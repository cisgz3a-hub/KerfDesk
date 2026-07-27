# Easel / Inventables project library — research and gap analysis

**Date:** 2026-07-25
**Scope:** What Inventables ships around Easel that we call "inventables", what
of it is reachable for a local-first MIT app, and what our bundled design
library would have to become to match or beat it.
**Method:** Web research against Inventables/Easel first-party surfaces
(2026-07-25) plus a read of our shipped `src/ui/library/` catalog.

---

## 1. What Easel actually has

Inventables ships **four separate things** that people collectively call "the
Inventables library". They are not one feature and they do not have the same
constraints.

### 1.1 Easel Gallery ("Projects") — the community cloud library

`easel.com/gallery` (formerly `site.inventables.com/projects`, 301-redirected
2026). A cloud, account-backed, socially-ranked catalog of user-published
projects.

**Project page structure** (verified on the first-party "Intro to Easel"
project, `easel.com/gallery/F2wZHdsz`):

| Section | Content |
|---|---|
| Title | Project name |
| Creator + date | Linked profile, publication date |
| **Description** | Free text |
| **Specs** | Material list (e.g. "Birch Plywood, Hard Maple") |
| **Comments** | User thread |
| Actions | Save Copy, Favorite, Preview |
| Metrics | Favorites, Views, Comments, Copies |

Notable: the project page carries **material only**. There is no structured
bit list, no cut-depth table, no part count, no step-by-step build sheet, and
no difficulty or time estimate. The geometry and its cut settings live inside
the copied Easel document, not on the page.

**Card metadata:** thumbnail, title, creator, likes / saves / comments / views.

**Filters:** Sort (Newest, Most Popular, Trending); Material (wood species,
acrylic, plastics, metals); Machine (60+ entries — Shapeoko, X-Carve,
Genmitsu, Longmill, Maslow 4, …); Status (In Progress, Carved, Finished);
Tags (25+).

**Curated collections** (the full navigation set, verified 2026-07-25):

> All Projects · Trending · Hot · Most Popular · Inlays · Monograms ·
> Shop Gear and Tools · Flags · Gifts · Kitchen · Toys & Games ·
> Home Storage · Furniture · Office and School Supplies · Sign Templates ·
> Valentines Day · Smart Values · Tiling · V-Carving · Flip-Milling ·
> Assembly · 3D Relief Carving · Joinery · Christmas & Winter Holidays ·
> Military Emblems · Home Decor · Epoxy Projects · Award Templates ·
> Address Sign Templates · Wedding Sign Templates · Cribbage Boards ·
> Clocks · Electronic Accessories · Carves in 15 Minutes or Less ·
> Carves in 1 Hour Or Less · Wedding Season · Sports & Den Decor ·
> Halloween · Thanksgiving · featured-maker collections

This taxonomy is the single most useful artifact from the research: it is
Inventables' own empirical answer to "what do CNC owners actually make?",
derived from their gallery traffic. Two of those facets are *not* subject
categories at all and are worth copying directly:

- **Time-boxed collections** — "Carves in 15 Minutes or Less",
  "Carves in 1 Hour Or Less". Browsing by *how long it takes* is a genuinely
  good idea and nobody else in this market does it.
- **Technique collections** — V-Carving, Inlays, Joinery, Tiling,
  Flip-Milling, Assembly, 3D Relief. These sell a *capability*, not an object.

### 1.2 Easel Pro Design Library — the paid clipart corpus

Advertised as **3M+ designs and 300+ fonts**, gated behind Easel Pro
($19.99/mo, or $12.99/mo billed annually at $155.88). This is a licensed
stock-art corpus, not project files.

**Not reachable for us and not worth chasing.** It is a licensing deal, it is
cloud-served, and PROJECT.md rules out accounts, entitlement, and cloud
services. Competing on clipart *count* is a losing and pointless game.

### 1.3 Easel Apps — parametric generators

Third-party and first-party JS plug-ins that generate geometry inside Easel.
The commonly cited set: **box maker / tabbed box, gear generator, inlay
generator, puzzle generator, voronoi, star generator, polygon generator,
dogbone generator, replicator, offsetter, vectorizer, DXF import.**

Reference: `github.com/inventables/easel-box-maker` (first-party),
`github.com/dacarley/easel-apps` (community).

**We already beat most of this natively**, and it is worth stating plainly
because it changes what the library needs to carry:

