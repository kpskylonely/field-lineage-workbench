#!/usr/bin/env bash
# Build field-lineage-workbench .deb for Kylin V10 / Ubuntu 20.04 (glibc 2.31).
# Must run on Linux (use scripts/build_kylin_docker.sh on macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
if [[ -z "${ARCH:-}" ]]; then
  if command -v dpkg >/dev/null 2>&1; then
    ARCH="$(dpkg --print-architecture)"
  elif [[ "$(uname -m)" == "aarch64" ]]; then
    ARCH="arm64"
  else
    ARCH="amd64"
  fi
fi

PY="${PYTHON:-$(command -v python3)}"
RELEASE_DIR="$ROOT/release"
DEB_ROOT="$ROOT/build/deb-root"
OPT_DIR="$DEB_ROOT/opt/field-lineage-workbench"
DEB_FILE="$RELEASE_DIR/field-lineage-workbench_${VERSION}_${ARCH}.deb"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Kylin/Linux packages must be built on Linux." >&2
  echo "On macOS run: bash scripts/build_kylin_docker.sh" >&2
  exit 1
fi

if [[ ! -x "$PY" ]]; then
  echo "Python not found. Set PYTHON=/path/to/python3" >&2
  exit 1
fi

echo "==> Version ${VERSION} · arch ${ARCH}"
echo "==> Using Python: $PY ($("$PY" --version))"

echo "==> Building frontend..."
(cd frontend && npm ci && npm run build)
if [[ ! -f frontend/dist/index.html ]]; then
  echo "frontend/dist/index.html missing after build" >&2
  exit 1
fi

echo "==> Assembling deb root..."
rm -rf "$DEB_ROOT"
mkdir -p "$OPT_DIR"/{app,data,vendor}
mkdir -p "$DEB_ROOT/DEBIAN"
mkdir -p "$DEB_ROOT/usr/bin"
mkdir -p "$DEB_ROOT/lib/systemd/system"
mkdir -p "$DEB_ROOT/usr/share/doc/field-lineage-workbench"

# App code (no macOS vendor / node_modules)
rsync -a --delete \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  backend "$OPT_DIR/app/"
mkdir -p "$OPT_DIR/app/frontend"
rsync -a frontend/dist/ "$OPT_DIR/app/frontend/dist/"
install -m 644 requirements.txt "$OPT_DIR/app/requirements.txt"
install -m 644 VERSION "$OPT_DIR/app/VERSION"

# Portable Python from builder image (indygreg under /opt/python)
if [[ -d /opt/python && -x /opt/python/bin/python3 ]]; then
  echo "==> Bundling portable Python from /opt/python..."
  rsync -a /opt/python/ "$OPT_DIR/python/"
  APP_PY="$OPT_DIR/python/bin/python3"
else
  echo "==> No /opt/python; creating venv with system Python (target must have matching python3)..."
  "$PY" -m venv "$OPT_DIR/venv"
  APP_PY="$OPT_DIR/venv/bin/python3"
fi

echo "==> Installing Python dependencies into package..."
"$APP_PY" -m pip install --upgrade pip setuptools wheel
"$APP_PY" -m pip install -r "$OPT_DIR/app/requirements.txt"

# Point FRONTEND path: main.py uses parents[2] from backend/app/main.py → app/
# Layout: /opt/.../app/backend/app/main.py → parents[2] = /opt/.../app
# and FRONTEND = app/frontend — matches.

mkdir -p "$OPT_DIR/bin" "$DEB_ROOT/usr/bin"
cat > "$OPT_DIR/bin/field-lineage-workbench" <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
ROOT="/opt/field-lineage-workbench"
export PYTHONPATH="${ROOT}/app${PYTHONPATH:+:$PYTHONPATH}"
if [[ -x "${ROOT}/python/bin/python3" ]]; then
  PY="${ROOT}/python/bin/python3"
elif [[ -x "${ROOT}/venv/bin/python3" ]]; then
  PY="${ROOT}/venv/bin/python3"
else
  echo "No bundled Python found under ${ROOT}" >&2
  exit 1
fi
cd "${ROOT}/app"
mkdir -p "${ROOT}/data"
export FLW_DATA_DIR="${FLW_DATA_DIR:-${ROOT}/data}"
PORT="${PORT:-8766}"
HOST="${HOST:-0.0.0.0}"
exec "$PY" -m uvicorn backend.app.main:app --host "$HOST" --port "$PORT"
WRAP
chmod 755 "$OPT_DIR/bin/field-lineage-workbench"
ln -sf /opt/field-lineage-workbench/bin/field-lineage-workbench \
  "$DEB_ROOT/usr/bin/field-lineage-workbench"

install -m 644 packaging/field-lineage-workbench.service \
  "$DEB_ROOT/lib/systemd/system/field-lineage-workbench.service"

cat > "$DEB_ROOT/usr/share/doc/field-lineage-workbench/README" <<EOF
字段级数据血缘与重构影响分析工作台 ${VERSION}

启动: sudo systemctl start field-lineage-workbench
访问: http://127.0.0.1:8766
数据目录: /opt/field-lineage-workbench/data
EOF

echo "==> Verifying GLIBC (<= 2.31)..."
bash "$ROOT/scripts/verify_glibc.sh" "$OPT_DIR" "2.31"

INSTALLED_SIZE="$(du -sk "$DEB_ROOT" | awk '{print $1}')"

cat > "$DEB_ROOT/DEBIAN/control" <<EOF
Package: field-lineage-workbench
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Installed-Size: ${INSTALLED_SIZE}
Maintainer: Field Lineage Workbench <local@field-lineage>
Depends: libc6 (>= 2.31)
Description: Field-level lineage and refactor impact workbench
 Web workbench for database refactor analysis (P0–P7 / 29 tables).
 Bundled portable Python + React UI. Targets Kylin V10 / Ubuntu 20.04.
EOF

cat > "$DEB_ROOT/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
mkdir -p /opt/field-lineage-workbench/data
chmod 755 /opt/field-lineage-workbench/bin/field-lineage-workbench || true
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
echo "Install OK. Start with: sudo systemctl enable --now field-lineage-workbench"
echo "Then open http://127.0.0.1:8766"
EOF
chmod 755 "$DEB_ROOT/DEBIAN/postinst"

cat > "$DEB_ROOT/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop field-lineage-workbench >/dev/null 2>&1 || true
  systemctl disable field-lineage-workbench >/dev/null 2>&1 || true
fi
EOF
chmod 755 "$DEB_ROOT/DEBIAN/prerm"

mkdir -p "$RELEASE_DIR"
rm -f "$DEB_FILE"
dpkg-deb --build --root-owner-group "$DEB_ROOT" "$DEB_FILE"

echo
echo "Done."
echo "  Debian pkg: $DEB_FILE"
ls -lh "$DEB_FILE"
echo
echo "Install: sudo dpkg -i '$DEB_FILE'"
