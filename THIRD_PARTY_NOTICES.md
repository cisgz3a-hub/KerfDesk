# Third-Party Notices

KerfDesk (repo: LaserForge 2.0) bundles third-party software and fonts under
their respective licenses and notices. KerfDesk's first-party software and
associated documentation, in source and compiled/bundled form, are MIT-licensed
— see `LICENSE`.

The tables below are a readable summary of selected libraries and bundled
fonts. The generated `public/third-party-notices.txt` is the release input: it
enumerates the complete installed `pnpm licenses list --prod` closure, the
Electron npm package license, bundled outline/CNC fonts, and all eight pinned
OpenClipart CC0 assets. Desktop packaging separately fails closed unless the
artifact retains Electron's native Windows notices and the explicitly bundled
`Contents/Resources/legal/electron/LICENSE` plus
`Contents/Resources/legal/electron/LICENSES.chromium.html` runtime notices on
macOS; JS license banners also remain in shipped assets.

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
| @tabler/icons 3.43.0 | MIT | © 2020-2026 Paweł Kuna and Tabler Icons contributors — https://github.com/tabler/tabler-icons/tree/v3.43.0 |

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
| Poppins Regular | OFL-1.1 | Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins); Indian Type Foundry, Jonny Pinhorn, Ninad Kale |
| Tinos Regular | OFL-1.1 | Copyright 2026 The Tinos Project Authors (https://github.com/googlefonts/tinos); designed by Steve Matteson, Monotype Imaging Inc. |
| Tinos Bold | OFL-1.1 | Copyright 2026 The Tinos Project Authors (https://github.com/googlefonts/tinos); designed by Steve Matteson, Monotype Imaging Inc. |
| Inconsolata Regular | OFL-1.1 | Copyright The Inconsolata Project Authors (Raph Levien) |
| Courier Prime Regular | OFL-1.1 | Copyright 2015 The Courier Prime Project Authors (https://github.com/quoteunquoteapps/CourierPrime); Alan Dague-Greene |
| Pacifico Regular | OFL-1.1 | Copyright The Pacifico Project Authors (Vernon Adams) |
| Dancing Script Regular | OFL-1.1 | Copyright The Dancing Script Project Authors (Pablo Impallari) |
| Anton Regular | OFL-1.1 | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont); Vernon Adams |
| Special Elite Regular | Apache-2.0 | Copyright (c) 2010 by Brian J. Bonislawsky DBA Astigmatic (AOETI) |
| UnifrakturMaguntia Book | OFL-1.1 | Copyright (c) 2010 j. 'mach' wust **with Reserved Font Name UnifrakturMaguntia** |
| Stardos Stencil Regular | OFL-1.1 | Copyright (c) 2011 by Vernon Adams |
| Saira Stencil One Regular | OFL-1.1 | Copyright 2019 The Saira Stencil Project Authors (https://github.com/Omnibus-Type/Saira); Hector Gatti, Omnibus-Type |
| Relief SingleLine | OFL-1.1 | Copyright 2021/2022 The Relief SingleLine Project Authors; François Chastanet, Noëlie Dayma, Élisa Garzelli |
| EMS Nixish | OFL-1.1 | Created by Sheldon B. Michaels; converted by Windell H. Oskay; derivative of Nixie One by Jovanny Lemonad |
| EMS Decorous Script | OFL-1.1 | Created by Sheldon B. Michaels; converted by Windell H. Oskay; derivative of Petit Formal Script by Impallari Type |
| EMS Casual Hand | OFL-1.1 | Created by Sheldon B. Michaels; converted by Windell H. Oskay; derivative of Covered By Your Grace by Kimberly Geswein |

- **Apache-2.0** (Roboto, Special Elite): full text at
  https://www.apache.org/licenses/LICENSE-2.0 — the license and any `NOTICE`
  file must accompany the distribution.
- **SIL Open Font License 1.1** (the fifteen OFL fonts): full text at
  https://openfontlicense.org — the above copyright/source notices and this
  license must be bundled with the fonts; the fonts may be redistributed but
  not sold on their own, and Reserved Font Names must not be reused for
  modified versions. The four CNC sources, pinned commits, canonical source
  hashes, and complete metadata attribution ship in
  `public/third-party-notices.txt`.
- **Reserved Font Name declared:** UnifrakturMaguntia. We ship it unmodified
  under its own name, which the OFL permits; a *modified* version may not reuse
  that name. No other bundled face declares an RFN — checked against each
  `.ttf`'s own copyright record, not against the license boilerplate, which
  always mentions the term.

> Maintainer follow-up (recommended for belt-and-suspenders): ship the verbatim
> `OFL.txt` / Apache `LICENSE` files alongside the fonts. The exact copyright
> strings are no longer a manual check — `generate-third-party-notices.mjs`
> reads them out of each `.ttf`'s `name` table and fails the build if a
> copyright record is missing.
