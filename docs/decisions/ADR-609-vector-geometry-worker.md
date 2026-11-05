## ADR-609 - Offset, Combine, Weld and Cut Shapes compute in a vector geometry worker

**Status:** Accepted; measured in Node on the maintainer's PC, browser and packaged-desktop qualification pending. | **Date:** 2026-10-18

### Context

Imports, tracing, job preparation, Preview, estimates and autosave already run in workers
(ADR-244, ADR-268, ADR-269, ADR-288, ADR-346). The vector editing commands did not. Offset
Shapes, Combine Shapes (subtract, intersect, exclude, weld), Offset outlines and Cut Shapes
called clipper on the UI thread. The two dialogs recomputed their preview on every edit, and
Apply then ran the same work a second time.

The cost grows with the artwork, and traced artwork is large. The checked-in dragon fixture
(`src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png`, default trace,
scaled to about 125 mm: 9,092 closed contours, 122,862 vertices) measured, as the median of
three runs of the exact core calls the UI makes:

| Operation (UI thread before this decision) | Median |
| --- | ---: |
| Offset Shapes preview, 0.5 mm both ways, corner | 7.0 s |
| Offset outlines (`offsetVectorObjects`), 1 mm | 6.2 s |
| Offset Shapes preview, 1 mm outward, round | 5.8 s |
| Cut Shapes | 0.77 s |
| Weld | 0.65 s |
| Combine preview: subtract / intersect / exclude | 0.60 / 0.56 / 0.55 s |

These were measured in Node 25 (V8, the same synchronous code) on the maintainer's PC. An
earlier run while other work loaded that PC took six to seven times as long (39 s for the 1 mm
offset) and ranked the operations the same way. During each of these the canvas, panels,
menus and typing were frozen, and an open dialog froze again on every edit and on Apply.

### Decision

1. **One vector geometry worker serves these commands.** `src/ui/commands/vector-op-worker.ts`
   runs five tasks, each the exact core call its action makes: `offsetShapes`,
   `combineVectorObjects`, `weldVectorObjects`, `offsetVectorObjects` and `planCutShapes`. Each
   task carries the result ids the action will use, so a result can be committed unchanged.
2. **Dialogs preview in the background and Apply commits the settled result.** Offset Shapes
   and Combine Shapes keep the last settled preview on screen, marked "Updating preview…", until
   the current request settles. If it settles with a problem, the older preview is cleared, so
   the dialog never shows geometry its status no longer describes. Apply is enabled only for the current request's result and
   passes it to the action. The action commits it only when its inputs are still exactly the
   action's own: the same source objects by identity and in order, the same options, and
   result ids the scene would still give. That last test is `objectIdStillFree`: the numbered
   id `uniqueObjectId` would return, or, once its 1,000 numbered ids run out, any unused random
   one. Without it, a fresh random id would never match and the action would rerun the work. A
   weld or cut plan also needs the identical scene. The core calls are pure, so that result is
   the one the action would compute. Any mismatch computes in thread, as before.
3. **Weld splits at the union.** `planWeldSelection` becomes `prepareWeldSelection` (operation
   buckets and cloned layers, cheap, on the UI thread), then the union in the worker, then
   `finishWeldSelection`. `planWeldSelection` is that composition, so its output is unchanged.
4. **One-click commands run in the background too.** Offset outlines and Cut Shapes post their
   selection. They show "working…" after 400 ms, refreshed until the work settles so the notice
   outlives the toast timeout. They commit through the ordinary action, as one undo step, when
   the result arrives. If the project or selection changed in the meantime, nothing is applied
   and a notice says why. A selection the action refuses outright (nothing eligible, locked, a
   live compound, too few shapes) goes straight to the action, which explains at once. The two
   commands share one slot. A newer click of either, refused or not, terminates the running one
   and says so when it was the other command. So at most one background result is ever
   committing, and two commits cannot both ask for Pro admission, which holds a single pending
   request. If any Pro prompt is open when a result arrives (another tool's edit is waiting on
   it), the result is not committed and a notice asks for the command to be run again; committing
   would replace or invalidate that waiting edit. The edition provider exposes the open prompt as
   a read-only `proPromptOpen`, including the prompt in Free-only builds, which gates nothing.
   The all-features licence information notice holds no pending edit and does not count as a
   tool prompt. A geometry error reports its specific warning without committing, even while a
   tool prompt is open, after confirming that its project and selection still match the request.
5. **Newer work cancels older work.** Clipper cannot be interrupted, and these runs last
   seconds to minutes. A newer request therefore terminates a busy worker and starts at once in
   a fresh one, instead of queuing behind work whose answer is no longer wanted. This differs
   from the box and kerf workers, which drop stale replies by id because their work is short.
   An idle worker is reused. Closing a dialog terminates its worker, and a one-click command's
   worker is released once it settles.
6. **Geometry crosses as packed buffers both ways.** The selection is sent with the ADR-346
   packing (one transferred buffer, below 5,000 points a plain clone). A dialog posts it once per
   worker, and later edits post only their options. Results return as packed polylines that the
   UI thread rebuilds with the core's exact key order (`{closed, points}` and `{x, y}`). The
   worker packs a path only after verifying that shape; any other path travels as a plain
   clone. A committed result is therefore byte-identical to the in-thread one, including the
   bytes a saved project writes.
