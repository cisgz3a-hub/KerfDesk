## ADR-686 - White fills in an imported SVG are the material showing through: cut out of the fills under them, with one Undo to burn them (2026-11-03)

**Status:** Accepted; tested through the store's SVG import with the audit's fixtures and the
compiled burn. Not burn-tested. | **Date:** 2026-11-03

Fixes UX audit U3-P2-2, ledgered as **P1** by its refuter
(`docs/audits/2026-11-03-ux-u1/U3-first-design.md`). The same double burn was rated P1 in rolling
audit v7 (L7-P1-1), where the trigger was KerfDesk's own SVG round trip.

### Context

- A beginner imports a logo: a black badge with a white diamond, or white letters on a black plate.
  Every way of writing white (`fill="#fff"`, `fill="white"`, a `style` attribute, a CSS class)
  became its own Fill operation. The white area burned solid with the black under it and then a
  second time on its own. The canvas painted the logo as a solid black shape, Preview showed only a
  faint darker overlap, and the import toast said "2 colors".
- Only a file whose author cut the hole into one compound path (`fill-rule="evenodd"`) kept it.
- **LightBurn.** Its documentation does not treat white specially:
  - Imported colours are matched to its palette: LightBurn "will attempt to match the colors used to
    the default LightBurn color palette" (legacy Layer Colors page,
    `https://docs.lightburnsoftware.com/LayerColors.html`, read 2026-11-03). The palette (00 to 29,
    T1, T2) has no white, so a white fill lands on its nearest colour, a light pink.
  - Its Fill Mode page (`https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/FillMode/`,
    read 2026-11-03) says nested shapes on one layer fill only between the outlines, and on two
    layers the inner area is "engraved twice".
  - Forum staff advise the same as the laser's physics: the laser cannot paint white back over a
    burn, so leave that area out of the shape, or use the Mask tool (forum thread 108950).
  - So LightBurn burns this logo the way KerfDesk did. It does show the white shape as its own pink
    outline, which KerfDesk's plain-ink canvas (ADR-620) painted black on black.
- Copying LightBurn here would copy the wrong burn. What LightBurn's own advice asks of the user
  ("omit that area from the shape") is something the import can do for them.

### Decision

1. **White fills are paper.** In an SVG import (file, drag and drop, Re-import, and every route
   that commits an SVG fragment: Remote Control, Design Studio), a fill painted pure white
   (`#ffffff`, however it is written) is the material showing through. SVG paints in document
   order, so a white fill is cut out of every fill painted **before** it, and the white shape itself
   is left out of the artwork. A darker shape painted **after** it stays whole, and a white
   background painted first cuts nothing and is simply left out. *Amended by Amendment 1: only flat,
   opaque, unmasked white is paper; see-through, gradient and masked white burn as ink.*
2. **Only beside a darker fill.** The rule applies only when the same import also has a fill that is
   not white. A design drawn entirely in white (for slate or anodised aluminium) keeps burning its
   shapes as before. *Amended by Amendment 1: a gradient counts as a darker fill; see-through white
   does not.*
3. **One Undo burns the white.** As the bed fit does (ADR-125 Amendment 1), the import as parsed is
   pushed to history first. The first Undo puts the white shapes back on their own operation, which
   burns, and the next removes the import. The import pushes no extra step when nothing is white.
   *Amended by Amendment 3: that history copy marks the white `kept`, and an unchanged Re-import
   keeps the operations and that choice.*
4. **The import says so.** The toast reads, for example, "plate.svg: 2 white shapes will not burn,
   as in the file: they were cut out of the shapes under them. To burn the white too, Undo: it
   returns on its own operation." It comes last, after any bed-fit notice, so the toast stack keeps
   it in view. The colour count no longer counts white. *Amended by Amendment 1: the toast says the
   file shows bare material there, says "cut out" only when it cut something, and names ink white.*
5. **The geometry.** Each darker fill loses the union of the white fills painted over it, computed
   with Clipper2 in the import's own coordinates (all vector parts of one import share one
   placement), on the 1 µm grid the vector tools use (`VECTOR_PATH_PRECISION_DECIMALS`). A fill a
   white shape does not actually overlap keeps its exact curves. A cut fill keeps its colour and
   operation, holds polylines flattened at the machine curve tolerance like a Boolean result, and is
   even-odd. A part left with no paths is removed, and an operation only white shapes used is
   removed with it. If the white would cover every darker shape, the import is left as parsed.

### Consequences

- *Amended by Amendment 2: a logo imported before this decision is named at open and in Job Review,
  and Leave white unburned applies the knock-out as one Undo step.*
- The beginner's logo burns as it looks, the canvas shows the hole (the white is no longer painted
  black), and Job Review has nothing white to warn about. CNC pockets follow the same artwork, so a
  white diamond in a black badge becomes an island.
- **Not covered (checked, left as they were):**
  - **PDF and compatible AI pages** import as one Line artwork through `importSvgObject`, with the
    operator choosing Fill afterwards; white paths there are cut as outlines. Knocking out there
    needs the mode at import, so it is a follow-up.
  - **DXF** has no fills; ACI colour 7 is "black on a light background" already (`dxf-colors.ts`).
  - **White strokes** still burn as lines and do not cut the fills under them.
  - **Near-white** (for example `#fefefe`) is a colour like any other.
  - **Pasting SVG text** is not a KerfDesk route (no OS-clipboard SVG paste); copy and paste of scene
    objects copies the already cut artwork.
  - **Trace output** traces ink against its background, so it produces no white fills.
- **Tests:** `src/ui/state/svg-white-fill-knockout.integration.test.ts`: for `fill="#fff"`,
  `fill="white"`, a `style` attribute with a CSS class, white letters on a plate and the auditor's
  logo, no compiled burn falls inside a white shape after the import, while the first Undo shows
  the white burning (more than 50 mm inside it); the white diamond burns the same as the even-odd
  control within 0.5 %; a white background leaves the art over it with its exact curves; a dark dot
  painted over the white still burns; an all-white design is unchanged; an import with no white
  runs no knock-out step, so its state and G-code are what they were.
