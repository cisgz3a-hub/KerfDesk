# Controller, workspace and jig fixes

Baseline: `ccaa3064d9efe904821307f0603ce842d903b586`.

- F17-01: the synchronous jig editor validates rows × columns before any outline/ID allocation.
  It uses the existing project persistence limits (10,000 objects and 256 operations), reserves
  capacity for retained artwork, and reclaims replaced jig outlines. Blank, fractional and invalid
  counts, invalid dimensions/gaps, and non-finite footprints/positions leave project/undo state
  untouched. A replacement at the object limit round-trips through project serialization.
- F22-2: full-page CNC preview registers modal ownership and uses shared initial focus, Tab trap,
  Escape and focus restoration. Its toolbar and renderer lifetime are retained. This legacy pane
  remains intentionally unmounted in production; its acceptance is source/DOM evidence.
- F23-1: the Inspector syncs the latest travel visibility after scene readiness, as it does its
  other derived view controls.
- F24-1: a canvas machine point goes through `jogToMachinePosition`, retaining work-offset/unit
  conversion and the existing CNC safe-Z sequence. Simulated real-store GRBL evidence with
  MPos (50,70), WCO (40,50), and target (100,100) emits relative X50/Y30.
- F24-2: origin transactions capture controller session, write epoch and operation identity.
  They check ownership around every asynchronous continuation and during the post-ACK WCO wait.
  Both success and failure leave a retired transaction's replacement session untouched.
- F25-1: a run-scoped variable observer is installed before `startJob`. It records early terminal
  completion but advances only after the initial write is accepted. Session/stream replacement
  and failed writes cancel it. Retained IDs from a previous completed run do not cancel a new
  observer before its streamer is created.
- F26-1: console Copy reports success and supplies selectable transcript text if clipboard access
  is missing, throws synchronously, or rejects asynchronously. Clear and filter changes retire
  pending copy results and clear the old manual transcript.

Regression evidence exercises the actual controller store with simulated transport, actual global
shortcut handler and dialogs with simulated WebGL, delayed scene readiness, early stream completion,
replacement ownership, incomplete jig fields and clipboard failures. No machine, camera or material
was operated. Full verification and PR/main identifiers are recorded in the remediation ledger.

Browser acceptance on controller commit `0ec227d40` is recorded in [browser.md](browser.md).
