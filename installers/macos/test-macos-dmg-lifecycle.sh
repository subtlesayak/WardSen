#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./installers/macos/test-macos-dmg-lifecycle.sh \
    --previous-dmg /path/to/previous.dmg \
    --dmg /path/to/current.dmg \
    --bundle-root /path/to/current/bundle \
    --interactive --confirm-vault-accounts-preserved

Runs on a disposable macOS test account. It mounts each signed/notarized DMG,
copies WardSen into a temporary Applications folder, pauses for the vault-account
upgrade checkpoint, uninstalls the temporary app and writes lifecycle evidence.
EOF
}

previous_dmg=""
current_dmg=""
bundle_root=""
interactive=false
confirmed_accounts=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --previous-dmg) previous_dmg="$2"; shift 2 ;;
    --dmg) current_dmg="$2"; shift 2 ;;
    --bundle-root) bundle_root="$2"; shift 2 ;;
    --interactive) interactive=true; shift ;;
    --confirm-vault-accounts-preserved) confirmed_accounts=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$interactive" != true || "$confirmed_accounts" != true ]]; then
  echo "Refusing lifecycle test without --interactive and --confirm-vault-accounts-preserved on a disposable macOS test account." >&2
  exit 2
fi
for required in "$previous_dmg" "$current_dmg" "$bundle_root"; do
  if [[ -z "$required" ]]; then usage >&2; exit 2; fi
done
for command in hdiutil ditto codesign spctl open node; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required." >&2; exit 1; }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$script_dir/../.." && pwd)"
previous_dmg="$(cd "$(dirname "$previous_dmg")" && pwd)/$(basename "$previous_dmg")"
current_dmg="$(cd "$(dirname "$current_dmg")" && pwd)/$(basename "$current_dmg")"
bundle_root="$(cd "$bundle_root" && pwd)"
[[ -f "$previous_dmg" && -f "$current_dmg" ]] || { echo "Both DMG files must exist." >&2; exit 1; }

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/wardsen-dmg-lifecycle.XXXXXX")"
previous_mount="$temp_root/previous-mount"
current_mount="$temp_root/current-mount"
install_root="$temp_root/Applications"
mkdir -p "$previous_mount" "$current_mount" "$install_root"

cleanup() {
  hdiutil detach "$previous_mount" -quiet >/dev/null 2>&1 || true
  hdiutil detach "$current_mount" -quiet >/dev/null 2>&1 || true
  rm -rf "$temp_root"
}
trap cleanup EXIT

mount_app() {
  local dmg="$1"
  local mount_point="$2"
  hdiutil attach "$dmg" -mountpoint "$mount_point" -nobrowse -readonly -quiet
  local app_path
  app_path="$(find "$mount_point" -maxdepth 1 -type d -name "WardSen.app" | head -n 1)"
  [[ -n "$app_path" ]] || { echo "WardSen.app was not found in $dmg" >&2; exit 1; }
  codesign --verify --deep --strict --verbose=2 "$app_path"
  spctl --assess --type execute --verbose "$app_path"
  printf '%s' "$app_path"
}

previous_app="$(mount_app "$previous_dmg" "$previous_mount")"
ditto "$previous_app" "$install_root/WardSen.app"
open "$install_root/WardSen.app"
read -r -p "Create a harmless test vault account in the previous WardSen version, close WardSen, then press Enter" _
hdiutil detach "$previous_mount" -quiet

current_app="$(mount_app "$current_dmg" "$current_mount")"
rm -rf "$install_root/WardSen.app"
ditto "$current_app" "$install_root/WardSen.app"
open "$install_root/WardSen.app"
read -r -p "Verify the same test vault account is present after upgrade, close WardSen, then press Enter" _
hdiutil detach "$current_mount" -quiet

rm -rf "$install_root/WardSen.app"
[[ ! -e "$install_root/WardSen.app" ]] || { echo "WardSen.app remains after temporary uninstall." >&2; exit 1; }

WARDSEN_BUNDLE_ROOT="$bundle_root" \
WARDSEN_INSTALL_LIFECYCLE_PLATFORM="macos" \
WARDSEN_INSTALL_LIFECYCLE_ARTIFACT="$current_dmg" \
WARDSEN_INSTALL_LIFECYCLE_TEST_ENV="disposable macOS test account" \
WARDSEN_INSTALL_LIFECYCLE_STEPS="fresh_install,launch,upgrade,vault_metadata_preserved,uninstall" \
node "$root/scripts/write-install-lifecycle-evidence.mjs"
