# Third-Party Provider Policy

WardSen is an independent open-source project. It is not affiliated with, endorsed by, sponsored by or approved by Bitwarden, 1Password, Proton, KeePassXC, Keeper, Ente, Password Pusher, Yopass, Onetime Secret or their respective companies.

This document defines the provider and trademark rules maintainers should check before publishing a WardSen release.

## Compatibility Scope

WardSen may identify third-party products only so users can choose the matching provider adapter.

WardSen may call user-installed, provider-published tools or documented local APIs, such as the Bitwarden `bw` CLI or KeePassXC `keepassxc-cli`, after the user has installed and authenticated those tools.

WardSen must not:

- Claim to be an official provider product.
- Use provider logos, icons, screenshots or brand styling without permission.
- Bundle provider binaries unless the license, trademark terms and redistribution requirements have been reviewed for that exact provider and release.
- Scrape provider websites or browser extensions.
- Use accessibility automation to extract vault contents.
- Reverse engineer private provider APIs.
- Bypass account limits, subscription boundaries, organization policies or access controls.
- Present generated secure links as impossible to save, copy or disclose after a recipient has viewed them.

## Naming Rules

Allowed wording:

- `Bitwarden adapter`
- `Uses the Bitwarden bw CLI installed by the user`
- `Open Bitwarden CLI install guide`
- `KeePassXC adapter`
- `Uses keepassxc-cli installed by the user`

Avoid wording:

- `Official WardSen Bitwarden app`
- `Bitwarden WardSen`
- `Bitwarden-approved`
- `Powered by Bitwarden`
- `Partnered with Bitwarden`
- Any phrase that implies endorsement, sponsorship, affiliation or provider control.

The same rule applies to planned delivery candidates such as Ente Paste, Password Pusher, Yopass, Onetime Secret and 1Password item sharing.

## Bitwarden Notes

Bitwarden publishes the `bw` CLI and documents CLI-based local API use through the Vault Management API. WardSen's Bitwarden adapter should remain a local wrapper around user-installed Bitwarden tooling.

### Provider Setup Wizard

WardSen's Bitwarden setup wizard may probe `bw --version`, open Bitwarden's official CLI guide, and save an operator-selected absolute executable path only after an explicit trust acknowledgement and successful local version check. It must not invoke `npm`, a package manager, an installer, or a provider download in the background.

Automatic provider-binary download is out of scope unless a future release adds a reviewed provider-specific manifest with a pinned artifact version, vendor-controlled HTTPS origin, checksum verification, platform signature verification where available, atomic installation, rollback handling, and test evidence. Until then, the user or their IT administrator installs the provider tool and WardSen verifies the selected local executable.

Bitwarden trademark guidance states that open-source copyright licenses do not grant trademark rights. WardSen must keep Bitwarden names limited to nominative compatibility references and must not use Bitwarden logos or market WardSen as a Bitwarden product.

References:

- Bitwarden CLI: https://bitwarden.com/help/cli/
- Bitwarden Password Manager APIs: https://bitwarden.com/help/bitwarden-apis/
- Bitwarden terms: https://bitwarden.com/terms/
- Bitwarden trademark guidelines: https://github.com/bitwarden/server/blob/main/TRADEMARK_GUIDELINES.md

## Release Checklist

Before publishing release assets:

1. Confirm README and release notes include the independent-project disclaimer.
2. Confirm provider names are used only for compatibility and setup instructions.
3. Confirm no provider logos, screenshots or brand assets were added.
4. Confirm installer artifacts do not bundle provider binaries by default.
5. Confirm provider setup links point to provider-controlled pages or documented package manager commands.
6. Confirm security copy describes limits honestly, especially expiry, view limits and revocation.
