## ADR-370 Amendment 1 - The Falcon A1's air settings stay on stock GRBL; the A1 Pro on grblHAL gets no `$150`-`$152` write and no `$152=100` advice (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-370 decisions 1 and 3 (the Falcon Console's air writes and the `$152=100` advice),
and the advisories of ADR-335, ADR-345 and ADR-462 that name `$152=100`. It adds no Start guard:
Job Review stays advisory (rule 7 / ADR-228).

### Context

Rolling audit v5, report J8 (`docs/audits/2026-10-27-rolling-v5/J8-catalogue-ground-truth.md`),
found J8-P3-2: the Falcon contract's `$150`-`$152` writes and the `$152=100` advice come from
Creality's page for the Falcon **A1**. ADR-370 already said that the A1 Pro's GRBL page lists none
of the three, and that whether the A1 Pro implements them was unverified. An independent refuter
then raised the finding to P1, and the coordinator confirmed it.

- **The A1 Pro runs grblHAL.** The A1 Pro preset declares `controllerKind: 'grblhal'`
  (`falcon-profiles.ts`). One A1 Pro's `$I`/`$$`, published in barebaric/rayforge PR #461
  (merged 2026-09-26), reads `[FIRMWARE:grblHAL]`, `[BOARD:A1 Pro Laser Master]`,
  `[PLUGIN:Trinamic v0.12]`, `[KINEMATICS:CoreXY v2.02]` and `$150=16 $151=16 $152=16 $153=16`.
  This change re-read that PR body on 2026-10-28.
