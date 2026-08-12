#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUNDLE_ROOT="${1:-apps/desktop/src-tauri/target/release/bundle}"
APP_PATH="$BUNDLE_ROOT/macos/WardSen.app"

if [[ ! -d "$BUNDLE_ROOT" ]]; then
  echo "Bundle root does not exist: $BUNDLE_ROOT" >&2
  exit 1
fi

if [[ -d "$APP_PATH" ]]; then
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  spctl --assess --type execute --verbose "$APP_PATH"
else
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

shopt -s nullglob
dmg_files=("$BUNDLE_ROOT"/dmg/*.dmg)
if (( ${#dmg_files[@]} == 0 )); then
  echo "No DMG artifacts found under $BUNDLE_ROOT/dmg" >&2
  exit 1
fi

for dmg in "${dmg_files[@]}"; do
  xcrun stapler validate "$dmg"
done

WARDSEN_BUNDLE_ROOT="$BUNDLE_ROOT" \
WARDSEN_SIGNING_PLATFORM="${WARDSEN_SIGNING_PLATFORM:-macos}" \
WARDSEN_SIGNING_METHOD="${WARDSEN_SIGNING_METHOD:-developer-id-notarized}" \
WARDSEN_SIGNING_VERIFIER="${WARDSEN_SIGNING_VERIFIER:-codesign/spctl/stapler}" \
node "$ROOT/scripts/write-signing-evidence.mjs"
