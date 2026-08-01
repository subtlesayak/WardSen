# RustSec Audit Notes

Last checked for the pre-1.0 Windows hardening pass:

```bash
cd apps/desktop/src-tauri
cargo audit
```

Result:

- `cargo audit` completed with exit code `0`.
- No blocking RustSec vulnerability failures were reported.
- RustSec reported warning-class findings for transitive crates.

Warning groups currently observed:

- GTK3 and glib bindings: `atk`, `atk-sys`, `gdk`, `gdk-sys`, `gdkwayland-sys`, `gdkx11`, `gdkx11-sys`, `gtk`, `gtk-sys`, `gtk3-macros`, `glib`
- Macro/parser utilities: `proc-macro-error`
- Unicode identifier utilities: `unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version`

Notes:

- The `unic-*` warnings are pulled through Tauri's URL pattern stack.
- The GTK/glib warnings are target/platform transitive dependencies from the Tauri webview stack, not direct WardSen dependencies.
- Keep Tauri and its plugins current before release tagging, then rerun this audit.
- If a future audit exits nonzero for vulnerabilities, do not publish installer artifacts until the advisory is fixed, patched, or explicitly documented as non-applicable.
