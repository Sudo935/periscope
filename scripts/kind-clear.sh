#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${1:-mariner}"
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  kind delete cluster --name "$CLUSTER_NAME"
else
  echo "kind cluster $CLUSTER_NAME does not exist"
fi
