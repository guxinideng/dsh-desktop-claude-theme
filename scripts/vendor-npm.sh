#!/usr/bin/env bash
# Installs a private, isolated copy of npm into npm-vendor/, for the Windows
# build to bundle via electron-builder's extraResources. This is npm itself
# (not dsh) — the Windows build has no fixed dsh version to ship, so it
# fetches @deepseek-ai/dsh@latest live on first launch instead, using this
# vendored npm running under Electron's own bundled Node
# (ELECTRON_RUN_AS_NODE, same trick as the vendored-dsh spawn path). npm's
# own CLI is plain JS with no native/compiled dependencies, so a copy
# installed here on macOS runs the same way under Windows-Electron's Node —
# unlike dsh's own dependency tree, which is NOT safe to cross-install this
# way (see vendor-dsh.sh).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/npm-vendor"

echo "Vendoring npm into $VENDOR_DIR"

rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"

cat > "$VENDOR_DIR/package.json" <<EOF
{
  "name": "npm-vendor",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "npm": "latest"
  }
}
EOF

(cd "$VENDOR_DIR" && npm install --omit=dev --no-audit --no-fund)

BIN="$VENDOR_DIR/node_modules/npm/bin/npm-cli.js"
if [[ ! -f "$BIN" ]]; then
  echo "vendor-npm: expected $BIN to exist after install — npm's package layout may have changed." >&2
  exit 1
fi

# Same electron-builder extraResources node_modules-stripping issue as
# dsh-vendor.zip — see that script's comment for the full explanation.
ZIP_PATH="$ROOT_DIR/npm-vendor.zip"
echo "Zipping to $ZIP_PATH"
rm -f "$ZIP_PATH"
(cd "$ROOT_DIR" && zip -qr "$ZIP_PATH" npm-vendor -x '.*')

echo "Done. $(du -sh "$VENDOR_DIR" | cut -f1) at $VENDOR_DIR, $(du -sh "$ZIP_PATH" | cut -f1) zipped"