| Easel App | KerfDesk equivalent | Status |
|---|---|---|
| Box maker / tabbed box | `src/core/box/` parametric finger-joint generator | Shipped, Phase K, with a 3D assembly referee Easel has no equivalent of |
| Dogbone generator | CNC corner-overcut relief (F-CNC26 convention) | Shipped |
| Offsetter | `clipper2` vector offset + kerf compensation | Shipped (ADR-103 G-series) |
| Vectorizer | In-house contour/centerline/edge trace engine | Shipped, Phase E (ADR-123) |
| DXF import | Clean-room DXF parser | Shipped, Phase H.6 |
| Inlay generator | Linked straight-sided inlay pocket/insert pairs | Shipped, ADR-155 |
| Replicator | Array / auto-fit / Quick Nest | Shipped (ADR-125, ADR-151) |
| Gear / voronoi / puzzle / star / polygon | Polygon only | **Gap** — genuine content gaps |

### 1.4 Inventables digital design files

A paid storefront of individual customizable design files
(`inventables.com/pages/digital-cnc-design-files-for-easel-cnc-software`).
Commercial; not applicable.

---

## 2. What we ship today

`src/ui/library/` — the ADR-105 G11 bundled design library. Its own ADR calls
the curation **"PROVISIONAL; growable."** Contents:

| Source | Count | What it actually is |
|---|---|---|
| `design-library-owned-svg.ts` | 21 | "Owned templates" |
| `design-library-cc0.ts` | 8 | Openclipart CC0 art |
| `design-library.ts` (Lucide) | 48 | `lucide-static` 24×24 UI icons |

### 2.1 The honest assessment

**The 48 Lucide entries are user-interface icons, not artwork.** They are
24×24 px stroke glyphs designed to render at toolbar size. They are fine as
placeholder clipart and terrible as engraving art.

**The 21 "owned templates" are not templates — they are stub rectangles.**
Read `design-library-owned-svg.ts:114-394`. Examples:

- `box-small-tray-preset` (`design-library-owned-svg.ts:234`) — six plain
  rectangles laid out on a sheet by `sixPanelLayout()`. **No finger joints, no
  tabs, no slots.** These six panels cannot assemble into a box. The name
  promises joinery the geometry does not contain.
- `box-electronics-box-preset` — the same six rectangles plus four circles.
- `cnc-v-carve-sample` — four diamonds and a line.
- `laser-power-speed-grid` — a 5×6 grid of identical rectangles with **no
  labels and no per-cell parameter variation**, so it cannot be read after
  burning. The real Material Test generator (ADR-044) does this properly;
  this library entry is a strictly worse duplicate of it.

**There is no project metadata at all.** `LibraryEntry`
(`design-library-types.ts:46`) carries id, title, category, subcategory, kind,
machineModes, operations, tags, provenance, preview, insert. It has **no**
size, material, thickness, bit, part count, difficulty, time, or instructions
— i.e. none of the fields that make a project library a project library rather
than a shape picker.

**`LibraryGeneratedInsert` is dead code.** `design-library-types.ts:39-42`
defines a `generated-scene` insert kind with a `generatorId`; nothing produces
it and `DesignLibraryDialog.tsx:56-59` rejects it with an error toast.

### 2.2 Verdict

What we ship is a **clipart picker**. What the maintainer asked for, and what
Easel's gallery is, is a **project library**. The gap is not size — it is kind.

---

## 3. What we can and cannot copy

| Easel property | Us | Why |
|---|---|---|
| Cloud gallery, accounts, sharing, likes, "Save Copy" | **Cannot** | PROJECT.md "Out of scope": no cloud, accounts, sharing, sync. Non-negotiable #8: no telemetry. |
| 3M licensed designs | **Cannot / should not** | Licensing deal; ADR-017 permissive-only dependency policy; 1 MB web bundle budget. |
| Community upload | **Cannot** | Same as gallery. |
| Curated collection taxonomy | **Should copy** | Free, empirical, and it is the actual navigation users want. |
| Time-boxed collections | **Should copy and extend** | We compute job time estimates already (Phase C) — we can be *honest* about it where Easel is editorial. |
| Technique collections | **Should copy** | Sells our V-carve, inlay, tiling, joinery, flip-mill capability, all shipped. |
| Structured build specs | **Should beat** | Easel's project page carries material only. Bits, depths, part counts, and steps are the useful part and Easel omits them. |
| Parametric generators | **Mostly already beat** | See 1.3. Remaining gaps: gear, voronoi, puzzle, star. |

