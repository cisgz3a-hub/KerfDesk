# O5 — variables-and-batch-production (Oracle audit O1, batch 2)

**Area:** `src/core/variables/` (sequence, sequence-offset, batch-sequence, date-pattern, evaluate-template, object-variable-template, template-source, parse-csv), the CSV import UI (`VariableCsvImport.tsx`, `VariableCsvMapping.tsx`, `csv-file-text.ts`, `use-variable-csv-import-owner.ts`), and every place a variable advances or is evaluated for output: Start, Job Review, Save G-code and exports, array copies, preview against output, project save and reload, Abort, Run again, laser recovery, manual restart, painted second pass, and autosave recovery.
**Code read:** `origin/main` 5c9441ba8 (2026-11-11). **Method:** [AREAS.md](AREAS.md) steps 1–8. **Known and not re-reported:** C2 D2-P2-3. "After completed job" never advances after Moshiboard/Ruida network jobs; that is being fixed elsewhere.

## Headline

**One P1.** A production run that needs a laser recovery repeated a serial number:

- An interrupted job correctly advances nothing.
- The sealed recovery that then **finishes the same part** advanced nothing either.
- So the next job burned the same serial or CSV record again, without warning.

It is fixed in [#1790](https://github.com/cisgz3a-hub/KerfDesk/pull/1790).

**Two P2s.**

- **O5-P2-1.** After a completed job advanced the serial, a manual *Start from line* burned the **next** serial onto the old part. Its confirmation said only that "a date or time" could differ. Fixed in #1790.
- **O5-P2-2.** Job Review **could never confirm** a job whose variable text shows seconds (`{{time}}`, `{{datetime}}`). Every Confirm recompiled the job with a new clock, so the bytes never matched what was shown. Fixed in [#1791](https://github.com/cisgz3a-hub/KerfDesk/pull/1791).

**Verified clean:**

- Serial arithmetic, wrap and step.
- Abort, error and disconnect consume nothing.
- One clock per compile, so the review shows what is burned.
- Local time, DST and midnight handling.
- RFC 4180 quoting.
- BOM and UTF-16 detection.
- Number text is kept exactly ("007" stays "007").

| | Count |
|---|---|
| Raised (auditor, owner, refuter side finding) | 11 |
| Refuted | 1 (A-7, wrap repeats are documented) |
| P1 / P2 | 1 / 2 (all fixed) |
| P3 confirmed | 7 (2 fixed: O5-P3-1 comment, O5-P3-5; 5 listed for the maintainer) |
| Oracle-plan facts CONTRADICTED by research (plan corrected) | 3 |

## Oracle plan (written before reading the code closely)

| # | Claim | Oracle |
|---|---|---|
| C1 | For N completed jobs the serials burned are exactly start, start+k, … start+(N−1)k, padded, no repeat or skip | property; LightBurn Variable Text (Start, End, Advance by, wrap) |
| C2/C16 | An aborted, failed or unsent job advances nothing; a re-run advances once per completed job | LightBurn Auto-Advance; ADR-150, ADR-279 |
| C3/C11 | Preview text equals emitted text for the same job; one clock per job | property |
| C4 | Array copies get distinct consecutive values (per-copy offset) | LightBurn Grid Array "Auto-Increment Variable Text"; property |
| C5 | Save G-code and export advance consistently with a documented rule | LightBurn Auto-Advance; ADR-279 |
| C6 | Project save, reload and autosave recovery never roll the serial back to a burned value | property |
| C7 | Wrap and End never skip silently; width pads and never cuts digits | LightBurn; property |
| C8 | Date fields use local time; DST, midnight and leap years are correct | ECMA-262 §21.4.1.25 LocalTime; IANA tz |
| C9/C10 | Date codes mean what the documented syntax says | POSIX strftime; UTS #35 Dates; LightBurn Variable Text Formatting |
| C12–C15 | CSV: RFC 4180 quoting, CRLF, BOM, trailing newline, empty fields; Excel semicolon and UTF-16 exports; numbers kept as typed | RFC 4180 §2; Microsoft Excel import/export docs |

**Research corrections to the plan** (primary sources, fetched 2026-11-12):

- **LightBurn advances at job start, not at completion (C2 CONTRADICTED).**
  - LightBurn's [Variable Text reference](https://docs.lightburnsoftware.com/latest/Reference/VariableText/), section Auto-Advance, says Current moves on each Start, Send, or save in a machine format.
  - KerfDesk deliberately advances only after a cleanly completed stream or export (ADR-150, ADR-279). That is safer for aborts, and it is why O5-P1-1 could happen at all.
- **LightBurn's date codes are not strftime (C9 CONTRADICTED).**
  - [Variable Text Formatting](https://docs.lightburnsoftware.com/2.1/Reference/VariableText/VariableTextFormatting/), section Date/Time, uses letter patterns: `dd`, `MM`, `yyyy`, `hh`, `w` (ISO week), `t` (time zone).
  - KerfDesk uses the [POSIX strftime](https://pubs.opengroup.org/onlinepubs/9799919799/functions/strftime.html) %-codes. A comment claimed they were LightBurn's (O5-P3-1).
- **LightBurn truncates, KerfDesk does not (C7 corrected).**
  - LightBurn keeps only the rightmost digits when a serial is wider than its format (same Formatting page, Serial Number).
  - KerfDesk pads and never truncates. That deviation is safer, because truncation can create duplicates. Not a finding.
- **Microsoft encodings (C13): UNSOURCED.**
  - No Microsoft primary page says whether "CSV UTF-8" writes a BOM, which code page plain "CSV (Comma delimited)" uses, or that "Unicode Text" is UTF-16 LE with tabs.
  - [Import or export text files](https://support.microsoft.com/en-us/excel/get-started/import-or-export-text-txt-or-csv-files) does say the export delimiter is the Windows list separator.
  - Every C13 claim below rests on reproductions, not on Microsoft's word.

## Findings

Every finding was reproduced on the real modules or traced on the production call path. The refuter used a different method: an independent trace of the call path, different inputs, and a second reading of the oracle.

### O5-P1-1 — A recovered job repeated its serial number (fixed, #1790)

- **Where:** `src/ui/laser/laser-recovery-flow.ts` `streamLaserRecoveryAttempt`.
  - The "After completed job" observer (`armVariableStreamAdvancement`) was armed only from `start-job-transmission.ts`.
  - Nothing in the recovery flow, the laser store or `src/ui/state/recovery/` advanced variables.
- **Oracle:**
  - ADR-150: advance "after … completed streaming".
  - The [offline production roadmap](../2026-08-01-offline-production-expansion-roadmap.md) contract: only an *incomplete* recovery consumes zero, and a recovered artifact advances at most once.
  - Property C1: no serial repeats.
- **Reproduction:** `laser-recovery-flow.variables.test.ts` covers these steps:
  1. Start a job with "After completed job" and serial 41.
  2. Interrupt it (disconnect).
  3. Run the sealed recovery and let it finish cleanly.
  4. On `origin/main` the advance is called **0 times**, so serial 41 stays current and the next Start burns 41 again.
- **Research:** the oracle is the project's own ADR and a property, so nothing needs fetching. LightBurn advances at Start (VERIFIED, above), so a LightBurn user never sees a serial reused.
- **Refuter:** CONFIRMED and **raised to P1**. It is reachable with an ordinary disconnect, and no recovery text mentions serials or records, so the duplicate is silent.
- **Owner re-check:** re-read on 5c9441ba8: `laser-recovery-flow.ts:300-348`, `variable-stream-advancement.ts:10-85`, `start-job-transmission.ts:77`.
- **Fix:** the recovery arms the same observer (`armRecoveryVariableStreamAdvancement`).
  - It advances once on a clean finish and not after an abort, an error or a second interruption. Each finished part therefore consumes exactly one value.
  - It advances only while the open project still holds the run's variable data: record, serial, policy, range and CSV.
  - ADR-279 Amendment 1.

### O5-P2-1 — Manual Start from line burned the next serial and said only "a date or time" could differ (fixed, #1790)

- **Where:** `src/ui/laser/manual-restart-source.ts` `prepareManualRestartSource`.
  - After a completed job advances the serial from X to X+1, the restart cannot reproduce that run's fingerprint and continues past it.
  - It then falls back to the live project, "evaluated now", and burns X+1 from the chosen line onto part X.
  - The note said only "Variable text: evaluated now, so a date or time in it can differ from the part already burned."
  - A manual restart that *finishes* an interrupted part also never advances.
- **Oracle:** property C1 and C3; AREAS P2 "misleading result".
- **Reproduction:** refuter trace of `manual-restart-source.ts:89-117`, `:174` and `start-job-flow.ts:347-368`. No probe; the call path is direct.
- **Refuter:** CONFIRMED, P2. The no-advance half has the same cause as O5-P1-1.
- **Fix:**
  - The note now says the restart takes the current serial number and CSV record.
  - Under "After completed job" it also says a manual restart does not advance, so press Next after finishing a part (`manualRestartVariableNote`, test `manual-restart-variable-note.test.ts`).
  - A manual restart stays the operator's own tool: it says what it burns and leaves the advance to the operator, rather than guessing whether a part was finished. ADR-279 Amendment 1, decision 3.

### O5-P2-2 — Job Review could never confirm a job with a seconds field (fixed, #1791)

- **Where:** `src/ui/laser/job-review/job-review-gate.ts`.
  - Confirm re-prepares the job and accepts only byte-identical G-code (`sameReviewedArtifact`).
  - `preparedStartReusable` is false for any time-bound project, and `prepareCurrentStartJob` compiled with `evaluatedAtIso ?? new Date()` (`time-bound-start-inputs.ts:74`).
  - `{{time}}` (the built-in Time button) and `{{datetime}}` print seconds, so every Confirm showed the review again as changed.
- **Oracle:** property C3 ("Preview text equals emitted text"; one clock per job).
- **Reproduction:**
  - Auditor: a gate probe with a `{{time}}` Data Matrix, an in-process stand-in for the output Worker (the call `output-preparation.ts` makes) and a 3 s wait before each Confirm. Clicks 1–4 each re-showed the review. Controls: `{{date}}` and `%H:%M` within the same minute confirmed.
  - Regression test `job-review-gate.variable-clock.test.ts`, without the fix: `expected 2 to be 1`, meaning the review was shown twice.
- **Refuter:** CONFIRMED, P2. Ordinary Start always shows the review (`framed-start-review.ts:31-34`), and nothing else pins the clock. Minute fields cost an extra click only when the minute turns.
- **Fix:** the review's re-preparation compiles with the clock of the program on screen (`shownProgramClock`). An unchanged job confirms in one click and burns the time the operator approved. ADR-224 Amendment 5.

### O5-P3-1 — The date codes are strftime, not LightBurn's; gaps against strftime (comment fixed in #1790; the rest listed)

- **Where:** `src/core/variables/date-pattern.ts`.
- **What's wrong:**
  - The header comment claimed "LightBurn's Date/Time formatting codes". LightBurn uses `yyyy-MM-dd` (CONTRADICTED; source above). A pattern copied from LightBurn burns as typed; the probe gave `formatDatePattern(d,'dd/MM/yyyy')` → `"dd/MM/yyyy"`. That is visible in the preview, so it is not silent.
  - There is no week-number or time-zone code: `%U %W %V %G %Z %z` all print literally. LightBurn has `w` and `t`.
  - `%e` prints `5`; POSIX pads it with a leading space.
  - Month and day names are always English.
  - No user document lists the codes.
- **Refuter:** CONFIRMED, P3. Only comments make the LightBurn claim; user-facing text shows %-codes without naming LightBurn.
- **Listed:** adding `%V`/`%U`, a space-padded `%e`, localized names, accepting LightBurn's letter patterns, and a code list in the help. Each one changes what is burned, so it is a maintainer decision.

### O5-P3-2 — CSV separator detection picks the comma whenever the header has one (listed)

- **Where:** `src/core/variables/parse-csv.ts` `detectDelimiter`. A comma anywhere in the header row beats `;` and tab.
- **Reproduction:** both cases are accepted with no error:
  - `'Name;Weight, kg\nBolt;1,5\nNut;2,25\n'` gives headers `["Name;Weight"," kg"]` and records `[["Bolt;1","5"],…]`.
  - `'Last, First\tCity\nSmith, John\tBerlin'` gives headers `["Last"," First\tCity"]`.
- **Oracle:** RFC 4180 §2; Excel exports with the list separator. Excel quotes only the separator, so a comma-decimal export keeps unquoted commas.
- **Refuter:** CONFIRMED, P3. Visible before burning: the column dropdown shows the broken header names, and the rows preview shows the values.
- **Listed:** count separators across several lines, or name the detected separator in the import notice for commas too. This changes import behaviour.

### O5-P3-3 — A blank cell in a one-column CSV is dropped and later records move up (listed)

- **Where:** `parse-csv.ts` `finishRow`. A completely blank line is not a record.
- **Reproduction:** `'Name\nAlice\n\nCarol\n'` gives `[["Alice"],["Carol"]]`.
- **Oracle:** RFC 4180 §2. Each line is a record, and Excel writes an empty one-column cell as an empty line.
- **Refuter:** CONFIRMED, P3. The comment says this is deliberate: in wider files the alternative is rejecting the import. Record N then no longer matches spreadsheet row N+1, but the preview shows the values.
- **Listed:** keep blank lines as records when the file has exactly one column.

### O5-P3-4 — Undo after a job rolls the serial back (listed)

- **Where:** `src/ui/state/variable-data-actions.ts` `advanceVariablesAfter`. The automatic advance pushes an unlabelled undo snapshot.
- **What happens:** Ctrl+Z after a job, meant to undo an edit made during the run, puts the serial back to the burned value. The next job repeats it.
- **Refuter:** CONFIRMED, P3. It is intended in code and tested, but no ADR covers it. The change shows in the panel, and it needs an operator action.
- **Listed:** keep automatic advances out of undo, or label the undo step.

### O5-P3-5 — A painted second pass armed the advance and showed a false warning (fixed, #1790)

- **Where:** `start-job-transmission.ts:77` armed the observer for a second pass too.
  - The pass compares the archived run's variables object, which is never the live one.
  - So it skipped correctly, with no double advance, but warned "not advanced … because variable data was changed while it ran".
- **Reproduction:** `start-job-transmission.second-pass-variables.test.ts`. On main the advance is called once for a second pass.
- **Refuter:** found it as a side finding by trace; confirmed by the test.
- **Fix:** a second pass arms nothing. ADR-279 Amendment 1, decision 4.

### O5-P3-6 — The first job after setting a range start burns an out-of-range value (listed)

- **Where:** `sequence.ts` `wrap` applies only on the next advance, and `evaluate-template.ts` uses the current value as it is.
- **Reproduction:** record range 5–6, serial start 100, current row 1 and serial 1. Four jobs burn `r1-001, r5-100, r6-101, r5-102`.
- **Oracle:** the LightBurn docs, which tell the user to press Reset after setting non-zero starts. LightBurn behaves the same way.
- **Refuter:** CONFIRMED, P3. The current value is visible next to the range, with a Reset button.
- **Listed:** a hint, or clamp Current when a range is set.

### O5-P3-7 — A crash within 30 s of a job can recover the pre-advance serial (listed)

- **Where:** `src/ui/state/autosave.ts:24` sets `AUTOSAVE_INTERVAL_MS = 30_000`. The advance only marks the project dirty.
- **What happens:** a hard crash or power loss inside that window makes File > Recover restore the old serial. A normal close is covered by `beforeunload`.
- **Refuter:** CONFIRMED, P3. It needs a crash.
- **Listed:** autosave immediately after an automatic advance.

## Refuted

- **A-7, "wrap repeats values inside one batch".** Five copies over the range 1–3 give `001,002,003,001,002`. This is deliberate and documented in three places:
  - the roadmap's "Error, empty and edge behavior" ("shows the repeated mapped indices in preview");
  - ADR-279 decision 5 (no new blocks or confirmations);
  - the Array dialog ("wrap at range ends").

  At most it is a polish idea: name the repeat count in the hint.

## Verified clean

- **C1, serial sequence.**
  - `advanceVariableSequenceBy` equals repeated Next for n = 0..39.
  - Start 1, End 10, step 3 from 8 gives `8,1,4,7,10,3`.
  - Array copy offsets match the sequence.
  - Width pads and never cuts digits (`evaluate-template.ts` `padStart`).
- **C2/C16, abort, error and disconnect.**
  - An advance needs status `done` plus a clean settle at Idle (`variableStreamOutcome`).
  - Changed values during a run skip the advance with a warning.
  - Run again always recompiles time-bound jobs (`job-review-gate.ts:336`).
- **C3, preview equals output.**
  - One `evaluatedAtIso` per compile, carried into the Worker.
  - Job Review streams only bytes it showed.
  - Restart and recovery reuse the run's clock (ADR-443 Amendment 2).
  - The idle canvas preview has its own clock, so a `{{time}}` there can lead the burn. That is inherent.
- **C5, Save G-code and export.** These advance only after a complete write, under the "after export" policy.
- **C8, time zones.** With TZ = Europe/Berlin:
  - the DST gap at 2026-03-29 01:30Z prints 03:30;
  - 22:59:59Z on 2026-11-12 prints 23:59:59 on the 12th, and 23:00:00Z prints 00:00:00 on the 13th;
  - `%j` gives 366 on 31 December 2024;
  - `%I` gives 12 at midnight and noon.

  Fields use `getHours`/`getDate`, which follow host local time with DST (ECMA-262 §21.4.1.25 LocalTime, §21.4.4.2, §21.4.4.5). On Windows, `TZ` reaches Vitest only through PowerShell `$env:TZ`.
- **C12/C15, CSV basics.**
  - Quoted commas, doubled quotes and CR/LF inside quotes (stored as LF) are handled.
  - Empty fields are kept, and a trailing newline adds no record.
  - The BOM is stripped.
  - "007" and "1.10" come through verbatim.
- **C13, encodings and separators.**
  - UTF-16 LE/BE with a BOM is decoded.
  - Bytes that are not UTF-8 fall back to Windows-1252 with a warning.
  - A de-DE `Name;Preis` / `1,50` file is read correctly.
- **C6, project file.** The serial, record, sequence and CSV round-trip through the project validator.
- **Existing tests:** 7 files and 43 tests passed (stream advancement, variable data actions, sequence, sequence offset, parse-csv, date-pattern, date-time).

## Not verified

- **Frame then Start still compile with two clocks.**
  - If a changing `{{time}}` moves the job bounds by 0.001 mm or more, Start revokes the Frame (`framed-start-preparation.ts` `preparedMatchesCompletedFrame`).
  - The refuter traced this as plausible when the digits sit on a bounds edge. It was not probed.
  - Pinning Start to the Frame's clock would burn the Frame's time, so this is listed for the maintainer.
- **Microsoft encoding facts (C13), UNSOURCED:**
  - the CSV UTF-8 BOM;
  - the code page of "CSV (Comma delimited)";
  - "Unicode Text" being UTF-16 LE with tabs.

  KerfDesk handles all three cases by reproduction.
- **What LightBurn does on Stop or Abort** (whether it rolls back the Start-time advance): its docs say nothing.
- **Hardware.** Simulated controllers only; no recovery was run on a machine.

## Pull requests

- [#1790](https://github.com/cisgz3a-hub/KerfDesk/pull/1790): O5-P1-1, O5-P2-1, O5-P3-1 (comment) and O5-P3-5. ADR-279 Amendment 1. Auto-merge MERGE.
- [#1791](https://github.com/cisgz3a-hub/KerfDesk/pull/1791): O5-P2-2. ADR-224 Amendment 5. Auto-merge MERGE.
- Auto-fix could not be turned on from this session (permission denied); CI is followed by hand.

Ledger line for the coordinator: **O5 — raised 11 / refuted 1 / contradicted 3 / P1 1 / P2 2 / P3 7 (fixed: P1 1, P2 2, P3 2)**.
