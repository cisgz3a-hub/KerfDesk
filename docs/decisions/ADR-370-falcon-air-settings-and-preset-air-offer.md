## ADR-370 - The Falcon Console sends Creality's air settings, and Machine Setup offers a preset's air to an outdated saved profile (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

This amends two things: the Falcon A1 Pro command contract (ADR-322 item 4, ADR-323), and the
Console setting-write policy recorded as audit settings-console-10. It builds on ADR-335 and
ADR-345. It adds no Start guard: both changes are Console and Machine Setup behaviour, and Job
Review stays advisory (rule 7 / ADR-228).

### Context

An air-assist audit on the maintainer's Falcon A1 Pro (2026-09-24) found the air code paths
correct. It also found two ways the machine can still end up without working air.

1. **Job Review's `$152=100` advice could not be followed in KerfDesk.** ADR-345 tells the operator
   to set `$152=100` when the A1's standby timer idles the pump. The Falcon contract, however,
   refused every numeric `$N=` write in the Console.
   - Creality's Falcon A1 parameter page documents three air settings and says to set them from a
     software console:
     - `$150`: engraving airflow level, 0-100, default 25.
     - `$151`: cutting airflow level, 0-100, default 100.
     - `$152`: wait before standby, 0-100 s, default 30. At 100 the pump and laser module are never
       powered off.
   - The A1 Pro's GRBL page lists none of the three. LightBurn staff describe the air bug for both
     models, and ADR-345 already applies `$152` to the A1 Pro.
2. **An outdated saved profile never sends air.** Device profiles are saved whole, and nothing
   compared a saved profile with its preset.
   - The A1 Pro preset gained `airAssistCommand: 'M8'` on 2026-09-19 (#796) and
     `airAssistRestartUnreliable` on 2026-09-21 (#815).
   - A profile saved before then still has Air output Disabled. It emits no `M7`/`M8`/`M9`, and the
     Air restart row stays hidden.
   - The only signals were Manual Air's "no air output" notice and Job Review's manual-air advisory.
     Both said to configure an output only after a hardware test, although Creality's own LightBurn
     bundle uses `M8`.

### Decision

1. **The Falcon Console accepts `$150`, `$151` and `$152`.**
   - `ControllerDriver.consoleSettingWrites` lists the numeric `$N=` writes a driver still sends
     when `capabilities.settings` is not `grbl-dollar`, each with a whole-number range. The Falcon
     contract lists `$150`, `$151` and `$152`, each 0-100.
   - `consoleSettingWriteIssue` (core) refuses any other write with the existing message, which now
     names the exceptions. It refuses an out-of-range or fractional value with the documented range.
   - Listed writes go through the Console's existing confirmation, fresh-Idle check and
     configuration-state effect. Like any configuration write, they invalidate the Frame proof.
   - FluidNC, and every other driver without a list, is unchanged. The Falcon's Machine Settings
     panel stays unavailable.
2. **Machine Setup offers a preset's air settings to an outdated saved profile.**
   - `presetAirAssistUpdate` (core) returns a built-in preset's air settings when a saved profile
     names that preset (`profileId`), has Air output Disabled, and the preset defines a command.
   - Machine Setup's Air output row then shows the preset's settings and one button that applies
     them: `M8` with Air restart for the A1 Pro.
   - Manual Air's "no air output" notice and Job Review's manual-air advisory name the preset's
     command and point to that row.
   - Nothing is applied automatically. A saved profile with any air command configured is never
     flagged, including one whose Air restart was cleared after `$152=100`.
3. **The `$152=100` advice now names the Console.** The ADR-335/345 advisories, the Air restart
   tooltip and the live bar's hold message all say to send `$152=100` from the Console. The live
   bar adds "after the job", because setting writes need Idle.

### Consequences

- KerfDesk's own advice for the A1 air pump can now be followed inside KerfDesk. The vendor
  contract still keeps every other numeric setting out of host software.
- The offer covers any built-in preset with an air command: today the Falcon A1 Pro and the
  Sculpfun S30. Presets that ship with air Disabled, such as Falcon-compatible GRBL and Sculpfun S30
  manual air, never trigger it.
- An operator who deliberately set Air output Disabled on such a preset sees the Machine Setup note
  whenever the row is shown. The note has no other effect.

### Evidence and limits

- `console-setting-writes.test.ts` pins the allowed range, the refusal that names the exceptions,
  the unchanged FluidNC refusal, and that non-setting commands pass untouched.
- `laser-console-falcon-air-settings.simulator.test.ts` connects the real store to the GRBL
  simulator with the Falcon contract and sends `$152=100`. It also shows that `$110=36000` and
  `$152=150` never reach the wire. Removing the Falcon list fails this test and the unit test.
- `preset-air-assist.test.ts`, `PresetAirAssistOffer.test.tsx` and
  `manual-air-assist-warnings.test.ts` pin the offer.
- No hardware was operated. Whether the A1 Pro firmware implements `$150`-`$152` as Creality's A1
  page describes is unverified. WORKFLOW F-F3 step 12 is the check.
