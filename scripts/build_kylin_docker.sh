#!/usr/bin/env bash
# Build .deb inside Ubuntu 20.04 Docker (glibc 2.31) — same flow as en-word.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${FLW_KYLIN_IMAGE:-flw-kylin-builder}"
ARCH="${ARCH:-amd64}"
case "$ARCH" in
  arm64) PLATFORM="${FLW_DOCKER_PLATFORM:-linux/arm64}" ;;
  *) PLATFORM="${FLW_DOCKER_PLATFORM:-linux/amd64}" ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop, or push to GitHub Actions." >&2
  exit 1
fi

echo "==> Building Linux ${ARCH} builder image (${PLATFORM})..."
BUILD_CMD=(docker build --platform "$PLATFORM"
  -f "$ROOT/packaging/docker/Dockerfile.kylin-build"
  -t "$IMAGE")

if [[ -n "${DOCKER_BUILDX_CACHE:-}" ]] && docker buildx version >/dev/null 2>&1; then
  CACHE_DIR="${RUNNER_TEMP:-/tmp}/flw-docker-cache"
  mkdir -p "$CACHE_DIR"
  BUILD_CMD=(docker buildx build --platform "$PLATFORM" --load
    --cache-from "type=local,src=${CACHE_DIR}"
    --cache-to "type=local,dest=${CACHE_DIR}-new,mode=max"
    -f "$ROOT/packaging/docker/Dockerfile.kylin-build"
    -t "$IMAGE")
fi

"${BUILD_CMD[@]}" "$ROOT"

if [[ -d "${RUNNER_TEMP:-/tmp}/flw-docker-cache-new" ]]; then
  rm -rf "${RUNNER_TEMP:-/tmp}/flw-docker-cache"
  mv "${RUNNER_TEMP:-/tmp}/flw-docker-cache-new" "${RUNNER_TEMP:-/tmp}/flw-docker-cache"
fi

echo "==> Building Kylin/Ubuntu .deb inside Docker (${PLATFORM}, ${ARCH})..."
docker run --rm --platform "$PLATFORM" \
  -v "$ROOT:/app" \
  -w /app \
  -e ARCH="$ARCH" \
  -e PYTHON=/opt/python/bin/python3 \
  "$IMAGE" \
  bash -lc '
    set -euo pipefail
    export PATH="/opt/python/bin:${PATH}"
    python3 --version
    node --version

    # Host node_modules may be for another OS/arch.
    rm -rf frontend/node_modules
    rm -rf build/deb-root

    # rsync may be missing in slim image — install if needed
    if ! command -v rsync >/dev/null 2>&1; then
      apt-get update && apt-get install -y --no-install-recommends rsync
    fi

    bash scripts/build_kylin.sh
  '

echo
echo "Done. Debian package:"
ls -lh "$ROOT"/release/*.deb
