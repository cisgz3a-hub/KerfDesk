# T25 Multi-File Trace — refuter report
Tree: origin/main @ 1988481a5 (read-only). Scratch: `C:\Users\stolk\kd-t1\zz-t25r`.

## Verdicts

| Claim | Verdict | Why |
|---|---|---|
| T25-P2-1 Trace Image's Trace silently does nothing while a batch runs | **CONFIRMED, P2** (and the scope is wider than reported) | Reproduced on the worker path that the shipped app uses. The auditor's t25c ran the no-Worker inline path. The dialog is reachable, nothing disables Trace, and pressing again never wins: 8 of 8 presses were lost. The window is the whole batch, gaps between files included, not one file's trace. Repeated presses also cost the batch a file. It is a refusal that should not happen, with no message, so it is P2 under AREAS.md. |

### Answers to the brief's questions
- **Is the dialog reachable during a batch?** Yes. `MultiFileTraceDialog.tsx:269-270` closes the batch dialog and then starts the run. The progress panel is non-modal: it is a `role="status"` section, `MultiFileTraceProgress.tsx:1-2,61-79`, and ADR-431 Amd item 3 says "non-modal". `isMultiFileTraceRunning()` is read only by the batch dialog (`MultiFileTraceDialog.tsx:298,305`) to refuse a second batch. No Trace Image command or dialog checks it, so Tools → Trace Image stays enabled.
- **How long is the window?** It covers the whole batch, not one file:
  - Scenario D: Trace was pressed in the gap after file 1 was written, while file 2 was decoding. The dialog's request reached a free worker. The batch's next file trace then superseded it 16 ms later.
  - The dialog only wins if its whole trace fits inside a decode/write gap.
  - Real tracer timing for a photo-like image under Line Art: 1000×750 (preview grid) took 3.8 s, and 2744×2058 (the finer grid the batch plans for a 3000×2250 px file at the default density) took 11.6 s (`t25r-time.log`).
  - So the dialog is blocked for about 12 s per file × N files, which is minutes for a typical batch.
- **Does a press after the batch work?** Yes (scenario E): the trace came back and the commit spoke (the toast). So it is a delay with no work lost. But the user is never told to wait, and a press made in the meantime harms the batch (below).
- **Does an ADR accept the shared worker as a limitation?** Only from the batch's side. ADR-431 Amendment (2026-09-27) item 1 records that the batch shares the one worker and that a Trace Image preview supersedes it. It designs the retry so that "ordinary editor use cannot end the batch". Neither it nor WORKFLOW F-A9c says the Trace Image preview or commit may be starved for the batch's duration. The retry module's header (`multi-file-trace-retry.ts:1-5`) frames the case the same way. This is not an accepted limitation.
- **P2 or P3?** P2. It is a refusal that should not happen, with no message, and the AREAS P2 row names exactly that. "No work lost" does not lower it: the user has no way to learn that waiting is the fix, retrying makes it worse, and the batch pays for the retries (next section and T25R-P2-1).

## Evidence

My own method differs from the auditor's in three ways:
- I used a fake `Worker` installed on `globalThis` at the postMessage level. It sends the `started` ack after a startup delay, answers `ok` after a cost that depends on the image, and `terminate()` kills its timers.
- Everything above that transport is real:
  - `use-trace-worker-client` (epochs, `rejectAllPendingAndRetireWorker`, worker retirement)
  - `retrySupersededTrace`
  - `runMultiFileTrace` and `traceImagesToVectorFiles` (real finer-grid planning with the preview-grid fallback, the real SVG writer, the real notice text)
  - the real `commit` exported from `ImportImageDialog.tsx`
- Only the commit's resolver is replaced. The replacement waits a decode delay, calls the real `traceImageWithBoundaryMode` on a 601×450 image, and returns the result with no paths. A trace that came back is therefore visible as the commit's own "produced no paths" warning toast. A superseded commit is visible as nothing.

