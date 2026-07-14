# Third-Party Notices

KerfDesk (repo: LaserForge 2.0) bundles the third-party software and fonts listed
below and reproduces their required copyright and permission notices here, as their
licenses (MIT, ISC, Apache-2.0, MPL-2.0, BSL-1.0, OFL-1.1, Unlicense) require of a
distribution. The first-party source is MIT-licensed — see `LICENSE`.

The `pnpm licenses list --prod` output is the authoritative, always-current list of
every production package and its license; the JS libraries' full license texts are
also preserved as `@license` banners inside the shipped `dist/web/assets/*.js`.

---

## Bundled runtime libraries (shipped in the web/desktop bundle)

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

## Bundled fonts (`src/ui/text/fonts/` TTF assets and `src/core/text/` stroke data)

Per PROJECT.md / ADR-017 these are MIT-*compatible* permissive font licenses
(Apache-2.0 + SIL Open Font License 1.1) — **not** MIT. OFL-1.1 requires its
copyright notice and license to accompany the font in any distribution.

| Font | License | Copyright |
|---|---|---|
| Roboto Regular | Apache-2.0 | Copyright 2011 Google Inc. |
| Inconsolata Regular | OFL-1.1 | Copyright The Inconsolata Project Authors (Raph Levien) |
| Pacifico Regular | OFL-1.1 | Copyright The Pacifico Project Authors (Vernon Adams) |
| Dancing Script Regular | OFL-1.1 | Copyright The Dancing Script Project Authors (Pablo Impallari) |
| Hershey Roman Simplex | Hershey redistribution terms | Dr. A. V. Hershey, U. S. National Bureau of Standards; distribution format by James Hurt, Cognition, Inc. |
| EMS Allure | OFL-1.1 | Derivative of Allura by Rob Leuschke; stroke conversion by Sheldon B. Michaels and Windell H. Oskay |
| EMS Delight | OFL-1.1 | Derivative of Delius by Natalia Raices; stroke conversion by Sheldon B. Michaels and Windell H. Oskay |
| EMS Tech | OFL-1.1 | Derivative of Architects Daughter by Kimberly Geswein; stroke conversion by Sheldon B. Michaels and Windell H. Oskay |
| EMS Osmotron | OFL-1.1 | Derivative of Orbitron by Matt McInerney; stroke conversion by Sheldon B. Michaels and Windell H. Oskay |

- **Apache-2.0** (Roboto): full text at https://www.apache.org/licenses/LICENSE-2.0 —
  the license and any `NOTICE` file must accompany the distribution.
- **SIL Open Font License 1.1** (Inconsolata, Pacifico, Dancing Script, and the four
  EMS stroke fonts): full text at
  https://openfontlicense.org — the above copyright notice and this license must be
  bundled with the fonts; the fonts may be redistributed but not sold on their own,
  and the Reserved Font Names must not be reused for modified versions.
- **Hershey Roman Simplex:** the vector data may be used commercially or otherwise
  when the Hershey and Hurt acknowledgements accompany it, and converted data is not
  distributed in the restricted U.S. NTIS format. The complete terms ship in
  `scripts/license-texts/Hershey.txt` and the generated application notices.

> Maintainer follow-up (recommended for belt-and-suspenders): verify the exact
> copyright strings against each `.ttf`'s `name` table and, ideally, ship the
> verbatim `OFL.txt` / Apache `LICENSE` files alongside the fonts.
