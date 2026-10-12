#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT/vendor:$ROOT${PYTHONPATH:+:$PYTHONPATH}"
PY="${PY:-/Users/shenwei/.local/share/uv/python/cpython-3.12-macos-x86_64-none/bin/python3.12}"
if [[ ! -x "$PY" ]]; then
  PY="$(command -v python3)"
fi
mkdir -p data

# Build Make-aligned React UI if dist is missing
if [[ ! -f frontend/dist/index.html ]]; then
  echo "Building frontend (Figma Make UI)…"
  (cd frontend && npm install && npm run build)
fi

PORT="${PORT:-8766}"
echo "Starting field-lineage-workbench on http://127.0.0.1:${PORT}"
exec "$PY" -m uvicorn backend.app.main:app --host 127.0.0.1 --port "$PORT" --reload
