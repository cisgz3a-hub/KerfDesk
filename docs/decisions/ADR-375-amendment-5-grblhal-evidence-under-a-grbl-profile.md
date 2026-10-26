## ADR-375 Amendment 5 - grblHAL the controller shows, under a stock-GRBL profile (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

Amends [Amendment 4](ADR-375-amendment-4-grblhal-envelope-and-console-values.md) decisions 3 and 4
(Console setting values) and [Amendment 2](ADR-375-amendment-2-grblhal-report-mask-names-missing-fields.md)
decisions 1 and 2 (`$10`). It follows meta audit v1 finding M3-P3-3 on the merged fix #1379 for
C4-P2-1, which a refuter and the coordinator both confirmed.

Sources:

- grblHAL core at `d7aaee3d`, the commit ADR-375 pins.
- Ortur's ESP32-S2 firmware, `Ortur-Tech/Ortur_Laser_Firmware_17X-18X` at `4849ac85` (source headers
  "Part of grblHAL").
- Ortur's STM32 firmware, `Ortur-Tech/Ortur_Laser_Firmware_14X` at `19e68f0e` ("Part of Grbl",
  `GRBL_VERSION "1.1h"`).
- gnea/grbl at `bfb67f0c`.

No hardware was available, so none of this is hardware evidence.

### Context

- **The profile picks the driver.** Connect binds the driver from the machine profile, and a banner
  never switches it (ADR-375, `controller-identity-warnings.ts`).
