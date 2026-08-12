# macOS Testing Handoff

Use this checklist on a macOS machine for WardSen's remaining provider and packaging proof. Run one block at a time. Each block has a bounded command and a clear stop condition.

Do not paste a Bitwarden master password, raw `BW_SESSION` value, Apple signing secret, or certificate into Codex, a command line, a file, or a screenshot.

## 1. Prepare The Checkout

Use the exact commit or release tag being tested. A release candidate must be committed and tagged before its GitHub workflow can attest it.

```bash
npm ci
npm run check
npm test
npm run build
npm run prepare:desktop-runtime
npm run smoke:packaged
```

Expected result: `smoke:packaged` finishes within its 15-second startup and 5-second request limits. Its JSON evidence reports `accountCount: 1` and `crashRecovery.accountCountAfterRestart: 1`.

Stop if any command fails. Report only the safe error output and the failing command.

## 2. Bitwarden Send Live Contract

This is opt-in and creates one disposable 15-minute, one-access Bitwarden Send in a dedicated temporary CLI profile. The test checks create and status, then revokes the Send in cleanup even when an assertion fails.

First confirm the Bitwarden CLI is installed and visible to this Terminal session:

```bash
command -v bw
bw --version
```

If either command fails, install the Bitwarden CLI from the official provider guidance in WardSen, close and reopen Terminal, and repeat this check. Do not point the test at a shared WardSen profile.

Create an isolated temporary profile and sign in there. `bw login` and `bw unlock --raw` prompt in Terminal; the raw result stays in the shell variable and must not be printed:

```bash
export WARDSEN_BITWARDEN_LIVE_PROFILE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wardsen-bw-live.XXXXXX")"
export BITWARDENCLI_APPDATA_DIR="$WARDSEN_BITWARDEN_LIVE_PROFILE_DIR"
bw login your-test-account@example.com
export WARDSEN_BITWARDEN_LIVE_SESSION="$(bw unlock --raw)"
unset BITWARDENCLI_APPDATA_DIR
```

Only after Bitwarden is unlocked, run:

```bash
WARDSEN_BITWARDEN_LIVE_TEST=true npm run test:bitwarden-send:live
```

Expected result: one passing test. It does not access any saved credential; it generates a random disposable password locally and revokes the created Send before completion.

After the test, close the temporary Bitwarden profile with `bw logout`, then unset `WARDSEN_BITWARDEN_LIVE_SESSION` and `WARDSEN_BITWARDEN_LIVE_PROFILE_DIR` in that Terminal. Do not report either value.

Stop immediately if login prompts for an email/device verification that cannot be completed, `bw` cannot be found, the test does not revoke the Send, or the test exceeds 90 seconds.

## 3. Signed DMG Lifecycle Evidence

Run this only with a previous and current signed/notarized DMG on a disposable macOS account. It is intentionally interactive because an operator must verify that a harmless vault-account record survives the upgrade.

```bash
./installers/macos/test-macos-dmg-lifecycle.sh \
  --previous-dmg /absolute/path/to/previous.dmg \
  --dmg /absolute/path/to/current.dmg \
  --bundle-root /absolute/path/to/current/bundle \
  --interactive \
  --confirm-vault-accounts-preserved
```

Expected result: `INSTALL-LIFECYCLE-EVIDENCE-macos*.json` is created in the bundle root. Then regenerate checksums and require the lifecycle evidence:

```bash
WARDSEN_BUNDLE_ROOT=/absolute/path/to/current/bundle npm run release:checksums
WARDSEN_BUNDLE_ROOT=/absolute/path/to/current/bundle \
WARDSEN_INSTALL_LIFECYCLE_REQUIRED=true \
npm run release:verify-evidence
```

Do not substitute an unsigned DMG, CI smoke record, or a regular daily-use Mac account for this proof.

## 4. New Codex Task Prompt

In the new macOS Codex task, use this prompt:

```text
Read docs/macos-testing-handoff.md. Start at section 1. Run one bounded command at a time and stop after a failure. Never request or print passwords, Bitwarden session tokens, certificates, or Apple secrets. Report the command result, redacting any sensitive value.
```
