#!/usr/bin/env bash
set -euo pipefail

APPIMAGE="$(find release -maxdepth 1 -name '*.AppImage' | head -n 1)"
if [ -z "$APPIMAGE" ] || [ ! -x "$APPIMAGE" ]; then
  echo "Error: No executable AppImage found in release/" >&2
  exit 1
fi

DATA_DIR="$(mktemp -d)"
trap 'rm -rf "$DATA_DIR"' EXIT

PORT=4321
RUNNER=()
if command -v xvfb-run >/dev/null 2>&1; then
  RUNNER=(xvfb-run -a)
fi

echo "Running initial smoke test..."
UNTERWEGS_DATA_DIR="$DATA_DIR" UNTERWEGS_PORT="$PORT" "${RUNNER[@]}" "$APPIMAGE" --appimage-extract-and-run --no-sandbox --smoke-test

echo "Running restart and persistence smoke test..."
UNTERWEGS_DATA_DIR="$DATA_DIR" UNTERWEGS_PORT="$PORT" "${RUNNER[@]}" "$APPIMAGE" --appimage-extract-and-run --no-sandbox --smoke-test --smoke-restart

echo "All AppImage smoke tests passed!"