- **The Ortur ESP32-S2 boards run grblHAL that greets as stock GRBL.** The firmware for the Laser
  Master 2 Pro S1/S2 and the Aufero lasers is built at `COMPATIBILITY_LEVEL 1`
  ([config.h L47](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/config.h#L47)).
  So it greets as `Grbl 1.1f ['$' for help]`
  ([report.c L426-L429](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L426-L429)).
  Two LightBurn forum threads show that banner and a `$I` reply of `[VER:1.1f(ESP32).20210403:]`
  and `[OPT:VNMHSL,35,16384,3]`, with no grblHAL lines:
  - [73472](https://forum.lightburnsoftware.com/t/aufero-laser-2-doesnt-move-on-second-job/73472):
    Aufero 2 S2, OLF 186, August 2022.
  - [54848](https://forum.lightburnsoftware.com/t/ortur-laser-master-2-pro-s1-s2-firmware-update/54848):
    Laser Master 2 Pro S2, OLF 185.

  KerfDesk has no preset for these machines, so they run under the default stock-GRBL profile.
- **It keeps part of a malformed value.** `settings_store_global_setting` reads the value with
  `read_float` and never checks what follows the number
  ([settings.c L456-L472](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/settings.c#L456-L472),
  [nuts_bolts.c L152-L209](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/nuts_bolts.c#L152-L209)).
  So `$100=26,67` stores 26 and answers `ok`. This firmware stores a whole-number setting as
  `truncf(value)` in 16 bits, as stock GRBL does in 8
  ([settings.c L534](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/settings.c#L534)).
  Stock GRBL refuses `26,67` because a character follows the number. It answers error:3
  (invalid statement), not the error:2 the finding named
  ([system.c L269-L270](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L269-L270)).
- **Nothing told the operator.** On a stock-GRBL profile the Console left `26,67` to the firmware,
  because stock GRBL refuses it. The `$$` re-read compared a value that is not one number only on
  grblHAL. So the operator's X steps per mm ended about 2.5 % short, and nothing warned.
- **`$10` had the same profile key.** Amendment 2 reads `$10` as grblHAL's only on the grblHAL
  driver. This firmware prints `$10` whole
  ([report.c L474-L477](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L474-L477)).
  It has grblHAL's bit layout
  ([settings.h L331-L338](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/settings.h#L331-L338)),
  and sends `WCO:` and `Ov:` only with bits 5 and 6
  ([report.c L1401-L1412](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L1401-L1412)).
  Amendment 2 already listed this as open.
- **What the controller shows of grblHAL:**
  - **`$I`:** a plain `$I` prints `[NEWOPT:` and `[FIRMWARE:grblHAL]` only at level 0
    ([core report.c L918-L920](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L918-L920),
    [Ortur report.c L1100-L1114](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L1100-L1114)).
  - **`$$`:** at level 0 or 1 it lists every setting
    ([core system.c L300-L317](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L300-L317),
    [Ortur system.c L157-L158](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/system.c#L157-L158)).
  - **`$14`-`$18`:** grblHAL keeps its signal invert and pull-up masks there, and stock GRBL
    leaves those numbers unused. Core `d7aaee3d` always lists `$15` and `$18`
    ([settings.c L2368-L2372](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2368-L2372)).
    The Ortur firmware lists all five
    ([report.c L482-L490](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L482-L490)).
  - **Other extra settings prove nothing.** A stock-GRBL fork can list settings of its own. Ortur's
    STM32 firmware (`Grbl 1.1h`, stock `$10`) lists `$33`
    ([report.c L233-L242](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_14X/blob/19e68f0eb6b6043a034ce36eec40151270be53dd/grbl/report.c#L233-L242)).
    So on a stock profile, "a setting outside the legacy list" is not grblHAL evidence.
- **`$19` is legacy in grblHAL.** `$19` (probe pull-up disable) is `Setting_IsLegacyFn`
  ([settings.c L2373](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2373)).
  So a level-2 build with a probe input lists it beside a `$10` cut to bits 0 and 1. Amendment 2
  counted `$19` as non-legacy, so on the grblHAL driver it took such a dump as showing `$10` whole
  and reported `WCO:` and `Ov:` off.

### Decision

1. **What shows grblHAL under another profile** (`grblhal/grblhal-evidence.ts`). Any one of these:
   - the banner reads `GrblHAL`;
   - the `$$` lists any of `$14`-`$18` (`listsGrblHalSignalSettings` on the settings snapshot);
   - the `$I` reply carries `[FIRMWARE:grblHAL]` or `[NEWOPT:`.

   Two things do not count: a fork's other extra settings, and the ambiguous `Grbl 1.1f` banner on
   its own.
2. **On a stock-GRBL profile that shows grblHAL, a Console value must pass both checks** (amends
   Amendment 4 decision 3):
   - The stock check runs first, because this firmware truncates a whole-number value as stock
     GRBL does (`$22=0.5` keeps its stock message).
   - Then the grblHAL check runs. Its refusal adds why grblHAL applies, for example: "The profile
     selects GRBL v1.1, but this controller lists grblHAL's $14-$18 in its $$ report."
   - The Console's check before the confirmation prompt and the store's own check both use what
     the session showed.
   - This is refusal kind (a), as before.
3. **The `$$` re-read reports a value stored in part, on every driver** (amends Amendment 4
   decision 4). Stock GRBL refuses a value that is not one number. So an `ok`, followed by a number
   in the re-read, means the firmware kept part of the value. This covers a level-2 grblHAL under
   the stock profile, which shows nothing before the write. A text setting still reads back as its
   text and is not flagged.
4. **The stock-GRBL driver reads `$10` as grblHAL's when the `$$` lists `$14`-`$18`** (amends
   Amendment 2 decision 2). The driver declares `statusReportMask: 'grblhal-fields-if-grblhal-dump'`,
   and Amendment 2's texts then apply. FluidNC, which copies the stock driver's capabilities, drops
   the entry: its `$10` stays stock GRBL's.
5. **`$19` is a legacy setting** in the `statusReportMaskIsFull` test (corrects Amendment 2
   decision 1).

Considered and not chosen:

- **Applying both checks whenever the banner is `Grbl 1.1f`.** That banner is also stock GRBL
  1.1f's. Those boards would get `$22=1.0` and `$22=1 (on)` refused for a firmware they do not run,
  while decision 3 already reports a level-2 grblHAL's stored value.
- **Switching the driver, or the detected controller kind, on this evidence.** The profile picks
  the driver (ADR-375), and other features key on the detected kind.

### Consequences

- On these Ortur boards under the default profile, `$100=26,67` and `$110=5O00` are refused before
  the prompt, with the reason.
- `$22=1.0` and `$22=1 (on)` are also refused, with the line to send.
- `$1=300` and `$10=511` stay refused under the stock profile, though grblHAL would take them.
  Choosing grblHAL as the controller in Machine Setup lifts that.
- With a `$10` that turns `WCO:` or `Ov:` off, the status panel, Move to position, Set origin here,
  Job Review and the placement refusals name the bit and the `$10` to send. Frame skips the WCO wait.
- A stock-GRBL fork that lists `$14`-`$18` for settings of its own would get the grblHAL checks and
  `$10` texts. No such fork was found.
- Still open, and not changed here:
  - Job Review's controller identity check uses the banner only, so the `$$` evidence raises no
    identity warning and suggests no grblHAL profile.
  - The connect handshake keeps 8 `$I` lines. This firmware prints its vendor lines first, so its
    `[VER:]` and `[OPT:]` lines fall outside them.
- No change to Frame or Start policy, output, Save G-code, or the Machine Settings dialog.

### Evidence

Code and fake-controller evidence only.

- `console-setting-writes.test.ts` covers the stock-GRBL profile:
  - with each kind of evidence, `$100=26,67`, `$110=5O00` and `$22=1.0` are refused;
  - `$22=0.5` and `$1=300` keep their stock refusals;
  - values both firmwares store as typed are sent;
  - without evidence nothing changes;
  - the re-read reports `$100=26,67` stored as `26.000`.
- `parse-settings.test.ts`:
  - `$14`-`$18` mark the dump;
  - a fork's `$33` and `$40` do not;
  - a level-2 dump that lists `$19` does not show `$10` whole.
- `status-report-mask.test.ts`: the stock driver reads grblHAL's `$10` from a dump with `$14`-`$18`;
  FluidNC and a fork's dump do not.
- `laser-store-console-setting-writes.test.ts` connects each fake behind the default profile:
  - **grblHAL level-1 fake** (Ortur-shaped `$$` and `$I`): `$100=26,67` is refused with nothing
    written, `$10=0` names `$10=96`, and a legacy-only (level 2) dump writes the value, then
    reports `26.000`.
  - **Stock GRBL fake:** `$22=0.5` is still refused, `$100=26,67` reaches the fake and gets
    error:3 with no re-read message, and `$22=1.0` is sent.
