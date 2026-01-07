#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GO_DIR="$(dirname "$SCRIPT_DIR")"

# Temporary directory for tsgolint
TSGOLINT_DIR="$GO_DIR/.tsgolint-cache"

echo "==> Syncing shims from tsgolint..."

# Clone or update tsgolint
if [ -d "$TSGOLINT_DIR" ]; then
    echo "Updating tsgolint..."
    cd "$TSGOLINT_DIR"
    git fetch origin
    git reset --hard origin/main
else
    echo "Cloning tsgolint..."
    git clone --depth 1 https://github.com/oxc-project/tsgolint.git "$TSGOLINT_DIR"
    cd "$TSGOLINT_DIR"
fi

# Initialize submodules to get the exact typescript-go version
git submodule update --init

# Get the typescript-go commit hash
TSGO_COMMIT=$(cd typescript-go && git rev-parse HEAD)
echo "==> tsgolint uses typescript-go commit: $TSGO_COMMIT"

# Copy shims to our project
echo "==> Copying shims..."
rm -rf "$GO_DIR/shim"
cp -r "$TSGOLINT_DIR/shim" "$GO_DIR/shim"
# Copy our custom extensions (stored in internal/shim/) to the shim directories
# Using copy instead of symlink because the shim directory gets wiped by rm -rf above
cp "$GO_DIR/internal/shim/checker_extensions.go" "$GO_DIR/shim/checker/typical_extensions.go"
cp "$GO_DIR/internal/shim/project/session_extensions.go" "$GO_DIR/shim/project/typical_extensions.go"

# Clone or update typescript-go to the same commit (no submodules!)
echo "==> Updating typescript-go to $TSGO_COMMIT..."
if [ -d "$GO_DIR/typescript-go" ]; then
    cd "$GO_DIR/typescript-go"
    git fetch origin
else
    echo "Cloning typescript-go..."
    git clone https://github.com/microsoft/typescript-go.git "$GO_DIR/typescript-go"
    cd "$GO_DIR/typescript-go"
fi
git checkout "$TSGO_COMMIT"

# Apply patches if they exist
echo "==> Applying patches from tsgolint..."
if ls "$TSGOLINT_DIR/patches"/*.patch 1> /dev/null 2>&1; then
    for patch in "$TSGOLINT_DIR/patches"/*.patch; do
        echo "Applying $(basename "$patch")..."
        git am --3way --no-gpg-sign "$patch" || {
            echo "Patch may already be applied, continuing..."
            git am --abort 2>/dev/null || true
        }
    done
fi

# Copy internal/collections if needed (tsgolint copies this)
echo "==> Copying internal/collections..."
mkdir -p "$GO_DIR/internal/collections"
find "$TSGOLINT_DIR/typescript-go/internal/collections" -type f ! -name '*_test.go' -exec cp {} "$GO_DIR/internal/collections/" \;

# Copy selected utils from tsgolint (for IsBuiltinSymbolLike, type helpers, etc.)
echo "==> Copying internal/utils..."
rm -rf "$GO_DIR/internal/utils"
mkdir -p "$GO_DIR/internal/utils"
cp "$TSGOLINT_DIR/internal/utils/builtin_symbol_likes.go" "$GO_DIR/internal/utils/"
cp "$TSGOLINT_DIR/internal/utils/set.go" "$GO_DIR/internal/utils/"
cp "$TSGOLINT_DIR/internal/utils/ts_api_utils.go" "$GO_DIR/internal/utils/"
cp "$TSGOLINT_DIR/internal/utils/ts_eslint.go" "$GO_DIR/internal/utils/"
cp "$TSGOLINT_DIR/internal/utils/utils.go" "$GO_DIR/internal/utils/"

echo "==> Sync complete!"
echo "typescript-go is now at: $TSGO_COMMIT"
