# MCP bug audit, 14 October 2026

Audited the portable MCP server, remote relay, embedded app and desktop remote editing adapter from `origin/main` at `03f1da57737ebc58d7cf4e240be6c2225270c690`. Repairs are on `codex/mcp-audit-20261014`. The starting worktree was clean. This is source, protocol, browser-fixture and local Workers-runtime evidence; it does not establish the state of a hosted service or installed desktop.

## Confirmed defects and repairs

| Area | Reproduced behaviour before repair | Result after repair |
| --- | --- | --- |
| Command cancellation | A jog cancelled while durable admission was awaiting could still be dispatched when admission resumed. | Register pending ownership and the MCP cancellation association before admission. Check that ownership during reservation and again before dispatch. |
| Change notifications | `wait_for_change` bypassed pending-command tracking. MCP cancellation, revocation and desktop replacement left long polls alive; a pre-cancelled request could receive counters. | Track relay-only waits through the ordinary cancellation lifecycle and release their timers promptly. |
| Held-jog stop capacity | After 4,096 ordinary control actions, `jog_hold_stop` was refused despite reserved Abort capacity remaining, on both the relay and renderer. | Routine stops spend ordinary capacity and fall back to the bounded reserve when it is full. Abort retains its reserved capacity during normal use; exhaustion and request replay remain explicit. The desktop deadman is unchanged. |
| Connection replacement | Late reads, writes, camera results, receipt polling and queued model-context updates could survive teardown or publish into a replacement session. A delayed legacy resize could then move artwork on the replacement connection. | Fence asynchronous continuations to their connection generation, clear scheduled reads and subscriptions, and keep any held-jog release bound to its original receipt. |
| Legacy resize | The follow-up move could run after a rejected resize or use the pre-resize revision while refresh was still pending. | Require a successful resize in the same connection and use its returned revision for the move. Modern desktops still use the existing atomic batch. |
| Refresh polling | Slow workspace reads left `wait_for_change` using an old rendered revision, repeatedly returning the same change without waiting. | Advance the notification cursor as soon as a change is received, independently of rendering. |
| Canvas consistency | Workspace bounds from one revision could be displayed with scene geometry from another. | Clear outdated geometry and accept scene results only for the current workspace revision. |
| Camera images | Camera snapshots contained base64 text and structured data but no standard MCP image content for an AI host. | Emit a JPEG image block and metadata text, retaining structured image data for the app and the complete 256 KiB response limit. |
| Batch drawing validation | `apply_edits` accepted repeated-point strokes and closed polygons with fewer than three distinct points, although the individual tool rejected them. | Apply the same distinct-point rule at MCP ingress and in the renderer before any batch mutation. |
| CNC default settings | Operations without explicit `layer.cnc` omitted their effective settings from remote reads; CNC patches reported success without applying anything. | Project and edit the same effective defaults used by the PC. Changes remain one Undo step and retain existing Pro admission. |
| Manual CNC feeds | Remote feed, plunge, spindle, depth-per-pass and tool edits retained automatic feed provenance. Subsequent automatic refresh could therefore replace values that were entered manually. | Use the PC's `withManualCncFeedPatch` helper. Keep the material association and preserve automatic provenance for unrelated edits. |
| Laser-only CNC arguments | CNC operation creation silently ignored an explicit Laser mode; Laser material recipes could change irrelevant settings while reporting success. | Refuse those incompatible arguments consistently with ADR-584, including full batch rollback. Ordinary CNC operation creation remains available. |

An additional boundary repair rejects image footprints on a scene response labelled `disabled` or `unavailable`, matching the existing refusal of vector objects. The contradictory output was reproduced against the schema; no live disclosure or current renderer emission of disabled geometry was demonstrated.

## Regression evidence

New and extended regressions are in:

- `electron/mcp/media-result.test.ts` and `touch-authoring.test.ts`: camera content, full response budget, disabled scene output and batch ingress.
- `services/remote-control/test/command-admission-cancellation.test.mjs`, `mcp-wait-lifecycle.test.mjs` and `control-ledger.test.mjs`: cancellation before dispatch, wait cleanup, quota and replay in local Workerd.
- `services/remote-control/test/mcp-app-lifecycle.test.mjs`: notification cursors, connection replacement, teardown, scene revisions, model context and legacy resize in Chrome.
- `src/ui/remote-control/design-admission-audit.test.ts` and `cnc-operation-audit.test.ts`: direct/batch validation, rollback, effective settings, Undo, manual feed handling and existing Pro admission without a deferred prompt.
- `src/ui/remote-control/machine-hold-capacity.test.ts`: renderer ordinary/reserved capacity, release of the owned motion, duplicate request replay and reserve exhaustion.

Failing reproductions were run before repairs. Independent review also reproduced both legacy resize races and checked the renderer changes against the canonical desktop controls. The phone bundle and embedded MCP HTML were regenerated from their shared app source.

## Verification

- Combined renderer, remote-access and MCP tests: **56 files, 595 tests passed**.
- Complete remote-control service suite: **490 tests passed**, with no failures or skips. After the final ordinary-first quota refinement, the rebuilt service passed **32 focused tests** covering admission cancellation, wait lifecycle, action quotas, rate limits, machine authorization and live transport.
- App, Electron and service TypeScript checks passed, including root typecheck after the final renderer capacity repair.
- Repository, Electron and service lint and formatting passed; the final renderer capacity addition also passed scoped lint and formatting.
- Service formatting and generated-asset freshness passed.
- File-size backstop and public-export ratchet passed. The soft-size check reports existing repository-wide advisory entries.
- Final renderer capacity regression and related machine tests: **3 files, 15 tests passed**, including ordinary-capacity saturation, reserved-capacity exhaustion, owned cancellation and replay.

Primary references used for the affected protocol/runtime contracts: [MCP image content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#image-content), [Durable Object concurrency rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/), [Durable Object state](https://developers.cloudflare.com/durable-objects/api/state/) and [Workers execution context](https://developers.cloudflare.com/workers/runtime-apis/context/). Repository behaviour was checked against ADR-584, ADR-585 and the current desktop implementations.

## Delivery boundary

No merge, push, deployment, provider change or hardware operation is part of this audit. Browser tests use synthetic desktop responses, and Workers tests use local runtime instances. Live ChatGPT/OAuth pairing, installed desktop upgrades and physical controller/material behaviour remain unqualified. No new dependency, licence gate, Frame/Start policy or raw machine command was introduced.

The repairs require an updated desktop build and remote service/app deployment before they affect installed or hosted clients. Review the local branch, then use the existing approved release workflow.
