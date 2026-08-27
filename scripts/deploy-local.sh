#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRAEFIK_IP="$(kubectl -n infra get svc traefik -o jsonpath='{.spec.clusterIP}')"

kubectl create namespace mariner --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k "$ROOT_DIR/deploy/kustomize/local"

# The local Kustomize namespace transformer places the bootstrap CA Certificate
# in infra. ClusterIssuer reads its CA keypair from cert-manager, and Mariner
# needs a copy in its own namespace.
kubectl -n infra wait --for=condition=Ready certificate/sslip-io-ca --timeout=2m
for namespace in cert-manager mariner; do
  cert="$(kubectl -n infra get secret sslip-io-ca -o jsonpath='{.data.tls\.crt}' | base64 -D)"
  key="$(kubectl -n infra get secret sslip-io-ca -o jsonpath='{.data.tls\.key}' | base64 -D)"
  kubectl -n "$namespace" create secret generic sslip-io-ca \
    --from-literal=tls.crt="$cert" --from-literal=tls.key="$key" \
    --dry-run=client -o yaml | kubectl apply -f -
done
kubectl -n infra wait --for=condition=Ready certificate/sslip-io-tls --timeout=2m

helm upgrade --install mariner "$ROOT_DIR/deploy/helm/mariner" \
  --namespace mariner \
  --set image.repository=localhost/mariner \
  --set image.tag=local \
  --set image.pullPolicy=Never \
  --set oidc.issuer=https://keycloak.127.0.0.1.sslip.io/realms/mariner \
  --set oidc.clientId=mariner \
  --set oidc.clientSecret='MarinerClientSecret123!' \
  --set oidc.redirectUrl=https://mariner.127.0.0.1.sslip.io/auth/callback \
  --set caBundle.secretName=sslip-io-ca \
  --set cookieSecret='local-cookie-secret-change-me-1234567890' \
  --set ingress.enabled=true \
  --set ingress.className=traefik \
  --set 'ingress.hosts[0].host=mariner.127.0.0.1.sslip.io' \
  --set 'ingress.hosts[0].paths[0].path=/' \
  --set 'ingress.hosts[0].paths[0].pathType=Prefix' \
  --set 'ingress.tls[0].secretName=sslip-io-tls' \
  --set 'ingress.tls[0].hosts[0]=mariner.127.0.0.1.sslip.io' \
  --set "hostAliases[0].ip=$TRAEFIK_IP" \
  --set 'hostAliases[0].hostnames[0]=keycloak.127.0.0.1.sslip.io' \
  --server-side=false \
  --wait --timeout 10m