7. **No silent fallback onto the UI thread.** Only SSR and Vitest, which have no Worker, compute
   in process. Two failures are told apart. If the worker cannot start, or cannot be handed the
   work, it is `unavailable`. The preview says so, and Apply or the one-click command computes
   in thread, as it did before this decision. The operator chose that action. If the work started
   and then failed (a thrown error, a crashed worker, an unreadable reply), it is `failed`. The
   message is shown, Apply stays disabled, and nothing reruns the work on the UI thread, where
   it would fail again and freeze the window while doing so. Every failure retires the worker,
   so a later request never reaches a worker whose selection the client no longer knows. A
   failure belongs to the exact sources and task that met it, like a settled result.
8. **Desktop.** The worker is a same-origin Vite module worker
   (`new Worker(new URL(...), { type: 'module' })`). The renderer CSP (`worker-src 'self' data:
   blob:`, `script-src 'self' 'wasm-unsafe-eval'`) already admits it, and the desktop build
   bundles it like the other module workers. No CSP or Electron change is made.

No G-code, toolpath, Frame, Start, machine output or licence behaviour changes. Pro admission
still runs inside the same actions.

### Consequences

The UI thread now does only these parts of each operation, for the same fixture:

| Operation | Before | After, first run | After, each later dialog edit | Apply, before / after |
| --- | ---: | ---: | ---: | ---: |
| Offset Shapes, 1 mm outward, round | 5,818 ms | 3.6 ms | 0.2 ms | 5,818 ms / 0 ms |
| Combine Shapes, subtract | 600 ms | 5.6 ms | 2.6 ms | 600 ms / 0 ms |
| Combine Shapes, weld | 652 ms | 9.2 ms | 6.9 ms | 652 ms / 0 ms |
| Offset outlines, 1 mm | 6,196 ms | 2.5 ms | (one click) | (one click) |
| Cut Shapes | 771 ms | 6.2 ms | (one click) | (one click) |

"After, first run" adds packing the selection (2.2 to 3.4 ms), weld's bookkeeping (0.2 ms) and
rebuilding the result from the reply. The rebuild is an upper bound: the benchmark copies the
reply's buffers, which a real reply transfers. "Apply, after" is the geometry work left before
the ordinary commit, which reuses the settled result (for weld, the whole settled plan). Both
columns were measured the same way, in Node on the same PC.

What remains on the UI thread scales with the size of the selection and of the result, not with
clipper's work.

Other vector commands (Optimize Shapes, which already time-slices, Trim and Extend, Dogbone,
path cleanup, text shaping) still run in thread. Text rendering costs about 16 to 58 ms per
debounced edit, mostly opentype.js parsing the font each time. It is the next candidate.

### Verification

- `src/ui/commands/vector-op-worker-runtime.test.ts` sends each task through the full worker
  round trip without a Worker. The selection is packed and cloned with transfer, the task runs,
  and the reply is packed, cloned and decoded. The result must equal the direct core call both
  by `toStrictEqual` and by `JSON.stringify`, which pins key order. Coverage: four Offset
  Shapes variants, two Offset outlines distances, subtract, intersect, exclude, weld, Cut
  Shapes and their refusals. The fixtures exceed the packing threshold and include exact curve
  twins, an even-odd hole, a mirrored and rotated transform, power scale and an operation
  override.
- `src/ui/state/vector-op-prepared.test.ts` commits worker results through the real store
  actions. The resulting project JSON must equal the JSON of the in-thread action. Results for
  other options, sources or scenes must be recomputed.
- `src/ui/state/vector-op-prepared.test.ts` also checks `objectIdStillFree`, including reuse of a
  random id once the numbered ids run out.
- `src/ui/commands/vector-op-worker-client.test.ts` covers the selection being posted once,
  supersede terminating the busy worker, and stale ids. It also covers release, failed replies
  and worker errors retiring the worker, and an unpostable request reported as unavailable.
  `src/ui/commands/use-vector-op-preview.test.tsx` keys failures and results to their own
  request.
- `src/ui/commands/vector-background-commands.test.ts` and `background-vector-command.test.ts`
  cover the one-click commands: a selection changed mid-run, refusals cancelling a running
  command, one command cancelling the other, failures not retried in thread, and the notice
  lasting until the work settles.
- The existing dialog, action, weld-plan and cut suites pass unchanged in behaviour.

### Amendment 1 - a worker that never loads, a replaced click, and Free builds' notices (2026-10-20)

An audit of the merged work found three gaps.

1. **A worker whose script never loads is `unavailable`.** A module worker whose script cannot be
   fetched or evaluated still constructs, and reports that only later through `onerror`: a tab
   left open across a deploy asks for a hashed chunk that is gone, a CSP blocks it, or the
   browser cannot run module workers. Decision 7 called every `onerror` `failed`, so Offset Shapes
   and Combine Shapes kept Apply disabled (changing the settings only spawned another worker that
   failed the same way), and Offset outlines and Cut Shapes only showed an error. The worker now
   posts `ready` once its script has run, and the client counts an `onerror` before that as
   `unavailable`, which takes decision 7's documented path: the preview says so, and Apply or the
   one-click command computes in thread. An `onerror` after `ready` is still `failed`. Each fresh
   worker must announce itself again.