**Our structural advantage:** the library ships *inside the app*, offline,
versioned with the code, with no account and no network. Easel's gallery is
unreachable without a login and an internet connection. A bundled library can
therefore be *trusted* in a way a cloud gallery cannot — it can be tested in
CI, its geometry can be property-checked, and it can state real numbers.

**Our structural disadvantage:** we have no community, so quantity has to come
from authored parametric families rather than uploads. That is fine —
Inventables' gallery is mostly duplicates ("Copy of Copy of Test" is literally
on page one of `easel.com/gallery/all`).

---

## 4. What "high quality" has to mean here

A library entry earns the word *project* only if all of these hold. This is
the acceptance bar for the build that follows.

1. **Real dimensions.** Authored in millimetres at true size, with
   `width="Xmm" height="Ymm"` and a matching `viewBox`, so it imports at the
   size it claims.
2. **It assembles.** Every slot is `thickness + clearance` wide and every
   mating tab is the complementary size. A joinery project that cannot be
   built is worse than no entry, because the name is a promise.
3. **Operations are separated.** Our SVG importer groups geometry by stroke
   colour into distinct colour groups (`parse-svg.test.ts:48`). A project must
   therefore arrive with cut, engrave, pocket, V-carve, and drill geometry on
   *different colours* so each maps to its own operation instead of landing as
   one undifferentiated outline.
4. **CNC-realistic.** Inside corners that a round cutter cannot reach carry
   dogbone or T-bone relief; parts that need holding carry tabs.
5. **Structured specs.** Stock thickness, finished size, part count, bit
   list, and estimated time — stated, not implied.
6. **Provenance.** First-party MIT geometry, or CC0 with source URL, hash, and
   download date, per the existing catalog rules
   (`design-library-validation.ts:36-43`).

---

## 5. Engineering constraints that shape the design

- **File-size policy applies only to source extensions.**
  `scripts/check-file-size-policy.mjs:12` checks
  `.cjs .cts .js .jsx .mjs .mts .ts .tsx` at 600 raw physical lines; ESLint
  caps counted code lines at 400. **`.svg` and `.json` are exempt.**
  Therefore geometry must live in `.svg` asset files and metadata in `.json`,
  never inline in TypeScript — otherwise the library cannot grow past a
  handful of entries without splitting modules forever.
- **Authoring must be deterministic and regenerable**, so joinery maths is
  reviewable and can be re-emitted at other stock thicknesses. Precedent:
  `scripts/generate-cnc-stroke-fonts.mjs` generates checked-in font data from
  pinned sources.
- **Zero new runtime dependencies.** ADR-017; 1 MB compressed bundle target.
- **Insertion must reuse the shipped SVG import path** so library geometry is
  ordinary editable scene objects and the CAM pipeline is untouched.

---

## 6. Recommendation

Build **a bundled project library** — first-party, offline, generated from a
deterministic authoring script into cap-exempt `.svg` + `.json` assets, with
structured build specs Easel does not provide, organised on Easel's own proven
category taxonomy plus time-boxed and technique collections.

Do **not** chase design count. 3M clipart is unreachable and worthless
offline. Beat Easel on the axis where its own project pages are thin: every
entry states its stock, its bits, its part count, its finished size, and its
steps, and its geometry is CI-verified to actually assemble.

---

## Sources

- <https://easel.com/gallery> — collection taxonomy, filters (2026-07-25)
- <https://easel.com/gallery/all> — card metadata, sort/material/machine/status filters
- <https://easel.com/gallery/F2wZHdsz> — "Intro to Easel", project page section structure
- <https://support.easel.com/hc/en-us/articles/5503660393363-Easel-Pro-Feature-Pro-Design-Library> — Pro Design Library (403 to automated fetch; corroborated via search result summary)
- <https://www.inventables.com/products/easel-pro-membership> — Easel Pro pricing and 3M design / 300 font claim
- <https://github.com/inventables/easel-box-maker> — first-party Easel App reference
- <https://github.com/dacarley/easel-apps> — community Easel App list
- <https://www.inventables.com/pages/digital-cnc-design-files-for-easel-cnc-software> — paid design-file storefront
