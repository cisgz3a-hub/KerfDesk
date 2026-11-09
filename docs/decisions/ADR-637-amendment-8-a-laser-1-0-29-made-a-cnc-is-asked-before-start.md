## ADR-637 Amendment 8 - A laser that 1.0.29 made a CNC is asked before Start

**Status:** Accepted (rolling audit v10, finding V2-P2-2, raised to P1 by its refuter and the
coordinator, matching U8-P2-1; the coordinator's fix brief asks for a question before any job
reaches the controller and for no silent change of machine type). It corrects Amendment 7's
Consequences, which said the CNC output path "cannot be reached from `$32` alone". It changes no
G-code, no stored machine and no project format. | **Date:** 2026-11-08

### Context

- On its first Connect to stock GRBL with laser mode off (`$32=0`), KerfDesk 1.0.29's automatic
  fill turned the generic laser starter into a CNC (U8-P2-1). Pressing Save stored that machine,
  and the last-machine document (`kerfdesk.last-machine.v1`, ADR-500 Amendment 1) kept it.
- Amendment 7 (#1567) changed the fill, so a new Connect keeps the laser. It added no check for
  the machines 1.0.29 had already saved. Their document is restored unchanged
  (`loadLastMachineSelection`, `createStartupProject`), so the window reopens on a CNC.
- On that CNC a first square compiles to `M3 S12000`, `G4 P3.000` and rapids with no `S0`. The
  repository's GRBL model (`grbl-laser-power-model.ts`, a port of gnea/grbl `gc_execute_line`)
  holds the spindle output, which is the beam, on through the 3 s dwell and 40 mm of rapids when
  `$32=0`. GRBL clamps S to `$30`, so a diode runs at full power.
- The only controller warning on that path was the `$30` mismatch advisory. It never holds Start,
  it does not mention a laser, and it advised `$30=12000`, which is wrong for a laser.
- The saved machine cannot prove what it is. A router owner who chose CNC on the starter has the
  same document, apart perhaps from its name. So KerfDesk must ask, not convert.

The real document 1.0.29 saved is `src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json`,
made by 1.0.29's own `initDeviceSetup`, `planControllerAutoFill`, `deviceSetupReducer`,
`machineSetupProfile` and `rememberLastMachine` on a stock-GRBL `$$` (`$30=1000`, `$31=0`,
`$32=0`). It has the starter's `profileId` (`generic-grbl-400x400`), `cnc-output` as its only
output, and KerfDesk's CNC defaults (12000 RPM, 3 s spin-up, coolant off).

### Decision

1. **Which machines are asked** (`src/core/preflight/converted-laser-profile.ts`). A CNC is asked
   whether it is a laser when all of these hold:
   - It was made from the laser starter as 1.0.29's fill left it: the starter's `profileId`, with
     CNC as its only declared output. The plain starter declares no output kind, so a CNC on it is
     the toolbar's Laser/CNC switch, not the fill. A starter that also declares a laser head is its
     owner's two-tool machine.
   - Nobody set its spindle: max RPM, spin-up and coolant are KerfDesk's defaults.
   - The controller, once read this session, does not report a spindle's `$30`. A `$30` above
     1000 is an RPM someone configured, so that machine is not asked.
   - Nobody has answered "This is a CNC router" yet.
   - **Amended by Amendment 10 (2026-11-09).** The spindle and `$30` conditions above let a laser
     whose owner followed 1.0.29's own `$30` advice go unasked, and the starter-only id missed
     LightBurn imports and profiles with no id (rolling audit v12 X2-P1-2). Amendment 10 asks any
     CNC-only profile 1.0.29 could have converted and ends the question only on an answer. CNC
     recoveries ask it too (X2-P2-1).

   The other controller hints agree with a laser but do not tell one from a stock router: a
   reported `$32` (only GRBL 1.1 and its descendants have laser mode), `$30` at 1000 or under
   (GRBL's default and the laser scale), and GRBL 1.1 build info. The question names them ("Your
   controller reports laser mode off ($32=0), $30=1000 (the power scale lasers use) and GRBL 1.1h
   (the firmware that has laser mode)") so it reads true. It never uses them to change anything.

2. **The question.** "Is this machine a laser?" KerfDesk 1.0.29 could set a laser up as a CNC when
   its controller had laser mode off ($32=0). Set up as a CNC, a job turns the laser on at full
   power, holds it still for 3 seconds, and keeps it on over every travel move. It is asked in
   three places:
   - **On the canvas at startup**, in the Machine Setup banner's corner, before any Connect. It
     offers **It's a laser: open Machine Setup**, **This is a CNC router** and **Not now**. Not now
     only hides the card for this launch.
   - **In Machine Setup**, above every step, while the draft is still the CNC Setup opened on. The
     card follows a Connect, so the hints appear once the controller is read. **It's a laser**
     puts the draft on Laser. Only Save applies it, and with `$32=0` Amendment 7's laser-mode
     question follows. **This is a CNC router** keeps the answer.
   - **In Job Review**, at the top. Start is disabled with "Answer whether this machine is a laser
     before starting.", and the review store refuses a confirm while the question is open, so
     neither a keyboard, a remote approval (ADR-638) nor a stale signal starts past it. The gate
     also never confirms a model that still holds the question. **This is a CNC router** keeps the
     answer and rebuilds the review. **It's a laser: open Machine Setup** closes the review with
     nothing sent and opens Machine Setup. A phone waiting on this review is told to answer it on
     the PC.

3. **Nothing changes the type except the operator.** No path rewrites the stored machine or the
   project. The answer "This is a CNC router" is kept app-level
   (`kerfdesk.converted-laser-answer.v1`), beside the last machine, so it is asked once. Saving
   Machine Setup as a CNC also counts as that answer when the operator chose CNC there (the
   question was not open), because on this build a CNC is always the operator's own choice
   (Amendment 7). Save alone, while the question is open, is not an answer.

4. **The `$30` advisory names the laser first.** When a CNC's controller reports `$30` at 1000 or
   under, below the profile's spindle max RPM, the advisory now reads: "Controller $30 is 1000 but
   this machine's spindle max RPM is 12000. 1000 is the scale lasers use: if this machine is a
   laser, it is set up as a CNC and this job fires the beam at full power, so do not start it; open
   Machine Setup and choose Laser. If it is a router, set $30=12000 (or update the machine profile)
   so S values map to real RPM." A larger `$30`, and FluidNC's wording, are unchanged.

5. **The Start rule.** The question is an acknowledgement in Job Review, of the same kind as
   ADR-224's CNC attestation: one click in the review answers it, and it holds only until then. It
   is not a refusal of the transport or of the program, and the frame-first gate (PROJECT.md rule
   21, ADR-565) is unchanged. It holds Start only because the operator is the one who knows whether
   the machine is a laser, and the cost of a wrong guess is a full-power diode burn.

### Consequences

- A returning 1.0.29 user whose laser became a CNC sees the question when KerfDesk opens and again
  in Job Review, and no job starts on that CNC until they answer. Answering Laser goes through
  Machine Setup's Save, so the operator sees the laser setup before it applies.
- A router owner whose router was set up on 1.0.29 from the starter, with the spindle left at
  KerfDesk's defaults, is asked once. A router set up on this build is not asked.
- **Not covered.** A CNC project from 1.0.29 opened on another computer, whose last machine is the
  plain starter, opens on the starter's capabilities, so it is not asked. Its Job Review still
  shows the reworded `$30` advisory, which names the laser first, whenever the controller reports a
  laser scale.
- G-code is unchanged for every machine: the question and the answer feed only the review, the
  setup card and the canvas card.
- **1.0.30 update notes** (the notes on main are still 1.0.29's, so this is the line to add when
  they are collected): "If KerfDesk 1.0.29 set your laser up as a CNC when you first connected it,
  KerfDesk now asks whether the machine is a laser before any job starts. Choose It's a laser and
  save Machine Setup to put it back."

### Verification

- `converted-laser-profile.test.ts`: the starter made a CNC is asked, with the controller's hints;
  before a read with none; never a laser; not once the spindle's RPM, spin-up or coolant was set;
  not another machine, a two-tool starter or the toolbar's CNC on the plain starter; not at a
  spindle `$30` (1001, 12000), and at a laser one (1000, 255).
- `converted-laser-question.test.ts`: the real 1.0.29 document restores as a CNC on this build and
  is asked, offline and after a stock-GRBL read (the exact hint sentence); the router answer is
  kept and ends the question; the same document saved as a laser, or as a router with its spindle
  set, is not asked.
- `job-review-converted-laser.test.ts`: the real gate on the restored machine reviews `M3 S12000`
  and `G4 P3.000`, holds the question in its model, refuses the store's confirm, and rebuilds
  without the question after the answer; a router with its spindle set is not asked.
- `JobReviewDialog.converted-laser.test.tsx`: the question names the beam and the hints, disables Start with its
  reason and holds the store; **This is a CNC router** keeps the answer and rebuilds; **It's a
  laser** closes the review, opens Machine Setup and changes nothing.
- `DeviceSetupWizard.converted-laser.test.tsx`: Machine Setup asks on open; **It's a laser** and
  Save make the machine a laser and keep no answer; **This is a CNC router** is kept; Save alone is
  not an answer; a router set up from the laser starter on this build is kept as the answer.
- `controller-readiness.test.ts`: a laser-scale `$30` advisory names the laser before the `$30`
  advice; a spindle-scale one is unchanged.
- `e2e/converted-laser-question.e2e.ts` (the e2e fixture's simulated serial GRBL, `$32=0`): the
  1.0.29 browser storage restores a CNC; the canvas asks at startup; after Connect the hints name
  `$32=0` and `$30=1000`; the real Job Review shows the question with Start disabled and a store
  confirm refused, over a program with `M3 S12000` and `G4 P3.000`; **This is a CNC router**
  removes it and is kept; no `M3`/`M4` reaches the controller. A second case takes **It's a laser**
  from the canvas into Machine Setup, where Laser and Save make the machine a laser.