2. **A newer click of the same command says that it replaced the running one.** Decision 4 named
   the cancelled command only when the newer click was the other command. Outward copy and Inward
   copy are both Offset outlines, so clicking one while the other ran dropped the first copy
   without a word. The notice now appears whenever the newer click asks for different work ("The
   earlier Offset outlines was cancelled: a newer one started."), including a click the action
   refuses. A repeat of exactly the same work (the same task, compared by value) still replaces it
   silently, since its result is the one the first would have given.
3. **Only a prompt that keeps an edit counts as an open Pro prompt.** Decision 4 counted the
   per-tool "Pro is in the desktop app" notice of a Free-only build (and of a desktop build that
   runs Free) as an open prompt. That notice keeps no edit, since nothing there can unlock Pro, so
   a finished Cut Shapes or Offset outlines was thrown away for nothing. `proPromptOpen` is now
   true only while a licensed build's Pro prompt holds the tool's edit. No Pro gate changes:
   `proPromptOpen` stays read-only and gates nothing.

Verification: `vector-op-worker-client.test.ts` reports an `onerror` before `ready` as
`unavailable` and after it as `failed`, and a replacement worker must announce itself again;
`vector-op-worker-entry.test.ts` checks that the worker posts `ready` on load;
`background-vector-command.test.ts` covers Outward copy then Inward copy, an identical repeat and a
refused click; `FreeOnlyEdition.test.tsx` keeps `proPromptOpen` false while a Free build explains
a Pro tool, and `EditionProvider.test.tsx` still reports the licensed prompt.

### Amendment 2 - Weld's absorbed-shapes check runs in the worker (2026-11-05)

Performance audit S1, area S6, found S6-P2-1 (`docs/audits/2026-11-02-performance-s1/S6-geometry-commands.md`).
`describeWeldChange` came in two days after this decision (`310cb363a`, 2026-10-20). It finds the
shapes Weld absorbs, for the Combine Shapes dialog's warning, and it ran on the UI thread when the
worker's union arrived. For each candidate it runs one clipper difference per neighbouring shape,
so the work that stayed on the UI thread scaled with clipper's work, against the Consequences above.
A plate under 1,999 overlapping circles froze the window for 5.2-6.0 s after the worker had
finished, with "Updating preview…" and Cancel frozen. A scalloped plaque of 1,000 circles froze it
for about 1.2 s.

1. **A `weld-review` task.** The dialog posts the operands, rebound to their weld operations,
   followed by the selected objects they came from, and `operandCount`. The worker welds the
   operands with `weldVectorObjects`, then runs `describeWeldChange` against the selection, the
   same two calls with the same inputs the dialog made, and replies with the union and the change.
   The warning, the "Nothing to weld" refusal and Apply's enable state are therefore identical by
   construction. `describeWeldChange` itself is unchanged.
2. **The dialog no longer calls clipper after the reply.** It reads `changed` and `absorbedIds` from
   the reply. Apply still commits the settled union through `finishWeldSelection`, so the weld,
   the project and the G-code are unchanged. The plain `weld` task stays for other callers.
3. **What it costs.** The selection crosses the boundary twice (operands and sources), which adds
   one more packing pass on opening. The check now runs before the reply, so the result appears
   once the worker has done both. The window stays live and Cancel terminates the worker
   (decision 5). A single-difference rewrite of the check (one `differenceD` per candidate against
   all covering pieces) measured 5.3-6.1 s → 0.34-0.38 s in the audit's prototype, but it named
   the other one of two identical shapes in 1 of 3,600 random scenes, so it is left for a separate
   decision.

Measured on the maintainer's PC in Chrome against the Vite dev build (unminified React, so larger
than production), the same spec on both trees, a plate under the circles:

| Weld of | main: longest UI task | after: longest UI task | warning text |
| --- | ---: | ---: | --- |
| plate + 999 circles | 8,927 ms | 134 ms | identical (4,684 characters) |
| plate + 1,999 circles | 40,134 ms | 181 ms | identical (10,501 characters) |

The remaining tasks are opening the dialog (packing and preparing) and receiving the reply.

Verification: `vector-op-worker-runtime.test.ts` sends `weld-review` through the full worker round
trip for the parity fixture with an absorbed shape and for a scalloped plate, with operands from
the real `prepareWeldSelection`, and requires the in-thread `weldVectorObjects` plus
`describeWeldChange` result by `toStrictEqual` and `JSON.stringify`; a reply without its change is
refused. `BooleanDialogHost.weld-worker.test.tsx` runs the dialog against a fake Worker and records
every `describeWeldChange` call: none happens before the worker's reply, the one call happens inside
the worker's handler, the warning names the absorbed shape, and Apply's project equals the
in-thread Weld's. The existing dialog and `vector-path-weld-change` suites pass unchanged.
