## ADR-637 - Machine Setup leads with one machine list (2026-10-19)

**Status:** Accepted. Amends ADR-420 (the Machine stage's order and its Find card), ADR-420
Amendment 4 (the **Review setup** shortcut) and ADR-347 (the profile card picker and the
capability cards). | **Date:** 2026-10-19

Maintainer direction, 2026-10-19: Machine Setup "feels like it's too difficult at the moment for a
normal user to even find their profile". After a review of the Machine stage they asked for "one
searchable machine list that comes first, connection as a strip, a quick path for machines that
aren't listed, and one Next button".

ADR-240 #2 is unchanged: generic `$$` values never establish hardware identity, so no machine is
chosen from a connection. ADR-205's separation of observation from draft, the single draft with
its Save/Cancel boundary, per-setting firmware consent and all Frame/Start behaviour are
unchanged. No guard is added (ADR-228).

### Context

The machine profile was the third block of the Machine stage. Above it sat the **Find my
machine** card (with Connection options) and three machine-type cards, so the list usually began
below the fold of the dialog. Then:

- The catalog showed two profiles until **Browse all N profiles** was pressed. With nothing
  connected, the two were the first in catalog order: **Default 400×400**, the generic starter
  the first-run banner calls a guess (ADR-500), and the Creality Falcon A1 Pro. Sixteen of the
  eighteen laser profiles, Ortur, Sculpfun and xTool among them, were hidden.
- CNC machines were a different control: a dropdown and **Load into draft** inside an "Optional"
  disclosure, shown only after **CNC only** or **Laser + CNC** was chosen.
- **Find my machine**, the stage's primary button, finds the port and firmware, never the machine
  model (ADR-240 #2). The name promised what it could not do.
- Every card carried a **Manual choice** badge until a controller answered, and the stage had two
  forward buttons, **Check essentials** and **Review setup**, with a sentence explaining them.
- A machine that is not in the catalog had no path of its own: the hint said to keep the current
  settings and check the controller.

### Decision

1. **One list, first.** The Machine stage asks **Which machine do you have?** Every brand laser
   profile and every CNC preset is one row of one scrolling list, grouped by brand from A to Z.
   **Search machines** matches brand, model, type and `WxH`; an **All / Laser / CNC** filter
   narrows it, and a Laser + CNC machine shows under both. A row is one option in a radio group
   (ADR-347): the whole row chooses it. All rows show at once; there is no preview.
2. **The generic firmware starters are not listed.** Default 400×400 and the generic grblHAL,
   FluidNC, Marlin, Smoothieware and Ruida starters describe firmware, not machines. Their
   firmware is chosen in rule 5's form, with the same effect as Connection options' controller.
3. **The chosen machine is described under the list**: its work area, power, type and
   controller, the evidence label, any warning, and **Profile details** (outside the choice, so
   reading selects nothing). A CNC preset shows the existing geometry-only, controller-unchanged
   disclosure and its sources. A Laser + CNC machine asks which toolhead is fitted.
4. **A CNC preset makes the draft a CNC-only machine** with the preset's name, work area and
   spindle ceiling, keeping the controller as before. Over a listed laser profile it starts from
   the generic starter for the same controller, so no laser brand's settings stay behind under a
   CNC name. A row is chosen while the draft has its name, work area and spindle ceiling.
5. **My machine isn't listed** follows the list and asks four things: name, type (**Laser only**,
   **CNC only**, **Laser + CNC**, plus the toolhead for a hybrid), work area and firmware. Chosen
   over a listed machine it starts again from the generic starter for the same controller, named
   **My machine**, keeping the work area. Chosen on the untouched starter it names it **My
   machine**, so the choice lives in the draft and survives moving between stages. A draft that is
   neither listed nor the untouched starter (imported, filled in from the controller, or set up
   this way before) opens with it chosen. Nothing else on the stage asks the machine type.
6. **Connection is a strip.** The Find card becomes a one-line strip at the top of the stage: its
   status (**Not connected**, **Connecting…**, **Found your GRBL controller**, …) and **Connect**,
   a normal button, since connecting is optional. What the controller reported, the automatic
   fill with its Undo, the mismatch cards and Connection options open under it, unchanged
   (ADR-420). **Set up without connecting** is removed: the list is always usable.
7. **A firmware hint, not an identification.** Once a controller has named its firmware, laser
   rows show **Same firmware** or **Other firmware**. The **Manual choice** / **Possible match**
   badges go.
8. **One Next.** Machine and Essentials each have one primary **Next**; Review has **Save**. The
   **Review setup** shortcut and **Check essentials** go. The stage buttons still open any stage,
   Review included.

### Alternatives

- **Rank by the controller's reported travel and preselect.** Rejected: many machines report
  400 × 400 mm, and ADR-240 #2 forbids a generic `$$` read from establishing identity.
- **Keep the type cards above the list.** Rejected: a listed machine already says what it is, so
  the question only matters for a machine that is not listed.
- **List the generic starters in a "Generic" group.** Rejected: they read as machines and put the
  generic 400 × 400 starter back in front of the operator as a choice.
- **Keep the two-profile preview.** Rejected: it hid most machines and led with the starter.

### Consequences

- Choosing **My machine isn't listed** is a draft edit, so Escape asks before discarding it.
- A CNC-only machine is now one click from the list instead of a type card, a dropdown and Load.
- The connection's automatic fill of a new machine is unchanged, and leaves the draft as a
  machine that isn't listed, with the form showing what was filled in.
- Saved projects, the catalog, G-code, Frame and Start are unchanged.

### Verification

- `machine-picker-entries.test.ts`: the list holds every brand laser profile and CNC preset and no
  generic starter; brand grouping; search and type filter; CNC preset choice; the reset over a
  listed laser; the not-listed choice from a listed machine, the untouched starter and a custom
  draft.
- `DeviceSetupWizard.catalog.test.tsx`, `DeviceSetupMachinePicker.*.test.tsx` and the updated
  wizard, audit and LaserWindow tests cover the stage in the rendered wizard; the e2e specs follow
  the new controls.

### Amendment 1 - A listed machine keeps its type, and a choice asks before it replaces values (2026-10-20)

An audit of this decision found four gaps; each is closed here.

1. **A listed machine keeps its type.** ADR-420 rule 5's fill set the machine type from `$32`
   after a machine had been chosen from the list, so an Ortur Laser Master 3 whose controller had
   laser mode off became a CNC-only draft while its row stayed chosen and its facts still said
   Laser. `$32` is a setting of the controller, not a measurement of the machine, and ADR-240 #2
   already keeps `$$` values from establishing identity, so a draft that is a listed machine (a
   chosen row, or a listed laser profile however edited) keeps the type the list gives it. The
   reported laser mode still reaches the draft, where Review shows it. A machine that is not listed
   still takes its type from `$32`, with the type question in view. The chosen machine's facts now
   describe the draft (its work area, power and type), and a listed machine that an earlier setup
   saved as another type says so and shows the type question, so the draft can be seen and set.
2. **A choice asks before it replaces values someone set.** Rows are one native radio group, so
   arrowing through the list chose each row in turn, and a CNC preset or **My machine isn't
   listed** reset a tuned listed profile to the starter. A choice now applies at once only when it
   would replace nothing that differs both from the listed profile or firmware starter the draft
   came from and from what the controller reported: the max feed, S range, origin and homing,
   frame speed, no-go zones, scan-offset, camera or rotary calibration, saved positions, and a
   Laser + CNC machine's CNC values (not the spindle ceiling each CNC choice brings). Otherwise a
   notice after the list names what would be replaced, with **Replace settings** and **Keep
   current settings**. The radios keep the draft's choice meanwhile, so arrowing over such a draft
   asks for each row in turn instead of applying it. Values from the controller are not counted,
   because connecting brings them back, so the first-connect fill followed by a choice from the
   list asks nothing; nor are the name and work area, which every machine brings.
3. **The generic starters' values stay reachable.** In **My machine isn't listed**, choosing the
   firmware on a draft that is still a firmware starter (apart from its name, type and work area)
   starts from that firmware's generic starter: Ruida's rear-right origin and 900 × 600 mm,
   Marlin's S 0-255 and capabilities, grblHAL's receive window. It keeps the name, the type asked
   in the form and a work area the operator typed. Any other draft changes its controller only,
   as Connection options does.
4. **A CNC preset over a Laser + CNC machine** also returns the CNC values (safe Z, spin-up,
   coolant, park) to the defaults before applying the preset's spindle ceiling, so the listed
   machine's CNC sub-profile does not stay behind under the preset's name.

Amendment 2 (`ADR-637-amendment-2-a-listed-machine-keeps-its-work-area.md`) also keeps a listed
machine's work area when the controller is read, and shows `$130`/`$131` beside it instead.

Amendment 3 (`ADR-637-amendment-3-profile-import-asks-before-it-replaces.md`) has the Machine
stage's profile imports ask the same question as item 2 before they replace values someone set.

Amendment 4 (`ADR-637-amendment-4-grblhal-work-area-is-its-homed-envelope.md`) maps a grblHAL
`$130`/`$131` with homing and hard limits on to the homed envelope's size, which is what the fill,
**Use detected values** and Job Review's travel fact use.

Amendment 5 (`ADR-637-amendment-5-a-bed-widened-to-the-travel-is-named-and-warned.md`) names the
correction once at connect for a grblHAL bed widened to `$130`/`$131`, and warns by name at Frame
and Start while a route leaves the homed area.

Amendment 6 (`ADR-637-amendment-6-save-switches-the-live-driver.md`) has Save reconnect with the
saved machine's driver when the live connection uses another, or say why not and offer
**Reconnect now** in the toolbar, which no longer names a vendor command set that is not live.

Amendment 7 (`ADR-637-amendment-7-laser-mode-off-asks-instead-of-making-a-cnc.md`) stops taking
the machine type from `$32`: a laser whose controller reports `$32=0` stays a laser, is asked to
turn laser mode on with one guarded click, and becomes a CNC only when the operator says so. Job
Review's laser-mode-off row gets **Send $32=1**.

Amendment 9 (`ADR-637-amendment-9-reconnects-wait-for-the-job.md`) holds the toolbar's
**Reconnect now** and step 1's **Reconnect using selected profile** while a job runs, as Save's
driver switch already was: reconnecting resets the controller, which would end the job.

Verification: `device-setup-auto-fill.test.ts` (a listed laser and a CNC preset keep their type),
`machine-picker-entries.test.ts` (the CNC reset), and `DeviceSetupMachinePicker.customised.test.tsx`
(the draft's facts and type question, the replace notice for a CNC preset, **My machine isn't
listed** and another listed laser, no notice for an untouched profile, and the firmware starters).
