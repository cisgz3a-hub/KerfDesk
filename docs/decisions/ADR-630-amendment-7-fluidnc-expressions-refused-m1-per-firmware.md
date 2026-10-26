## ADR-630 Amendment 7 - FluidNC and grblHAL expressions are refused, and M1 is described per firmware (2026-10-23)

**Status:** Accepted. Amends ADR-630 "What is sent" (Refusals) and "Review and Start". Keeps PROJECT.md
non-negotiable 21 and ADR-565: the completed Frame stays the only ordinary Start gate. Fixes
controller audit v4 findings E4-P2-2 and E4-P2-3. | **Date:** 2026-10-23

### Context

1. **FluidNC works out lines the review cannot read (E4-P2-2).** FluidNC v4.0.3 reads a word's
   value from a `#` parameter (`X#1`, `X#<width>`, `X##2`) or a bracketed expression (`X[5*2]`,
   `X[COS[0]*120]`). It takes `#1=120` as an assignment, and it hands whatever follows an O number to
   flow control (`O100 if [...]`, `else`, `endif`, `while`, `repeat`). It strips spaces and
   upper-cases each line before reading it (`GCode.cpp` `collapseGCode` and the word loop at
   L313-L328, `Parameters.cpp` `read_number`/`assign_param`, `Flowcontrol.cpp`). grblHAL does the
   same in builds with `NGC_EXPRESSIONS_ENABLE` (off by default), and answers with an error in
   other builds (`gcode.c` L1379-L1474 at 4ec1ae44b).

   KerfDesk streamed such lines unchanged, but the Inspector reads none of them. It treated `G1X#1`
   as a `G1` with no axis word and skipped `#1=120`. So for `G1 X10`, `#1=120`, `G1 X#1` the Frame
   traced X10 only, while FluidNC drives to X120. `G1 X[10+110]` behaved the same. The review gave
   no warning that matched what would happen. `X[5*2]` was refused, but as a "checksum" line,
   because of its `*`. A flow-control block was framed as if every line in it runs. The audit's
   auditor and refuter both reproduced this.
2. **M1 was described as a hold everywhere (E4-P2-3).** The Run review said "The program stops with
   M0 or M1. The controller holds there until the machine's own cycle start is pressed". Stock GRBL
   takes `M1` and does nothing (`gcode.c` L251: "Optional stop not supported. Ignore."). Its
   `config.h` has no option to change that. FluidNC v4.0.3 does the same (`GCode.cpp` L633-L636 set
   only the modal group). So a stop the program planned with `M1`, perhaps to check a part or
   change a bit, never happens, and the review said it would. grblHAL does hold at `M1`, unless
   optional stop is turned off on the controller: its optional-stop input, or the flag its
   realtime toggle sets (`gcode.c` L1826-L1827).

### Decision

1. **Refuse, do not evaluate.** On FluidNC and grblHAL, the normalizer refuses a line that, after
   comments are removed, holds a `#` or a `[`, or an O number followed by more of the line. The
   reason names the line, the syntax (`a # parameter`, `a [ ] expression` or `O-word flow
   control`) and the firmware, and asks for the program to be saved with plain numbers. The check
   runs before the `*` checksum check, so `X[5*2]` is named as an expression. A line that *starts*
   with `[` keeps its own refusal, because FluidNC runs it as a `$` command, and a grblHAL
   stored-program call (`O<…> call`, `M98`) keeps Amendment 5's shell, file and stored-program
   refusal, which is checked first.
   - **Why not evaluate it.** Evaluating would mean reproducing FluidNC's expression language and
     its parameter store. Those values can depend on the controller at run time: work offsets,
     the current position, probe results, and FluidNC's config items. KerfDesk does not hold them
     when it frames, so the Frame could still differ from the run. Refusing is the only choice that
     never frames a different path.
   - **Why this is a factual refusal.** It is the same kind as the `error:21`/`24`/`25` refusal in
     Amendment 1: the Frame outline cannot be the path that runs, so the reviewed program cannot be
     handed to Start consistently. It adds no policy gate beside the Frame.
   - **Stock GRBL is unchanged.** Stock GRBL rejects such a line (`error:1` or `error:2`). Its Run
     review already blanks the line in its reading and says so (`grbl-block-rejection.ts`), which
     matches what runs. A board running FluidNC under a GRBL profile is left to the existing
     controller-identity warning. Marlin and Smoothieware have no such syntax.
   - A lone O program number (`O1001`), as some CAM posts write, is not flow control and is not
     refused.
2. **M1 is described per firmware.** M0 keeps its wording: the controller holds until the machine's
   own cycle start, and KerfDesk's Resume does not release it.
   - On stock GRBL and FluidNC, a program with `M1` (also spelt `M01`) gets: "The program asks for
     an optional stop (M1), which Stock GRBL ignores: the program does not stop there and runs
     straight on. Use M0 where it must stop." FluidNC's version names FluidNC. A program with both
     gets the M0 hold and this warning. A review without a controller kind is a legacy GRBL caller,
     as the baseline already assumes.
   - On grblHAL, M1 is listed with M0 as a hold, plus: "grblHAL skips M1 while optional stop is
     turned off on the controller."
   - Smoothieware keeps the earlier wording, because only the GRBL family was re-read for this
     audit. Marlin's reader names its own M0/M1 lines, as before.
   - This is a warning, not a refusal: the program can be sent exactly as reviewed.

### Consequences

- A FluidNC or grblHAL program that uses parameters, expressions or flow control no longer reaches
  Frame or Start. The Run dialog lists the lines (five, then a count) and offers only **Close**.
  The operator re-posts the program from CAM with plain numbers.
- A FluidNC or stock GRBL program that relies on M1 says, before Frame, that it will not stop
  there.
- The G-code Inspector's own view and Program Health are unchanged.

### Verification

- `evaluated-syntax.test.ts` normalizes, for FluidNC:
  - the audit's program, whose two lines are refused by number;
  - named, indirect and assigned parameters, expressions with functions, and `if`/`else`/`endif`
    and named-label flow control, in lower and upper case;
  - `X[5*2]`, named as an expression and not as a checksum.

  It also covers grblHAL's wording. It shows that commented `#`/`[ ]` and a lone `O1001` are still
  sent, that a leading `[` keeps its controller-command refusal, and that stock GRBL, Marlin and
  Smoothieware are unchanged.
- `program-stops.test.ts` reviews M1, M01 and M0 programs on each GRBL-family kind and on
  Smoothieware. It checks that a program without either gets no stop wording.
- A `RunGcodeFileDialog` case shows the audit's program on a FluidNC connection refused, with only
  **Close**.
- No hardware was run.
