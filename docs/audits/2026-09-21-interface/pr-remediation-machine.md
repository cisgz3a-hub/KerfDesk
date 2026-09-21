# Machine integration review after main #826

The completed-job display, simplified origin controls, and three-stage setup remain compatible with the streaming, dwell-estimate, and recovery changes integrated at `9d05cc626cee59187370b16d31095f257de8cb2e`. This review found no production defect requiring another change. It adds one simulator regression for successful completion when dwell timing is unknown.

## Executed evidence and provenance

The two raw reports are preserved separately; neither is an aggregate or a replacement for the historical control audit.

| Raw report | Executed result | Scope |
| --- | --- | --- |
| [pr-remediation-machine-vitest.json](pr-remediation-machine-vitest.json) | 132 passed, 15 files | Completion display, origin/release controls, setup navigation and draft behavior, dwell estimates, hosted refill/invalidation, and durable recovery. Run before the additional simulator regression. |
| [pr-remediation-machine-completion-vitest.json](pr-remediation-machine-completion-vitest.json) | 8 passed, 1 filtered, 2 files | New unknown-dwell simulator regression and seven transport eligibility cases. The filtered simulator case already passed in the initial batch. |

Together these establish **140 distinct passing cases across 16 files**, with no failing case. Both commands used `--maxWorkers=1`. The changed simulator test also passed ESLint and Prettier checks.

## Findings and control bindings

- **Done after unknown dwell:** `CompletedJobNotice.simulator.test.tsx`, `offers Done after an unknown-dwell run settles even though its live estimate was unavailable`, starts real store streaming through the GRBL simulator with unknown detected firmware and a `G4` command. It asserts an unavailable handoff/live estimate, no dismissal while active, terminal `finished`/`complete` timing with cleared streamer/settle operation, visible Done, and display-only dismissal preserving the project reference and outbound command history. The existing simulator completion case and 29 completion state/UI cases also passed in the initial batch. This uses the low-level test Start helper; it is not independent evidence for the ordinary UI's exact-job Frame gate.
- **Why Done remains available:** `live-canvas-run-timing.ts` converts any successful terminal run to `completeLiveJobTiming()`, regardless of whether its earlier estimate was available. `laser-post-job-settle.ts` invokes that transition after the driver's settle marker and two fresh Idle reports. `completed-job-display.ts` still rejects active, unsettled, interrupted, or faulted state, rechecks the run identity on click, and changes only `liveCanvasRun`. Unknown dwell remains an estimate limitation; this work adds no Start gate.
- **One Release motors control:** `release-motors-complementarity.test.tsx` passed `offers one control after a Z-only touch-off with no XY origin`, `offers one control with no origin at all`, and `offers one control once an XY origin is settled`. These mount OriginRow and NoHomingPositionGuide together and assert exactly one release control. `OriginRow` now uses the same XY-origin predicate as the guide, so a Z-only touch-off does not produce duplicate controls. This is rendered availability evidence, not a motor-release test.
- **Release confirmation and busy state:** `MachineRunControls.audit.test.tsx`, `Release motors requires confirmation and does not release while streaming`, asserts the declined/accepted confirmation and busy click boundaries against a mocked release action. It proves callback dispatch and suppression only.
- **Worker checkbox family gate and draft preservation:** `DeviceSetupWizard.test.tsx`, `offers worker streaming only for GRBL-family controllers and keeps its saved preference`, exercises the real wizard draft while selecting GRBL, grblHAL, FluidNC, Marlin, and Smoothieware. The option is hidden for unsupported families, and returning to a supported family preserves its checked preference. `DeviceSetupControls.audit.test.tsx`, `Identify disclosures toggle and worker streaming records a draft-only preference`, separately proves disclosure interaction and dispatch arguments at the component callback boundary.
- **Transport selection behind the checkbox:** all seven `worker transport firmware eligibility` cases in `laser-connect-hosted-eligibility.test.ts` passed: saved opt-in is ignored for Marlin/Smoothieware; explicit opt-in is retained for GRBL/grblHAL/FluidNC/default driver; ordinary transport remains selected without opt-in. These call the real connect action and inspect exact `SerialOpenRequest` arguments at a mocked `port.open` that throws before opening a session.
- **Dwell preparation:** nine `start-job-preparation-dwell.test.ts` cases retain unavailable estimates for uncertain connected dwell evidence, including line-budget and missing-position fallbacks; proven-seconds, offline, and no-dwell paths retain their applicable estimates. Each preparation still succeeds. The existing timing handoff case also passed.
- **Streaming and recovery:** six hosted-refill cases and eight worker invalidation cases passed, covering simulated barrier/session invalidation and no additional motion refill after reboot, MPG, alarm, or sleep input. Fourteen recovery reconciliation cases cover the memory and fake IndexedDB stores, archive reuse/reconstruction, mismatched program or integrity rejection, and preservation of a newer pending Start across asynchronous work. Eight handoff and two terminal-coordinator cases also passed. These are software state-machine/transport and simulated persistence evidence.

## Boundary and change scope

No physical controller, serial port, laser, spindle, motor, material, or provider was operated. DOM tests do not qualify visual layout; worker bridge fixtures do not qualify an actual browser worker/USB handoff; fake IndexedDB does not prove persistence after an actual browser crash. These reports supplement the broader audit and browser checks rather than extending their claims.

The sole source change in this bounded review is the added unknown-dwell completion simulator case in `src/ui/laser/CompletedJobNotice.simulator.test.tsx`. No production code or machine policy was changed.

## Commands

```text
pnpm exec vitest run src/ui/laser/CompletedJobNotice.test.tsx src/ui/laser/CompletedJobNotice.simulator.test.tsx src/ui/laser/release-motors-complementarity.test.tsx src/ui/laser/OriginRow.test.tsx src/ui/laser/MachineRunControls.audit.test.tsx src/ui/laser/JobControls.setup-navigation.test.tsx src/ui/laser/device-setup/DeviceSetupControls.audit.test.tsx src/ui/laser/device-setup/DeviceSetupWizard.test.tsx src/ui/laser/start-job-preparation-dwell.test.ts src/ui/laser/start-job-preparation-timing.test.ts src/ui/state/laser-hosted-refill.test.ts src/__fixtures__/worker-stream-invalidation.test.ts src/ui/state/recovery/recovery-start-intent-reconciliation.test.ts src/ui/state/recovery/recovery-start-intent-handoff.test.ts src/ui/state/recovery/recovery-terminal-coordinator.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/audits/2026-09-21-interface/pr-remediation-machine-vitest.json

pnpm exec vitest run src/ui/laser/CompletedJobNotice.simulator.test.tsx src/ui/state/laser-connect-hosted-eligibility.test.ts -t "unknown-dwell|worker transport firmware eligibility" --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/audits/2026-09-21-interface/pr-remediation-machine-completion-vitest.json

pnpm exec eslint src/ui/laser/CompletedJobNotice.simulator.test.tsx
pnpm exec prettier --check src/ui/laser/CompletedJobNotice.simulator.test.tsx
```
