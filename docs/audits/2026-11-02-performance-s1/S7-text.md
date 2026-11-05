# Performance audit S1 — S7 Text

- **When:** 2026-11-05 03:28 – 08:20 +0800 (measurements until 07:31; reading, profile mapping and the report after).
- **Tree:** origin/main @ `3a8acb3bb` (worktree `claude/performance-audit-s6`, HEAD `d592e6962`, docs only).
  - **`j7-main`:** it equalled `45cbf63f9` (S6). The 12 files #1578 changed since then (`src/ui/image-editor/*` and one e2e spec) were rewritten with `MSYS_NO_PATHCONV=1 git show origin/main:<path>` and hash-checked: all equal. No text, font, variable or output file changed between `45cbf63f9` and `3a8acb3bb` (`git diff --stat`).
  - **Browser rows, main:** S6's `zz-s6\dist-main` (built from `45cbf63f9` with hidden source maps), reused read-only. Its text code is byte for byte the code on `3a8acb3bb`. Every S7 operation is in the Free web build.
  - **Engine rows (Node):** `build7.mjs` bundles each tree's text entry points with esbuild 0.28.1, as `scripts/trace-bench.mjs` does: `renderTextGeometry`, `computeTextGeometry` (the text worker's call), `textToPolylines`, `layoutTextBox`, `placeTextOnPath`, `renderVariableText`, `materializeVariableText`, `prepareVariableArray`, `parseVariableCsv`, `encodeEmbeddedFont` / `embeddedFontBuffer` and `parseOutlineFont`.
    - Bundled `.ttf?url` imports become `file://` URLs, which a fetch shim serves.
    - The 1.0.28 and 1.0.23 trees in `scratchpad\zz-s2-old\` lacked `public/desktop-licence-window.mjs`, which `prepare-variable-array.ts` reaches. I added it to each tree from its own commit (`git show <sha>:public/desktop-licence-window.mjs`).
  - **Trend:** 1.0.28 (`33bc394c6`) and 1.0.23 (`87ecb4f24`). The browser uses S1's `dist-33bc394c6` and `dist-87ecb4f24`; the engine uses the `zz-s2-old` trees. Each build opened projects written by its own `serializeProject`, with text geometry from its own `renderTextGeometry` (`gen7.mjs`).
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Iris Xe; Chrome 156 (installed, headless); Node 25.8.2. `zz-s7\machine-state.log` holds every set's free memory, load and waits; `zz-s7\sampler.log` a line every 30 s.
  - **03:28–07:37: I was the only measuring agent.** No other session's tooling, harness or Chrome was seen. All engine sets, all clean single calls and every main browser set ran in this window.
    - The sampler's non-zero `tooling`, `harness` and extra-Chrome readings before 07:37 are all mine. At 03:53–03:54 my own driver matched the `tsc` pattern, because its JSON held `postscriptName`; the check now skips `run7.mjs`. My prototypes ran at 03:36 and 05:23–05:25, and Chrome's crash handler showed for one sample at 05:29 and 05:34.
  - **From 07:37 four fix sessions shared the PC** (coordinator, 07:39): Weld check and Array grid; UX P3s U1–U4; UX P3s U5–U8; and the performance P3 fixes for S1–S6, with their own timing batches. The sampler shows their tooling (up to 4 processes), a harness and free memory down to 1.6 GB from 07:37.
    - My gate then held every remaining set. These were the 1.0.28 / 1.0.23 browser trend sets, a profiled variable array, and the batch-parse prototype. By 08:12 free memory had fallen to 298–570 MB and load to 97–100%, so I stopped my waiting queue rather than measure on a shared PC. The browser trend therefore rests on the engine (Trend) and on the 1.0.28 / 1.0.23 browser runs of the path bug.
    - I stopped none of their processes.
  - **OneDrive.Sync.Service held about one core** (73,800 CPU-seconds by 03:30), so the PC idled at 0–39% load. As in S5 and S6, the gate's CPU limit was 45% and calibration decided what was kept.
  - **Gate:** `gate.ps1` (no other tooling, harness or Chrome; load < 45%; ≥ 2.5 GB free) had to pass three times, 20 s apart, before each set (`qe7.sh`, `qb7.sh`, `clean7.sh`). `run7.mjs` also checks it before each run. Before 07:37 the waits were 71 s and 93 s (load).
  - **Calibration:** S1's 40M-step loop runs before and after every engine set and every browser run.
    - Engine sets start at 36–40 ms. Sets with seconds of sustained single-thread work end at 44–92 ms, because the laptop's clock falls under load, as S5 and S6 found. A few sets started at 55–70 ms right after such a set.
    - **Engine results are therefore quoted as ratios between versions.** The versions alternate round by round in one process.
    - Absolute engine times come from single calls, one per process (`out\clean.jsonl`). Each started at 36–43 ms, though the clock still falls inside a call of several seconds.
    - **Browser calibration sat at 40–61 ms from 05:27, on a quiet PC.** S6 saw 42–55 ms after 21:05. Re-running a set (`#2`) did not lower it, so from 05:40 `qb7.sh` stopped re-running sets for drift.
    - Each scorecard row gives the calibration of its kept runs. A run is kept when both calibrations are ≤ 50 ms, unless the row says otherwise. Runs that end in seconds of frozen work raise their own after-run calibration (to 76–201 ms); those rows say so.
    - The S7 numbers that matter are freezes and latencies of seconds, far beyond what a 15–40% clock difference changes.
  - Free memory stayed at 1.7–4.2 GB until 07:37 (sampler minimum 1,667 MB at 04:00, during a smoke run).
  - **Memory figures:** browser rows give the measuring Chrome's private bytes (S4's `mem-poll.ps1`), text workers included. Engine rows give the process `maxRSS`.
