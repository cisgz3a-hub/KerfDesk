# Latest twenty PR audit repairs

The combined workflow candidate also retains PR #1084 features and adds the workflow repairs below. The repair branch carries forward the document and job handover fixes from PR #1082, fixes inherited image-mask nesting and MCP cancellation defects, and strengthens substantive regression coverage. The original PR branches are retained.

| Finding | Result | Regression or source evidence |
| --- | --- | --- |
| H1 pending Open overwrites a newer edit | Pending Open belongs to the unchanged exact document owner. | `src/ui/app/file-actions-open-ownership.test.ts` and document ownership regressions. |
| H2 a queued numeric edit reaches another document | Debounce admission belongs to its captured document epoch, including before React reconciliation. | `src/ui/layers/use-debounced-commit.document.test.tsx`. |
| H3 acknowledgements promote completion too early | Owned controller settlement must complete before finished state is confirmed. Interrupted ownership remains intact. | `src/ui/state/live-canvas-run.test.ts`, settlement and controller timing tests. |
| H4 checkpoint activation misses early progress | Late activation records the current matching stream progress without adopting another job. | `src/ui/app/use-job-checkpoint.activation.test.ts`: 13 actual ACK/refill transitions before activation and later storage failure. |
| H5 inaccurate Marlin G4 comment | Correct the planner-synchronisation description; retain explicit M400 behaviour. | Pinned Marlin 2.1.2.5 source and `src/ui/state/laser-post-job-settle.ts`. |
| C1 nesting separates an image and its external mask | Pack connected masks, consumers and groups as one rigid unit; refuse partial dependency selections before mutation. Component identity uses a unique object ID. | `src/ui/state/nest-mask-dependencies.test.ts`: actual compiled powered samples, rotations, shared masks, owned clips and opaque overlapping group IDs. |
| R1 accepted legacy batches lose cancellation ownership | Preserve 1-100 valid legacy messages and bounded priority Abort capacity. Associate each typed wire ID with its authenticated client/grant, apply mixed cancellation once, preserve original retained member bytes, and release every acquired association. | `services/remote-control/test/mcp-batch-boundary.test.mjs`, lifecycle and raw-byte regressions; real legacy/modern SDK HTTP cancellation and shared `electron/mcp/server.test.ts` wire-ID forwarding. |
| R2 phone test reads controls before readiness | Wait for the admitted edit form before beginning the original complete workflow. | `services/remote-control/test/mobile.test.mjs`. |
| R3 local quota assertion can cross its minute boundary | Observe the real test binding epoch and start the unchanged exact 61-request assertion inside one verified minute. | `services/remote-control/test/rate-admission.test.mjs`; test-only observer, no production quota changes. |


| F1 copied production sheets inherit completed observations | Copy current artwork while keeping the original run archived; explicitly allocate a new run with fresh identities, pending rows and fresh capture attribution. | `src/ui/state/project-sheet-production-copy.test.ts` and `e2e/project-production-reuse.spec.ts`, including save/reopen and no serial writes. |
| F2 a valid long experiment ID produces an invalid recipe reference | Keep derived IDs within the existing 200-character limit, resolve collisions across both stores, and validate the entire next library before persistence. | `src/ui/state/material-experiment-recipe-id.test.ts`: boundary lengths, suffix growth, collision, CNC/tool fidelity and atomic refusal. |
| B1 an extra workflow strip reduces the compact canvas | Move sheet, production and saved-array controls into the existing header and an accessible dialog. | `e2e/ux-shell.spec.ts`: original canvas height bounds, keyboard reachability, nested dialog and opener focus. |
| B2 seven browser scenarios follow superseded UI controls | Follow explicit Nest acceptance, scoped Materials status, CSV column insertion, current numeric fields and the shared Save flow. | Production, variable-array and shape browser tests retain output, placement, Undo, persistence and SVG assertions. |
| Workflow integration conflicts | Preserve closed-sales seller/Paddle policies and AI disclosure together; retain the verified workflow Nest implementation when merging inherited fixes. | Full website, privacy, legal-publication and release-integrity checks; final candidate checks are recorded separately. |

The service README records the precise legacy batch, MIME, wire-ID and capacity boundaries. Invalid or unsupported shapes are rejected before effects. Capacity denial remains per member; HTTP cancellation does not implicitly call physical Abort or replay controller commands.

These repairs preserve completed Frame as the ordinary Start policy gate and exact executable review at each Start. Pro entitlement remains at tool entry; Frame, Start, output, Save and running jobs acquire no new entitlement checks.

Final check results and exact candidate heads are recorded in the pull request and the separate dated repair evidence. Earlier failures, superseded approaches and interrupted runs remain diagnostic evidence; none is counted as a final passing verdict. Software evidence does not establish installed desktop, provider deployment or physical-machine qualification.

The combined candidate also integrates the original workflow owner's updated PR #1084 head `cafcd54bee547bac9693f46b8d1e12aea03496d4`. It retains the owner's compact numeric spacing, explicit CSV column selection and stronger Nest assertions: searching must preserve the complete project and Undo/Redo state, show a draft, and acceptance must add exactly one Undo entry. Workspace focus still precedes keyboard Undo.

The project controls remain in the header dialog, with the owner's bounded selector/button styling adapted to a wrapping dialog control group. Seller/Paddle closed-sales information and approved AI disclosures are equivalent in both integrations and retained. The owner's updated verification records distinguish its initial qualification from later browser repairs. Reproductions against the original frozen `4165bb6` head remain historical evidence; current PR #1084 is recorded separately. Its original branch and worktree are not overwritten.
