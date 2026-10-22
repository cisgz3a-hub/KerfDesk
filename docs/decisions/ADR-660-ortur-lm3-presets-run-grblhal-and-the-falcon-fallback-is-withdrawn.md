## ADR-660 - The Ortur Laser Master 3 presets run grblHAL, and the Falcon-compatible fallback leaves the machine list (2026-10-22)

**Status:** Accepted. Amends ADR-637 rule 2 (what the machine list leaves out) and ADR-322
Amendment 1 (adds the Falcon A1 Pro bed to `preset-corrections.ts`). | **Date:** 2026-10-22

Controller audit v2, area C7 (device profiles, `docs/audits/2026-10-22-controller-v2/` on the
audit branch), raised three findings that a refuter and the coordinator confirmed: C7-P2-2,
C7-P2-3 and C7-P2-1 (lowered to P3). AGENTS.md says never to invent controller settings, so every
value below comes from a vendor source cited in the profile's evidence. Nothing is refused or
migrated on its own (ADR-322 item 6, PROJECT.md non-negotiable 21).

### Context

1. **The Ortur Laser Master 3 presets declared stock GRBL.** All three (LU2-10A, LU3-20A,
   LU3-40A) took `controllerKind: 'grbl-v1.1'` from the shared brand-preset builder. The LM3 runs
   Ortur Laser Firmware 2.x, which is grblHAL on its ESP32-S2 mainboard:
   - Ortur's own LM3 user manual (V1.1, `github.com/Ortur-Tech/Ortur_Laser_Master_3`, SHA-256
     `5c793d73…`, sections 7.2 and 7.3) sets Wi-Fi with `$74=WiFi name` and `$75=WiFi password`.
     These are grblHAL settings 74 and 75 (`settings.h` at `d7aaee3d`, lines 130-131). Stock
     GRBL 1.1 has no such settings.
   - Two LM3 owners' startup reports, posted on the LightBurn forum, read `GrblHAL 1.1f`,
     `[FIRMWARE:grblHAL]`, `[DRIVER:ESP32-S2]` and `[BOARD:Ortur Laser Master 3]`. One is OLF 205
     on an `OLM_ESP_PRO_V2.4` board (2022). The other is OLF 211 on an `OLM_ESP_PRO_V2.4B` board
     with an LU3-20A head (2024).
   - Ortur's own earlier ESP32-S2 firmware source (`Ortur_Laser_Firmware_17X-18X`) says it is
     "Part of grblHAL" in its file headers.

   The effects: connect binds the driver from the profile, and a banner never switches it. So with
   an LM3 connected, the picker marked all three Ortur rows **Other firmware** and the Falcon A1
   Pro row **Same firmware**. Every Job Review showed a controller identity mismatch, and the
   Console refused valid grblHAL `$22` values with stock GRBL's 0-or-1 rule. The stock driver also
   never clears the error that grblHAL latches after a refused line, so one Console typo or one
   `$J=` past soft limits made the next G-code actions fail with a stale error. That last effect
   comes from the code and Ortur's source, not from a machine.

   There is no Laser Master 2 preset. The LU2-10A preset is an LM3 fitted with the LU2-10A head,
   on the same mainboard, so it is not stock GRBL either.
2. **An unsourced 400 × 400 mm "Falcon-compatible GRBL diode" was listed as a Creality
   machine.** No Creality machine is 400 × 400 mm. Creality lists the Falcon A1 at
   305 mm × 381 mm and the A1 Pro at 358 × 268 mm, and the catalog has no Falcon A1 row. Since
   ADR-637 the fallback was a row in the main list, with a **Simulator tested** badge. A Falcon A1
   owner who searched "falcon" and chose it got a bounds check up to 95 mm deeper than the machine.
   The evidence note saying the size names no model is shown on no Machine Setup screen.
3. **Saved Falcon A1 Pro copies kept the generic bed.** From 2026-07-07 until #796
   (2026-09-19), the A1 Pro preset spread the default 400 × 400 mm bed. A copy saved then still has
   it, and `preset-corrections.ts` did not list it. Job Review told such a copy to re-apply the
   preset for its command set, but never named the bed.

### Decision

1. **The three Ortur Laser Master 3 presets declare `grblhal`.** As the Falcon A1 Pro preset
   does, they request the grblHAL starter's 1024-byte receive window. Start still bounds it by the
   controller's own `Bf:` report and falls back to the stock window without one (ADR-331). The
   catalog's coherence check requires this window: the project loader lifts a grblHAL profile
   still at the stock window anyway. S max (1000), work areas, origin, homing and feed ceiling are
   unchanged. A second evidence entry names OLF 2.x and its sources. The presets' `catalogVersion`
   becomes 2026-10-22, and `profile-catalog-content.test.ts` records the new content.