- **Temp files:** none in the repo except this report. Kept for the refuter in `scratchpad\zz-s7\`:
  - scripts;
  - `results.jsonl`, and `smoke.jsonl` (set-up and debugging runs, not data);
  - `out\gt7.jsonl`, `out\clean.jsonl`, `out\memo7.txt`, `out\b64fix7.txt`;
  - `machine-state.log`, `sampler.log`, `logs\`;
  - the CPU profiles and the engine bundles.

  Deleted to save disk, and remade by "Re-running": the generated projects (`projects\`, about 190 MB).
- **Scope** (AREAS S7, ordinary first, then large):
  1. **Typing on the canvas** (the canvas text editor and its live lettering) at 20, 200 and 2,000 characters, in plain text and in a shrink-to-fit frame. Measured: keystroke to the character in the text box, keystroke to the live preview, ten keys at 100 ms, and Done.
  2. **Shrink-to-fit frames** (ADR-643's text worker). The frame width, the size and the font were changed in the editor, in two kinds of frame:
     - the frame the **Text box** checkbox makes (60 × 30 mm, 10 mm text, minimum 2 mm);
     - N4-P3-2's frames: 150 × 30 mm at 5 mm with 500 characters, and 150 × 60 mm with 2,000.
  3. **Variable text and records:**
     - serial numbers and CSV names through the Array dialog's **Advance variables per copy**, at 10, 100 and 1,000 copies;
     - in the engine, output preparation of the records and CSV parsing at 10, 100 and 1,000 records;
     - the rows preview.
  4. **Fonts:**
     - opening the font list;
     - switching through all 20 other bundled outline fonts;
     - the first use of a system font, through **System fonts…**: Arial (1.0 MB) and SimHei (9.3 MB);
     - a project with an embedded font, opened and edited.
  5. **Text on a path** (800 characters typed, 1,000–2,000 attempted) and **Convert to Path** of 2,000 characters.
  6. Trend against 1.0.28 and 1.0.23, with the outlines compared by hash first.
  - The text was generated by `fixtures7.mjs` (sentence-like Latin from a fixed word list), in Roboto unless stated.
  - System fonts were read from `C:\Windows\Fonts` through a `queryLocalFonts` stub. Everything from `systemFontFile` on is the page's own code, unchanged.
- **Counts (auditor):** 4 raised → **P1 0 / P2 2 / P3 2** (+ 1 KNOWN re-observed: N4-P3-2; + 1 functional bug for the coordinator, not counted). The auditor refuted 4 leads.
- **Counts (after the refuter, 2026-11-05):** 5 raised → 0 refuted → **P1 0 / P2 3 / P3 2** (+ 1 KNOWN: N4-P3-2). All four findings CONFIRMED at their severity. The functional bug is raised as **S7-P2-3** and widened: Bend fails the same way, and the bundled Special Elite fails from about 75 characters. The auditor's 4 refutations stand.

## Headline

**Ordinary text is clean.**
- **Plain text.** A key shows in the canvas text box in 9–26 ms. At 20 and 200 characters the live lettering follows in 77–112 ms, and 82–98 ms after the last of ten fast keys. No long task occurs.
- **Ordinary frame.** The same holds in the frame the **Text box** checkbox makes, with 20 characters: the preview comes 92 ms after a key, the frame width 138 ms after it is changed, and the size 65 ms.
- **Fonts.** Switching among the 20 bundled fonts shows the new lettering in 80–265 ms (median 107). Arial from **System fonts…** is in use in 114 ms.
- **Convert to Path.** 2,000 characters take 121–187 ms.
- **Outputs.** Every text output is identical in main and 1.0.28. Outlines (paths) also equal 1.0.23; only the render's metadata gained `glyphContours`.

**Two P2s.**
- **S7-P2-1. The Array dialog's "Advance variables per copy" renders every copy on the UI thread in one task, and Cancel cannot stop it.**
  - Serial numbers freeze the window for 1.95–2.19 s at 100 copies and 19.7 s at 1,000.
  - CSV names in a 60 × 20 mm shrink-to-fit frame (name badges) freeze it for 0.68–0.85 s at 10 copies, 7.3–8.3 s at 100 and **69–79 s at 1,000**.
  - **"Preparing variable copies…" paints once and then freezes.** Cancel, pressed 1 s in, lands 18.8 s later, after all 1,000 copies have been added.
  - Each record parses the whole font file again (`textToPolylines`). Same in 1.0.28 and 1.0.23.
- **S7-P2-2. Embedding a large system font, and the first edit after opening a project that holds one, block the window.** The embedded-font codec builds and reads base64 one character at a time.
  - Choosing SimHei (9.3 MB) blocks for 670–988 ms, then about 550 ms more, so the dialog closes after 1.19–1.66 s.
  - Opening a saved project with SimHei and double-clicking its text blocks 385–466 ms.
  - Chunked `btoa`/`atob` gives the identical string and bytes 10 × faster (Node: encode 1.0–2.0 s → 0.10 s; decode 0.46–0.93 s → 0.04 s).

**Two P3s.**
- **S7-P3-1. Shrink-to-fit pays for opentype.js's full shaping pipeline on every prefix of every line, in each of up to 20 trial layouts.**
  - **The default frame.** The frame the **Text box** checkbox makes, holding a 200-character paragraph, shows its lettering 1.38–1.55 s after each key. That is 2.5–3.0 s after a burst of typing, 1.4–1.6 s after a width change, and 2.6–2.8 s for the frame's own preview.
  - **N4's frames.** The 500-character frame takes 5.9–6.0 s per key, and the 2,000-character frame 32–34 s, with its frame preview after 61–63 s.
  - The window stays responsive (worker, "Updating…").
  - Memoizing the shaping per line string gives byte-identical output 3.5–5.7 × faster (Node: 200 characters 0.75–0.98 s → 0.21–0.24 s; 2,000 characters 28.7 s → 5.0 s). The same code runs on the UI thread for remote and jig edits (N4-P3-2) and for variable records in frames (S7-P2-1).
- **S7-P3-2. Typing into a large text frame lags behind the keys.** The frame preview's SVG path string is rebuilt from every point on every keystroke (`TextBoxFields.tsx:120, 225-240`), although the preview it draws has not changed.
  - With 2,000 characters in the default frame, each key costs a 51–280 ms task, and ten keys at 100 ms reach the text box 1.2 s late.
  - The profile puts 3.76 s of 4.72 s of long tasks in `previewGeometry`.

**N4-P3-2, re-measured (KNOWN).** Remote `update_text` and jig edits still lay frames out on the UI thread (`render-styled-text.ts:33` → `renderTextGeometry`). That call takes:
- **3.76–4.20 s** for the 500-character 150 × 30 mm frame (N4: 11.0–17.0 s inside Vitest);
- **23.2–24.1 s** for the 2,000-character 150 × 60 mm frame (N4: 70–81 s);
- 0.64 s for the default frame with 200 characters.

These are Node single calls in a bundled build. The growth is the same; the bundle runs the code about 3 × faster than Vitest. 1.0.28 and 1.0.23 are the same.

**Refuter: raised as S7-P2-3 (P2).** Bend fails the same way. The bundled Special Elite fails from about 75 characters.

**Also noticed (not speed, for the coordinator): text on a path fails from about 1,000 Roboto characters, or about 250 Great Vibes characters.** The editor shows "Maximum call stack size exceeded" and the text cannot be saved. `placeTextOnPath`'s `boundsForPaths` spreads every point into `Math.min(...xs)` (`text-on-path.ts:191-203`), and 110,000–130,000 arguments overflow the stack. The same happens in 1.0.28 and 1.0.23, in Chromium and in Node. Details are under Not verified.

**Trustworthiness.**
- **Engine.** Three trees alternated in one process. The first round was dropped, the median of 2–5 rounds kept, and every result hashed. The numbers are solid as ratios. Late-set clock fall makes absolute times read up to about 1.7 × high, so the absolute figures quoted come from single calls.
- **Browser.** All main sets ran before 07:37 on a PC with no other session, at calibration 36–61 ms (most runs 37–50 ms). The findings rest on freezes and latencies of 0.7–79 s.

## Scorecard

Budgets (AREAS): 100 ms from input to visible response; a 200 ms longest UI block while designing, or a progress indicator and Cancel if the work can take longer; 1.5 GB peak memory.

Column meanings:
- Browser times are the median (range) of the kept runs, measured from the input.
- **"Box"** is the frame on which the canvas text box shows the key.
- **"Preview"** is the frame on which the panel's status returns to "Live preview" after the input, or after the last key of a burst. At that point the canvas lettering has been redrawn.
- **"Block"** is the longest main-thread task in the step.
- **"Chrome"** is the measuring Chrome's private bytes, workers included.

### In the app (main, `zz-s6\dist-main`; `results.jsonl`)

| Operation, input | Box | Preview | Longest block | Chrome | Budget | Verdict |
|---|---|---|---|---|---|---|
| Open the editor (double-click), 20 / 200 characters (`M-type-plain20`, `M-type-plain200`; n=5+3, 5+3; cal ≤ 61) | 112–183 | 258–396 | 50–86 | 0.56–0.61 GB | 100 ms response | Pass (the editor opens on the first frame after the double-click's task) |
| One key, plain 20 / 200 characters | 10–25 / 8–24 | 75–89 / 92–112 | 0 | 0.6 GB | 100 ms | Pass |
| Ten keys at 100 ms, plain 20 / 200 | keeps up | 81–83 / 82–98 after the last key | 0 | 0.6–0.7 GB | 100 ms | Pass |
| Done (Ctrl+Enter), plain 200 | editor closed 108–192 | — | 68–95 | 0.7 GB | 100 ms | 1.5–1.9 ×: the post-edit preparation (S2-P3-1's area) |
| Plain 2,000 characters (`M-type-plain2000`, n=5, cal 38–63): open / one key / ten keys / Done | 254–426 / 22–25 / keeps up / 432–557 | 1,043–1,442 / 383–505 / **1,350–1,633 after the last key** / — | 143–223 / 0–62 / 68–101 / 75–95 | 0.92–1.03 GB | 100 ms; 200 ms block | Large size: preview 4–16 × the response budget, in the worker with "Updating…"; open block 1.1 × |
| Default frame, 20 characters (`M-type-shrinkA20-r`, n=4, cal ≤ 49): one key / ten keys / width / size / font / Done | 14–26 / keeps up / — / — / — / 87–197 | 89–97 / 134–501 / **123–170** (frame preview 276–384) / 55–70 / 105–145 / — | 0–84 | 0.59–0.68 GB | 100 ms | Pass (the frame preview 2.8–3.8 ×, worker) |
| **Default frame, 200 characters** (`M-type-shrinkA200`, n=5, cal 36–46): open / one key / ten keys / width / size / font / Done | 135–190 / 23–26 / keeps up / — / — / — / 209–272 | 1,593–2,283 / **1,380–1,554** / **2,536–2,998 after the last key** / **1,360–1,587** (frame preview **2,565–2,815**) / 930–1,059 / 312–424 / — | 0–83 | 0.67–1.05 GB | 100 ms (worker, status) | **S7-P3-1** (14–28 × the response budget; no block) |
| Default frame, 2,000 characters (`M-type-shrinkA2000`, n=5, cal 37–75): one key / ten keys / width / size / font / Done | 15–45 / **10th key 1,202–2,562 after the 1st** / — / — / — / 396–676 | 1,334–1,971 / 2,489–3,141 / 1,360–1,593 (frame 2,570–2,889) / 1,391–1,606 / 575–830 / — | **78–280 per key** (sum 2.6 s over 10 keys) | 1.0–1.75 GB | 100 ms; 200 ms; 1.5 GB | **S7-P3-2** (typing lags); S7-P3-1 |
| N4's 500-character frame, 150 × 30 mm (`M-type-shrinkB500`, n=3, cal 38–50): one key / ten keys / width / size / font / Done | 25–40 / keeps up / — / — / — / 655–722 | **5,933–6,018** / **7,214–7,760 after the last key** / **6,429–6,787** (frame preview **11,548–11,699**) / 5,758–6,332 / 1,027–1,184 / — | 0–223 | 0.68–1.03 GB | 100 ms (worker) | **S7-P3-1** |
| N4's 2,000-character frame, 150 × 60 mm (`M-type-shrinkB2000`, n=2, cal 42–49): open / one key / ten keys / width / size / font / Done | 245–267 / 29–38 / keeps up / — / — / — / 4,234–4,375 | **34,148–34,966** / **32,474–33,946** / 33,171–35,640 after the last key / 34,862–35,787 (frame preview **61,117–63,238**) / 34,917–38,605 / 4,649–4,655 / — | 180–373 when each result lands | 0.82–1.36 GB | | **S7-P3-1**; N4-P3-2's layout |
| Text on a path, 800 characters at 2 mm (`M-type-path800`, n=5, cal 37–51): open / one key / ten keys / Done | 181–220 / 11–24 / keeps up / 245–357 | 646–715 / 265–409 / 271–321 after the last key / — | **241–249** / 114–200 / 134–176 / 112–173 | 0.74–0.92 GB | 200 ms block | 1.2 × at open (placement runs on the UI thread after the worker, as ADR-643's Consequences say); not raised |
| Text on a path, 1,000 / 1,500 / 2,000 characters (`smoke.jsonl` `dbg-path*`, 1 run each) | — | **"Maximum call stack size exceeded"** | 133 / 302 / 522 | — | | **Functional bug** (Also noticed) |
| Convert to Path, 2,000 characters (`M-to-curves2000`, n=5, cal 38–67) | — | settled 121–187 | 94–153 | 0.83–0.87 GB | 200 ms block | Pass |
| Font list opens (`M-font-list`, n=5, cal 37–55) | listbox shown 180–328 | all 21 specimen faces loaded 196–346 | 0–101 | 0.6 GB | 100 ms | 1.8–3.3 ×; not raised (see Not verified) |
| Switch font, 20 fonts × 5 runs, 200 characters | — | median 107, p95 204, 80–265 | 0–72 | 0.6–0.88 GB | 100 ms | About at budget; Pass |
| System fonts…: list (stub) / use **Arial** 1.0 MB (`M-sys-arial`, n=5, cal 37–50) | 30–62 / dialog closed 102–129 | — / 214–247 | 0 / 0–66 | 0.67–0.69 GB | 100 ms | Pass |
| System fonts…: use **SimHei** 9.3 MB (`M-sys-simhei`, n=5, cal 36–53) | dialog closed **1,186–1,656** | 1,373–1,869 | **670–988**, then 548 | 1.09–1.12 GB | 200 ms block | **S7-P2-2** |
| Open a project with an embedded font, then double-click its text: Arial (`M-open-emb-arial`, n=5, cal 37–55) | open 218–320; editor 176–226 | 303–410 | 104–137 | 0.54–0.63 GB | 200 ms | Pass |
| Same, SimHei (14.6 MB project; `M-open-emb-simhei`, n=5, cal 36–47) | open 345–593; editor **505–566** | 711–809 | open 77–141; **edit 385–466** | 0.61–0.84 GB | 200 ms block | **S7-P2-2** |
| Array, **Advance variables per copy**, serial "SN-{{serial:4}}" (`M-var-serial10/100/1000`; n=5 / 4 / 1; after-run cal 40–118, the freeze heats the CPU): 10 / 100 / 1,000 copies | done 298–343 / **1,994–2,223** / **19,710** | — | 260–287 / **1,951–2,187** / **19,677** | 0.69–0.72 / 0.90–0.94 / 1.48 GB | 200 ms, or progress and Cancel | **S7-P2-1** |
| Same, Cancel pressed 1 s after Create array (`M-var-serial1000-cancel`, n=1 kept of 3) | Cancel's click lands **18.8 s later**; **1,000 copies created** | — | 19,751 | 1.64 GB | Cancel | **S7-P2-1** |
| Same, CSV names in a 60 × 20 mm shrink frame (`M-var-csv10/100/1000`; n=4 / 5 / 2): 10 / 100 / 1,000 copies | **721–883 / 7,361–8,366 / 69,347–79,337** | — | **684–845 / 7,310–8,335 / 69,284–79,298** | 0.71 / 0.84–0.93 / **2.17–2.20 GB** | 200 ms; 1.5 GB | **S7-P2-1** |
| Rows preview, 1,000 CSV records, first page of 25 laid out (`M-var-rows1000`, n=5) | 12–1,382 | — | 0 | 0.63–0.65 GB | 100 ms | Pass (worker); "Next rows" not measured (harness error) |

### Engine (Node; main / 1.0.28 / 1.0.23; `out\gt7.jsonl`, single calls `out\clean.jsonl`)

Median of the kept rounds. "=" means the result hashes equal main's; "paths =" means only the render's metadata differs (1.0.23 has no `glyphContours`).

| Operation, input | main | 1.0.28 | 1.0.23 | Output | Where it runs | Verdict |
|---|---|---|---|---|---|---|
| `renderTextGeometry`, plain 20 / 200 / 2,000 characters | 15.5 / 29.5 / 376 ms | × 1.01 / 1.06 / 1.17 | × 1.03 / 1.09 / 1.17 | = / paths = | UI (output, remote, jig, variable records) | Pass |
| Text worker's later edit (`computeTextGeometry`, one held parse), plain 200 / 2,000 | 15.7 / 325 ms | × 1.03 / 1.27 | × 1.06 / 1.20 | = / paths = | worker | Pass |
| Auto height box 150 mm, 200 / 2,000 characters | 89 / 1,379 ms | × 1.03 / 1.04 | × 1.05 / 0.86 | = / paths = | both | Large size only |
| **Shrink frame**, default 60 × 30 mm: 20 / 200 / 2,000 characters | 19.3 / **817** (single call **638–644**) / 944 ms (overflows at the minimum) | × 0.97 / 1.09 / 1.04 | × 0.99 / 1.02 / 1.14 | = / paths = | both | **S7-P3-1** |
| **Shrink frame**, 150 × 30 mm at 5 mm: 200 / 500 characters (fits at 5 mm / shrinks to 3.61 mm) | 93 / **4,340** (single call **3,758–4,198**) | × 0.97 / 0.96 | × 1.02 / 1.01 | = / paths = | both | **S7-P3-1**; N4-P3-2 |
| **Shrink frame**, 150 × 60 mm at 5 mm, 2,000 characters | **21,927** (single call **23,246–24,105**) | × 1.04 | × 1.00 | = / paths = | both | **S7-P3-1**; N4-P3-2 |
| Text on a path, 200 / 800 characters at 2 mm (render + `placeTextOnPath`) | 47 / 178 ms (placement 21 / 81) | × 1.01 / 0.99 | × 1.04 / 1.01 | = | UI after the worker | Pass |
| Text on a path, 1,000 / 1,500 characters | RangeError | RangeError | RangeError | | | Functional bug |
| **Variable array** (`prepareVariableArray`), serial, 10 / 100 / 1,000 copies | 303 / **2,593** (single call **1,978–2,403**) / **25,468** (single call **25,437–26,466**) | × 1.00 / 0.91 / 1.02 | × 1.00 / 0.97 / 1.06 | = | **UI** | **S7-P2-1** |
| Same, serial in a 60 × 20 mm shrink frame, 10 / 100 | 323 / 2,522 | × 0.94 / 1.02 | × 1.07 / 1.01 | = | **UI** | **S7-P2-1** |
| Records at output (`materializeVariableText`), 10 / 100 / 1,000 variable copies | 199 / 2,756 / 28,185 (single call 24,823) | × 1.04 / 0.98 / 0.95 | × 1.06 / 0.91 / 0.95 | = | UI below 2,000 work units (live estimate), else the preparation worker | See KNOWN (S4's area) |
| CSV parse, 10 / 100 / 1,000 records | 0.2 / 0.4 / 0.5 ms | = | = | = | UI | Pass |
| Embedded font encode + decode, 1 MB / 10 MB | 37 ms / **1,600 ms** (encode 1,639, decode 545) | × 1.04 / 1.03 | × 1.01 / 1.05 | = | **UI** | **S7-P2-2** |
| `parseOutlineFont`, Roboto / Great Vibes / Dancing Script | 24.5 / 5.0 / 5.1 ms | = | = | = | per record on the UI route | Pass (Roboto's parse is most of a record: S7-P2-1) |

Peak process memory (Node `maxRSS` of the three-tree set): variable array of 1,000 copies 1,207 MB; records at output 1,000: 1,185 MB; embedded font 10 MB: 663 MB; 2,000-character frame: 358 MB.

## Findings

### S7-P2-1 — "Advance variables per copy" renders every copy on the UI thread in one task: 100 serial numbers freeze the window for 2 s, 100 CSV name badges for 8 s, 1,000 for 20–79 s, and Cancel lands after the copies are made

- **Where:**
  - `src/ui/commands/ArrayDialogHost.tsx:118-121`: `applyVariableArray` calls `prepareVariableArray(captured, spec, { render: renderVariableText, … })` on the UI thread.
  - `src/ui/state/prepare-variable-array.ts:58-75`: one `await materializeVariableText(slotProject, { now }, options.render)` per copy. `isCurrent` is checked between copies (`:59, :65`), but nothing yields to the event loop. Every await settles as a microtask, so the whole loop is one task.
  - `src/ui/text/render-variable-text.ts:73` → `render-text-geometry.ts:41` → `src/core/text/text-to-polylines.ts:115`: `textToPolylines` parses the whole font file (`parseOutlineFont`) for every record. Roboto's parse is 24.5 ms of a record's 20–30 ms.
  - A record in a shrink-to-fit frame also pays the frame's search (S7-P3-1).
- **Anchor:**
  - AREAS: "200 ms longest block while designing, or a progress bar and Cancel". P2 for "a freeze of 5 s or more … with no progress or Cancel" and for "an ordinary operation over three times its budget".
  - Contract: ADR-643 D1/D3. Canvas text and its previews lay out in a text worker that keeps one parse of a reusable font, while D8 leaves output on the UI thread. The array dialog is not output; it is a design command that renders up to thousands of records interactively.
  - ADR-307 Amendment 1, the variable array, refuses an array the project has no room for "before the first one, not after a render for each", which acknowledges that the render costs.
- **Scenario:** a user makes 100 name badges from a CSV, or 1,000 serial-numbered tags, the batch workflow the Array dialog's checkbox exists for.
  - The status shows "Preparing variable copies…" once.
  - The window then stops answering: nothing paints, the cursor does not change, and Cancel does nothing until every copy is made.
  - At 1,000 badges the freeze lasts over a minute, long enough that a user may kill a window that looks hung.
- **Evidence:** **REPRO** (browser and engine) and **READ**.
  - **Browser** (`results.jsonl`):

    | Copies | Serial "SN-{{serial:4}}", 8 mm | CSV name in a 60 × 20 mm shrink frame, 10 mm |
    |---|---|---|
    | 10 | 260–287 ms block | 684–845 ms |
    | 100 | **1,951–2,187 ms** | **7,310–8,335 ms** |
    | 1,000 | **19,677 ms** | **69,284–79,298 ms**; Chrome 2.17–2.20 GB |

    Each is a single task that starts 68–111 ms after Create array. After it come a 100–234 ms task, when the copies arrive, and the post-edit preparation.
  - **Cancel** (`M-var-serial1000-cancel`): a pointer click on Cancel 1,006 ms after Create array was handled 18,803 ms later. The dialog closed with **1,000 objects in the project**. `close()` increments the request (`ArrayDialogHost.tsx:40-41`), but the loop had already finished and `arraySelection` had run before the click event was dispatched. Removing them takes Undo (I did not time it).
  - **Engine, single calls:** serial 100 copies 1.98–2.40 s, 1,000 copies 25.4–26.5 s; serial in a frame, 100 copies 1.92–2.40 s.
  - **Trend:** 1.0.28 and 1.0.23 hash the same and take × 0.91–1.07 of main at 10, 100 and 1,000. **Not a regression.**
  - **Prototype** (`varfix7.mjs`; harness only): 100 records laid out by `computeTextGeometry` with one held parse give **the identical result for all 100 records** as `renderTextGeometry`, both for serial numbers and for the 60 × 20 mm frame.
    - It ran once, at 08:13, after the other sessions had taken the PC (calibration 191–358 ms), so I quote no absolute time.
    - Within that one process, one parse took 895 ms against 11,574 ms for a parse per record (serial), and 943 ms against 12,702 ms (frame). That is an indication of about 12–13 ×, not a measurement.
- **Severity:** **P2.**
  - 100 copies is 10 × (serial) to 40 × (CSV frame) the 200 ms budget, with no working progress or Cancel.
  - 1,000 CSV badges freeze for over a minute, and the Cancel the dialog offers is ignored.
  - Not P1: no job is running, and nothing is lost.
- **Fix direction** (no output change: each copy's geometry must hash equal, which `gt7.mjs var-array` / `var-arrayf` checks):
  1. Parse the font once per batch where ADR-643 D3 allows reuse (`reusableOutlineFont`; every bundled outline font except Dancing Script). The text worker already does this. Outputs are identical by ADR-643's proof (`text-render-worker-runtime.test.ts`).
  2. Yield between copies (a macrotask every ≤ 50 ms), and show "n of N" in the status. Cancel and `isCurrent` then work as written.
  3. Or lay the records out in the text worker, as the rows preview already does (`VariableRowsPreview.tsx` uses `useTextWorkerSession`).
  - Budget: no UI task over 200 ms at 1,000 copies; Cancel closes the dialog within 100 ms and adds no copies; 100 serial copies under 1 s in all.

**Refuter (2026-11-05):** **CONFIRMED, P2.**
- **What would make it false:** a yield inside the loop, or a real macrotask in a record's render. Either would let Cancel and paint through.
  - **Neither exists** (READ, origin/main `790b95c4a`). No cited file changed since `3a8acb3bb`. `git diff 3a8acb3bb origin/main` touches neither `prepare-variable-array.ts`, `ArrayDialogHost.tsx`, `render-variable-text.ts`, `render-text-geometry.ts` nor `text-to-polylines.ts`; #1582 changed only `ArrayDialog.test.tsx`.
  - `prepare-variable-array.ts:58-77` awaits `materializeVariableText` per copy. Each await resolves by microtasks:
    - `loadFont` returns the cached buffer (`font-loader.ts:84-85`; only the first fetch is a real task);
    - `prepareTextShaping` returns `undefined` before any import for Latin text (`prepare-text-shaping.ts:16-17`);
    - `loadOpentype` and `templateBaselines` are settled promises.
  - `textToPolylines` parses the font on every call (`text-to-polylines.ts:115`). `isCurrent` (`:59, :65`) can only be read inside the one task. `applyVariableArray` (`ArrayDialogHost.tsx:118-140`) calls `arraySelection` in the same microtask checkpoint, so a queued Cancel click is dispatched after the copies exist, as measured.
- **Is 100 ordinary? Yes, and the P2 does not need 100.**
  - "Advance variables per copy" exists for batches: a sheet of name badges, serial tags or plates. Tens to a hundred is the everyday size; 1,000 is the large size.
  - The CSV badge case is P2 by the second clause already at **10 copies**: 0.68–0.85 s is 3.4–4.2 × the 200 ms budget.
  - At 100 badges (7.3–8.3 s) it is P2 by the first clause too: a freeze over 5 s with no working progress or Cancel.
  - Serial numbers alone reach 3 × only from about 30 copies (10 copies are 1.3–1.4 ×).
  - At 1,000 badges Chrome peaks at 2.17–2.20 GB, over the 1.5 GB budget.
  - Not P1: no job runs and nothing saved is lost. Undo removes the copies.
- **The late Cancel is not a separate finding.** It has the same root cause: one task, so the `isCurrent` checks the code already has can never see the click.
  - Yielding between copies (fix 2) or moving the records to the worker (fix 3) makes the existing `close()` → `request.current += 1` → `isCurrent()` path work unchanged.
  - The fix card must keep the auditor's acceptance test: Cancel within 100 ms, and no copies added.
- **Correction to the fix direction and to `biggest_win`.** Fix 1 (one parse per batch) helps serial numbers a lot. It does **not** bring CSV badges in a shrink frame under 1 s, because most of a badge's time is the frame's shrink search (S7-P3-1), not the parse.
  - **Re-measured** (`zz-s7r\varcsv7r.mjs 30 3`, the gen7 V-csv names in the 60 × 20 mm frame):
    - parse per record against one held parse: **× 1.20–1.48**, with all 30 records hash-identical in each of 3 rounds;
    - the parse alone 65–162 ms.
  - The PC was heavily loaded (calibration 247–253 ms against 36–40 quiet), so only the ratio is quoted.
  - **The budget therefore needs fix 2 or fix 3** (yield, or the worker), not fix 1 alone. Fix 1 with S7-P3-1's memoized shaping shortens the total.
- **Not re-measured in the browser:** the PC was shared by five fix sessions (calibration 165–260 ms, free memory 0.3–1.4 GB). The auditor's quiet-window figures (03:28–07:37) stand.

### S7-P2-2 — Embedding a large system font, and the first edit after opening a project that holds one, block the window: SimHei (9.3 MB) 0.7–1.0 s then 0.55 s; opening and editing 0.4–0.5 s

- **Where:**
  - `src/core/text/embedded-font.ts:34-47` (`encodeBase64`) appends four one-character strings per three bytes, 12.4 million concatenations for SimHei.
  - `:49-68` (`decodeBase64` / `decodeBase64Block`) calls `BASE64_ALPHABET.indexOf(char)` for every character.
  - Callers on the UI thread:
    - `src/ui/text/use-text-dialog-fields.ts:233` (`importFont` → `encodeEmbeddedFont`), reached by **System fonts…** (`SystemFontsDialog.tsx:66-78`) and **Import font**;
    - `src/ui/text/font-loader.ts:76` (`loadFont` → `embeddedFontBuffer`), the first time a session uses an embedded font: the editor's `ensureFontCss`, the text worker request, and output.
- **Anchor:** AREAS: 200 ms block. S3-P2-1 set the precedent: a phone photo's 0.8–1.1 s import block, "about 4–5 × the 200 ms budget", was P2.
- **Scenario:**
  - A user picks a Chinese, Japanese or Korean system font under **System fonts…**. These fonts are commonly 5–20 MB; the project limit is 10 MB. The maintainer's PC has SimHei (9.3 MB) and HarmonyOS Sans SC (8.3 MB).
  - The window freezes for a second, and **again for half a second** the next time that project is opened and its text edited.
- **Evidence:** **REPRO** (browser, engine) and **READ**.
  - **Browser:**
    - `M-sys-simhei` (5 kept runs): "Use SimHei" → a **670–988 ms** task and a second of about **548 ms**. The dialog closes 1,186–1,656 ms after the click, and the lettering shows in SimHei at 1,373–1,869 ms. Chrome 1.09–1.12 GB.
    - `M-sys-arial` (1.0 MB): dialog closed in 102–129 ms, no task over 66 ms.
    - `M-open-emb-simhei` (a 14.6 MB project): Open is fine (345–593 ms, tasks ≤ 141 ms). The double-click into the text blocks **385–466 ms** before the editor shows (505–566 ms). With Arial the same edit blocks 91–126 ms.
  - **Engine** (`emb 10`, 10 MB): encode 1,639 ms and decode 545 ms on main, the same in 1.0.28 and 1.0.23 (× 1.03, × 1.05). At 1 MB: 10 and 30 ms.
  - **Prototype** (`b64fix7.mjs`; harness only): encode in 32,766-byte chunks with `btoa(String.fromCharCode.apply(null, chunk))`, decode with `atob`. Both give **the identical base64 string and identical bytes** as main's codec on Arial and SimHei, in 8 of 8 rounds.

    | Font | main encode | main decode | chunked encode | chunked decode |
    |---|---|---|---|---|
    | Arial 1.0 MB | 8–48 ms | 28–32 ms | 5–7 ms | 3 ms |
    | SimHei 9.3 MB | 1,003–2,048 ms | 461–925 ms | 98–199 ms | 38–92 ms |
- **Severity:** **P2**, by S3-P2-1's precedent: an everyday action for a CJK user, 3.4–5 × the block budget, with no progress.
  - A refuter may weigh how often a font this large is embedded and lower this to P3. Latin system fonts are 0.1–1 MB and clean.
- **Fix direction** (no output change: the same string and bytes, which the existing embedded-font tests and a byte-equality test on a 10 MB buffer can hold):
  - Replace the codec with chunked `btoa` / `atob`.
  - Decode once per project load, not per session key, or in the text worker that receives the file anyway.
  - Budget: no task over 200 ms when a 10 MB font is embedded or first used.

**Refuter (2026-11-05):** **CONFIRMED, P2** (borderline; kept by the AREAS wording and S3-P2-1's precedent).
- **READ** (origin/main `790b95c4a`).
  - `embedded-font.ts` is unchanged since `3a8acb3bb`. `encodeBase64` (`:34-47`) concatenates one character at a time. `decodeBase64Block` (`:62-68`) calls `indexOf` per character.
  - The callers are on the UI thread:
    - `use-text-dialog-fields.ts:233` encodes **before** `embeddedFontChoice` (`:241`), so choosing a face that is already in the project encodes it again;
    - `font-loader.ts:77` decodes. The line moved from `:76` with #1581's import, and the code is unchanged.
  - ADR-643 D2 confirms that the UI thread loads the file and posts it to the worker.
- **Re-measured, ratio only** (`node ../zz-s7/b64fix7.mjs simhei.ttf 3`, `zz-s7r\b64fix7r.txt`):
  - chunked against main: encode × 7.8–11.7 and decode × 8.1–9.1 faster;
  - **IDENTICAL** string and bytes in 3 of 3 rounds.
  - Calibration was 211–260 ms (the PC was loaded), so the absolute times are not quoted.
- **How large the block can get.** It is bounded by `MAX_EMBEDDED_FONT_BYTES` (10 MiB, `:3`). SimHei, at 9.3 MiB, is about 90% of the worst case, so the block cannot exceed about 1.1 s on this PC.
- **Who meets it** (`C:\Windows\Fonts` on the maintainer's PC). Every CJK user embedding a common system font meets this one-off ≈ 1 s block.
  - **The commonest Chinese, Korean and Japanese UI fonts are over the cap.** These are refused before any encoding (`:17-19`), so they cost nothing:
    - Microsoft YaHei (`msyh.ttc` 18.8 MiB);
    - SimSun (`simsun.ttc` 17.5);
    - DengXian (15.6);
    - KaiTi (11.2), FangSong (10.1);
    - Malgun Gothic (12.8), Yu Gothic (13.2).
  - **Under the cap**, they pay the block:
    - SimHei (9.3), the standard Chinese sans;
    - STXihei (9.3), LiSu (8.8), HarmonyOS Sans SC (7.9), STXingkai (7.2), YouYuan (6.4);
    - MS Gothic (`msgothic.ttc` 8.6, so any face extracted from it is smaller);
    - Noto Sans KR VF (9.9).
  - So the trigger is narrower than "any CJK font", but it is a real, ordinary choice: SimHei is the default Heiti on Chinese Windows.
  - KerfDesk's users are owners of Chinese-made diode lasers worldwide. That does not by itself make CJK text common for them. The finding rests on CJK users, and on Latin users who engrave Chinese characters for gifts.
- **Severity.** The block is 670–988 ms, then about 548 ms (3.4–4.9 × the 200 ms budget), with no progress. That is "an ordinary operation over three times its budget" for a CJK user, with ordinary input: 5–10 MB is the normal size of a CJK font, not a large file. That makes it P2, like S3-P2-1's 0.8–1.1 s photo import.
  - It would be P3 if "ordinary" were read as "most users". It happens once per embed. The reopen-and-edit block (385–466 ms, 1.9–2.3 ×) is under 3 × and would be P3 on its own.
  - The coordinator may lower it on reach. I keep P2, because AREAS has no reach clause and the fix is small and output-identical.
- **Not re-measured in the browser** (shared PC). The auditor's quiet-window figures stand.

### S7-P3-1 — Shrink-to-fit lays text out up to 20 times and shapes every growing prefix of every line through opentype.js's full pipeline: the default frame with 200 characters previews 1.4 s after each key; N4's frames 6 s and 33 s

- **Where:**
  - `src/core/text/text-box-layout.ts:36-51`: a fixed shrink frame that overflows lays the text out at the natural size, at the minimum, then in 18 bisection steps (`:42`).
  - Each layout wraps every paragraph (`:63-75`). For each word, `wrapLine` measures `current + token` (`:108`) and then `current` again (`:118`), so each line's prefixes are measured over and over.
  - `src/core/text/text-to-polylines.ts:317-335` (`measureLineWidth`): each measurement is `font.forEachGlyph(line, …, { kerning, liga, rlig })`. opentype.js 2.0 runs `stringToGlyphs` → Bidi → `applyFeaturesToContexts` → `ccmpReplacementLigatures` over the whole string for every call.
  - The editor runs this twice for every edit in a frame: the canvas draft (`use-canvas-text-draft.ts`) and the frame preview (`TextBoxFields.tsx:93-116`), each in its own worker. The missing-glyph check uses a third.
- **Anchor:** AREAS: 100 ms to a visible response; P3 for "any other budget miss". The window does not freeze (worker, "Updating…"), and the key itself shows in the text box at once.
- **Evidence:** **REPRO + PROFILE + prototype.**
  - **Browser:**
    - The default frame with 200 characters (`M-type-shrinkA200`, 5 kept, cal 36–46): one key → preview **1,380–1,554 ms**; after ten keys **2,536–2,998 ms**. The status stays "Updating…" the whole time, because each key supersedes the last render and restarts its worker. Width → **1,360–1,587 ms**, with the frame preview at **2,565–2,815 ms**. Size → 930–1,059 ms.
    - With 20 characters the same frame is clean: 89–97 ms per key, 123–170 ms for the width.
    - N4's frames: 500 characters → **5.9–6.0 s** per key, and 11.5–11.7 s for the frame preview after a width change. 2,000 characters → **32–35 s**, and **61–63 s** for the frame preview.
  - **Engine** (Node, single call): 200 characters 638–644 ms; 500 characters 3.76–4.20 s; 2,000 characters 23.2–24.1 s. 1.0.28 and 1.0.23 are within × 0.96–1.14 with equal outlines.
  - **Profile** (`node --cpu-prof prof7.mjs shrinkA-200`, summarised by `profsum.cjs`; the Node profile was deleted and that command remakes it):
    - `layoutTextBox` holds 1,071 of 1,102 ms inclusive.
    - `measureLineWidth` → `forEachGlyph` → `stringToGlyphs` holds 1,044 ms, of which `ccmpReplacementLigatures` 749 ms and `lookupFeature` 534 ms.
    - The rendering itself is 3%.
  - **Prototype** (`memo7.mjs`; harness only): memoize `stringToGlyphs` per font and string, so each distinct line string is shaped once per render. This is safe by construction where ADR-643 D3 already reuses the parsed font. Every output **hashes equal to the unpatched render**:

    | Case | Calls → distinct strings | Unpatched | Memoized |
    |---|---|---|---|
    | Default frame, 20 characters | 19 → 8 | 18 ms | 15–16 ms |
    | Default frame, 200 characters | 3,014 → 363 | 749–981 ms | **214–239 ms** |
    | 150 × 30 mm, 500 characters | 7,256 → 1,025 | 4,721–5,104 ms | **902–1,011 ms** |
    | Default frame, 2,000 (overflows) | 3,135 → 1,313 | 1,095–1,161 ms | 636–697 ms |
    | Auto height, 2,000 | 1,525 → 736 | 889–958 ms | 544–571 ms |
    | 150 × 60 mm, 2,000 characters | 28,365 → 5,263 | 28,733 ms | **5,044 ms** |
- **Severity:** **P3.** No freeze: the text box, the status and Cancel stay live, as ADR-643 intends. The work is not ordinary-sized below about 100 characters in a frame.
  - A refuter may weigh AREAS' second P2 clause, "an ordinary operation over three times its budget". The default frame with a paragraph of text is ordinary, and its lettering lags 14–28 × the 100 ms budget.
  - The same cost lands on the UI thread in three places: remote and jig edits (N4-P3-2, KNOWN), the live estimate's records, and the variable array (S7-P2-1).
- **Fix direction** (no output change; prove with `gt7.mjs ui shrink*` hashes and the existing `text-box-layout` and `text-render-worker-runtime` tests):
  - Cache shaping per line string within a layout call, inside `measureLineWidth`. Store the glyph run and kerning in font units, then replay `forEachGlyph`'s own arithmetic at each size, so the sums stay bitwise equal.
  - Further: measure word by word with boundary kerning. That would be O(n), but it must prove identical line breaks first.
  - Let the frame preview reuse the draft's result instead of laying the text out a second time.
  - Budget: the default frame with 200 characters previews within 300 ms of a key; N4's 500-character frame under 1.5 s; the remote and jig 500-character edit under 1 s on the UI thread (N4-P3-2).

**Refuter (2026-11-05):** **CONFIRMED, P3.**
- **READ** (origin/main `790b95c4a`; `text-box-layout.ts` and `text-to-polylines.ts` unchanged since `3a8acb3bb`):
  - `layoutTextBox` makes the natural layout, the minimum, then 18 bisection layouts (`:35-50`);
  - `wrapLine` measures `current + token` (`:108`), then `current` again (`:118`);
  - `measureLineWidth` (`:317-335`) shapes the whole line string through `font.forEachGlyph` each time.
- **On P2 by "an ordinary operation over three times its budget":** I do not raise it.
  - The budget is "key to **visible response**". The key itself shows in the text box in 23–26 ms, and the panel shows "Updating…" at once. The lettering follows in a worker that each key supersedes (ADR-643 D5), with no block over 83 ms.
  - That is the pattern ADR-643 chose, and what AREAS asks of longer work: progress, and nothing frozen.
  - The miss is the time to the final lettering. That is "any other budget miss", so P3.
  - The cost lands on the UI thread only on the routes already counted: S7-P2-1 (CSV badges) and N4-P3-2 (remote and jig).
- **Fix-card note:** the shaping memo is the lever that also shortens S7-P2-1's CSV badges. The one-parse fix alone gives × 1.2–1.5 there (S7-P2-1 refuter note).
- Not re-measured (shared PC); the prototype's hashes and the profile are the auditor's.

### S7-P3-2 — Typing into a large text frame lags behind the keys: the frame preview rebuilds its SVG path from every point on every keystroke

- **Where:** `src/ui/text/TextBoxFields.tsx:90-120`. `TextBoxPreview` re-renders whenever the dialog values change, that is on every keystroke. On every render it calls `previewGeometry(preview, layout)` (`:120`), which joins every point of the last result into one SVG `d` string (`:232-240`). The result has not changed, because the new layout is still in the worker. The call is not memoized.
- **Anchor:** AREAS: 100 ms from a key to a visible response; 200 ms block.
- **Evidence:** **REPRO + PROFILE.**
  - `M-type-shrinkA2000` (2,000 characters in the default frame, 245,858 points): ten keys at 100 ms produce one task per key of **51–280 ms** (2.6 s in all). The tenth character reaches the text box **1,202–2,562 ms after the first key**, against 1,155–1,194 ms in plain text of the same length.
  - Profile (`prof-M-prof-shrinkA2000-burst10-r1.json`, mapped with `map-profile.cjs` against `dist-main`): `TextBoxPreview` → `previewGeometry` holds **3,764 ms** of the 4,721 ms of long tasks; `TextBoxFields.tsx:235/237` self time is 3,432 ms. Unpacking the worker's result is 121 ms, and the canvas draw 112 ms.
  - At 200 characters in the same frame no keystroke task exceeds 50 ms. The cost grows with the points.
  - The same code is in 1.0.28 and 1.0.23 (`TextBoxFields.tsx:120`).
- **Severity:** **P3**: large text only. 2,000 characters in one frame is the area's large size.
- **Fix direction** (display only; the burn and the committed object are untouched):
  - Memoize `previewGeometry` on `preview`.
  - Build the path at the preview's resolution, skipping sub-pixel points; it is 130 px tall.
  - Budget: no keystroke task over 50 ms with 2,000 characters in a frame.

**Refuter (2026-11-05):** **CONFIRMED, P3.**
- **READ** (origin/main `790b95c4a`; `TextBoxFields.tsx` unchanged since `3a8acb3bb`). `TextBoxPreview` (`:90-120`) takes `values`, so it re-renders on every keystroke. `previewGeometry(preview, layout)` (`:120`, body `:225-242`) has no `useMemo`, and maps every point of the last result into a string (`:232-240`).
- **The cost follows the points**, about 120 per character in Roboto (`zz-s7r\fonts7r.txt`). Script fonts carry 3–5 × as many points per character (Great Vibes 528, Allura 580), so a script font in a frame reaches the same per-key cost at a few hundred characters, not 2,000.
  - That is still not an everyday size for one frame, so P3 stands.
- Not re-measured in the browser (shared PC).

### S7-P2-3 — Text on a path, and bent text, fail with "Maximum call stack size exceeded" once a render passes about 124,000 points: from about 75 characters of the bundled Special Elite, 210–420 of the script fonts, and about 1,000 of Roboto (raised by the refuter from the auditor's "Also noticed")

- **Where** (origin/main `790b95c4a`; both files unchanged since July, `e3fb1903c`):
  - `src/core/text/text-on-path.ts:188-205` (`boundsForPaths`) and `src/core/text/text-bend.ts:88-105` (its own `boundsForPaths`). Each spreads every point's x and y into `Math.min(...xs)` / `Math.max(...)`.
  - V8 caps a spread call's arguments by stack size. `zz-s7r\spreadlim.mjs` finds about **124,000** in Node 25, and Chrome fails at the same size.
  - **Callers:**
    - the canvas editor and Add/Edit Text: `build-text-object.ts:125` (`styledBentRender`, any non-zero **Bend**) and `:135` (`placeTextOnPath`);
    - variable records at output and in the Array dialog: `render-variable-text.ts:36, :62`;
    - remote `update_text` and the jig: `render-styled-text.ts:48`.
  - `bendTextRender` returns early only at bend 0 (`text-bend.ts`, `Math.abs(angleDeg) < 1e-9`).
  - `text-style.ts:266-273` uses the same pattern per contour, which stays far below the limit.
- **Anchor:** METHOD §3 P2, "wrong behaviour an ordinary user will hit, with a misleading result". The engine's raw error is shown, with no hint that the text is too long.
- **Evidence:** **REPRO** (engine and browser) and **READ**.
  - **Engine** (`zz-s7r\pathbend7r.mjs` on the auditor's main bundle; `pathbend7r.txt`, `fonts7r.txt`):
    - The point count does not depend on size: Roboto at 2, 5 and 10 mm gives the same 122,923 points at 1,000 characters. **Larger lettering does not help.**
    - Path and bend fail at the same length. Roboto passes at 900 characters and fails at 1,000; Great Vibes passes at 200 and fails at 250; **Special Elite passes at 70 (118,633 points) and fails at 75 (128,345)**; Allura passes at 200 and fails at 220.
    - Points per character over 100 fixture characters, and the length where each bundled outline font fails:

      | Font | Points per character | Fails from about |
      |---|---|---|
      | Special Elite | 1,669 | **75** |
      | Allura | 580 | 214 |
      | Parisienne | 567 | 219 |
      | Italianno | 540 | 230 |
      | Great Vibes | 528 | 235 |
      | Pinyon Script | 468 | 266 |
      | Dancing Script | 415 | 299 |
      | Corinthia | 390 | 319 |
      | Alex Brush | 372 | 334 |
      | UnifrakturMaguntia | 345 | 360 |
      | Pacifico | 332 | 374 |
      | Courier Prime | 293 | 424 |
      | Stardos Stencil | 218 | 570 |
      | Cinzel Decorative | 160 | 777 |
      | Inconsolata | 155 | 803 |
      | Poppins, Saira Stencil | 132–133 | 932–940 |
      | Anton, Roboto, Tinos | 114–120 | 1,035–1,086 |

  - **Browser** (`zz-s7r\run7r.mjs` on `zz-s6\dist-main`, `repro7r.jsonl`, `shots\r7r-*`; functional runs only, no timing quoted). A 60-character Special Elite text at 5 mm, once on a spiral guide (`R-se-path60`) and once with Bend 30° (`R-se-bend60`), generated by `gen7r.mjs`:
    - The editor opens at 60 characters with "Live preview".
    - Typing 29 more characters (to 89) gives the `alert` **"Maximum call stack size exceeded"**.
    - **Done (Ctrl+Enter) does nothing.** The editor stays open with the same error, and the object keeps its 60-character text.
    - Cutting back to 70 characters clears the error.
    - The path and bend projects behave identically.
    - The auditor's runs show the same for Roboto at 1,000–2,000 characters in main, 1.0.28 and 1.0.23.
  - **How the measured build shows it.** In `dist-main` (`45cbf63f9`) the error sat inside the panel's scroller, below its visible edge (screenshot `r7r-R-se-path60-state-after-done-r0.png`). The status read "Live preview" over stale lettering, so Done looked dead with no reason shown. On origin/main, #1581 (U5-P3-9) moved the error above Done (`CanvasTextPanel.tsx`), so the raw message is now visible. It still does not say "too long".
- **Is work lost? Can the user save?**
  - **Nothing saved is lost or corrupted.** The object keeps its last committed text, and the project saves and reopens normally (`use-canvas-text-actions.ts:52-65` upserts only after a successful build).
  - **The edit cannot be committed.** Cancel discards what was typed in the session, and the only way forward is to shorten the text, change the font, or remove the bend or path, guided by nothing but a stack-overflow message.
  - **At output**, a bent or path variable text whose records pass the limit throws the same raw error from Preview, Start or the variable array (`render-variable-text.ts:36-42, :62`). That is a refusal, not wrong physical output.
  - Not P1: no data loss, no wrong burn.
- **Severity: P2.**
  - A sentence of 75 characters in Special Elite, bent into an arc ("Est. 2024 · handmade by …" on a sign or plate), is ordinary input with a bundled font.
  - A few hundred characters of script around a circular plate or a ring is less common, but ordinary for the fonts made for it.
  - Same in 1.0.28 and 1.0.23 (auditor; both functions are unchanged since `e3fb1903c`).
  - Found by the auditor ("Also noticed"); raised and widened by the refuter, as S6-P2-2 was.
- **Fix direction** (no output change):
  - Replace both spreads with a loop, as `normalizeToOrigin` (`text-to-polylines.ts:283-293`) and `copyStride` already do. Min and max over the same values are the same numbers, so the geometry and G-code stay byte-identical.
  - Test with a render over 200,000 points on both routes, for example 150 characters of Special Elite.
  - Sweep the other runtime `Math.min(...` / `Math.max(...` over point arrays. `git grep -nE "Math\.(min|max)\(\.\.\." -- src` lists further candidates outside text, such as `head-camera.ts:170` and `slide-lid-referee.ts`; check whether any can see more than about 100,000 values.

## Trend

Engine rows alternate the three trees in one process (ratios to main). "Out" compares result hashes with main.

| Row | main | 1.0.28 | 1.0.23 | Out | Verdict |
|---|---|---|---|---|---|
| Plain text 20 / 200 / 2,000 (UI route) | 15.5 / 29.5 / 376 ms | × 1.01 / 1.06 / 1.17 | × 1.03 / 1.09 / 1.17 | 1.0.28 =; 1.0.23 paths = | Flat (main fastest) |
| Text worker's later edit, 200 / 2,000 | 15.7 / 325 ms | × 1.03 / 1.27 | × 1.06 / 1.20 | same | Flat |
| Shrink frames: default 200 / N4 500 / N4 2,000 | 817 / 4,340 / 21,927 ms | × 1.09 / 0.96 / 1.04 | × 1.02 / 1.01 / 1.00 | same | Flat: S7-P3-1 in every build |
| Variable array, 10 / 100 / 1,000 serial copies | 303 / 2,593 / 25,468 ms | × 1.00 / 0.91 / 1.02 | × 1.00 / 0.97 / 1.06 | = | Flat: S7-P2-1 in every build |
| Records at output, 10 / 100 / 1,000 | 199 / 2,756 / 28,185 ms | × 1.04 / 0.98 / 0.95 | × 1.06 / 0.91 / 0.95 | = | Flat |
| Text on a path, 200 / 800 | 47 / 178 ms | × 1.01 / 0.99 | × 1.04 / 1.01 | = | Flat |
| Embedded font 10 MB encode + decode | 1,600 ms | × 1.03 | × 1.05 | = | Flat: S7-P2-2 in every build |
| Font parse, CSV parse | 24.5 / 0.5 ms | = | = | = | Flat |
| Text on a path at 2,000 characters (browser, `dbg-path2000-*`) | RangeError | RangeError | RangeError | | The bug is in every build |

**Browser trend:** not run. The 1.0.28 / 1.0.23 sets (typing at 200 characters plain and framed, the font list, SimHei, the 100-copy variable array) were queued behind main's and were still waiting at 07:37, when the four fix sessions started. The engine rows above cover the same code paths with equal outputs, and the path bug was reproduced in both old builds' browsers.

Nothing is two or more times slower than 1.0.23 with the same output.

## KNOWN re-observed

- **N4-P3-2 (v8): remote `update_text` and jig edits lay text frames out on the UI thread.** Not fixed. `render-styled-text.ts:33` still calls `renderTextGeometry` in process; its callers are `remote-control/text-edit.ts:54` and `jig-text-object.ts:57`.
  - Now (Node, bundled, single calls starting at calibration 36–39 ms), `renderTextGeometry` on N4's frames takes:
    - 500 characters, 150 × 30 mm, Roboto 5 mm: **3,758 / 3,981 / 4,198 ms**;
    - 2,000 characters, 150 × 60 mm: **23,246 / 24,105 ms**;
    - 200 characters, 150 × 30 mm (fits at 5 mm): 93 ms;
    - the default 60 × 30 mm frame with 200 characters: 638–644 ms.
  - N4 measured 10,985–17,005 ms and 70–81 s inside Vitest. A bundle runs the same code about 3 × faster; the cost is unchanged since 1.0.23 (× 0.96–1.04, equal outlines).
  - I could not drive a remote or jig edit in the web build, so these are engine figures; in the browser the call would freeze the window for its whole length.
  - S7-P3-1's prototype cuts the 500-character case to 0.90–1.01 s and the 2,000-character case to 5.0 s with identical output. Routing `renderStyledText` through `renderTextGeometryOffThread` removes the block.
  - **Refuter (2026-11-05):** **CONFIRMED, still KNOWN, not fixed.** On origin/main `790b95c4a`, `render-styled-text.ts:33` still awaits `renderTextGeometry` in process. Its callers are still `remote-control/text-edit.ts:54` and `registration-jig/jig-text-object.ts:57`, and none of the three changed since `3a8acb3bb`.
    - ADR-643 D8 keeps remote control and the jig on the UI path by design. N4-P3-2 stays open as filed.
    - The same route also hits S7-P2-3 through `styledBentRender` (`render-styled-text.ts:48`).
- **The post-edit preparation (S2-P3-1's area), seen after Done.** Closing the editor with Ctrl+Enter is followed by a 68–95 ms task (200 characters) and 75–223 ms (2,000 characters), from the post-edit job preparation. It is within budget at ordinary sizes and not raised here.
- **Records at output (S4's area).** `materializeVariableText` renders every variable record with a fresh font parse: 2.76 s per 100 copies and 28 s per 1,000 in the engine.
  - Below 2,000 work units (a few variable texts) this runs on the UI thread in the live estimate (`live-job-estimate.ts:94-121`). Above that it runs in the preparation worker.
  - I did not measure Preview or Start on an array of variable copies in the app. S7-P2-1's batch parse would cut it the same way.

## Refuted

1. **"The text worker lets ordinary typing block the window."** At 20–200 characters, plain or framed, no keystroke has a long task. The key reaches the text box in 8–26 ms, and the preview follows in 75–112 ms in plain text.
2. **"Switching between 20 fonts is slow."** It takes a median of 107 ms (80–265, 100 switches) with no task over 72 ms. Each font is fetched, registered with CSS and posted to the worker once.
3. **"CSV merge at 1,000 records is slow to load."** Parsing 1,000 records takes 0.5 ms (Node), and the rows preview lays out its first page of 25 in a worker. The cost of 1,000 records is the per-record layout (S7-P2-1), not the data.
4. **"Main's text render got slower than 1.0.23."** Every text row is within × 0.86–1.27 of 1.0.23, mostly with main the fastest. 1.0.23 differs only in render metadata (`glyphContours`); its outlines hash equal.

**Refuter (2026-11-05): all four refutations upheld.**
- 1 and 2 rest on the auditor's quiet-window browser sets. The shared PC (calibration 165–260 ms) gave no fair re-run. The code they rely on is unchanged on origin/main: the text worker, `use-canvas-text-draft.ts` and the font loader's cache. The only text change since `3a8acb3bb` is #1581's wording and placement of messages.
- 3 is re-checked (`zz-s7r\csv7r.mjs`): `parseVariableCsv` on 1,000 quoted name records took 2.0–20.7 ms over 5 calls (2 ms once warm), at calibration 204–224 ms. Read against the quiet 36–40 ms, that is well under a millisecond to a few milliseconds. The auditor's 0.5 ms is plausible, and either way it is far inside the budget.
- 4 is consistent with the engine trend table. For the path and bend bug (S7-P2-3), `git log -S` shows both spreads unchanged since `e3fb1903c` (July), so it is no regression.

## Verified clean

- **Everyday typing** (20 and 200 characters, plain): the key shows in 8–26 ms and the lettering in 75–112 ms, with no long task. Done takes 104–192 ms.
- **The default text frame with a few words** (20 characters): 89–97 ms per key; width, size and font 65–170 ms.
- **Font switching**, with a median of 107 ms, and **Arial from System fonts…** in 102–129 ms.
- **Convert to Path** of 2,000 characters: 121–187 ms, with one task of 94–153 ms.
- **Output equality:** every engine set gave one hash per tree across all rounds. Main equals 1.0.28 everywhere, and equals 1.0.23's outlines everywhere.
- **ADR-643's worker routes** keep the window responsive during long layouts. The 2,000-character N4 frame lays out for 33 s with only 180–373 ms tasks when each result lands.

## Not verified

- **Functional bug, for the coordinator: text on a path fails from about 1,000 characters of Roboto, or about 250 of Great Vibes.**
  - **Where:** `src/core/text/text-on-path.ts:188-205` (`boundsForPaths`) spreads every point's x and y into `Math.min(...xs)` / `Math.max(...)`. Above about 110,000–130,000 points that throws `RangeError: Maximum call stack size exceeded`.
  - **REPRO in the app** (`dbg-path1000-main`, `dbg-path1500-main`, `dbg-path2000-main`, `-r28`, `-r23` in `smoke.jsonl`; a 2.4 m spiral guide, Roboto 2 mm):
    - 800 characters work.
    - Typing or pasting to 1,000, 1,500 or 2,000 characters shows **"Maximum call stack size exceeded"** in the panel and blocks Done.
    - The same holds in 1.0.28 and 1.0.23.
  - **Engine** (`pathlim7.mjs`): Roboto works at 900 characters (109,473 points) and fails at 1,000. Great Vibes works at 200 characters (104,223 points) and fails at 250 (128,853). Pacifico and Dancing Script work at 250.
  - Variable records on a path use the same function at output (`render-variable-text.ts:36`).
  - Not speed, so not counted. The scale suggests P3 for Roboto and P2 for a script font, where 250 characters is a short paragraph. The message is the raw engine error.
  - **Fix:** a loop for the bounds, as `normalizeToOrigin` in `text-to-polylines.ts:283-293` already does. The geometry does not change.
  - **Refuter (2026-11-05):** raised as **S7-P2-3** (see Findings).
    - **Reproduced:** in Node, at the auditor's thresholds; in the browser, with Special Elite at 89 characters, both on a path and bent.
    - **Widened:** `text-bend.ts:88-105` has the same spread, so any non-zero Bend fails at the same length. The bundled Special Elite fails from about 75 characters.
- **Remote and jig edits in the app** (N4-P3-2): engine only, as above.
- **The font list's 180–328 ms opening** (1.8–3.3 × the 100 ms budget, no task over 101 ms) is not raised. I did not profile it. It renders 25 specimens of the current text in their own faces, and `SingleLineFontPreview` lays out the four CNC fonts on the UI thread.
- **The rows preview's "Next rows"**: my done-expression had a syntax error, so that step was not measured. The first page laid out in 12–1,382 ms with no long task.
- **Preview and Start on an array of variable copies** in the app (S4's area): engine only.
- **The packaged desktop app.** All browser rows are the Free web bundle in Chrome. The system font list came from a stub, because headless Chrome has no font-access permission prompt.
- **Typing of IME and complex scripts** (HarfBuzz): not measured. ADR-643's tables cover Arabic and CJK renders.
- **The browser trend rows and a source-mapped profile of the variable array in the app**, both gated out by the other sessions from 07:37 (Machine state). The engine attributes a record's time to the per-record font parse (Roboto 24.5 ms of 20–30 ms), and the batch-parse prototype is output-identical.
- **Undo after a variable array**, and its cost at 1,000 copies.

## Refuter summary

**Refuter:** fresh context, 2026-11-05, origin/main `790b95c4a`.
- **No cited text file changed since `3a8acb3bb`.** #1581 changed only message wording and placement in `CanvasTextPanel.tsx`, `font-loader.ts` (one import, so `:76` → `:77`) and a few other text UI files. #1582 and #1583 changed no text code. No open PR touches the cited files.
- **Result: 5 raised → 0 refuted → P1 0 / P2 3 / P3 2 (+ 1 KNOWN).**
  - **Confirmed:** 4, at the auditor's severity. N4-P3-2 is confirmed as KNOWN.
  - **Severity changes:** none.
  - **New:** 1, S7-P2-3, raised from the auditor's "Also noticed" and widened.
  - **The auditor's 4 refutations:** upheld.

| ID | Verdict | Key evidence |
|---|---|---|
| S7-P2-1 | **CONFIRMED P2** | READ: only microtask awaits, so one task, and a parse per record. P2 already at 10 CSV badges (0.68–0.85 s, 3.4–4.2 ×) and by both clauses at 100 (7.3–8.3 s). The late Cancel has the same root cause, so it is not a separate finding. Re-measured ratio: one parse alone is only × 1.20–1.48 on CSV badges, so the budget needs yield or the worker |
| S7-P2-2 | **CONFIRMED P2** (borderline) | READ: per-character codec on the UI thread. Re-measured ratio: chunked encode × 7.8–11.7, decode × 8.1–9.1, identical. Bounded by the 10 MiB cap. YaHei, SimSun, DengXian, KaiTi, Malgun and Yu Gothic are refused by the cap; SimHei, MS Gothic, HarmonyOS Sans SC and Noto Sans KR VF pay about 1 s once. The coordinator may lower it on reach |
| S7-P3-1 | **CONFIRMED P3** | READ: 20 layouts × prefix shaping. The key echoes in 23–26 ms with "Updating…" and no block, so the lettering latency is "any other budget miss", not P2 |
| S7-P3-2 | **CONFIRMED P3** | READ: `previewGeometry` is not memoized. The cost follows the points, and script fonts carry 3–5 × Roboto's per character |
| N4-P3-2 | **CONFIRMED, KNOWN** | `render-styled-text.ts:33` unchanged |
| **S7-P2-3** (new) | **P2, functional** | REPRO in Node and the browser. Path and bend fail past about 124,000 points, whatever the size. Special Elite fails at 75 characters, the script fonts at 214–424, Roboto at about 1,000. Done cannot commit, and the message is raw. Nothing saved is lost |

**What I re-measured, and what I did not.**
- Five fix sessions shared the PC throughout: calibration 165–260 ms against 36–40 quiet, and 0.3–1.4 GB free (a first browser run was stopped by the harness watchdog at 329 MB).
- **Re-measured:** ratios inside one Node process (`varcsv7r`, `b64fix7r`), functional outcomes (`pathbend7r`, `spreadlim`, `run7r` browser repros, with the gate skipped and no timing quoted), and the CSV parse order of magnitude.
- **Not re-measured:** every browser latency and block, and every absolute engine time. These rest on the auditor's quiet window (03:28–07:37).
- I stopped no other session's processes. My host on port 4891 and my Chrome were closed at the end.

**Refuter files** (`scratchpad\zz-s7r\`):
- scripts: `spreadlim.mjs`, `pathbend7r.mjs`, `gen7r.mjs`, `mkrepro7r.mjs`, `run7r.mjs`, `host7r.mjs`, `varcsv7r.mjs`, `csv7r.mjs`;
- results: `pathbend7r.txt`, `fonts7r.txt`, `varcsv7r.txt`, `b64fix7r.txt`, `csv7r.txt`, `repro7r.jsonl`, `shots\r7r-*`.

The generated projects (about 13 MB) were deleted; `node gen7r.mjs` remakes them.

## Re-running

From `scratchpad\zz-s7`.
- **Tree:** refresh `j7-main` against `origin/main` file by file with `MSYS_NO_PATHCONV=1 git show`, and hash-check. Never delete `j7-main` or anything under it recursively; its `node_modules` is a junction.
- **Build main:** S6's command, with `zz-s7-vite.config.mts` and `--outDir <zz-s7>/dist-main`. Or reuse `zz-s6\dist-main` while no text file has changed since `3a8acb3bb`.
- **Engine:** `node build7.mjs` (bundles `eng-main/r28/r23.mjs`), then `./qe7.sh q-e1.txt` (gated). One set: `node --expose-gc --max-old-space-size=6144 gt7.mjs <op> <fixture> main,r28,r23 <rounds>`. Summarise with `node anal7.mjs [file] [regex]`. Single calls: `./clean7.sh`.
- **Prototypes:**
  - `node --expose-gc memo7.mjs shrinkA-200,shrinkB-500 3` (S7-P3-1, hashes);
  - `node --expose-gc b64fix7.mjs C:/Windows/Fonts/simhei.ttf 4` (S7-P2-2);
  - `node --expose-gc varfix7.mjs 100` (S7-P2-1);
  - `node pathlim7.mjs roboto-regular,great-vibes-regular 900,1000` (the path bug);
  - `node --cpu-prof prof7.mjs shrinkA-200` with `node profsum.cjs <file>`.
- **Projects:** `node gen7.mjs main,r28,r23 T-plain-20,T-plain-200,T-plain-2000,T-shrinkA-20,T-shrinkA-200,T-shrinkA-2000,T-shrinkB-500,V-serial,V-csv10,V-csv100,V-csv1000,P-path800,E-arial,E-simhei` and `node gen7.mjs main T-shrinkB-2000`. That is about 190 MB, and E-* reads `C:\Windows\Fonts`.
- **Browser:**
  - Hosts: `node host.mjs ../zz-s6/dist-main 4871`, `node host.mjs ../zz-s1/dist-33bc394c6 4872` and `node host.mjs ../zz-s1/dist-87ecb4f24 4873`. The host also serves `C:\Windows\Fonts\<name>` for the `queryLocalFonts` stub.
  - Queues: `node mkq7.mjs <queue> <templates> main,r28,r23 <runs>`, then `./qb7.sh <queue>` (gated).
  - Summarise with `node sum7.mjs '<label regex>' [maxCal]`. It prints "live-after-last-key" from the status trail.
- **S7-P2-1 first** (one set, about 4 minutes): `node mkq7.mjs q.txt var-serial100,var-serial1000-cancel main 4 && ./qb7.sh q.txt`.
- **Profiles:** add `"profile":"<step tag>"` to a set, then `node map-profile.cjs <file> ../zz-s6/dist-main 60`.

```json
{
  "area": "S7-text",
  "tree": "3a8acb3bb",
  "builds": { "main": "zz-s6/dist-main (45cbf63f9; no text file changed to 3a8acb3bb)", "engine": "esbuild bundles of main (j7-main = 3a8acb3bb) / 33bc394c6 / 87ecb4f24 (build7.mjs)", "trend": ["1.0.28 33bc394c6", "1.0.23 87ecb4f24"] },
  "counts": { "raised": 5, "refuted": 0, "auditor_refuted_leads": 4, "P1": 0, "P2": 3, "P3": 2, "known": 1, "auditor_counts": { "raised": 4, "P2": 2, "P3": 2, "functional_bug_not_counted": 1 } },
  "refuter": { "date": "2026-11-05", "tree": "origin/main 790b95c4a (no cited file changed since 3a8acb3bb; font-loader.ts:76 -> :77 by #1581's import)", "confirmed": ["S7-P2-1", "S7-P2-2", "S7-P3-1", "S7-P3-2", "N4-P3-2 (KNOWN)"], "refuted": [], "severity_changes": [], "new": ["S7-P2-3 (functional; auditor's 'Also noticed', widened to Bend and Special Elite)"], "remeasured": "Node ratios and functional browser runs only (PC shared by five fix sessions, calibration 165-260 ms): CSV badges one-parse x1.20-1.48; base64 chunked encode x7.8-11.7, decode x8.1-9.1, identical; path/bend thresholds per font; CSV parse 1,000 records 2-21 ms at 5.5x slow clock", "files": "scratchpad/zz-s7r" },
  "budgets": { "response_ms": 100, "design_block_ms": 200, "memory_gb": 1.5 },
  "machine": "only measuring agent 03:28-07:37 (all engine, single-call and main browser sets); OneDrive sync ~1 core; browser calibration 40-61 ms on a quiet PC from 05:27; four fix sessions from 07:37 (gated sets after that: see Machine state)",
  "n4_p3_2_now": { "where": "render-styled-text.ts:33 (UI thread; remote text-edit.ts:54, jig-text-object.ts:57)", "node_single_call_ms": { "chars500_150x30": [3758, 3981, 4198], "chars2000_150x60": [23246, 24105], "chars200_default_frame": [638, 644] }, "n4_then_ms": { "chars500": "10985-17005 (Vitest)", "chars2000": "70000-81000 (Vitest)" }, "trend": "x0.96-1.04 of main in 1.0.28/1.0.23, equal outlines", "editor_worker_browser_ms": { "chars500_key_preview": "5933-6018", "chars2000_key_preview": "32474-33946", "chars2000_frame_preview_after_width": "61117-63238" } },
  "findings": [
    { "id": "S7-P2-1", "severity": "P2", "evidence": "REPRO + READ", "file": "src/ui/state/prepare-variable-array.ts", "line": 64, "known": false, "regression": "none (1.0.28/1.0.23 x0.91-1.07, same hashes)", "title": "Array 'Advance variables per copy' renders every copy on the UI thread in one task (font parsed per record): serial 100 copies 1.95-2.19 s, 1,000 19.7 s; CSV names in a 60x20 shrink frame 10 0.68-0.85 s, 100 7.3-8.3 s, 1,000 69-79 s (Chrome 2.2 GB); Cancel pressed at 1 s lands 18.8 s later and 1,000 copies are created" },
    { "id": "S7-P2-2", "severity": "P2", "evidence": "REPRO + READ + prototype", "file": "src/core/text/embedded-font.ts", "line": 34, "known": false, "regression": "none", "title": "Embedded-font base64 codec is per character on the UI thread: System fonts SimHei 9.3 MB blocks 670-988 ms then ~548 ms; opening a project with it and editing its text blocks 385-466 ms; chunked btoa/atob identical and ~10x faster" },
    { "id": "S7-P3-1", "severity": "P3", "evidence": "REPRO + PROFILE + prototype", "file": "src/core/text/text-box-layout.ts", "line": 108, "known": "N4-P3-2's cost; routes in worker here", "regression": "none", "title": "Shrink-to-fit bisection shapes every line prefix through opentype stringToGlyphs (97% of the render): default 60x30 frame with 200 chars previews 1.38-1.55 s after a key (2.5-3.0 s after typing, frame preview 2.6-2.8 s); N4 500-char frame 5.9-6.0 s, 2,000-char 32-34 s (frame preview 61-63 s); memoized shaping identical, 3.5-5.7x faster" },
    { "id": "S7-P3-2", "severity": "P3", "evidence": "REPRO + PROFILE", "file": "src/ui/text/TextBoxFields.tsx", "line": 120, "known": false, "regression": "none", "title": "TextBoxPreview rebuilds its SVG path string from every point on every keystroke: 2,000 chars in a frame give 51-280 ms per key and the 10th key reaches the text box 1.2-2.6 s after the 1st (previewGeometry 3.76 of 4.72 s of long tasks)" },
    { "id": "S7-P2-3", "severity": "P2", "evidence": "REPRO (Node + browser) + READ", "file": "src/core/text/text-on-path.ts", "line": 200, "also": "src/core/text/text-bend.ts:100", "known": false, "regression": "none (since e3fb1903c, July)", "raised_by": "refuter (auditor's Also noticed)", "title": "Text on a path and bent text throw 'Maximum call stack size exceeded' once a render passes ~124,000 points (boundsForPaths spreads every point into Math.min(...)): Special Elite from ~75 characters, script fonts 214-424, Roboto ~1,000; size does not matter; Done cannot commit the edit; variable records on a path or bent fail at output with the same raw error; nothing saved is lost" }
  ],
  "refuter_verdicts": {
    "S7-P2-1": "CONFIRMED P2: one task (microtask-only awaits), font parsed per record; P2 already at 10 CSV badges (3.4-4.2x of 200 ms) and at 100 (7.3-8.3 s freeze); late Cancel is the same root cause, not separate; one-parse alone only x1.2-1.5 on CSV badges in a frame, so the budget needs yield or the worker",
    "S7-P2-2": "CONFIRMED P2 (borderline): bounded by the 10 MiB cap (SimHei ~90% of worst case); the commonest CJK fonts (YaHei, SimSun, DengXian, KaiTi, Malgun, Yu Gothic) are over the cap and refused before encoding; SimHei, MS Gothic, HarmonyOS Sans SC, Noto Sans KR VF pay it; chunked codec identical, x8-12",
    "S7-P3-1": "CONFIRMED P3: key echoes in 23-26 ms with 'Updating…' and no block; lettering latency is 'any other budget miss'",
    "S7-P3-2": "CONFIRMED P3: previewGeometry unmemoized; scales with points (script fonts 3-5x Roboto per character)",
    "N4-P3-2": "CONFIRMED KNOWN, not fixed (render-styled-text.ts:33 unchanged)"
  },
  "known_reobserved": [ "N4-P3-2: remote/jig frame layout on the UI thread, 500 chars 3.8-4.2 s, 2,000 chars 23-24 s (Node)" ],
  "functional_bug": "raised by the refuter as S7-P2-3 (also text-bend.ts:88-105). Auditor's note: text-on-path.ts:191-203 boundsForPaths spreads all points into Math.min(...): text on a path fails with 'Maximum call stack size exceeded' from ~1,000 Roboto / ~250 Great Vibes characters (app and Node, main/1.0.28/1.0.23)",
  "biggest_win_refuter_note": "one parse per batch alone is x1.2-1.5 on CSV badges in a shrink frame (zz-s7r/varcsv7r.mjs); the 8 s badge freeze needs the yield or the worker, plus S7-P3-1's shaping memo for total time. S7-P2-3 is the cheapest fix: two loops, output-identical",
  "biggest_win": "S7-P2-1: render a variable array's records with one font parse and yield between copies (or in the text worker): 100 copies from a 2 s / 8 s freeze to well under 1 s with working Cancel. For per-render cost, S7-P3-1's memoized line shaping is identical and 3.5-5.7x faster on every shrink-frame route, including N4-P3-2"
}
```