- **In grblHAL's numbering, `$150`-`$152` are microsteps.** grblHAL core
  [`settings.h` @ `d7aaee3d`, L36 and L553-L558](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L553-L558)
  sets `AXIS_SETTINGS_INCREMENT` to 10 and
  `Setting_AxisMicroSteps = Setting_AxisSettingsBase + 5 * AXIS_SETTINGS_INCREMENT`, so `$150`,
  `$151` and `$152` are X, Y and Z. The Trinamic plugin registers them as "-axis microsteps"
  ([`trinamic.c` @ `11c937c8`, L121](https://github.com/grblHAL/Plugins_motor/blob/11c937c85f07f7f4a52be6dfdd0e49f4fcfe1886/trinamic.c#L121)).
  It sets the driver whenever the value is valid and never touches steps/mm
  ([L245-L259](https://github.com/grblHAL/Plugins_motor/blob/11c937c85f07f7f4a52be6dfdd0e49f4fcfe1886/trinamic.c#L245-L259)).
  A valid value is any power of two up to 256
  ([Trinamic-library `common.c` @ `9b304175`, L44-L55](https://github.com/terjeio/Trinamic-library/blob/9b304175318d93818c8967faadc89dd101b17e92/common.c#L44-L55)).
  This change re-read `settings.h` and `trinamic.c` at those SHAs.
- **On the A1, the air map is real.** An A1 `$$` (LightBurn forum topic 181704, post 19,
  2026-01-25, per the J8 refuter) reads `[VER:1.1f.20220810:]`, stock-GRBL numbering, and
  `$150=25 $151=100 $152=30`, the defaults on Creality's A1 page.
- **What KerfDesk did with it.** The refuter drove the real Falcon driver on the A1 Pro preset.
  `$150=32`, `$151=8`, `$152=8` and `$152=100` all passed `consoleSettingWriteIssue`, behind only
  the Console's generic "Send persistent controller setting?" confirm. The Falcon contract has no
  `$$`, so nothing is read back.
  - An "airflow level" that is a power of two changes that axis's microstepping while steps/mm
    stay the same. The motor then moves 16/n of the commanded distance. On CoreXY that distorts
    both X and Y; `$152` changes Z, the focus axis. The change persists.
  - The advised `$152=100` is not a power of two. The firmware refuses it with `error:3`, so the
    remedy cannot work there.
- **Who sees the advice.** Job Review's standby and cycling advisories, the Air restart tooltip and
  the live bar's hold message all named `$152=100`. The two advisories and the tooltip named it for
  any profile with Air restart ticked, not only a Falcon.

### Decision

1. **The Falcon contract lists the A1's air writes on stock GRBL only.**
   `withFalconCommandContract` lists `$150`, `$151` and `$152` (0-100, as ADR-370 decision 1) when
   the wrapped driver is stock GRBL. That is the profile kind the A1's numbering matches. On
   grblHAL the list is empty, so the A1 Pro preset's Console sends no numeric `$N=` write at all.
   Every other driver is unchanged.
2. **The refusal names the grblHAL meaning.** On the grblHAL Falcon contract, a refused `$150`,
   `$151` or `$152` says that in grblHAL's numbering it is the X, Y or Z axis microstep setting,
   not a Falcon A1 air setting. It also says that on a build with the Trinamic plugin, as the A1
   Pro's is, a power-of-two value changes how far that motor moves.
3. **A listed write needs the firmware it was listed for.** The profile, not the banner, picks the
   driver, so an A1 Pro can still be connected under a stock-GRBL Falcon profile. When the session
   shows grblHAL (`grblHalEvidence`: its banner, `$$` or `$I`), the Console refuses a listed write.
   It names the write, the evidence and, for `$150`-`$152`, the microstep meaning.
4. **The advice follows the same split** (`airStandbyRemedy`, `src/core/devices`):
   - **A Creality Falcon on stock GRBL** keeps `$152=100` from the Console. Falcon means the
     Falcon command set or `machineFamily: 'creality-falcon'`, which includes saved copies of the
     Falcon-compatible fallback withdrawn by ADR-660. A profile without a kind counts as stock
     GRBL. On every such profile the Console sends the write, and a test pins that.
   - **A Falcon on grblHAL (the A1 Pro)** gets the firmware remedy only: "install the latest
     firmware and confirm with an air test". The standby advisory adds that Creality documents no
     air standby setting for the A1 Pro, and that on its grblHAL firmware `$150`-`$152` set the
     motor microsteps. The cycling advisory and the tooltip say to untick Air restart after an
     air test. The live bar says to check the firmware, and that `$150`-`$152` are motor
     settings there.
   - **Any other machine with Air restart ticked** gets the firmware remedy and names no setting.
5. **Not done: reading the A1 Pro's setting list.** grblHAL can enumerate its own settings
   (`$ES`, `$EG`, the `$I` plugin list). A write could then be allowed once the controller names
   the setting as an air setting. The Falcon contract disables settings fetch and `$I`, as
   Creality's own LightBurn device does (ADR-322), and no A1 Pro build is known to name an air
   setting. So this amendment sends no new query to the controller, and none to probe a write.
   It can be revisited with a grblHAL A1 Pro build whose own enumeration shows an air setting.

### Consequences

- The Falcon A1 Pro preset can no longer change its microstepping from KerfDesk's Console. It is
  no longer told to send a value that its firmware refuses or that would rescale motion.
- The A1 Pro operator's remedy for air that stops mid-job is a firmware update and an air test.
  The air-command repeats of ADR-462 and the held air of ADR-335 are unchanged. KerfDesk does not
  know an A1 Pro setting that disables the standby timer.
- A Falcon A1 run under a stock-GRBL Falcon profile keeps the ADR-370 behaviour. So does a saved
  copy of the withdrawn fallback. An A1 owner who chose **My machine isn't listed** (ADR-660
  decision 3) and ticked Air restart now sees the firmware remedy without `$152`, because nothing
  in that profile says it is a Falcon. That owner's stock-GRBL Console still sends any `$N=` write.
- ADR-370's own "is unverified" is now answered for one A1 Pro build: `$150`-`$152` are not air
  settings there.

### Evidence and limits

- `falcon-command-contract.test.ts`: the grblHAL Falcon contract lists no write. The stock-GRBL
  one, with or without a profile kind, lists `$150`, `$151` and `$152`.
- `console-setting-writes.test.ts`: on the grblHAL Falcon contract, `$150=32`, `$151=8`, `$152=8`,
  `$152=100` and `$150=25` are refused with their axis named, and `$110` gets the plain refusal.
  The stock-GRBL Falcon contract still sends the A1's writes, and refuses `$152=100` once the
  banner shows grblHAL.
- `laser-console-falcon-air-settings.simulator.test.ts`: the real store on the GRBL simulator.
  On the A1 Pro preset with a grblHAL banner, none of those writes reaches the wire. On a
  stock-GRBL Falcon, `$152=100` does. Under a stock-GRBL Falcon profile with a grblHAL banner,
  it does not.
- `air-standby-remedy.test.ts`: the remedy for each kind, and that the `$152=100` remedy is named
  only where the Console sends it.
- `air-assist-standby-warnings.test.ts`, `air-assist-cycling-warnings.test.ts`,
  `laser-stream-hold.test.ts` and `LiveMotionBar.hold.test.tsx`: the A1 Pro's Job Review and live
  bar text names no `$152=100`. The stock-GRBL Falcon's still does.
- No hardware was operated, and the maintainer's A1 Pro was not connected. The firmware side rests
  on one third-party A1 Pro transcript, consistent with Creality's A1 Pro settings page (which uses
  grblHAL core's setting names and lists no `$150`-`$152`) and with the maintainer A1 Pro's
  `Bf:512,65535`. WORKFLOW F-F3 steps 12 and 13 hold the checks on a machine.
