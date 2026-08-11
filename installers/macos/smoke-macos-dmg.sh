#!/usr/bin/env bash
set -euo pipefail

bundle_root="${1:-apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle}"

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required for macOS DMG smoke tests." >&2
  exit 1
fi

dmg_path="$(find "$bundle_root/dmg" -maxdepth 1 -type f -name "*.dmg" | head -n 1)"
if [ -z "$dmg_path" ]; then
  echo "No DMG found under $bundle_root/dmg" >&2
  exit 1
fi

mount_point="$(mktemp -d "${TMPDIR:-/tmp}/wardsen-dmg-smoke.XXXXXX")"
cleanup() {
  hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  rmdir "$mount_point" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil attach "$dmg_path" -mountpoint "$mount_point" -nobrowse -readonly -quiet

app_path="$(find "$mount_point" -maxdepth 1 -type d -name "WardSen.app" | head -n 1)"
if [ -z "$app_path" ]; then
  echo "WardSen.app was not found in $dmg_path" >&2
  exit 1
fi

plist="$app_path/Contents/Info.plist"
executable="$app_path/Contents/MacOS/wardsen"
server_bundle="$app_path/Contents/Resources/server/index.cjs"
node_runtime="$app_path/Contents/Resources/runtime/node"

for required_path in "$plist" "$executable" "$server_bundle" "$node_runtime"; do
  if [ ! -e "$required_path" ]; then
    echo "Missing required app bundle path: $required_path" >&2
    exit 1
  fi
done

if [ ! -x "$executable" ]; then
  echo "WardSen app executable is not executable: $executable" >&2
  exit 1
fi

if [ ! -x "$node_runtime" ]; then
  echo "Bundled Node runtime is not executable: $node_runtime" >&2
  exit 1
fi

bundle_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
if [ "$bundle_identifier" != "dev.wardsen.desktop" ]; then
  echo "Unexpected CFBundleIdentifier: $bundle_identifier" >&2
  exit 1
fi

"$node_runtime" --version >/dev/null
"$node_runtime" --check "$server_bundle" >/dev/null

echo "WardSen macOS DMG smoke passed: $dmg_path"
