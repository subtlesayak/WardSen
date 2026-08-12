# RustSec Audit Notes

Last checked: 2026-08-11.

```bash
cd apps/desktop/src-tauri
cargo audit
```

Recorded audit result from the previous pre-1.0 hardening pass:

- `cargo audit` completed with exit code `0` at that time.
- No blocking RustSec vulnerability failures were reported in that recorded run.
- RustSec reported warning-class findings for transitive crates.

The 2026-08-11 local rerun could not refresh RustSec's advisory database because this environment exposes the Cargo advisory-cache path as read-only. Run `cargo audit` on a normal release machine and attach the output to the release checklist.

Dependabot follow-up:

- The high-severity `fast-uri` alerts are addressed in `package.json` and `package-lock.json`: the direct `3.x` path is pinned to `3.1.5`, Fast JSON Stringify uses its required `4.1.2` path, and its nested AJV dependency remains on the compatible `3.1.5` path. `npm audit --audit-level=high` reports zero vulnerabilities.
- Dependabot alert #1 (`GHSA-wrw7-89jp-8q8g`) remains open for transitive `glib` in `apps/desktop/src-tauri/Cargo.lock`. The patched release is `glib 0.20.0`, but the current published Tauri `2.11.5` graph requires `gtk 0.18.2`, which requires `glib ^0.18`. `cargo update -p glib --precise 0.20.0` therefore fails dependency resolution; forcing the version would produce an invalid graph.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passes with the refreshed compatible lockfile. Keep the `glib` alert visible and re-evaluate it when Tauri/Wry publishes a GTK/glib-compatible upgrade; do not dismiss it as fixed or silently suppress it.

Warning groups currently observed:

- GTK3 and glib bindings: `atk`, `atk-sys`, `gdk`, `gdk-sys`, `gdkwayland-sys`, `gdkx11`, `gdkx11-sys`, `gtk`, `gtk-sys`, `gtk3-macros`, `glib`
- Macro/parser utilities: `proc-macro-error`
- Unicode identifier utilities: `unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version`

Notes:

- The `unic-*` warnings are pulled through Tauri's URL pattern stack.
- The GTK/glib warnings are target/platform transitive dependencies from the Tauri webview stack, not direct WardSen dependencies.
- Tauri's published GTK dependency is documented in its [Cargo manifest](https://raw.githubusercontent.com/tauri-apps/tauri/v2.11.5/crates/tauri/Cargo.toml); keep Tauri and its plugins current before release tagging, then rerun this audit.
- If a future audit exits nonzero for vulnerabilities, do not publish installer artifacts until the advisory is fixed, patched, or explicitly documented as non-applicable.
