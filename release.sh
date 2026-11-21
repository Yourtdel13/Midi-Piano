#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -f .signing.env ] || { echo "缺少 .signing.env"; exit 1; }
set -a; . ./.signing.env; set +a
./build.sh
