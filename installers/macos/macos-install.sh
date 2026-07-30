#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
START=0
PROVIDERS_ONLY=0
PACKAGE_DESKTOP=0

usage() {
  cat <<'USAGE'
WardSen macOS bootstrap

Usage:
  ./installers/macos/macos-install.sh [--start] [--providers-only] [--package-desktop]

Options:
  --providers-only    Verify/install Node.js and provider CLIs, then exit.
  --start             Install npm dependencies and start the local dev app.
  --package-desktop   Verify packaging prerequisites and build the Tauri app.
  --help              Show this help text.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --start) START=1 ;;
    --providers-only) PROVIDERS_ONLY=1 ;;
    --package-desktop) PACKAGE_DESKTOP=1 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

require_brew() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required for automatic prerequisite installation." >&2
    echo "Install Homebrew or install the missing tool manually, then rerun this script." >&2
    exit 1
  fi
}

require_command() {
  local name="$1"
  local brew_formula="${2:-}"
  if command -v "$name" >/dev/null 2>&1; then
    return
  fi
  if [[ -z "$brew_formula" ]]; then
    echo "$name is required." >&2
    exit 1
  fi
  require_brew
  brew install "$brew_formula"
}

require_node_version() {
  require_command node node
  local version_text
  version_text="$(node -p 'process.versions.node')"
  local major minor
  IFS=. read -r major minor _patch <<<"$version_text"
  if { [[ "$major" -eq 20 && "$minor" -ge 19 ]] || [[ "$major" -ge 22 ]]; }; then
    return
  fi
  echo "WardSen's current packages require Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer. Detected Node.js $version_text. Update Node.js LTS and rerun this installer." >&2
  exit 1
}

require_xcode_tools() {
  if xcode-select -p >/dev/null 2>&1; then
    return
  fi
  echo "Xcode Command Line Tools are required for Tauri packaging." >&2
  echo "Run: xcode-select --install" >&2
  exit 1
}

install_provider_prerequisites() {
  require_node_version
  require_command bw bitwarden-cli
  if ! command -v keepassxc-cli >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      brew install --cask keepassxc
    else
      echo "KeePassXC CLI is optional but recommended for KeePassXC provider support." >&2
    fi
  fi
  bw --version
  echo "WardSen provider prerequisites checked."
}

start_wardsen() {
  cd "$ROOT"
  npm install
  npm run dev
}

build_desktop_package() {
  require_xcode_tools
  require_command rustup rustup-init
  if ! command -v cargo >/dev/null 2>&1; then
    echo "Cargo was not found after rustup installation. Open a new shell or source your shell profile, then rerun." >&2
    exit 1
  fi
  cd "$ROOT"
  npm ci
  npm run build:server
  npm run build:web
  npm run desktop:build
}

install_provider_prerequisites
if [[ "$PROVIDERS_ONLY" -eq 1 ]]; then
  exit 0
fi
if [[ "$PACKAGE_DESKTOP" -eq 1 ]]; then
  build_desktop_package
  exit 0
fi
if [[ "$START" -eq 1 ]]; then
  start_wardsen
  exit 0
fi

usage
