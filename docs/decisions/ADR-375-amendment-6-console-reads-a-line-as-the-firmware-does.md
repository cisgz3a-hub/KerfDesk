## ADR-375 Amendment 6 - The Console reads a line as the firmware does (2026-10-26)

**Status:** Accepted. | **Date:** 2026-10-26

Amends ADR-375 decision 9 and the Console value checks of Amendment 4, after meta audit v1 finding
M6-P2-1. That finding re-rated controller audit v2 C5-P3-1 and rolling audit v2 17-P3-2 from P3 to
P1; an independent refuter and the coordinator confirmed it on main `adf300522`. Sources are gnea/grbl
at `bfb67f0c`, grblHAL core at `d7aaee3d` (the commits ADR-375 pins) and FluidNC `v4.0.3`. No
hardware was available, so none of this is hardware evidence.

### Context

- **Stock GRBL filters a line before it reads it.** Its line reader drops whitespace, control
  characters and the block-delete `/`, removes `( … )` comments, cuts a `;` comment and upper-cases
  letters. Only then does a line that starts with `$` go to the system-command parser
  ([protocol.c L78-L149](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L78-L149)).
  The Console matched `$` commands only in their bare form (`/^\$\d+=\S.*$/`, `/^\$RST=/`,
  `/^\$N\d*=/`). So `(x)$30=255`, `$30(x)=255`, `$22(x)=0.5`, `$RST(x)=*`, `$N(x)0=G0X100` and
  `$I(x)=x` went out as plain G-code. That skipped the persistent-command block, the confirmation,
  the value check and the `$$` re-read, while the firmware ran the command. The refuter's repro
  went through the real Console store:
  - `(x)$30=255` left Start's power scale at 1000, so every layer above 25.5 % burned at full
    power;
  - `$RST(x)=*` wiped the EEPROM without confirmation;
  - `$N(x)0=G0X100` installed a startup move.
- **Stock GRBL reads numbers with read_float, then casts.** It reads a setting number and a startup
  line's number this way, so it stores:
  - `$30.0=` and `$+30=` as `$30=`
    ([system.c L252-L271](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L252-L271));
  - `$N0.5=` and `$N+0=` as startup line 0
    ([system.c L237-L266](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L237-L266)).
- **grblHAL keeps a comment inside a `$` line.** It compacts and upper-cases only the key, then
  reads the setting number with `read_float` and never checks what follows the number
  ([system.c L1155-L1212](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1155-L1212),
  [nuts_bolts.c L253-L291](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L253-L291)).
  So `$30(x)=255`, `$30;x=255`, `$30)=255` and `$30X=255` all store `$30=255` with `ok`. A line
  that starts with a comment or `/` goes to the G-code parser instead. `gc_normalize_block` strips
  the comment, and a `$` left in front starts a jog
  ([gcode.c L1091-L1348](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L1091-L1348)).
- **FluidNC also keeps a comment inside a `$` line.** An unknown key is then an error
  ([ProcessSettings.cpp L1209-L1240](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1240)).
  A line that starts with a comment goes to `gc_execute_line`. Its `collapseGCode` strips the
  comment and parses a leading `$` as a jog from the fourth character
  ([GCode.cpp L157-L312](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L157-L312)).
  FluidNC names its settings with `/` paths (`$Sta/SSID`, `$/axes/x/…`).
- A stock-GRBL profile can be talking to grblHAL (Amendment 5), so the firmware behind a profile
  is not certain.

### Decision

1. **The Console classifies a line twice.** It classifies the line as typed, and then the line
   GRBL's line reader would hand its parser (`grbl-line-reader.ts`). When the reader's line is a
   `$` command, the line is sent as typed only if two things hold:
   - it was typed as a `$` command;
   - both readings get the same safeguards: kind, state effect, the Idle and operation
     requirements, the confirmation and the allowed states.

   Otherwise the line is refused before anything is written:
   - when the reader's line is a blocked command (`$RST=`, a startup-line store, `$I=` or
     `$DWNGRD`), with the persistent-command reason;
   - otherwise with a message that names the command GRBL would run and asks for it to be typed
     without comments or `/`.

   This holds on every GRBL-family profile (GRBL, grblHAL, FluidNC and the Falcon contract)
   because they share the classifier.
2. **A `$` setting number is digits only.** A key that starts with a sign, a digit or a point but
   is not digits only is refused, both as typed and after GRBL's reader. Examples are `$30.0=`,
   `$+30=`, `$30;x=`, `$30)=` and `$0x1E=`.
3. **Every startup-line store GRBL accepts is blocked.** That is `$N`, then optionally a sign, a
   digit or a point, then `=`. It joins the blocked persistent commands. FluidNC's
   `$Notification/…` settings stay writable.
4. **Kept:**
   - A G-code line with a comment is still G-code (`G0 X10 (move)`, `/G0 X10`, `(note)`).
   - On stock GRBL, a comment after a setting value stays a confirmed setting write. The value
     check and the re-read already read the value as GRBL does (`console-setting-writes.ts`).
   - FluidNC's `/`-path settings are sent as typed.
   - The password mask still covers every numeric alias the firmware reads as a password setting.
5. **Every `$N=` write that reaches the controller is re-read.** A line the firmware would store as
   `$N=` is now either classified as a setting write or refused. So each one that reaches the
   controller is confirmed, value-checked and read back with `$$`, and KerfDesk's record of `$30`
   (Start's power scale) follows the controller. The re-read itself is unchanged.
6. This is decision 9's Console policy for persistent commands, applied to the line the firmware
   reads. It adds no refusal to Frame, Start, Save G-code or output, and no Job Review gate.

### Consequences

- An operator who puts a comment or `/` in or in front of a `$` command is told which command the
  firmware would run, and types it plainly.
- In theory, a FluidNC string value could hold a G-code word once GRBL's reader drops a `/` or a
  comment (a value of `T/1` reads as a tool word), and that value would be refused too. No setting
  in FluidNC's documented configuration does that.
- `console-setting-writes.ts` keeps its own copy of the GRBL value reader. #1446 edits that file,
  so it was not touched here.
- Tests:
  - `grbl/console-command-comments.test.ts` covers every form above on the GRBL, grblHAL and
    FluidNC drivers.
  - `laser-store-console-disguised-commands.test.ts` sends the refuter's six lines through the
    store on stock GRBL and grblHAL, with confirmation given, and checks that no byte is written.
  - Without this change, 87 and 12 of those tests fail.
- The evidence is code and tests only, not hardware.
