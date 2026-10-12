#!/usr/bin/env bash
# Fail if bundled binaries require glibc newer than Kylin V10 baseline (2.31).
set -euo pipefail

TARGET="${1:-}"
MAX_ALLOWED="${2:-2.31}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <path-to-dir-or-binary> [max-glibc]" >&2
  exit 1
fi

if ! command -v readelf >/dev/null 2>&1; then
  echo "readelf not found; skip glibc verification" >&2
  exit 0
fi

version_gt() {
  [[ "$(printf '%s\n' "$1" "$2" | sort -V | tail -1)" == "$1" && "$1" != "$2" ]]
}

highest="0"
while IFS= read -r -d '' file; do
  while read -r tag; do
    ver="${tag#GLIBC_}"
    if version_gt "$ver" "$highest"; then
      highest="$ver"
    fi
  done < <(readelf -V "$file" 2>/dev/null | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)*' || true)
done < <(find "$TARGET" \( -type f -name '*.so*' -o -type f -perm -111 \) -print0 2>/dev/null)

echo "Highest GLIBC required: ${highest:-unknown}"

if [[ "$highest" == "0" || -z "$highest" ]]; then
  echo "Warning: could not detect GLIBC version symbols" >&2
  exit 0
fi

if version_gt "$highest" "$MAX_ALLOWED"; then
  echo "ERROR: binary requires GLIBC ${highest}, max allowed is ${MAX_ALLOWED} (Kylin V10)" >&2
  exit 1
fi

echo "GLIBC check passed (<= ${MAX_ALLOWED})"
