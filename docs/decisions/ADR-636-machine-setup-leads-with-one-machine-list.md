## ADR-636 - Machine Setup leads with one machine list (2026-10-19)

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