2. **A preset can be withdrawn.** A catalog entry may carry a `withdrawn` reason. Machine Setup's
   list leaves a withdrawn preset out, as ADR-637 rule 2 leaves out the generic firmware starters.
   The preset stays in the catalog, so a saved copy still resolves. The Falcon-compatible fallback
   is withdrawn, and its profile content does not change.
   - A saved copy of it opens in Machine Setup as a machine that isn't listed (ADR-637 rule 5),
     with its own name, type, work area and firmware in the form.
   - Job Review names a saved copy that still has the withdrawn preset's 400 × 400 mm work area.
     It gives the reason and says to set the machine's work area. A work area the operator set is
     their own, so it is not named.
3. **No Falcon A1 preset is added.** Creality's A1 download page offers no LightBurn device file,
   and the wiki's A1 LightBurn guide returns 404. Creality's product page gives 305 mm × 381 mm
   without saying which is X, so a preset would have to guess. An A1 owner chooses **My machine
   isn't listed**.
4. **`preset-corrections.ts` adds the Falcon A1 Pro bed.** A copy of
   `creality-falcon-a1-pro-grblhal` that still has exactly 400 × 400 mm predates #796. Job Review
   names it, and Machine Setup offers **Use 358 x 268 mm** (ADR-322 Amendments 1 and 2). The
   values are Creality's LightBurn bundle's Width 358 and Height 268.
5. **Not listed in `preset-corrections.ts`:**
   - **Ortur copies saved as `grbl-v1.1`.** The mismatch is not silent. With an LM3 connected,
     every Job Review already names it and says to choose grblHAL in Machine Setup. Changing the
     controller kind also clears calibrated scan offsets (`controllerCompatibleProfile`), so it is
     the operator's choice, not a one-click patch.
   - **Pre-split Ortur LM3 and xTool D1 Pro copies.** They equal today's LU2-10A and D1 Pro (20 W)
     presets. Only owners of other heads are affected, and the chosen row already names its head.
     There is no single corrected value to offer: an LU3 owner needs the LU3 row. For the 40 W
     xTool head, xTool's own pages disagree on the depth (430 × 348 against 430 × 390 mm, per the
     audit's search-index snippets; the cited page is now 404).

### Alternatives

- **Delete the Falcon-compatible profile.** Rejected: saved copies would lose their catalog
  entry, and with it the G-code provenance and the Job Review note. Withdrawing changes only the
  list.
- **Give the fallback a sourced work area.** Rejected: it describes no Creality machine, so no
  vendor source exists for it.
- **Keep the Ortur presets at the stock receive window.** Rejected: the catalog coherence check
  and the project loader both treat a grblHAL profile at the stock window as uncorrected.

### Consequences

- An LM3 owner who connects sees the Ortur rows as **Same firmware**. The chosen preset connects
  with the grblHAL driver, which clears a latched line error and lets the firmware judge `$N=`
  values.
- The Creality group lists only the Falcon A1 Pro. Searching "400x400" no longer finds a Creality
  row.
- Owners of a saved fallback copy, or of a pre-#796 A1 Pro copy, are told at their next Job
  Review.
- No hardware was operated. The grblHAL banner and the latched-error behaviour rest on Ortur's
  manual, Ortur's firmware source and owners' posted startup reports.

### Verification

- `brand-laser-profiles.test.ts`: each Ortur preset binds the grblHAL driver (`stickyLineError`),
  keeps S1000 and the 1024-byte window, and accepts `$22=5`, which the stock driver refuses. With
  grblHAL detected, every Ortur row is `possible` with no warning.
- `profile-catalog.test.ts` and `profile-catalog-content.test.ts`: the catalog stays coherent, and
  the Ortur presets are pinned at 2026-10-22.
- `machine-picker-entries.test.ts` and `DeviceSetupWizard.catalog.test.tsx`: the fallback is out
  of the list, and Creality lists only the A1 Pro. A saved copy is a machine that isn't listed. The
  wizard shows Ortur as **Same firmware** and xTool as **Other firmware** when grblHAL is detected.
- `preset-corrections.test.ts` and `preset-correction-warnings.test.ts`: the A1 Pro bed
  correction, and the withdrawn-copy note with the operator's own work area left alone.
