# Third-party notices

This project is an unofficial, community-made desktop shell and theme for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is
not affiliated with or endorsed by DeepSeek. The code in this repository
(under `LICENSE`, MIT) is a thin Electron wrapper plus CSS/JS overrides —
none of it is DeepSeek's code, and none of it is redistributed here.

## DeepSeek Harness

The **public** build (`npm run build:public`) bundles an unmodified copy of
`@deepseek-ai/dsh`, fetched from the npm registry at build time by
`scripts/vendor-dsh.sh`. It is not vendored into this git repository.

```
DeepSeek Harness
Copyright (c) 2026 DeepSeek
Licensed under the MIT License
https://github.com/deepseek-ai/deepseek-harness
```

The **personal** build (`npm run build:personal`) does not bundle dsh at
all — it expects you to already have it installed and running.

## Fonts (`fonts/`)

Both fonts are licensed under the SIL Open Font License 1.1, which
explicitly permits bundling/embedding in software. Full license text:
https://scripts.sil.org/OFL

**Smiley Sans (得意黑)**
```
Copyright 2018-2024 Atelier Anchor (https://atelier-anchor.com)
SIL Open Font License 1.1
https://github.com/atelier-anchor/smiley-sans
```

**LXGW WenKai Lite (霞鹜文楷 Lite)**
```
Copyright (c) 2021-2025, LXGW WenKai contributors
SIL Open Font License 1.1
https://github.com/lxgw/LxgwWenKai-Lite
Derived from Klee One, Copyright 2022 Fontworks Inc., also OFL-1.1.
```

## Electron

```
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.
MIT License
https://github.com/electron/electron
```
