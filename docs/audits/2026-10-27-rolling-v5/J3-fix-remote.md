# Rolling audit v5 — Remote fixes

- **When:** 2026-10-27   **Tree:** origin/main @ `d2acacdbe` (#1473).
  - The repros ran from the audit worktree's `src` at `19a05d355`.
  - `git diff --name-only 19a05d355 d2acacdbe -- src electron services` lists only bit-file, recovery, G-code Inspector, camera and `src/ui/state` files from #1472/#1473.
  - None of them is on a path the repros load: `src/ui/remote-control`, `src/io/svg`, `src/io/dxf`, `src/ui/import`, the SVG/DXF import actions, board capture, JogPad/`jog-hold-aim`, `electron/mcp` and `services/remote-control`.
  - In `laser-store-helpers.ts` only `toolChangeXyOriginBlockMessage` changed. The board gate's `jogFrameCommandBlockMessage` did not.
- **Scope:** the three remote fix PRs on main.
  - **#1460** (`d5bd5fbf8`): board capture keeps the PC Capture gate. ADR-654 Amd 1.
  - **#1465** (`eaa4bb015`): remote DXF in the import worker, plus a block expansion budget. ADR-269 Amd 1.
  - **#1470** (`7a459ef2d`): remote import notices and bed fit, remote bit change, phone hold aim. ADR-125 Amd 2, ADR-306 Amd 4, ADR-375 Amd 8.
  - The same remote/MCP entry points re-diffed against the desktop, building on the H8 table.
  - Files: `src/ui/remote-control/**`, `src/ui/laser/board-capture/**`, `src/ui/laser/jog-hold-aim.ts`, `src/io/dxf/dxf-expan*.ts`, `src/io/svg/svg-use-expansion.ts`, `electron/mcp/*-schemas.ts`, `services/remote-control/src/{relay,device}.ts` and the phone `import-sheet.tsx`.
- **Lenses run:**
  - L10 on each fix: repro, siblings, regressions, ADR text and test truth.
  - L9 entry-point parity: the table below.
  - L5 on remote import input.
  - L2 was not needed: no firmware claim is new here.
  - No hardware, relay, phone or production service was used.
- **Counts:** 7 raised → 0 refuted → P1 2 / P2 2 / P3 3 (+9 KNOWN carried).
  - Refuter (2026-10-27, `origin/main` @ `0db717973`): 7 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. One severity change: J3-P2-3 is raised from P2 to P1 (§3). The ID is kept so the ledger can trace it.
  - The refuter's repros ran from this worktree's `src` (`a454a10d9`). `git diff HEAD origin/main` is empty for `src/ui/remote-control`, `src/io`, `src/ui/import`, `electron/mcp`, `services` and `src/ui/laser/jog-hold-aim.ts`. Six temporary `zz-j3r-*` files were run one at a time with the command below and then deleted.
- **Repro:** four temporary files, run one at a time with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=1536" node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose` (`--expose-gc` added for the heap run). All were deleted afterwards.
  - `src/ui/remote-control/zz-j3-svg-stall.test.ts`: the real adapter's `add_svg` and `apply_edits`, with a 5 ms `setInterval` and a `setTimeout(0)` probe.
  - `src/io/dxf/zz-j3-dxf-budget.test.ts`: the real `parseDxf`.
  - `src/ui/remote-control/zz-j3-bit-batch.test.ts`: the real adapter, plus the current and the pre-#1470 MCP output schemas.
  - `electron/mcp/zz-j3-old-design-schemas.ts`: `git show 7a459ef2d^:electron/mcp/design-schemas.ts`.
  - The fixes' own tests were also run and pass on this code:
    - `machine-board-panel.test.tsx` (3);
    - `machine-hold-travel.test.tsx` (6);
    - `import-dxf-worker.test.ts` (4);
    - `src/ui/laser/JogPad.native-travel.test.tsx` (5).
  - SVG timings are under jsdom. The point-heavy cost is JavaScript path work and memory, not DOM work.

## Headline

All three fixes hold on the paths they patched. These hold:

- A remote board capture is refused while the PC's Capture is disabled, and records only from a fresh Idle report.
- Remote DXF parses in the import worker and is cancelled with its request.
- Remote imports now report the bed fit and the notices.
- A single remote bit change follows the Artwork card.
- The phone XY hold stops where the PC's does.

**One sibling is a security issue (J3-P1-1, SECURITY — hold details until fixed).** #1465 moved only DXF off the UI thread. Remote **SVG** (`add_svg`, `import_file` SVG, `apply_edits` `add_svg`) still runs `parseSvg` synchronously in the renderer:

- A 1,079-character `add_svg` froze the event loop for 2.1 s, with 0 timer ticks.
- One `apply_edits` stacks 40 such parses.
- The SVG `<use>` budget counts elements, not points (J3-P2-1). So a 3.6 KB SVG passes it with 3×10^7 points, which is enough to run the renderer out of memory.

The other gaps are smaller:

- An `apply_edits` bit change drops the kept-values message (J3-P2-2).
- The phone still says only "Imported." after art is scaled (J3-P2-3). The refuter rates this P1: it is the phone half of H8-P1-2, and no warning reaches a phone operator.
- The DXF budget counts nested copies twice (J3-P3-1).
- The new receipt fields need a relay redeploy (J3-P3-2).
- The phone Z hold ignores the withheld MPos the XY hold uses (J3-P3-3).

## Findings

### J3-P1-1 — SECURITY — hold details until fixed: remote SVG import still parses on the renderer's UI thread, uncancellable, so an edit-only client can freeze every PC software stop with about 1 KB (the H8-P1-1 sibling #1465 did not move)

- **Security hold lifted 2026-10-28:** fixed by #1481 (ADR-269 Amd 3), which moved remote SVG import to the cancellable document import worker and made the `<use>` budget count points. The details below were withheld from the committed report until then.

- **Where:**
  - `src/ui/remote-control/design-imports.ts:44-51`: `prepareSvgImport` calls `parseSvg({ svgText, … })` synchronously. `signal.throwIfAborted()` (`:51`) runs only after the parse.
  - Reached from three places:
    - `addSvg` (`:196-210`);
    - `importFile` for `image/svg+xml` (`:246-255`);
    - `apply_edits`, through `prepareItem` (`src/ui/remote-control/design-batch.ts:66-80`). The loop at `:56` prepares up to 40 items back to back. For a non-fragment result `prepareSvgImport` awaits nothing, so no task runs between items.
  - Desktop twin: `src/ui/app/svg-import-action.ts:85-101`. File > Import parses with `parseSvgOffThread` in the document import worker, and Escape cancels it. The main-thread parse is only the disclosed fallback when no worker can start.
  - #1465 changed only the DXF branch (`design-imports.ts:256-285`, `parseDxfInWorker`). Its ADR scopes the premise to DXF: "Every DXF import route, desktop and remote, parses in the import worker" (ADR-269 Amd 1 Consequences).
  - Reach:
    - `add_svg`, `import_file` and `apply_edits` are edit-tier MCP commands (`electron/mcp/input-schemas.ts` `MCP_WRITE_COMMANDS`).
    - The phone Import sheet sends SVG through `import_file`.
    - Design writes are not refused during a job (H8-P1-1 refuter: `assertCurrent` checks `canWrite`, `canEdit` and the revision only).
- **Anchor:**
  - Contract: PROJECT.md:465, non-negotiable 9. The software Abort "is reachable from any window state during a job".
  - Contract: ADR-269 item 7 (`DECISIONS.md:14211-14219`): "Document routes move off the UI thread". File-backed SVG runs in the worker, and the main-thread parse is only the "disclosed main-thread fallback".
  - Twin: `svg-import-action.ts:92-98` (worker, cancellable) against `design-imports.ts:50` (UI thread).
  - ADR-584's table (`docs/decisions/ADR-584-full-remote-design-control.md:17`) names `parseSvg` for `add_svg`, so the remote route follows ADR-584 and breaks NN9 and ADR-269 item 7. This is exactly the position H8-P1-1's DXF route was in.
  - Trust boundary: as H8-P1-1. An edit-approved principal, or an MCP agent carrying an untrusted SVG, gets an effect on machine control.
- **Scenario:**
  1. A job is streaming on the PC.
  2. A paired client with edit approval sends `add_svg` with a 1,079-character SVG. It holds a two-point path and four levels of ten `<use>` of `<use>`.
  3. The renderer walks 10^5 instances, 222,210 instantiated elements, under the ADR-268 Amd 1 budget of 250,000. It does this on its UI thread.
  4. No timer, input or serial callback runs meanwhile. The PC ABORT, Ctrl+. and a remote `abort_job` wait behind it.
  5. On the default worker transport the job keeps running with every software stop frozen. On the window transport the stream starves (the H8-P1-1 refuter's split).
  6. One `apply_edits` with 40 such items (about 45 KB) stacks 40 parses into one stall.
  7. With a 300-point base path (3,563 characters) the same chain is 3×10^7 points. Because of J3-P2-1 the budget does not see it. At the measured cost, that is tens of seconds of stall and about 5 GB retained, which ends in a renderer OOM: no result, unsaved edits since the last autosave lost.
- **Evidence:** REPRO (`zz-j3-svg-stall.test.ts`, real adapter).
  - `J3-E {"svgChars":1079,"instances":100000,"instantiatedElements":222210,"code":"ok","totalMs":2056,"ticks":0,"longestStallMs":2056,"timeoutRanBeforeSettle":false,"polylines":100000,"points":200000}`
  - `J3-A` (10^3 / 10^4 instances): 38 ms / 136 ms, `ticks:0`, `timeoutRanBeforeSettle:false`.
  - `J3-C`, `apply_edits` with 4 `add_svg` items: `{"items":4,"code":"ok","totalMs":73,"ticks":0,"timeoutRanBeforeSettle":false,"polylines":4000}`. The stall is one block, with no task between items.
  - `J3-D`, the point cost:
    - `{"instances":1000,"points":300000,"totalMs":276,"ticks":0,"usPerPoint":0.92,"retainedBytesPerPoint":176}`
    - `{"instances":2744,"points":823200,"totalMs":470,"ticks":0,"usPerPoint":0.571,"retainedBytesPerPoint":171}`
  - The 3×10^7-point variant was not run (memory). Its scale comes from the measured 0.57–0.92 µs and about 171–176 B per point. The extrapolation method is the H8-P1-1 refuter's.
  - Shipped: `prepareSvgImport` arrived with #1156 (`22868ee92`), an ancestor of the 1.0.21 release `faf5a54f1`.
- **Severity:** P1 under §3, "shipped, remotely reachable security hole", on the same reasoning that made H8-P1-1 P1. The payload is smaller here (1 KB against 320 characters of base64), and the route is the one #1465 left.
- **Novelty:** not KNOWN.
  - H8-P1-1 and ADR-269 Amd 1 are DXF only.
  - `14-vector-importers.md:344` checked a 20^4 `<use>` bomb with two-point paths on the import routes, not the remote UI-thread route.
  - No open PR touches `design-imports.ts`.
- **Refuter:** CONFIRMED. P1 kept, under §3 "shipped, remotely reachable security hole", as for H8-P1-1.
  - *What would make it false:*
    - a worker or a yield in the remote SVG parse;
    - a size or `<use>` gate that stops the 1 KB chain before the walk;
    - a permission above edit, or a job check on design writes;
    - a stop path outside the renderer;
    - a prior report.
  - *REPRO* (`src/ui/remote-control/zz-j3r-svg-stall.test.ts`, real adapter, jsdom, deleted):
    - **The stall.** `add_svg` of a 1,074-character chain (a two-point path, four levels of ten `<use>`, ten at the top) returned `{"code":"ok","totalMs":1290,"ticks":0,"timeoutRan":false,"points":200000}`. At 10^3 and 10^4 instances it took 46 and 165 ms, also with 0 ticks. The auditor measured 2,056 ms on a differently loaded PC. Both runs block the whole call.
    - **The request's own cancel.** An `abort()` was scheduled 5 ms into a 10^4-instance `add_svg`. It ran only after the call settled. The result was `ok` and the art was inserted, so cancelling the request cannot interrupt the parse.
    - **Batches.** `apply_edits` with four `add_svg` items of 10^4 instances returned `{"code":"ok","totalMs":751,"ticks":0}`. That is one block, with no task between the items.
    - **The budget's reach.** A two-point chain past the budget (3×10^5 instances, 1,414 characters) is refused, but only after the walk reaches 250,000 elements: 1.85 s on the same thread. So a refused item still stalls. The element budget limits one two-point item to about 1–2 s, and `apply_edits` multiplies that by up to 40. J3-P2-1 lifts even that limit.
  - *Guards read:*
    - **Sizes.** `add_svg` is capped at 180,000 characters and `import_file` at 240,000 base64 characters (`electron/mcp/design-schemas.ts:32-33,142,177-195`); the phone caps its file at 178,000 bytes (`import-sheet.tsx:13`). `apply_edits` takes at most 40 items. None of these limits instances or points before the parse.
    - **Permission.** The three commands are in `MCP_WRITE_COMMANDS` (`electron/mcp/input-schemas.ts:122-145`), so they need edit scope.
    - **Job state.** `assertCurrent` (`adapter.ts:288-295`) checks only disposal or abort, `canWrite`, `canEdit` and the revision. `canEdit` is `pendingUndo === null` (`src/ui/remote-access/renderer-session.ts:127`). There is no job check.
    - **Shipped.** `parseSvg(` is at `design-imports.ts:33` in the 1.0.21 tree (`faf5a54f1`). It arrived with #1156 (`22868ee92`), an ancestor of that release.
  - *The desktop twin is off the UI thread.* File > Import passes the Blob to `parseSvgOffThread` (`svg-import-action.ts:92-98`). Its main-thread `parseSvg` runs only for a Blob-less file, or as the fallback when no worker starts, and that fallback shows a toast. The other UI-thread callers, `library-entry-insert.ts:15` and the `page-artwork-object.ts:32` fallback, are local actions. So the remote reach is what makes this P1.
  - *Abort is blocked while the job runs.* ADR-354's Consequences: "The renderer can stop processing tasks without stopping an armed worker's acknowledgement and refill loop. UI updates and new operator actions still require the renderer."
    - So on the default GRBL-family USB worker the job keeps running. ABORT, Ctrl+. and a remote `abort_job` wait behind the parse; the H8-P1-1 refuter's split holds.
    - The main process has no stop path of its own. Its close dialog for an unresponsive renderer says "Software Abort and saving cannot be confirmed" (`electron/desktop-window-close.ts:99`).
  - *Anchor correction.* ADR-269 item 7 (`DECISIONS.md:14211-14219`) names only "File-backed SVG". `add_svg` carries text, so item 7 is at most a partial anchor; it fits `import_file`, which decodes a file. NN9 (`PROJECT.md:465`) and the File > Import twin carry the finding. ADR-269 Amd 1 covers DXF only ("Every DXF import route…"), so its premise does not extend to SVG; this confirms the novelty rather than refuting it.
  - *Not run.* The 40×10^5-instance batch and the 3×10^7-point case were not run (memory). Chromium's DOM may walk instances faster than jsdom does. The point cost, about 0.64 µs per point in J3-P2-1's repro, is JavaScript work.
  - *Novelty.* No other v5 report and no audit raises remote SVG on the UI thread; H8's table lists only the DXF worker for this row. `gh pr list --state open` shows no open PR that touches `design-imports.ts`, `design-batch.ts` or `svg-use-expansion.ts`; the only open PR, #1476, is unrelated.
- **Fix direction:** Route remote SVG through `parseSvgOffThread` on a Blob of the text, carrying the request signal, as #1465 did for DXF. Answer `unavailable` when no worker can start. Fix J3-P2-1 so the worker cannot be driven to OOM either.

### J3-P2-1 — The SVG `<use>` budget counts instantiated elements, not points; its DXF twin counts points, so a 3.6 KB SVG passes with 3×10^7 points

- **Security hold lifted 2026-10-28:** fixed by #1481 (ADR-269 Amd 3), which moved remote SVG import to the cancellable document import worker and made the `<use>` budget count points. The details below were withheld from the committed report until then.

- **Where:**
  - `src/io/svg/svg-use-expansion.ts:18-25,41-56`: `spendSvgUseElement` adds 1 per instantiated element (floor 250,000, or 10 per document element). The points a referenced `<path>` carries are not counted.
  - `src/io/svg/svg-import-budget.ts:10-15,42-56`: the polyline and point limits are advisory only.
  - Twin: `src/io/dxf/dxf-expand.ts:250-253` counts `grid.instanceCount * pointCount(child.polylines)`, the points placed, per ADR-269 Amd 1.
- **Anchor:**
  - Twin: ADR-269 Amd 1 item 2 (`docs/decisions/ADR-269-amendment-1-remote-dxf-worker-and-block-budget.md:31-35`): "every point that placing a block creates counts". It calls itself the twin of ADR-268 Amd 1: "the same number of copies as ADR-268 Amendment 1's floor" (:44-46).
  - Contract: ADR-268 Amd 1 item 1 (`docs/decisions/ADR-268-amendment-1-use-expansion-has-a-budget.md`) sizes the floor from "250,000 two-point paths instantiated through `<use>` in 2.1 s". Its Context says the growth "is not bounded by the input". With points uncounted, a fat referenced path keeps that growth unbounded: a 180,000-character file can instantiate a path of about 20,000 points about 200,000 times.
- **Scenario:**
  - A 3,563-character SVG holds a 300-point path and a chain of `<use>` four levels deep with ten at each level. That gives 10^5 instances, 222,210 counted elements (accepted) and 3×10^7 points.
  - On the desktop, File > Import runs it in the import worker until memory runs out, at about 5 GB retained at the measured 171–176 B per point.
  - Remotely it runs on the UI thread (J3-P1-1).
  - The only signal is the advisory "Large SVG" note, after the parse, if it ever finishes.
- **Evidence:** REPRO.
  - `J3-E`: the 10^5-instance chain is accepted (`"code":"ok"`, 222,210 counted elements, below 250,000).
  - `J3-B`: `{"instances":1000,"instantiatedElementsCounted":2210,"code":"ok","points":300000}`. The budget charged 2,210 elements for 300,000 points.
  - `J3-D`: about 0.6–0.9 µs and about 171–176 retained bytes per point.
- **Severity:** P2 for the desktop route. It needs a crafted local file. The worker share of the cost is off the UI thread, but whether a worker OOM also takes down the Electron renderer was not verified. Through the remote it is the amplifier of J3-P1-1.
- **Novelty:** not KNOWN. 14 checked the element budget with two-point paths, and a 400,000-segment path on its own (`14-vector-importers.md:344-345`), not the two together.
- **Refuter:** CONFIRMED. P2 kept, and kept as a finding separate from J3-P1-1.
  - *What would make it false:* a point count in the `<use>` budget, or anywhere else before the result is built; a point cap further down; or the defect being only the remote amplifier.
  - *READ:*
    - `spendSvgUseElement` adds 1 per element (`svg-use-expansion.ts:41-56`).
    - `svgImportSizeNote` is advisory (`svg-import-budget.ts:42-56`).
    - No point cap was found on the remote insert path.
  - *REPRO* (`zz-j3r-svg-stall.test.ts`):
    - **Remote.** A 1,928-character SVG (a 300-point path, three levels of ten `<use>`) through the real `add_svg` returned `{"code":"ok","totalMs":192,"ticks":0,"points":300000,"heapDeltaMB":67}`. That is about 0.64 µs and about 220 B per point, including the store.
    - **Desktop worker parser.** The worker's own parser (`parseSvgInWorker`, linkedom) was run on the same chain at 1,000 and 2,000 instances. It accepted 300,000 and 600,000 points, with only the "Large SVG" note.
    - **The 3×10^7 case.** The element budget accepts the 10^5-instance structure (J3-P1-1's repro, 1,074 characters). The element count does not depend on how many points the path has. So the same structure with a 300-point path, about 3.6 KB, carries 3×10^7 points.
  - *Desktop.* Escape cancels the worker while it runs (ADR-269 item 5), so the operator has a remedy. Two things were not tested in Electron: whether a worker OOM also ends the renderer, and whether a finished result of that size runs the UI thread out of memory when it is inserted. A crafted local file is still needed, so this is P2 under §3 ("security weakness that needs local access").
  - *Why it is a separate finding.* J3-P1-1's fix, moving the remote parse into the worker, does not touch this. It has its own desktop reach and its own fix (the budget's unit). It also amplifies J3-P1-1, but J3-P1-1 stands without it: two-point chains at the element budget, up to 40 per `apply_edits`.
- **Fix direction:** Charge each instantiated element its point count (or its path-data length), as the DXF budget charges placed points. Keep the floor's intent: about 500,000 placed points, the same as ADR-269 Amd 1.

### J3-P2-2 — A bit change inside `apply_edits` keeps a Manual operation's old-bit values with no message: the batch drops the kept-values receipt that ADR-306 Amd 4 extends to it

- **Where:**
  - `src/ui/remote-control/design-batch.ts:170-173`: the `update_operation` runner calls `updateOperationFull`, which returns `message` (`design-operations.ts:258-262`). `pick()` (`:237-245`) then keeps only `changedArtworkIds` and `operationId`.
  - The batch result (`:114-123`) has no `message`. Even if it did, the MCP output schema's `apply_edits.results` item (`electron/mcp/design-schemas.ts:325-333`) has no `message` field, and `toolSuccess` strips undeclared keys (`electron/mcp/server.ts:60`).
  - No PC toast is shown in either mode.
  - L7: `cnc-operation-audit.test.ts` checks the message only for `'single'` (`:156-180`). The batch cases check recalculation only.
- **Anchor:**
  - Contract: ADR-306 Amd 4 (`docs/decisions/ADR-306-amendment-4-remote-bit-change-follows-the-card.md:6-7`) "Extends Amendment 3 items 2 and 3 to Remote Control's `update_operation` (ADR-584), alone or inside `apply_edits`".
  - Its item 3 (:37-40): "The receipt names kept values". Its Consequences claim "Bit changes have their own tests, single and in a batch".
  - Twin: the Artwork card's kept-values note (`CncOperationToolFields.tsx`, `cncKeptFeedsAfterBitChange`) and the single-command receipt.
- **Scenario:**
  1. A Manual operation is hand-set for a 1/4" end mill: 2400 / 960 / 12,000 RPM / 2.5 mm.
  2. An MCP agent sends `apply_edits [{update_operation {cnc:{toolId:"em-1588"}}}]`, a 1/16" bit.
  3. The operation keeps 2400 / 960 / 2.5 on the 1/16" bit. This is correct for Manual, and it is the case ADR-306 Amd 3 calls about 2.5× the chip load and 3.3× the depth per pass.
  4. The receipt is `results:[{command,operationId}]`. The agent tells the user the bit is changed.
  5. Nothing on the PC or in Job Review names the kept values. No chip-load check exists in the review. The cut breaks the bit.
- **Evidence:** REPRO (`zz-j3-bit-batch.test.ts`, real adapter).
  - `J3-BIT {"mode":"single",…,"after":{"toolId":"em-1588","feed":2400,"plunge":960,"dpp":2.5},"receiptKeys":["operationId","changedFields","message","history"],"message":"Bit changed. Kept from the previous bit: feed 2400 mm/min, plunge 960 mm/min, sp…","pcToasts":[]}`
  - `J3-BIT {"mode":"batch",…,"after":{"toolId":"em-1588","feed":2400,"plunge":960,"dpp":2.5},"receiptKeys":["changedArtworkIds","changedOperationIds","selection","history","results"],"message":null,"results":[{"command":"update_operation","operationId":"operation-…"}],"pcToasts":[],"batchItemKeysAfterSchema":[["command","operationId"]]}`
- **Severity:** P2, matching H8-P2-1. Feeds and depth per pass are not one of §3's four physical quantities, and this is the disclosure half of that finding on the batch route the ADR names.
- **Refuter:** CONFIRMED. P2 kept.
  - *What would make it false:* the message carried somewhere else (at the top level, in a PC toast or in the card's note), or ADR-306 Amd 4 not promising it for the batch.
  - *REPRO* (`src/ui/remote-control/zz-j3r-bit-batch.test.ts`, real adapter). A Manual operation set to 2400 / 960 / 12,000 RPM / 2.5 on `em-6350` was changed to `em-1588`:
    - **Single.** The receipt keys are `operationId, changedFields, message, history`, and the message reads "Bit changed. Kept from the previous bit: feed 2400 mm/min, p…".
    - **Batch, one item and two items.** The receipt is `results:[{command,operationId}]` with no `message` anywhere. The values stay at 2400 / 960 / 2.5, and the PC toast list is `[]`.
    - **Schema.** A probe parse through the current `apply_edits` output schema keeps a top-level `message` but strips one inside a `results` item, which keeps only `["command","operationId"]`.
  - *Correction to "Where".* The top-level `apply_edits` schema already accepts `message` (`designWrite`); only the `results` item lacks it. A fix can use either.
  - *The PC shows nothing.* The card's kept-values note is local component state, set only when the bit is changed on the card itself (`CncOperationToolFields.tsx:69-78`). So no PC note appears in either remote mode.
  - *Contract.* ADR-306 Amd 4 (:6-7) extends Amd 3 items 2 and 3 to `update_operation` "alone or inside `apply_edits`". Its item 3 is the receipt's `message`.
  - *Severity.* Manual keeping its values is the decided behaviour (Amd 4 item 1), so the output is not wrong by the contract. Depth per pass is also not the cut depth §3 names. What breaks is the disclosure, as in H8-P2-1.
- **Fix direction:** Carry `message` through `pick()` into each `results` item. Add `message` to the `apply_edits` result item schema. Add the batch case to the message test.

### J3-P2-3 (P1 after the refuter) — H8-P1-2's phone route is still silent: the phone Import sheet says "Imported." after the bed fit shrinks the art or a unit is assumed

- **Where:**
  - `services/remote-control/app/src/ui/import-sheet.tsx:36-47`: `controller.write('import_file', …, { success: 'Imported.' })`.
  - `services/remote-control/app/src/core/controller.ts:332`: shows the fixed success text and ignores the receipt's other fields.
  - #1470 changed no file under `services/`.
  - The desktop receipt does carry `notices` and `bedFit` (`design-imports.ts:326-333`).
- **Anchor:**
  - Contract: ADR-125 Amd 1 item 3 (`docs/decisions/ADR-125-amendment-1-imports-keep-file-size.md:23-25`). The import "report[s] it with a warning".
  - Twin: the MCP receipt and the PC toast, which now both carry it.
  - ADR-125 Amd 2 Consequences (`docs/decisions/ADR-125-amendment-2-remote-imports-report-the-bed-fit.md:58-60`) acknowledges "The phone's Import sheet still shows only 'Imported.'". It says showing them "needs a rebuild of the phone app bundle and a relay Worker deploy". But there is no phone change in the repo to rebuild.
- **Scenario:**
  1. On a 400 × 400 mm bed, the phone imports a 1000 × 500 mm DXF or SVG without a width (the sheet's default).
  2. The art becomes 360 × 180 mm. The phone toasts "Imported."
  3. The warning appears only as a transient toast on the PC screen, which a phone operator is by design away from.
  4. They Frame and Start from the phone. Neither shows the mismatch (§3: Frame is not a warning).
  5. A `$INSUNITS 22` DXF (1/25.4 scale) is the same.
- **Evidence:** REPRO + READ.
  - The real adapter's receipt for the oversize SVG: `desktopReceiptKeys:["changedArtworkIds","history","notices","bedFit"]` (`J3-RELAY`).
  - The phone code (READ) ignores both fields.
- **Severity:** P2, not P1. A warning toast does reach the PC before output, as on a desktop import, so the output is not silent everywhere. The defect is that the operator who imported, on the phone, is told "Imported." The coordinator may weigh §3 differently for a phone-only operator.
- **Novelty:** the gap is acknowledged in ADR-125 Amd 2's Consequences. No audit or open PR covers it.
- **Refuter:** CONFIRMED. **Raised to P1** (§3).
  - *What would make it false:* the phone showing `notices` or `bedFit`, a phone-side check, a pending phone change, or a warning that reaches the phone operator before output.
  - *READ, two independent lines:*
    - **The phone code.** `import-sheet.tsx:36-47` passes `{ success: 'Imported.' }`. `controller.ts:332-334` shows that text and reads only `changedArtworkIds`. `git grep -e notices -e bedFit` finds neither in `services/remote-control/app/src`.
    - **The ADR.** ADR-125 Amd 2's Consequences (:58-60) state that the phone "still shows only 'Imported.'".
  - *Severity ruling:*
    - **What H8-P1-2 rested on.** It was P1 because "No warning reaches the phone, the MCP reply or the PC". #1470 fixed the MCP reply and the PC. The PC warning is a toast that lasts 8 s (`src/ui/state/toast-store.ts:20`).
    - **Why the PC toast is not enough.** ADR-569 provides import, Frame, Job Review and Start on the phone, so a phone-only workflow is supported, and the operator who uses it is never told. §3 allows a P1 to be lowered only when "a clear warning reaches the operator before the output". An 8-second toast on a screen that this workflow does not use does not meet that bar.
    - **The phone screen shows only the result.** The phone canvas and the Transform sheet's size show the scaled art, not the mismatch (§3; the H8-P1-2 ruling).
    - **Some cases look normal.** A `$INSUNITS 22` DXF arrives at 1/25.4 scale and looks like an ordinary small part.
    - So the phone route keeps H8-P1-2's P1. If the coordinator counts the PC toast as reaching a phone operator, it is P2.
  - *Novelty:* this is the phone half of H8-P1-2, which ADR-125 Amd 2 left open.
    - It is raised here, not carried as KNOWN, because H8-P1-2 is closed as fixed by #1470, and no ledger item or open PR tracks the phone half.
    - ADR-125 Amd 2 describes the remaining work as "a rebuild of the phone app bundle and a relay Worker deploy". The phone code change that would need rebuilding has not been written.
- **Fix direction:** In the Import sheet, show `notices`, warning first, and a fitted `bedFit` ("scaled to N% to fit"), instead of the fixed success text. Ship it with the relay redeploy of J3-P3-2.

### J3-P3-1 — The DXF block budget counts nested copies again at every level, so a 260,000-point drawing in a block placed once is refused as "more than 500,000 points"

- **Where:**
  - `src/io/dxf/dxf-expand.ts:250-253`: `expandInsert` spends `grid.instanceCount * pointCount(child.polylines)` at each level. `child.polylines` already holds the inner level's copies, which were spent when they were made.
  - So a SHEET block (1,000 INSERTs of a 260-point PART), placed once, spends 1,000 + 261,000 at the inner level and another 260,000 at the outer one: 522,000.
  - The same 1,000 INSERTs placed in model space spend 261,000.
- **Anchor:**
  - Contract: ADR-269 Amd 1 item 2 (`ADR-269-amendment-1-…md:34-35,57-58`): "a file may place 500,000 points this way", and "A large drawing whose geometry sits in a block placed once stays within it".
  - Twin: the same drawing with and without its wrapper block.
- **Scenario:** A nesting sheet of 1,000 copies of a 260-point part is exported with the sheet as a block, placed once (a common CAD habit). It is refused with "DXF block references expand to more than 500,000 points, far more than the file holds …". The flat export of the same 260,000 points imports. The message misstates the size, and the remedy works.
- **Evidence:** REPRO (`zz-j3-dxf-budget.test.ts`, real `parseDxf`, the same collector as the worker).
  - `{"wrapped":false,"bytes":38686,"drawingPoints":260000,"result":260000}`
  - `{"wrapped":true,"bytes":38761,"drawingPoints":260000,"result":"error: DXF block references expand to more than 500,000 points, far more than the file holds; suc…"}`
- **Severity:** P3. It is a loud refusal with a working remedy and no wrong output, but the ADR text and the code disagree. Each further wrapper level adds another full count.
- **Refuter:** CONFIRMED by its own REPRO. P3 kept.
  - *REPRO* (`src/io/dxf/zz-j3r-dxf-budget.test.ts`, real `parseDxf`):
    - **The file.** 1,000 INSERTs of a 100-point PART sit in a SHEET block, placed through zero to four wrapper blocks; each wrapper is one INSERT. The file is about 34.5 KB, and the drawing holds 100,000 points every time.
    - **The result.** With zero, one or two wrappers it imports 100,000 points. With three or four it is refused with "more than 500,000 points".
    - **Why.** Each level adds the full count again, as the auditor read at `dxf-expand.ts:250-253`.
  - *The ADR can be read both ways.*
    - Item 2's "every point that placing a block creates counts, at any nesting" can be read to include the copies each level makes, so the code follows one reading.
    - Its :57-58 claim does not fit, and neither does the message: "expand to more than 500,000 points" for a 100,000-point drawing.
  - The refusal is loud and the remedy (explode the blocks) works, so P3.
- **Fix direction:** Count only the outermost placement's points, or count each level's own new points, `(instanceCount − 1) × points` plus the entity reads. Alternatively, reword the ADR to say every nesting level counts.

### J3-P3-2 — The new import receipt fields reach MCP clients only after a relay Worker redeploy: the Worker re-parses every result with its bundled output schemas, and the pre-#1470 schema strips `notices` and `bedFit`

- **Where:**
  - `services/remote-control/src/relay.ts:92` (MCP) and `services/remote-control/src/device.ts:358` (phone) parse the desktop's result with `mcpOutputSchemas` bundled into the Worker.
  - The pre-#1470 `add_svg`/`import_file` schema is plain `designWrite` (`7a459ef2d^:electron/mcp/design-schemas.ts:299-300`), and `z.object` strips unknown keys.
  - ADR-125 Amd 2 names the Worker deploy only for the phone display (:58-60).
- **Anchor:**
  - Contract: ADR-125 Amd 2 item 2 (:34-39). The receipts "gain `notices`" and "When the fit was applied they also gain `bedFit`".
  - Its Consequence: "An MCP agent and the PC operator both learn that the art was scaled".
- **Scenario:** Until the Worker is redeployed, an MCP agent's oversize `add_svg` returns `{revision, changedArtworkIds, history}`, with no `notices` and no `bedFit`. Only the PC toast tells anyone.
- **Evidence:** REPRO (`J3-RELAY`).
  - `{"desktopReceiptKeys":["changedArtworkIds","history","notices","bedFit"],"currentSchemaKeys":["revision","changedArtworkIds","history","notices","bedFit"],"preFixSchemaKeys":["revision","changedArtworkIds","history"]}`
  - The production Worker's version was not observed (no production contact).
- **Severity:** P3: a deploy dependency and doc gap, the same kind as ADR-654 Amd 1's relay note and 01-P2-3.
- **Refuter:** CONFIRMED. P3 kept.
  - *READ:* `relay.ts:92` (`decodeRelayResponse`) and `device.ts:358` parse the desktop's result again with the Worker's bundled `mcpOutputSchemas`.
  - *REPRO* (`electron/mcp/zz-j3r-relay.test.ts`, with the schemas from `7a459ef2d^`):
    - A receipt carrying `notices` and `bedFit` parses under the old schema to `["revision","changedArtworkIds","history"]`, for both `add_svg` and `import_file`.
    - The current schema keeps both fields.
  - *Who is affected:* the local MCP server uses the desktop's own schemas (`electron/mcp/server.ts:60`), so only relay clients wait for the deploy: the phone and remote MCP. The production Worker's version was not observed.
- **Fix direction:** Add the Worker redeploy to ADR-125 Amd 2's Consequences and to the release checklist, as ADR-654 Amd 1 does for its relay dependency.

### J3-P3-3 — The phone Z hold ignores the controller MPos KerfDesk withholds, which the XY hold uses, so with `$20=1` after an Unlock without Home it still asks for 20 mm and is refused whole near the Z limit

- **Where:**
  - `src/ui/laser/jog-hold-aim.ts:65-74`: `holdZRoomMm` measures only `inferCurrentMachinePosition`, and returns null when KerfDesk withholds the position.
  - The XY aim falls back to `firmwareJogCheckPosition(evidence, withheldControllerMPos(...))` (`:53-57`). Its own header (`:13-15`) and `laser-status-position.ts:8-15` explain why: "With $20=1 stock GRBL checks a jog target against it whatever KerfDesk trusts".
  - `machine-hold.ts:66-71` then asks for `HOLD_MAX_Z_TRAVEL_MM` (20 mm).
- **Anchor:**
  - Twin: the XY hold aim in the same file.
  - Contract (partial): ADR-375 Amd 8 Consequences, "with soft limits on it is no longer refused whole near an edge". Item 2 scopes the Z clamp to when "the head's machine Z is known", so the text and the code agree, and the gap is the twin.
- **Scenario:**
  1. A stock GRBL CNC with `$20=1` is unlocked without Home. The head is 5 mm below the Z soft limit.
  2. The phone Z-up hold asks for 20 mm. GRBL answers `error:15` and the hold does nothing.
  3. The phone reports a failed hold instead of the "already at the travel limit" refusal, or a 5 mm hold.
  4. No motion results.
- **Evidence:** READ. Both aims are in the cited lines. Not run.
- **Severity:** P3: no motion, a confusing refusal.
- **Refuter:** CONFIRMED by the refuter's REPRO. P3 kept.
  - *REPRO* (`src/ui/laser/zz-j3r-zhold.test.ts`, the GRBL simulator through the real laser store):
    - **Setup.** The simulator was set to `$20=1 $22=1 $23=0 $132=80`. It booted into Alarm, was unlocked without Home, and was jogged to MPos −50, −50, −5. The store then had `positionEvidenceSuppressed:true` and `homingState:'unknown'`.
    - **The asymmetry.** `holdJogAim` aims XY from the withheld MPos `{x:-50,y:-50}`, but `holdZRoomMm(aim, +1)` returns `null`.
    - **The result.** `machine-hold.ts:68` therefore asks for 20 mm. Sent through the store, the simulator answered `error:15`, and Z stayed at −5. With the XY hold's fallback, the room would be 5 mm.
  - No motion results, but the hold fails where a 5 mm hold would have run, so P3.
- **Fix direction:** Give `holdZRoomMm` the same withheld-MPos fallback, using Z from `withheldControllerMPos`, for stock GRBL with soft limits on.

## KNOWN (carried, not re-raised)

Each item was re-checked on `d2acacdbe`. For the H8 items, the remote files they cite are unchanged since `a59f74ff9` apart from the board, hold, import and operation edits listed above.

- **H8-P3-1:** remote Home runs with homing off. `executeHome` is unchanged.
- **H8-P3-2:** the remote Job Review omits the jig block. `machine-projections.ts` is unchanged.
- **H8-P3-3:** remote Connect says "No saved connection". `executeConnect` is unchanged.
- **H8-P2-2, secondary half:** bounds and no-go jog warnings still reach only the PC. ADR-375 Amd 8 Consequences defers it.
- **01-P2-5 / G7-K-1:** `jog_hold_stop` is on the Abort lane.
- **01-P3-15:** the discrete remote Z jog accepts 100 mm. The Z *hold* is now clamped; the step is not.
- **01-P3-11 / 01-P3-12:** remote `update_operation` bounds and tool text.
- **G7-K-2:** the `update_text` receipt.
- **01-P3-9:** remote save salvage (latent).

## Entry-point table re-diff (L9, after #1460, #1465, #1470)

| Action | Remote path | Desktop twin | After the fixes |
|---|---|---|---|
| Board capture | `executeBoardAction` → gate → fresh report → `captureNow` (re-gates from one snapshot) | Capture button (`useCaptureGating`) | **Fixed** (#1460). Same gate function. The remote also needs a fresh Idle report |
| Board finish | gate + `finishReview` refusal, then the panel finish | Create board outline | **Fixed**. Refused where the PC warns. The circle is PC-only |
| Board photo / place / get_board | `board.ts` | Place Board panel | Clean (unchanged) |
| Hold-to-jog XY | `holdJogAim` + `continuousJogVector`, capped at 100 mm | JogPad hold (same `holdJogAim`) | **Fixed** (#1470) |
| Hold-to-jog Z | `holdZRoomMm`, capped at 20 mm | none on the PC | New envelope clamp; withheld-MPos gap **J3-P3-3** |
| Jog step | store `jog` | JogPad step | KNOWN 01-P3-15. Warnings PC-only (KNOWN) |
| SVG import (`add_svg`, `import_file`, batch) | `parseSvg` **on the UI thread** → `insertAndPlace` (fit as its own step) → desktop toasts + receipt | File > Import: `parseSvgOffThread` (worker) | Notices and fit **fixed**. Thread **J3-P1-1**. Budget unit **J3-P2-1**. Phone display **J3-P2-3**. Relay **J3-P3-2** |
| DXF import (`import_file`) | `parseDxfOffThread` with the request signal → `describeDxfImport` | File > Import (same worker) | **Fixed** (#1465, #1470). Budget double count **J3-P3-1** |
| PNG/JPEG import | `importImageFile` with recorded PC toasts and the returned outcome | File > Import | Fit notice **fixed** (#1470). Decode limits not verified |
| PDF, `.lbrn`/`.lbrn2`, `.lf2`, STL, HPGL | none (`MCP_IMPORT_TYPES` is SVG/PNG/JPEG/DXF; the phone `fileKind` is the same) | File > Open/Import | Not remotely reachable |
| Operation edit, CNC bit | `cncSettingsAfterOperationChoice` (the card's transform); unknown id refused | Artwork card | Single **fixed**. Batch message **J3-P2-2** |
| Operation edit, other fields | `withManualCncFeedPatch` / `setLayerParam` | Cut Settings / card | KNOWN 01-P3-11/12 |
| `apply_material_recipe` | refused on CNC | Material library | Clean |
| Frame / Review / Start / Pause / Resume / Abort / origin / Zero Z / Disconnect / Camera still | unchanged | — | Clean as in H8. KNOWN H8-P3-2, 01-P2-5 |
| Connect / Home | unchanged | — | KNOWN H8-P3-3 / H8-P3-1 |
| Text, shapes, transform, arrange, create/assign/reorder/delete operation, Undo/Redo, AI draft | unchanged | — | Clean as in H8. KNOWN G7-K-2 |

## Refuted

Refuter (2026-10-27):

- **No whole finding was refuted.**
- **Sub-claims corrected:**
  - **J3-P1-1's ADR-269 item 7 anchor.** Item 7 covers "File-backed SVG" only. It is not a contract for `add_svg`, which carries text; it fits `import_file` at most. The finding rests on NN9 and the File > Import twin.
  - **J3-P1-1's timing.** The 1,074-character chain measured 1.29 s here against the auditor's 2.06 s; the difference is machine load. Both runs had 0 timer ticks for the whole call.
  - **J3-P2-2's "Where".** The `apply_edits` output schema already accepts a top-level `message` (`designWrite`). Only the `results` item strips it.
- **KNOWN items, spot-checked on `0db717973`.**
  - Since `a59f74ff9`, the only change to `machine-actions.ts`, `machine-projections.ts`, `laser-jog-warnings.ts`, `input-schemas.ts`, `machine-schemas.ts`, `writes.ts` and `design-save.ts` is #1460's board gate.
  - `executeHome` still has no homing check. "No saved connection" is unchanged. `jog_hold_stop` is still in `MCP_PRIORITY_COMMANDS`.

Candidates dropped by the auditor:

- **"New receipt fields break MCP clients."** Dropped. `toolSuccess` safe-parses every result (`server.ts:60`), and the current schemas accept the new fields:
  - `notices.level` is the `ToastVariant` set;
  - `importNoticeFields` caps notices at 20 and 2,048 characters before the schema's same caps;
  - `bedFit` holds finite numbers;
  - `update_operation`'s `message` was already in `mcpWriteResultSchema`.

  `J3-RELAY` shows the current schema keeps them, and `J3-BIT` single parses.
- **"A remote capture can record a head that starts moving after the fresh-report check."** Dropped. `captureNow` re-reads the gate and the position from one store snapshot, synchronously, before its first await (`use-board-capture-handlers.ts`).
- **"The ADR-269 Amd 1 budget refuses the pinned 150,000-instance regression."** Dropped. It counts about 302,000, below 500,000, and the remote and worker tests pass.
- **"A remote DXF still parses on the UI thread when no worker starts."** Dropped. It answers `unavailable` (`design-imports.ts:280`), and the `import-dxf-worker.test.ts` case passes.
- **"The phone hold regresses where no envelope is known."** Dropped. It is still the 100 mm bound (`machine-hold-travel.test.tsx` "keeps the 100 mm bound when this session read no $$").
- **"The remote fit differs from the desktop fit."** Dropped. Both call `fitImportedObjectsToBed` with `project.device.bedWidth`/`bedHeight` (`import-bed-fit.ts:31-35`, `design-imports.ts:115-116`).
- **"The remote kept-values message lacks the card's material."** Dropped. `materialKey` drives the card's "use recipe" patch, not the message text (`CncKeptFeedsNotice.tsx:77-85`).

## Verified clean

- **#1460, ADR-654 Amd 1.** One `boardCaptureBlockMessage` drives the PC buttons (`use-capture-gating.ts`), the remote refusal (`machine-actions.ts`) and `captureNow`.
  - Remote capture waits for a report with `statusSequence` newer than the request. It refuses on motion, on a session change, on a PC capture meanwhile, or after 3 s.
  - Finish runs the shared `measuredRectChecks` and carries the outline scale note. The ADR text matches the code.
  - Test truth: `machine-board-panel.test.tsx` "refuses a capture during a PC jog" expects `state:'failed'` with the PC's reason. Pre-fix `executeBoardAction` had no machine gate, so it would fail there (READ of the `d5bd5fbf8` diff).
- **#1465, ADR-269 Amd 1.**
  - Remote DXF is `parseDxfOffThread(new Blob([bytes]), …, {signal})`. The budget is in the shared collector, so the worker, the text fallback and drag-and-drop all enforce it.
  - Test truth: the four `import-dxf-worker.test.ts` cases (worker used, cancel ends the worker, `unavailable` without a worker, refusal past the budget) each contradict the pre-fix UI-thread `parseDxf`.
  - `dxf-expansion-budget.test.ts` imports a module that did not exist before.
  - The original H8-P1-1 repro, the 150,000-instance fixture through `import_file`, now reaches the worker request (the `import-dxf-worker.test.ts` "parses the file in the import worker" case).
- **#1470, ADR-125 Amd 2.**
  - Item 1: SVG and DXF use `describeSvgImport`/`describeDxfImport`, and raster records the importer's own toasts.
  - Item 3: the fit is its own second Undo step, computed and checked inside step 1.
  - Item 4: `widthMm` replaces the fit.
  - Item 5: a batch says "Undo reverts the whole batch".
  - Test truth: `import-desktop-parity.test.ts` compares receipt notices that the pre-fix receipt lacked.
- **#1470, ADR-306 Amd 4.** A single and a batch bit change both equal the card's `sceneWithCncStartupOperationDrafts` result. An unknown `toolId` is `invalid_arguments`.
  - Test truth: the pinned hand-edit test that asserted the opposite is replaced.
- **#1470, ADR-375 Amd 8.** The XY hold equals the JogPad hold (dx 18 vs 18). The Z hold stops the pull-off short of the switch (dz 8) and follows `motionMachineKind`.
  - `JogPad.native-travel.test.tsx` still passes after the JogPad refactor.
  - Test truth: the pre-fix `holdVector` returned 100 mm / 20 mm, so the 18 mm and 8 mm expectations fail on it.
- **MCP output.** The schemas for `add_svg`, `import_file` and `apply_edits` declare `notices` and `bedFit` (`design-schemas.ts:287-333`).

## Not verified

- **The 3×10^7-point SVG, and the 40-item `apply_edits` stall.** Neither was run (memory). Both are extrapolated from the measured per-instance and per-point costs above.
  - jsdom stands in for Chromium's DOM. The point cost is JavaScript.
  - Whether an OOM in the desktop import *worker* (J3-P2-1 on File > Import) also ends the Electron renderer was not tested.
  - The refuter did not run these cases either. It reproduced the stall at 10^5 instances, the stacking at 4 × 10^4, and 300,000 / 600,000 accepted points. Nothing was run in Chromium or Electron.
- **The UI-thread share of a near-budget remote DXF.** The worker's packed result is unpacked, inserted, fitted and redrawn on the UI thread. ADR-269 Amd 1 measured 1.3 s of unpack for 249,000 copies. The insert and canvas cost after that was not measured.
- **The fresh-report wait on a queued-poll controller (Marlin).** Its `M114` poll owes an `ok`. If the remote's 25 ms check lands while that `ok` is outstanding, the gate's pending-write clause may refuse with "Wait for the previous controller command to settle." Not traced to the ack counter, and not run.
- **Remote PNG/JPEG decompression bombs** (G7's open item): still not checked.
- **PDF form XObject nesting.** PDF import is desktop-only. Whether PDF.js bounds nested-form expansion before `pdfVectorPage` sees the operator list was not checked (J6 scope).
- **Production relay Worker and phone bundle versions** (J3-P3-2): not observed.
- **Hardware, real phone, packaged build:** none used.

```json
[
  {"id":"J3-P1-1","severity":"P1","area":"fix-remote","file":"src/ui/remote-control/design-imports.ts","line":50,"anchor":"Contract: PROJECT.md:465 NN9 (Abort reachable from any window state during a job); ADR-269 item 7 (DECISIONS.md:14211-14219) document routes incl. SVG move off the UI thread; Twin: svg-import-action.ts:92-98 parseSvgOffThread; sibling of H8-P1-1 that ADR-269 Amd 1 / #1465 scoped to DXF","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j3r-svg-stall (real adapter, jsdom): 1,074-char add_svg (1e5 instances) ok in 1,290 ms with 0 timer ticks; an abort scheduled 5 ms in ran only after settle and the art was inserted; apply_edits of 4 x 1e4 items one 751 ms block; a two-point chain past the element budget is refused only after a 1.85 s walk on the same thread. Guards: 180,000-char / 240,000-base64 / 40-item caps bound neither instances nor points; edit scope (MCP_WRITE_COMMANDS); assertCurrent has no job check; shipped in 1.0.21 (faf5a54f1 design-imports.ts:33). Desktop File > Import uses parseSvgOffThread, so remote reach makes it P1. ADR-354 Consequences: the worker refill keeps running while new operator actions need the renderer, so the job runs with every software stop frozen. Anchor corrected: ADR-269 item 7 covers file-backed SVG only (partial for import_file, not add_svg); NN9 and the twin carry it. P1 kept (shipped, remotely reachable security hole)","known":false,"summary":"SECURITY — hold details until fixed. Remote add_svg / import_file SVG / apply_edits add_svg still run parseSvg synchronously on the renderer UI thread: a 1,079-char add_svg (1e5 use instances, 222,210 counted < 250,000) froze the event loop 2,056 ms with 0 timer ticks; apply_edits stacks up to 40; a 3,563-char variant carries 3e7 points (J3-P2-1) at ~0.6-0.9 us and ~171-176 B per point -> tens of seconds and ~5 GB, a renderer OOM; an edit-only client freezes PC Abort, Ctrl+. and remote abort_job during a job"},
  {"id":"J3-P2-1","severity":"P2","area":"fix-remote","file":"src/io/svg/svg-use-expansion.ts","line":41,"anchor":"Twin: ADR-269 Amd 1 item 2 DXF budget counts every placed point (dxf-expand.ts:250-253); Contract: ADR-268 Amd 1 item 1 floor sized on two-point paths, growth 'not bounded by the input'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ spendSvgUseElement +1 per element, size note advisory, no point cap on the insert path. REPRO: remote add_svg of a 1,928-char 300-point x 1,000-instance chain ok, 300,000 points, 192 ms, 67 MB heap; the desktop worker parser (parseSvgInWorker) accepted 300,000 and 600,000 points with only the Large SVG note; the 1e5 structure passes the element budget whatever the path's points. Kept separate: J3-P1-1's worker fix does not touch it and it has its own desktop reach. P2 kept (crafted local file; Escape cancels the worker; worker-OOM effect on the renderer not tested)","known":false,"summary":"The SVG <use> budget charges 1 per instantiated element, not its points: a 3.6 KB SVG of a 300-point path in a 10x10x10x10x10 use chain passes (222,210 < 250,000) with 3e7 points; 1,000 instances of a 300-point path were charged 2,210 for 300,000 points; desktop File > Import runs it in the worker to OOM"},
  {"id":"J3-P2-2","severity":"P2","area":"fix-remote","file":"src/ui/remote-control/design-batch.ts","line":237,"anchor":"Contract: ADR-306 Amd 4 (extends Amd 3 items 2-3 to update_operation 'alone or inside apply_edits'; item 3 the receipt names kept values); Twin: single update_operation receipt and the Artwork card note","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j3r-bit-batch (real adapter): single receipt has message 'Bit changed. Kept from the previous bit…'; batch of one and of two items returns results [{command,operationId}] with no message, values 2400/960/2.5 kept, PC toasts []; the apply_edits schema keeps a top-level message but strips one in a results item. The card note is local state set only by the card. ADR-306 Amd 4 :6-7 extends item 3 to apply_edits. P2 kept (Manual keeping values is decided behaviour; the disclosure is what breaks, as H8-P2-1)","known":false,"summary":"apply_edits update_operation {cnc:{toolId}} on a Manual operation keeps 2400/960/2.5 on a 1/16 in bit (correct) but pick() drops the kept-values message and the MCP results item schema has no message field; single mode returns it; no PC toast in either; the message test is single-only"},
  {"id":"J3-P2-3","severity":"P1","area":"fix-remote","file":"services/remote-control/app/src/ui/import-sheet.tsx","line":36,"anchor":"Contract: ADR-125 Amd 1 item 3 (imports report the scale with a warning); Twin: MCP receipt notices/bedFit and PC toast; ADR-125 Amd 2 Consequences acknowledges the phone gap but no phone change exists","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ import-sheet.tsx:36-47 fixed 'Imported.', controller.ts:332-334 reads only changedArtworkIds, no notices/bedFit anywhere in the phone app; ADR-125 Amd 2 :58-60 states the same. RAISED P2 -> P1 (§3): H8-P1-2 was P1 because no warning reached the phone, MCP or PC; the PC toast lasts 8 s (toast-store.ts:20) and the phone-only import -> Frame -> Review -> Start workflow (ADR-569) never shows it; the phone canvas and Transform size show the result, not the mismatch; a $INSUNITS 22 DXF looks normal. P2 only if the coordinator counts a PC toast as reaching a phone operator. Raised rather than KNOWN because H8-P1-2 is closed as fixed by #1470","known":false,"summary":"H8-P1-2's phone half is unfixed: the phone Import sheet shows the fixed 'Imported.' and ignores the receipt's notices and bedFit, so a phone import scaled to 36% (or an assumed $INSUNITS) is announced as plain success; only a transient PC toast warns"},
  {"id":"J3-P3-1","severity":"P3","area":"fix-remote","file":"src/io/dxf/dxf-expand.ts","line":253,"anchor":"Contract: ADR-269 Amd 1 item 2 ('a file may place 500,000 points'; 'A large drawing whose geometry sits in a block placed once stays within it'); Twin: same drawing flat vs wrapped","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j3r-dxf-budget (real parseDxf): 1,000 INSERTs of a 100-point PART in SHEET (100,000 points, ~34.5 KB) through 0-4 one-INSERT wrapper blocks: 0-2 wrappers import 100,000, 3 and 4 are refused 'more than 500,000 points'; each level adds the full count. Item 2's 'at any nesting' can be read either way; :57-58 and the message disagree with the code. P3 kept","known":false,"summary":"The block budget re-counts inner copies at every nesting level: 1,000 copies of a 260-point part (260,000 points) import flat but are refused when wrapped in one SHEET block placed once (522,000 counted), with a message claiming more than 500,000 points"},
  {"id":"J3-P3-2","severity":"P3","area":"fix-remote","file":"services/remote-control/src/relay.ts","line":92,"anchor":"Contract: ADR-125 Amd 2 item 2 and Consequences (MCP agent learns of the fit); the Worker re-parses results with its bundled mcpOutputSchemas","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ relay.ts:92 and device.ts:358 re-parse with the bundled mcpOutputSchemas. REPRO zz-j3r-relay: the 7a459ef2d^ add_svg/import_file schema strips a receipt to [revision, changedArtworkIds, history]; the current one keeps notices and bedFit. The local MCP server uses the desktop's schemas, so only relay clients wait. P3 kept","known":false,"summary":"Until the relay Worker is redeployed, its pre-#1470 add_svg/import_file schema (plain designWrite, z.object) strips notices and bedFit from MCP and phone receipts; ADR-125 Amd 2 names the Worker deploy only for the phone display"},
  {"id":"J3-P3-3","severity":"P3","area":"fix-remote","file":"src/ui/laser/jog-hold-aim.ts","line":65,"anchor":"Twin: holdJogAim XY falls back to firmwareJogCheckPosition(withheldControllerMPos) (jog-hold-aim.ts:53-57, :13-15); Contract (partial): ADR-375 Amd 8 Consequences 'no longer refused whole near an edge'","evidence":"READ","verdict":"CONFIRMED","refuter":"REPRO zz-j3r-zhold (GRBL simulator, real laser store): $20=1 $22=1 $23=0 $132=80, boot Alarm, Unlock without Home, jog to MPos -50,-50,-5; position suppressed, homing unknown; holdJogAim XY aims from {-50,-50} but holdZRoomMm(+1) is null, so machine-hold asks 20 mm; the simulator answers error:15 and Z stays -5. P3 kept","known":false,"summary":"holdZRoomMm reads only the trusted MPos, so after an Unlock without Home with $20=1 the phone Z hold asks 20 mm and stock GRBL refuses the whole line (error:15) near the Z limit, where the XY hold aims from the withheld MPos"},
  {"id":"J3-K-1","severity":"P3","area":"fix-remote","file":"src/ui/remote-control/machine-actions.ts","line":128,"anchor":"Twin: laser-command-family.ts Home disabled","evidence":"READ","verdict":"KNOWN","known":"H8-P3-1","summary":"Remote Home runs with homing off (unchanged)"},
  {"id":"J3-K-2","severity":"P3","area":"fix-remote","file":"src/ui/remote-control/machine-projections.ts","line":262,"anchor":"Twin: JobReviewRegistrationJig","evidence":"READ","verdict":"KNOWN","known":"H8-P3-2","summary":"Remote Job Review omits the jig block (unchanged)"},
  {"id":"J3-K-3","severity":"P3","area":"fix-remote","file":"src/ui/remote-control/machine-actions.ts","line":86,"anchor":"Twin: runConnectAction refusals","evidence":"READ","verdict":"KNOWN","known":"H8-P3-3","summary":"Remote Connect says No saved connection for file-only / network (unchanged)"},
  {"id":"J3-K-4","severity":"P2","area":"fix-remote","file":"src/ui/state/laser-jog-warnings.ts","line":37,"anchor":"ADR-375 Amd 8 Consequences","evidence":"READ","verdict":"KNOWN","known":"H8-P2-2 secondary half, deferred by ADR-375 Amd 8","summary":"Jog bounds and no-go warnings still reach only the PC"},
  {"id":"J3-K-5","severity":"P2","area":"fix-remote","file":"electron/mcp/input-schemas.ts","line":170,"anchor":"Twin: Abort reserve","evidence":"READ","verdict":"KNOWN","known":"01-P2-5 / G7-K-1","summary":"jog_hold_stop on the Abort lane"},
  {"id":"J3-K-6","severity":"P3","area":"fix-remote","file":"electron/mcp/machine-schemas.ts","line":67,"anchor":"Twin: PC Z step","evidence":"READ","verdict":"KNOWN","known":"01-P3-15","summary":"Discrete remote Z jog accepts 100 mm (the Z hold is now clamped)"},
  {"id":"J3-K-7","severity":"P3","area":"fix-remote","file":"electron/mcp/design-schemas.ts","line":57,"anchor":"Twin: cut-settings bounds","evidence":"READ","verdict":"KNOWN","known":"01-P3-11 / 01-P3-12","summary":"Remote update_operation bounds and tool text"},
  {"id":"J3-K-8","severity":"P3","area":"fix-remote","file":"src/ui/remote-control/writes.ts","line":95,"anchor":"Twin: store insert check","evidence":"READ","verdict":"KNOWN","known":"G7-K-2 / 02-P3-4","summary":"update_text receipt not checked against the store"},
  {"id":"J3-K-9","severity":"P3","area":"fix-remote","file":"src/ui/remote-control/design-save.ts","line":11,"anchor":"Twin: desktop Save salvage confirm","evidence":"READ","verdict":"KNOWN","known":"01-P3-9","summary":"Remote save skips the invalid-project salvage confirm (latent)"}
]
```
