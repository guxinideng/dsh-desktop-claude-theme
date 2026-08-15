# DSH Desktop

A community desktop shell and warm-toned theme for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

**Not an official DeepSeek product.** This is a personal reskin project: an
Electron wrapper around dsh's own web UI, with a warm cream/terracotta
theme, a font picker, a widened layout, and a few interaction tweaks
(quieter tool-call trace rows, translated trajectory-view labels). All of
it works by CSS variable overrides and DOM tweaks on top of dsh's existing
web interface — it doesn't fork or modify dsh itself.

## Two ways to build it

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

Either way you get the same app; the only difference is whether dsh comes
along for the ride.

## Running it without building

```bash
npm install
npm start
```

Requires `dsh web` already running at `127.0.0.1:3080`.

## Status / caveats

- **macOS only, Apple Silicon only** for now.
- **Unsigned.** Neither build is code-signed or notarized (no Apple
  Developer account behind this project), so macOS Gatekeeper will call it
  unidentified on first open — right-click → Open once to get past that.
- **Pinned to dsh `0.1.0-rc.6`.** This app's theme works by targeting dsh's
  own CSS class names, which are build-hashed and can change on any dsh
  release. There's no auto-update story yet — see `scripts/vendor-dsh.sh`
  if you want to bump the pinned version yourself, but re-check the theme
  after doing so.
- The visual choices here (colors, fonts, layout width) are one person's
  taste, hardcoded. If you want something different, `theme.css` and
  `font-picker.js` are where to start.

## License

The code in this repository is MIT-licensed — see `LICENSE`. It bundles
DeepSeek Harness (MIT) and two open-source fonts (SIL OFL 1.1) in the
public build; see `NOTICE.md` for full attribution.
