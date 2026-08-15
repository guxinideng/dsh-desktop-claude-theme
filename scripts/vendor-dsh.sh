#!/usr/bin/env bash
# Installs a private, isolated copy of @deepseek-ai/dsh into dsh-vendor/,
# for the "public" build to bundle via electron-builder's extraResources.
# Pinned to a specific version on purpose: this app's CSS/JS overrides
# target dsh's own build-hashed class names, which can change on any dsh
# release — bundling a version we've actually tested against, instead of
# "latest", is what keeps the theme from silently breaking for people who
# download the installer.
set -euo pipefail

DSH_VERSION="0.1.0-rc.6"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/dsh-vendor"

echo "Vendoring @deepseek-ai/dsh@$DSH_VERSION into $VENDOR_DIR"

rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"

cat > "$VENDOR_DIR/package.json" <<EOF
{
  "name": "dsh-vendor",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "@deepseek-ai/dsh": "$DSH_VERSION"
  }
}
EOF

(cd "$VENDOR_DIR" && npm install --omit=dev --no-audit --no-fund)

BIN="$VENDOR_DIR/node_modules/@deepseek-ai/dsh/lib/bin.js"
if [[ ! -f "$BIN" ]]; then
  echo "vendor-dsh: expected $BIN to exist after install — dsh's package layout may have changed." >&2
  exit 1
fi

# electron-builder's extraResources copy silently drops nested node_modules
# content (it shares the same default-ignore file matcher the main app's
# own packaging step uses to prune node_modules junk, and that kicks in
# here too) — a raw directory bundled that way loses everything. Zipping it
# first sidesteps the whole matcher: a single .zip file has no directory
# named "node_modules" for it to filter. main.js unzips this into the
# app's userData dir on first launch.
ZIP_PATH="$ROOT_DIR/dsh-vendor.zip"
echo "Zipping to $ZIP_PATH (electron-builder drops raw node_modules dirs from extraResources)"
rm -f "$ZIP_PATH"
(cd "$ROOT_DIR" && zip -qr "$ZIP_PATH" dsh-vendor -x '.*')

echo "Done. $(du -sh "$VENDOR_DIR" | cut -f1) at $VENDOR_DIR, $(du -sh "$ZIP_PATH" | cut -f1) zipped"
