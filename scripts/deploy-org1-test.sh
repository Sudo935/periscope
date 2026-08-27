#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE="mariner"
MINIO_NAMESPACE="infra"
MINIO_ENDPOINT="http://minio.infra.svc.cluster.local:9000"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
for bucket in one two three; do
  kubectl -n "$NAMESPACE" create secret generic "org1-bucket-${bucket}-s3" \
    --from-literal=accessKey=minioadmin \
    --from-literal=secretKey=MinioAdmin123! \
    --dry-run=client -o yaml | kubectl apply -f -
done

kubectl -n "$MINIO_NAMESPACE" run minio-org1-bootstrap --rm -i --restart=Never \
  --image=quay.io/minio/mc:latest --command -- sh -c \
  'mc alias set local "$0" minioadmin MinioAdmin123! >/dev/null && for bucket in org1-bucket-one org1-bucket-two org1-bucket-three; do mc mb --ignore-existing "local/$bucket"; done' \
  "$MINIO_ENDPOINT"

# Keycloak realm/client/user/group configuration is idempotent. Use the admin
# REST API from the host so this works with the minimal official image, which
# does not include awk/curl and has limited kcadm output formatting.
KC_BASE="https://keycloak.127.0.0.1.sslip.io"
KC_TOKEN="$(curl -ksSf -X POST "$KC_BASE/realms/master/protocol/openid-connect/token" \
  -d username=admin -d password='MarinerAdmin123!' -d grant_type=password -d client_id=admin-cli \
  | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
test -n "$KC_TOKEN"
KC_AUTH=(-H "Authorization: Bearer $KC_TOKEN" -H 'Content-Type: application/json')

client_id="$(curl -ksSf "${KC_AUTH[@]}" "$KC_BASE/admin/realms/mariner/clients?clientId=mariner" \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
user_id="$(curl -ksSf "${KC_AUTH[@]}" "$KC_BASE/admin/realms/mariner/users?username=demo" \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
group_id="$(curl -ksSf "${KC_AUTH[@]}" "$KC_BASE/admin/realms/mariner/groups?search=ORG1" \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
if [ -z "$group_id" ]; then
  curl -ksSf -X POST "${KC_AUTH[@]}" "$KC_BASE/admin/realms/mariner/groups" \
    -d '{"name":"ORG1"}' >/dev/null
  group_id="$(curl -ksSf "${KC_AUTH[@]}" "$KC_BASE/admin/realms/mariner/groups?search=ORG1" \
    | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi
curl -ksSf -X PUT "${KC_AUTH[@]}" \
  "$KC_BASE/admin/realms/mariner/users/$user_id/groups/$group_id" >/dev/null

mapper_url="$KC_BASE/admin/realms/mariner/clients/$client_id/protocol-mappers/models"
if ! curl -ksSf "${KC_AUTH[@]}" "$mapper_url" | grep -q '"name"[[:space:]]*:[[:space:]]*"groups"'; then
  curl -ksSf -X POST "${KC_AUTH[@]}" "$mapper_url" \
    -d '{"name":"groups","protocol":"openid-connect","protocolMapper":"oidc-group-membership-mapper","config":{"full.path":"false","claim.name":"groups","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true"}}' >/dev/null
fi

"$ROOT_DIR/scripts/build-image.sh"
TRAEFIK_IP="$(kubectl -n infra get svc traefik -o jsonpath='{.spec.clusterIP}')"
helm upgrade --install mariner "$ROOT_DIR/deploy/helm/mariner" \
  --namespace "$NAMESPACE" \
  -f "$ROOT_DIR/deploy/helm/mariner/values-local-org1.yaml" \
  --set "hostAliases[0].ip=$TRAEFIK_IP" \
  --set 'hostAliases[0].hostnames[0]=keycloak.127.0.0.1.sslip.io' \
  --wait --timeout 10m
