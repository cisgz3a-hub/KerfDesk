# Connection-panel redesign (WorkflowPanel)

## Why this exists

User report: the existing `src/ui/components/ConnectionPanelMain.tsx`
(~1700 lines) renders ~22 sub-components in a single vertical stack.
On smaller windows the bottom (primary actions, job control footer)
gets pushed off-screen. There's no mode-driven progressive disclosure
— recovery cards, banners, jog pad, frame controls, layer overview,
compile progress, issues list, ready-to-run, simulator, console, and
job footer can all be on-screen at once.

## What we're building

A new top-level component **`WorkflowPanel`** with a three-zone layout
and mode-driven middle. Lives at
`src/ui/components/workflow/WorkflowPanel.tsx`.

```
┌────────────────────────────────────────┐
│ TOP BAR (always visible)               │
│  status badge · X/Y position · ESTOP   │
├────────────────────────────────────────┤
│                                        │
│ MODE CONTENT (scrolls inside zone)     │
│  one of 6 modes, mutually exclusive    │
│                                        │
├────────────────────────────────────────┤
│ PRIMARY ACTION FOOTER                  │
│  one contextual button + secondaries   │
└────────────────────────────────────────┘
```

## Panel modes

Picked from a derived `PanelMode` value (pure function — testable
without React). Mutual exclusion is by construction.

| Mode | When | Content |
|---|---|---|
| `disconnected` | no controller | ConnectWizard (USB / Simulator) |
| `connecting` | handshake in flight | Spinner + Cancel |
| `recovery` | recovery state non-none OR alarm OR fault | Recovery card (hard lock — replaces all other content) |
| `setup` | idle + no fresh compiled job | Tabs: **Move** · **Job** · **Console** |
| `ready` | idle + compiled fresh job + preflight ok | ReadyToRun summary card |
| `running` / `paused` | job active | Progress + Pause/Resume + Stop |

The Emergency Stop sits in the top bar (always visible when
connected) per industrial-control convention. It never gets covered
by scrolling, modals, or layout changes.

Recovery mode is a **hard lock** — when active, no other tab is
reachable. This matches the existing `recoveryAllowsStart()` gate.

## Setup-mode tabs

`setup` is the only mode with internal tabs. Inside `setup`:

- **Move** — Jog pad, Home, Last position, Auto-focus, Set origin,
  Frame, Test fire.
- **Job** — Profile, Start mode, Layer overview, Recompile prompt,
  Compile progress.
- **Console** — Manual command + message log + simulator toggle.

One tab visible at a time. Tab state persisted in localStorage so it
survives reload.

## Rollout

Feature-flagged in localStorage (`laserforge.workflowPanelV2`).
Default off. `ConnectionPanel.tsx` reads the flag and routes to
`ConnectionPanelMain` (existing) or `WorkflowPanel` (new). Old panel
keeps working until parity is confirmed.

Once parity is confirmed and the user flips the flag on for a few
sessions, we delete the old panel.

## Phases

**Phase 1 (this PR — T1-204):** scaffold.

- Design doc (this file).
- `src/ui/features/uiFeatureFlags.ts` — localStorage flag get/set.
- `src/ui/components/workflow/derivePanelMode.ts` — pure mode
  derivation (testable without React).
- `src/ui/components/workflow/WorkflowPanel.tsx` — top-level shell
  that selects a mode and routes to a mode component.
- `src/ui/components/workflow/zones/TopBar.tsx` — real wiring (status
  + position + E-Stop button).
- `src/ui/components/workflow/zones/PrimaryActionFooter.tsx` —
  real wiring (contextual primary button + secondaries).
- `src/ui/components/workflow/modes/*` — stub renderers that say
  "Phase N will fill this in" so the routing is verifiable end-to-
  end with the flag on.
- `ConnectionPanel.tsx` reads the flag and routes between old and
  new.
- Tests pinning the derivation logic + flag persistence.

**Phase 2 (T1-205+):** implement `disconnected` + `connecting` +
`recovery` modes by reusing existing components
(`ConnectWizard`, `RecoveryCard`).

**Phase 3 (T1-206+):** implement `setup` with the three tabs
(`Move` / `Job` / `Console`).

**Phase 4 (T1-207+):** implement `ready` + `running` + `paused`.

**Phase 5 (T1-208+):** flip the feature-flag default to on. Delete
the old panel once parity is confirmed across several real sessions.

## Constraints

- Every existing button / function must remain reachable. Inventory
  was captured by an Explore agent before design started; nothing
  may regress silently.
- Safety gates (`computeCommandGates`, `recoveryAllowsStart`,
  `evaluateActionAllowed`, `placementUncertain`) are unchanged at
  the service layer. The new panel READS them; it never bypasses.
- TS baseline stays at 0 errors at every phase.
- New components are small. The current panel's 1700 LoC was the
  problem; the new shell at the top of the tree should be <300 LoC,
  with each mode <250 LoC.

## Hardware verification

Required at Phases 2–5 (each mode must be exercised on Falcon A1 Pro
before it can be flipped on by default). Phase 1 is type-safe routing
and stub renders; no machine commands run.
