#!/usr/bin/env bash
set -euo pipefail

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
