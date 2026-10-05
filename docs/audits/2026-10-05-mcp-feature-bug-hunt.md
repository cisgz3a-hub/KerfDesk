# MCP feature and bug audit, 5 October 2026

This audit covers the phone control page, embedded MCP workspace UI and the desktop's remote authoring/review adapter. It started from `origin/main` at `14eef624cee00503f2d341fbc4cef798f64d3f23` in an isolated worktree. The primary checkout and customer profiles were not changed. Findings below come from source inspection and reproduced local scenarios, not PR metadata alone.

## Confirmed defects and repairs

All five findings are P2 correctness defects. They do not establish a physical machine failure.

| Finding | Reproduction before repair | Repair and regression evidence |
| --- | --- | --- |
| Decimal keyboard entry rejected | Enter `0,5` in a shape width or jog step. Both phone and embedded fixtures reject it even though they request a locale-aware decimal keyboard. | Parse one comma as the decimal separator on submission, preserving the user's draft and existing range checks. Ten browser cases cover blank/partial drafts, refresh, both separators, malformed/non-finite values and one explicit jog dispatch. Baseline: six failures; repaired: ten passes. |
| Navigation interruption discards a completed drawing | Complete a rectangle, begin a separate Pan or pinch, then cancel that pointer/capture. The completed unapplied drawing disappears. | Cancel the active edit or navigation according to its owner. A completed independent draft survives navigation cancellation; an unfinished stroke still cancels. |
| Keyboard nudge corrupts a held Move | Hold Move at its starting point, press Right, then release without moving. The old code creates a negative 1 mm draft. | Keep independent start/end points and suppress nudges during held edits or navigation. Keyboard nudging resumes after release. The two touch findings have twelve browser cases: baseline eight failures, repaired twelve passes, across both clients. |
| Remote transforms split persistent groups | Group two rectangles; transform only one member by remote ID. The ordinary desktop moves both, but the remote edit moves one while retaining the group. | Share the existing arrangement group-closure policy with move/resize/rotate. Validate every member before one canonical undoable edit and return all changed IDs. Twelve new cases cover desktop parity, move/resize/rotate, overlapping memberships, target bounds, refusal and document/selection ownership. |
| Full edit window strands a machine review | After 256 settled authoring requests, hold a machine review and submit another edit. The revision namespace renews without a store event. The old review remains busy/stale and cannot recover normally. | Notify the existing owned-review rebuild path when the edit namespace renews. New cases cover 255/256 boundaries, unresolved text writes and invalidation during canonical preparation. Frame and document history stay unchanged; Start must consume a fresh one-use handle for the exact current output. |

Production changes are in `services/remote-control/public/control-model.js`, `control-touch-view.js`, `control-touch.js`, their embedded MCP counterparts, and `src/ui/remote-control/{adapter,transforms,writes,arrange,machine-control-registry,machine-owned-operation}.ts`. The touch source remains generated from the shared phone implementation.

## Scenario checklist

| Scenario | Result / evidence lane |
| --- | --- |
| Delete a numeric value, leave it blank during refresh, then type a replacement | Passed in phone and embedded browser fixtures. |
| Submit a partial minus sign, mixed separators, grouped values, NaN or out-of-range input | Refused with the draft retained and no authoring/jog dispatch. |
| Submit comma-decimal dimensions, positions and a discrete jog | Passed with independent expected numeric command values; no physical controller involved. |
| Cancel Pan/pinch after finishing a local drawing | Completed drawing retained. |
| Cancel a held stroke or Move; add a second finger | Active draft cancelled; no accidental desktop edit. |
| Press arrows while Move/pinch is held, then nudge after release | Held gestures do not nudge; normal nudging resumes. |
| Move, resize or rotate one grouped member, then undo/replay | Whole group changes once, unrelated groups and selection stay intact, one undo entry and idempotent replay. |
| Group target includes hidden, locked or missing artwork, or exceeds 200 members | Whole edit refused without a partial transform. |
| Document changes during remote transformation | Stale ownership refused. |
| Renew the 256-request edit window during an owned review | Fresh canonical review replaces the stale one. Exact output confirmation is retained. |
| Renew while a text write is unresolved | Request remains reserved; no renewal discards it. |
| Permission, document, controller or renderer changes during review rebuilding | Checked by the canonical invalidation regressions. |
| Deliver an expired remote-control lease | The renderer refused it with zero native jog calls in the local fixture. The captured bridge envelope was not sufficient to demonstrate a machine-control bypass. |
| Phone pre-dispatch cancellation race | Unverified. The service investigation was stopped after platform review; the attempted fixture did not execute that scenario. No claim of a defect or passing check. |
| Physical phone, actual ChatGPT host, installed customer upgrade, power loss and real controller/material | Not qualified in this audit. |

## Dependency advisory triage

