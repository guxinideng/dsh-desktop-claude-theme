# DSH Desktop

A community desktop shell and warm-toned theme for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

**Not an official DeepSeek product.** This is a personal reskin project: an
Electron wrapper around dsh's own web UI, with a warm cream/terracotta
theme, a font picker, a widened layout, and a few interaction tweaks
(quieter tool-call trace rows, translated trajectory-view labels). All of
it works by CSS variable overrides and DOM tweaks on top of dsh's existing
web interface — it doesn't fork or modify dsh itself.

## Download

Pre-built installers are on the [Releases page](https://github.com/guxinideng/dsh-desktop-claude-theme/releases) — macOS personal, macOS public, and Windows. See the caveats below before picking one.

## Three ways to build it

**Personal build** — you already have `@deepseek-ai/dsh` installed and
`dsh web` running:

```bash
npm install
npm run build:personal
```

Produces `dist/personal/*.dmg`. Small, since it doesn't bundle dsh.

**Public build** — for someone with nothing installed. Bundles a full,
pinned copy of `@deepseek-ai/dsh` and starts it automatically:

```bash
npm install
npm run build:public
```

Produces `dist/public/*.dmg`. Larger (~350MB) because dsh itself is
bundled. On first launch, if nothing is already listening on
`127.0.0.1:3080`, the app spawns its own bundled dsh instance instead
(using Electron's built-in Node runtime, so a recipient doesn't need
Node.js installed either). No API key or credentials are bundled — first
launch prompts for the recipient's own DeepSeek API key, same as a plain
install of dsh would.

**Windows build** — same shell and theme, ported to run on Windows. Doesn't
bundle a fixed dsh version like the mac public build does; instead it
bundles just `npm` and fetches `@deepseek-ai/dsh@latest` for real, live, the
first time you launch it:

```bash
npm install
npm run build:windows
```

Produces `dist/windows/*.exe` (portable, no installer wizard — just run it).
Needs internet on first launch to fetch dsh; after that it reuses what it
already installed. Trades the mac public build's "works offline, tested
against one pinned dsh version" for "always current, needs internet once" —
see the pinned-version caveat below for why that's a real tradeoff, not a
strict upgrade.

Either way you get the same app; the differences are whether dsh comes
along for the ride, and whether it's a version this theme has actually been
checked against.

## Running it without building

```bash
npm install
npm start
```

Requires `dsh web` already running at `127.0.0.1:3080`.

## Status / caveats

- **macOS: Apple Silicon only.** Windows: x64 only. No Intel Mac or ARM
  Windows builds.
- **Unsigned.** None of the three builds are code-signed or notarized (no
  Apple Developer account or Windows code-signing certificate behind this
  project), so macOS Gatekeeper will call it unidentified on first open —
  right-click → Open once to get past that. Windows SmartScreen will
  likely show a similar "unknown publisher" warning.
- **The mac public build is pinned to dsh `0.1.0-rc.6`; the Windows build
  always fetches the latest.** This app's theme works by targeting dsh's
  own CSS class names, which are build-hashed and can change on any dsh
  release. Pinning (mac) means it's tested against a known-good version but
  won't get dsh's own updates automatically; always-latest (Windows) stays
  current but can drift out of sync with this theme's selectors without
  warning if dsh ships a frontend change. See `scripts/vendor-dsh.sh` if
  you want to bump the mac build's pinned version yourself, but re-check
  the theme after doing so.
- **The Windows build hasn't been run on an actual Windows machine by the
  people building this project** — it's cross-built from macOS and
  verified statically (package contents, PE resources, icon embedding),
  not launch-tested. Please open an issue if something's broken.
- The visual choices here (colors, fonts, layout width) are one person's
  taste, hardcoded. If you want something different, `theme.css` and
  `font-picker.js` are where to start.

## License

The code in this repository is MIT-licensed — see `LICENSE`. It bundles
DeepSeek Harness (MIT) and two open-source fonts (SIL OFL 1.1) in the
public build; see `NOTICE.md` for full attribution.
