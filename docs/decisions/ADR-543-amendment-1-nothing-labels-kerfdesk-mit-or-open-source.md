## ADR-543 Amendment 1 - Nothing labels KerfDesk MIT or open source (2026-09-29)

**Status:** Proposed on 2026-09-29, after the maintainer reported "I still see stuff that says we
are open source"; takes effect when merged. | **Date:** 2026-09-29 |
**Amends:** ADR-543 §2 and §5

### Context

After ADR-543 made KerfDesk all rights reserved, three things still presented it as MIT or open
source:

1. **GitHub's repository page.** GitHub reports every licence file in the repository root. With
   `LICENSE-MIT` beside `LICENSE`, the About sidebar read "License, MIT licenses found" and the
   README header had an "MIT license" tab (live page, checked 2026-09-29).
2. **The design library.** KerfDesk's own designs showed "Creator: KerfDesk contributors",
   "License: MIT" and a "License terms" link to opensource.org, because §5 kept their per-entry
   MIT label.
3. **Wording about third-party parts.** The About box said "Bundled open-source components", and
   the License & Safety Notice §5 and the notices header said the app "bundles open-source
   components". That is true of the libraries, but it reads as a claim about KerfDesk.

README, CONTRIBUTING and `THIRD_PARTY_NOTICES.md` also named the MIT License, where `LICENSE`
already explains what happens to earlier versions.

### Decision

1. The MIT text moves unchanged from `LICENSE-MIT` to `docs/legal/mit-final-terms.txt`. Outside
   the root, and with no "license" in its name, GitHub no longer reports it as a repository
   licence. `LICENSE` points to the new path and still says versions up to `mit-final` stay MIT.
2. KerfDesk's own design-library artwork no longer carries MIT. Its entries show "License: Free to
   use in your designs" (id `LicenseRef-KerfDesk-Designs`, which the label doesn't repeat), credit
   "KerfDesk", and carry the grant as their notice: "Made for KerfDesk. You may use it in your own
   designs and in the things you make with them, including things you sell." That keeps §5's
   purpose without the MIT label. Artwork published under MIT up to `mit-final` stays MIT for
   anyone who has it. Library search keeps these entries' licence out of substring matching, as it
   already did their credit, so "kerf" and everyday words don't return every original.
3. The About box says "Third-party components and their licences", and the License & Safety Notice
   §5 and the generated notices header say "third-party components".
4. README, CONTRIBUTING and `THIRD_PARTY_NOTICES.md` say versions up to `mit-final` keep the
   licence they were released under, and point to `LICENSE`. `AGENTS.md` names the new path and
   adds: keep MIT text out of the repository root.

### Consequences

- These still name the MIT License on purpose: `LICENSE`'s paragraph on earlier versions, the
  License & Safety Notice §1 sentence on versions up to `mit-final`, the moved text itself,
  historical ADRs and audits, the July Preview releases on GitHub (ADR-543 keeps their notices),
  and third-party licence texts.
- Projects that inserted a KerfDesk design earlier keep `MIT` in their stored library provenance.
  That record is history and isn't rewritten.
- Installed apps show the new wording only after they update: the web app after the deploy and
  Update in the status bar, and a desktop app after a new build is installed.

### Verification

- `pnpm generate:notices` rewrites only the notices header line.
- The library, About and notices tests, `node scripts/check-adr-numbers.mjs`, typecheck, lint and
  format checks pass.