A fresh full/production dependency scan at `2026-10-05T11:46:55Z`, classified with the repository's `report-dependency-audit.mjs`, found zero runtime-reachable registry advisories, one release-build-only advisory and one build/test-only advisory. The classification includes the packaged Electron host even though Electron is declared as a dev dependency. This snapshot does not prove the absence of vulnerabilities.

| Package and published advisory | Verified dependency path | Status |
| --- | --- | --- |
| `http-cache-semantics@4.2.0`, [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), high | `electron-builder > app-builder-lib > @electron/get > got > cacheable-request` | Release build tooling. The registry lists no patched version. The [maintainer disputed the report and closed it on 4 October](https://github.com/kornelski/http-cache-semantics/issues/56#issuecomment-5975759591), explaining the distinction between cache freshness and privacy. The registry alert remains open; neither its severity label nor the dispute alone demonstrates this application's exposure. |
| `braces@3.0.3`, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | `eslint-plugin-boundaries > micromatch`, also via `@boundaries/elements` | Lint tooling. The registry lists no patched version. No runtime dependency path or product reproduction was found in this audit. |

These remain dependency-maintenance follow-ups. No exploit probe, speculative patch or unsupported version override was used to erase an alert. Raw registry snapshots, exit codes and the classified report are saved in the audit evidence directory.

## Feature research and recommended order

These are proposals, not features completed by this repair.

1. **Fullscreen MCP editing with reliable host sizing.** The current embedded code initializes the portable MCP Apps bridge but does not request fullscreen or send host sizing notifications. OpenAI recommends fullscreen for rich canvas/multistep work, with a focused inline entry. Use the portable `ui/request-display-mode` capability, respect the host's actual response and available modes, and keep inline fallback. Fullscreen still shares space with the ChatGPT composer. Feature-detect optional host extensions instead of branching on a product name. Sources: [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui), [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines), [MCP Apps display-mode and sizing API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html).

2. **Existing-text editing inside the embedded panel.** The phone has a direct existing-text form; the embedded panel currently exposes Add text and relies on the assistant or PC for existing-text changes. Reuse the existing bounded `update_text` adapter, bundled fonts, sharing opt-in and local draft/revision checks. This is parity work, not a reason to add a second document store. [OpenAI state guidance](https://developers.openai.com/plugins/build/chatgpt-ui) distinguishes authoritative server/application data from temporary UI state.

3. **Aspect lock, rotation controls and clearer selection.** Today the canvas selects by bounds, and its width/height Resize affordance cannot explain the existing desktop refusal of non-uniform world-axis scaling for obliquely rotated objects (`selection-transform.ts`, `rejectsWorldAxisResize`). Add aspect lock and rotation metadata before allowing that interaction. Evaluate multi-selection, drag rotation and snapping against the desktop's canonical transform/undo engine. [Konva's transformer documentation](https://konvajs.org/docs/select_and_transform/Basic_demo.html) is useful reference behavior for selection and transform handles; it is not evidence that adding the library would solve the document/geometry contract.

4. **A structured editing projection for accurate vector hit testing.** The current view is a PNG plus bounded artwork summaries, not the desktop scene graph. A more capable editor needs a bounded, revisioned vector projection with stable artwork IDs; local drawing must commit through existing authoring commands. Image pixels/thumbnails need the existing explicit sharing choice. Replacing the drawing library alone cannot make the current PNG an editable scene. Dashed raster placement frames remain labelled as partial previews until real image content is available.

5. **Keep mobile state and input behavior explicit.** Keep primary controls near the canvas, offer exact numeric properties alongside gestures, retain drafts through harmless reads and navigation, and show when the desktop requires a newer revision or does not support an edit. The decimal fix follows the platform's locale keyboard behavior: [MDN inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode). Pointer cancellation is a normal browser lifecycle, including viewport manipulation and app/orientation changes: [MDN pointercancel](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event).

No new canvas library, host-only API or machine command was introduced. Layer/node editing, saved templates and richer image controls need their own bounded design; they are not promised by this audit.

## Verification and delivery

Final combined local verification passed:

- Desktop remote-control and Electron MCP integration: 28 test files, 342 tests.
- Complete remote-control service suite, including Chromium phone and embedded UI scenarios: 376 tests, zero failures or skips. Its build used the existing Wrangler dry-run script; no Worker version was published.
- App, Electron and service TypeScript checks.
- Repository, Electron and service lint; repository/service formatting; generated shared-touch and scanner parity; production dependency licence policy and current service notices; file-size backstop, soft-size policy and public-export ratchet.
- Independent scoped review of all five fixes found no additional actionable correctness regression.

There are 41 new regression scenarios across four files. Evidence logs and reproduction fixtures are under `D:/LaserForge/mcp-feature-audit-evidence-20261005/`; they are development artifacts, not customer content.

These repairs require updated service UI assets and an updated desktop build for their respective behavior. Source verification or a merged PR does not establish that either installed or live version contains them. This task does not manufacture a new Windows installer or claim live ChatGPT/phone/hardware qualification.