Files:
- Script: `C:\Users\stolk\kd-t1\zz-t25r\t25r.test.ts`, log `t25r.log`, config `vitest.config.mts`.
- Timing: `t25r-time.test.ts`, log `t25r-time.log`.
- Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t25r/vitest.config.mts --maxWorkers=1 C:/Users/stolk/kd-t1/zz-t25r/t25r.test.ts`. Result: 5 passed. Free memory was 3.28 GB.

| Scenario (3-file batch, 3000×2250 px files) | Result (t25r.log) |
|---|---|
| A: one press during file 1 | Dialog request 2 → batch retry request 3 issued 0–1 ms later on a fresh worker. Press settled with toasts `[]` and closed false. The batch wrote all 3 files. |
| B: press again each time the last press settles (8 presses) | **No press ever got a toast.** Presses 1–2 used up the batch's 2 retries on the 2744 px grid. Press 3 made the batch throw "kept interrupting" and go to the preview-grid fallback, whose decode plus trace superseded the dialog again. Presses 4–6 did the same on the fallback grid, and b1.png was skipped. Presses 7–8 were superseded by file 2. The batch wrote b2 and b3 only, with the warning "Could not trace 1 image (b1.png: Another trace (such as a Trace Image preview) kept interrupting this file.); it was skipped." |
| C: dialog opens (preview trace), then two presses | The preview was dropped (`TraceRequestSupersededError`, which `use-trace-preview.ts:161` swallows, so the preview stays unfinished). Both presses were silent. b1.png was **written at 1000×750 instead of 2744×2058** with the toast "This device could not trace the image at full resolution, so the trace uses the preview resolution." See T25R-P2-1. |
| D: press in the gap after file 1 was written | The dialog request reached the free worker at 367 ms. The batch's file-2 trace superseded it at 383 ms, and the press was silent. |
| E: press after the batch finished | The trace came back. The commit pushed its toast "Tracing photo.png produced no paths — try a higher contrast image." (the planted empty result). |

Every supersession also retires the worker and builds a new one: 26 fake workers were created over the run. That matches the documented TR-020 design and is not raised.

## Extra findings

### T25R-P2-1: A batch file interrupted by Trace Image is written at preview resolution with a notice that blames the device and does not name the file
- **Severity:** P2. This is a wrong (coarser) result with a misleading warning that does not name the file. It contradicts ADR-431 Amd item 1, which says a file still interrupted after two retries "becomes a `trace-failed` skip ('Another trace … kept interrupting this file.')". Ordinary editor use triggers it: opening Trace Image (its preview) plus two presses or slider changes during one large file.
- **Where:**
  - `src/ui/commands/multi-file-trace-retry.ts:34` throws a plain `Error(INTERRUPTED_TRACE_MESSAGE)`.
  - `src/ui/commands/multi-file-trace-action.ts:160-161,172-174`: `recoverable` is true for that error, so `canFallBack` lets `traceJob` (`src/core/trace/batch-trace.ts:281-285`) run the file's preview-grid fallback with a fresh retry budget.
  - `onFallback` adds `'preview-resolution'`.
  - `src/ui/trace/trace-notices.ts:6-7` words that notice as a device limit.
  - `multi-file-trace-report.ts:61` prints the notice set once for the whole batch, with no file name.
  - The file is only skipped after a second round of 3 interruptions (scenario B).
- **Repro:** `zz-t25r\t25r.test.ts` scenario C (log section "== C").
  - Actual: b1.png planned at a 2744 px edge was written from the 1000×750 grid. The batch toast says "This device could not trace the image at full resolution, so the trace uses the preview resolution." in a batch of 3 and does not say which image.
  - Expected (ADR-431 Amd item 1): either b1.png is skipped with the "kept interrupting" reason, or it is retraced at full resolution, and any downgrade names the file and its real cause.
- **Oracle:** ADR-431 Amendment item 1 text. The plan's own 2744 px grid (`planTraceCommitGridFor`, logged `maxEdge 2744`). For a 3000 px file at the default 254 DPI (300 mm wide), 1000 px is 3.3 px/mm against the planned 9.1 px/mm.
- **Suggested fix:** Exclude the interrupted error from `canFallBack`, or better, have the batch yield to a foreground trace and retry after it (this also fixes T25-P2-1). Key batch trace notices by file, as skips already are.

## Totals
- T25-P2-1: CONFIRMED, P2. The scope is wider than reported: the whole batch is affected, no number of presses wins, and presses cost the batch a file.
- Extra findings: 1 raised, P2 1 (T25R-P2-1). P1 0, P3 0. Known 0: earlier ledgers have no Multi-File preview-resolution or interruption entry.
