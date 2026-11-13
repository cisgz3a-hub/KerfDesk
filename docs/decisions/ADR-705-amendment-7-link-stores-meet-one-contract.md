## ADR-705 Amendment 7 - Link stores meet one contract (2026-11-13)

**Status:** Accepted. Amends ADR-705 Amendments 3, 4 and 6 and ADR-703 Amendments 1 and 2.
Fixes C2 verification E2-P3-2, E2-P3-3 and E2-P3-4 (`docs/audits/2026-11-12-c2-verify/`). Keeps
PROJECT.md non-negotiable 9. **Simulator-tested only.** | **Date:** 2026-11-13

### Context

Three link routes reach a machine outside the line-based laser store: the Moshiboard and the
K40 over USB, and the Ruida over the network. The shared pieces were each wired in by hand:

- the machine-work registry that Ctrl+., close, Update and the dialogs read;
- the link job request (placement, output scope, variable advance);
- the shared job warnings.

The K40 missed the registry once (D4-P1-1) and the request once (D6-P1-1). The only guard was a
test that looked for `reportLinkMachineWork` in folders named `*-usb` or `*-network`. The
completion was optional in every job type, and the warnings were added at three separate UI
call sites (E2-P3-2).

The `.rd`, `.egv` and Moshiboard preflight adapters were three copies of one function. Several
moves of one layer could read the same and be listed twice (E2-P3-3). Five comments still
named two links (E2-P3-4).

### Decision

1. **Shared job warnings are a branded type.**
   - `sharedJobWarnings(prepared, routeChecks)` (`ui/laser/shared-job-warnings.ts`) runs
     `detectMachineJobWarnings` and appends a route's own checks, such as the rotary row grid.
   - It is the only maker of `SharedJobWarnings`.
   - The `.rd` and `.egv` wrappers return it; the Moshi job calls it.
2. **A link job is built on a branded outcome.**
   - `linkJobOutcome(request, routeAdvisories, jobWarnings)` (`ui/state/link-job-outcome.ts`)
     is the only maker of `LinkJobOutcome`.
   - It takes the shared request and the shared warnings, and gives the job its advisories
     (each line once) and a required `completed`.
   - `MoshiUsbJob`, `LihuiyuUsbJob` and `RuidaNetworkJob` are `LinkJobOutcome & {…}`.
   - Tests that build a job from encoder output use `testLinkJobOutcome`.
3. **A store joins through `connectLinkStore`.**
   - `connectLinkStore(source, store, {controller, activeWork})` (`ui/state/link-store-
     connection.ts`) replaces the three hand-written subscribe blocks. It reports the
     connection, the Frame and the active work, with the store's own Abort.
   - It accepts a store only if its Frame and Start take a job that extends `LinkJobOutcome`.
     Otherwise the call does not compile.
   - The check is a conditional type, not a method parameter. Method parameters are compared
     both ways, which would let a looser job through.
   - `link-machine-work-sources.test.ts` now finds every module under `src/ui` that implements a
     Frame or Start taking a job, whatever its folder is called. It fails when one does not call
     `connectLinkStore`, or when the sources differ from `LINK_MACHINE_SOURCES`.
4. **One motion preflight.**
   - `runMotionPreflight` (`io/motion-preflight.ts`) writes a route's planned moves as G-code
     lines and runs the same `runPreflight`.
   - It relabels "Line N" as the move's layer and lists each finding once.
   - `runRdPreflight`, `runEgvPreflight` and `runMoshiPreflight` are now step-to-mm mappers.
5. **Comments name the K40.** The close, session-end, Machine Setup Save, Ctrl+. and dialog
   comments say "Moshi, K40 or Ruida".

The K40 air note (E2-P3-3) shipped in ADR-703 Amendment 2.

**For the JCZ galvo route (ADR-704, PR #1725, not merged):** its store must call
`connectLinkStore` with a source added to `LINK_MACHINE_SOURCES`. Its job type must be
`LinkJobOutcome & {…}`, built with `linkJobOutcome(request, advisories, sharedJobWarnings(…))`.
Until it does, the sources test fails on it and its Frame and Start do not type-check against
the contract.

### Evidence

- `link-store-connection.test.ts`:
  - a connected fake store reports connection, Frame and work, and its Abort is reached;
  - two `@ts-expect-error` lines check that a job without the outcome, or a looser job the
    outcome would fit, does not connect. The typecheck fails if either ever compiles.
- `link-machine-work-sources.test.ts`: all three stores are found and connected.
- The existing link store, job, preflight, Save `.rd`/`.egv` and job-route suites pass
  unchanged apart from building their jobs on the outcome.

### Consequences

- A new link route cannot reach Start without the shared request, the job warnings and the
  variable advance. It cannot run jobs without joining the registry that Abort, close and
  Update read.
- The three preflight adapters can no longer drift apart.
