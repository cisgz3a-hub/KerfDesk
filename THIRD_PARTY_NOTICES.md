# Third-Party Notices

KerfDesk (repo: LaserForge 2.0) bundles third-party software and fonts under
their respective licenses and notices. KerfDesk's first-party software and
associated documentation, in source and compiled/bundled form, are MIT-licensed
— see `LICENSE`.

The tables below are a non-exhaustive summary of selected direct libraries and
bundled fonts. The generated `public/third-party-notices.txt` enumerates every
direct `package.json` dependency plus those fonts, but neither document is the
artifact-scoped transitive/Electron/Chromium closure required by ADR-248. The
`pnpm licenses list --prod` output inventories production packages, and JS
license banners remain in the shipped `dist/web/assets/*.js`.

---

## Selected bundled runtime libraries (shipped in the web/desktop bundle)

| Library | License | Copyright / source |
|---|---|---|
| react, react-dom | MIT | © Meta Platforms, Inc. and affiliates — https://github.com/facebook/react |
| zustand | MIT | © 2019 Paul Henschel — https://github.com/pmndrs/zustand |
| three | MIT | © 2010-2024 three.js authors — https://github.com/mrdoob/three.js |
| dompurify | MPL-2.0 OR Apache-2.0 | © Cure53 and other contributors — https://github.com/cure53/DOMPurify |
| opentype.js | MIT | © 2020 Frederik De Bleser — https://github.com/opentypejs/opentype.js |
| imagetracerjs | Unlicense (public domain) | András Jankovics — https://github.com/jankovicsandras/imagetracerjs |
| clipper2-ts | BSL-1.0 (Boost Software License 1.0) | Port of Angus Johnson's Clipper2 — https://github.com/ErikSom/Clipper2-ts |
| lucide-static | ISC | © Lucide Contributors — https://github.com/lucide-icons/lucide |

The MIT / ISC permission notices ("Permission is hereby granted, free of charge, …
THE SOFTWARE IS PROVIDED "AS IS"…"), the Apache-2.0 / MPL-2.0 texts (DOMPurify),
and the Boost Software License 1.0 text (clipper2-ts) apply to their respective
packages above; full texts ship in each package under `node_modules/<pkg>/LICENSE`
and in the bundle's `@license` banners. imagetracerjs is released into the public
domain under the Unlicense.

---

## Bundled fonts and stroke-font data

These permissively licensed fonts ship alongside the MIT first-party work under
Apache-2.0 or SIL Open Font License 1.1. OFL-1.1 requires its
copyright notice and license to accompany the font in any distribution.

| Font | License | Copyright / source attribution |
|---|---|---|
| Roboto Regular | Apache-2.0 | Copyright 2011 Google Inc. |
| Inconsolata Regular | OFL-1.1 | Copyright The Inconsolata Project Authors (Raph Levien) |
| Pacifico Regular | OFL-1.1 | Copyright The Pacifico Project Authors (Vernon Adams) |
| Dancing Script Regular | OFL-1.1 | Copyright The Dancing Script Project Authors (Pablo Impallari) |
| Relief SingleLine | OFL-1.1 | Copyright 2021/2022 The Relief SingleLine Project Authors; François Chastanet, Noëlie Dayma, Élisa Garzelli |
| EMS Nixish | OFL-1.1 | Created by Sheldon B. Michaels; converted by Windell H. Oskay; derivative of Nixie One by Jovanny Lemonad |
| EMS Decorous Script | OFL-1.1 | Created by Sheldon B. Michaels; converted by Windell H. Oskay; derivative of Petit Formal Script by Impallari Type |
| EMS Casual Hand | OFL-1.1 | Created by Sheldon B. Michaels; converted by Windell H. Oskay; derivative of Covered By Your Grace by Kimberly Geswein |

- **Apache-2.0** (Roboto): full text at https://www.apache.org/licenses/LICENSE-2.0 —
  the license and any `NOTICE` file must accompany the distribution.
- **SIL Open Font License 1.1** (the seven OFL fonts): full text at
  https://openfontlicense.org — the above copyright/source notices and this
  license must be bundled with the fonts; the fonts may be redistributed but
  not sold on their own, and Reserved Font Names must not be reused for
  modified versions. The four CNC sources, pinned commits, canonical source
  hashes, and complete metadata attribution ship in
  `public/third-party-notices.txt`.

> Maintainer follow-up (recommended for belt-and-suspenders): verify the exact
> copyright strings against each `.ttf`'s `name` table and, ideally, ship the
> verbatim `OFL.txt` / Apache `LICENSE` files alongside the fonts.
