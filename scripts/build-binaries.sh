#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
GO_DIR="$ROOT_DIR/packages/compiler/go"
PACKAGES_DIR="$ROOT_DIR/packages"

echo "==> Building Go binaries for all platforms..."

# Ensure Go dependencies are synced
echo "==> Syncing Go dependencies..."
"$GO_DIR/scripts/sync-shims.sh"

cd "$GO_DIR"

# Build function
build_platform() {
  local goos=$1
  local goarch=$2
  local npm_platform=$3

  local output_dir="$PACKAGES_DIR/compiler-$npm_platform/bin"

  if [ "$goos" = "windows" ]; then
    local output_file="$output_dir/typical.exe"
  else
    local output_file="$output_dir/typical"
  fi

  echo "==> Building for $goos/$goarch -> compiler-$npm_platform..."

  mkdir -p "$output_dir"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -o "$output_file" ./cmd/typical

  echo "    Created: $output_file"
}

# only run these if WASM_ONLY is not set
if [ -z "$WASM_ONLY" ]; then

  # Build dev binary
  go build -o "$GO_DIR/bin/typical" ./cmd/typical

  # Build all platforms
  build_platform darwin arm64 darwin-arm64
  build_platform darwin amd64 darwin-x64
  build_platform linux arm64 linux-arm64
  build_platform linux amd64 linux-x64
  build_platform windows arm64 win32-arm64
  build_platform windows amd64 win32-x64
fi

# Build WASM (js/wasm for browser compatibility)
echo "==> Building for js/wasm -> compiler-wasm..."
mkdir -p "$PACKAGES_DIR/compiler-wasm/bin"
GOOS=js GOARCH=wasm go build -o "$PACKAGES_DIR/compiler-wasm/bin/typical.wasm" ./cmd/typical-wasm
echo "    Created: $PACKAGES_DIR/compiler-wasm/bin/typical.wasm"

echo ""
echo "==> All binaries built successfully!"
echo ""
echo "Binary sizes:"
for npm_platform in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-arm64 win32-x64; do
  if [[ "$npm_platform" == win32-* ]]; then
    binary="$PACKAGES_DIR/compiler-$npm_platform/bin/typical.exe"
  else
    binary="$PACKAGES_DIR/compiler-$npm_platform/bin/typical"
  fi

  if [ -f "$binary" ]; then
    size=$(ls -lh "$binary" | awk '{print $5}')
    echo "  compiler-$npm_platform: $size"
  fi
done

# WASM size
wasm_binary="$PACKAGES_DIR/compiler-wasm/bin/typical.wasm"
if [ -f "$wasm_binary" ]; then
  size=$(ls -lh "$wasm_binary" | awk '{print $5}')
  echo "  compiler-wasm: $size"
fi
