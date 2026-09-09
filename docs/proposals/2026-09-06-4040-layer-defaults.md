# Proposal: 4040 laser layer defaults

**Status: unapproved draft proposal, 2026-09-06.** The values below were recovered from uncommitted work. Their original numerical rationale has not been recovered. They are not calibrated machine/material settings, and no physical burn-quality improvement is established. This proposal reserves no ADR number.

## Behavior available for review

With the exact `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE` software profile selected in **laser** mode, the draft applies these fallbacks:

| Target operation mode | Speed | Power | Fill direction |
|---|---:|---:|---|
| Line | 800 mm/min | 90% | One way |
| Fill | 800 mm/min | 80% | One way |

The numbers are the original authored values. Profile selection identifies a software configuration; it does not identify or qualify attached hardware.

- Fresh manual and inserted operations receive the fallback beneath existing saved per-color/all-color settings. The existing saved-color lookup and CNC seeding paths remain in place.
- Changing an existing 4040 laser operation between Line and Fill, including **Fill Selection Separately**, can replace its current speed, power and fill direction. Matching saved values outrank those three fallbacks; explicit fields supplied in the mode-change patch outrank saved values. Other saved fields are not replayed onto an existing operation.
- **Review consequence:** current edits to those three fields can be replaced by a later mode change unless also saved as defaults or supplied in that patch. Whether that is desirable remains an open design choice.
- An already-Fill operation is not reseeded by Fill Selection. Shared selections retain the current operation isolation/binding behavior and leave unselected operations unchanged.
- Generic profiles and CNC mode receive no new defaults. Their existing-operation mode changes remain mode-only. Image-mode creation receives no added fallback, and switching to Image retains the current operation values without reseeding them; prior Line/Fill values can therefore remain on that operation.
- Project loading, ordinary profile changes, geometry, controller settings and Frame/Start logic are not changed by this draft.

## Unresolved historical preset hunk

The donor also changed `src/core/material-library/neotronics-4040-presets.ts`:

```diff
 const BASE_RECIPE: MaterialRecipe = {
   // ...
-  fillBidirectional: true,
+  fillBidirectional: false,
   // ...
 };
```

**This hunk is preserved here for review and is not applied.** `BASE_RECIPE` also feeds the Image-mode `neotronics-lt4lds-wood-engrave-254dpi` preset. Its 5000 mm/min, 30% Image recipe would change from bidirectional to one-way scanning, despite the layer fallback's Image exclusion. The other recipes inherit the field too. The intended relationship between image presets and the vector-only proposal remains unresolved; this draft retains the current preset file byte-for-byte.

## Disposition of every authored donor path

Source worktree: `C:/Users/Asus/LaserForge/4040-profile-defaults`; branch `codex/4040-profile-defaults`; HEAD `d463e6644b19c19da8e9906f6ff5c3810592e274`. All source working files and the source index are preserved.

| Authored path | Disposition in this draft |
|---|---|
| `src/core/material-library/neotronics-4040-presets.ts` | Unapplied hunk quoted above; Image reach and rationale remain unresolved. |
| `src/ui/state/fill-selection-actions.ts` | Ported fallback and current operation isolation; rejected the donor's replay of all saved fields onto existing operations. |
| `src/ui/state/layer-actions.test.ts` | Original Line, Fill and explicit-patch assertions ported into `profile-layer-default-actions.test.ts`, with current boundary coverage; existing test file retained. |
| `src/ui/state/layer-actions.ts` | Ported only fresh-manual fallback beneath saved settings; current CNC seeding retained. |
| `src/ui/state/object-insert-actions.ts` | Ported only the fallback inside the current fresh-layer helper. Original wrapper restructuring is already integrated and is not duplicated. |
| `src/ui/state/store-actions.ts` | Ported Line/Fill mode-change fallback with explicit-patch priority and saved overrides limited to the three proposed fields. |
| `src/ui/layers/profile-layer-default-settings.test.ts` | Adapted original assertions; added CNC, Image, exact profile identity and saved-value boundaries. |
| `src/ui/layers/profile-layer-default-settings.ts` | Retained original numbers; explicitly scoped by machine mode as well as profile identity, with narrow saved overrides. |

## Evidence and unresolved decisions

Baseline execution distinguished six expected proposal differences from seven preservation checks that already passed on main. Software tests exercise settings precedence, current CNC starters, Image/generic exclusions, operation ownership and mode changes. They do not qualify the proposed speed, power, scan direction, material response or physical output. No hardware, browser or packaged-runtime qualification was performed.

Adoption still requires a decision on the numeric values, reseeding existing operation settings on mode change, and the separately retained Image-preset hunk. This draft must remain unapproved until those choices are resolved; preserving the historical proposal does not establish that current main has a burn-quality defect.
