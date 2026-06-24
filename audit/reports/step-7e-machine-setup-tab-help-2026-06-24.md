# Step 7E: Machine Setup Tab Help Metadata

## Goal

Make Machine Setup tabs carry explicit, stable help metadata so the learning/help system can identify the operator-facing sections without relying on button text alone.

Out of scope: new UI layout, new Machine Setup features, Cloudflare deploy, and hardware smoke.

## Research Evidence

- `src/ui/kit/Button.tsx`: shared buttons default `title` from text children, but do not create a `data-help-id`.
- `src/ui/help/help-topics.ts`: existing help registry already supports `control:` help ids through `helpProps`.
- `src/ui/laser/MachineSetupDialog.tsx`: Machine Setup tab buttons were rendered from a local `TABS` list with labels only.
- `src/ui/a11y/button-hover-contract.test.ts`: existing broad guard checks for either a title or stable help id, so tab-specific help ids needed a focused regression test.

## Failing Proof

Added `MachineSetupDialog` coverage requiring every tab to expose:

- `data-help-id="control:laser.machine-setup.tab.*"`
- a meaningful explanatory `title`

Initial red run:

```text
pnpm vitest run src/ui/laser/MachineSetupDialog.test.tsx --testNamePattern "explicit help metadata"
FAIL: expected undefined to be 'control:laser.machine-setup.tab.overview'
```

## Implementation

- Added seven Machine Setup tab control help topics:
  - Overview
  - Profile Catalog
  - Controller Settings
  - Firmware Writes
  - Safety Zones
  - Raster Diagnostics
  - Import / Export
- Wired `MachineSetupDialog` tabs through `helpProps(item.helpId)`.
- Extended help registry tests so the tab ids stay meaningful.

## Verification

```text
pnpm vitest run src/ui/laser/MachineSetupDialog.test.tsx --testNamePattern "explicit help metadata"
PASS: 1 test passed

pnpm vitest run src/ui/laser/MachineSetupDialog.test.tsx src/ui/help/help-topics.test.ts src/ui/a11y/button-hover-contract.test.ts
PASS: 3 files, 15 tests

pnpm format:check
PASS after formatting touched files

pnpm typecheck
PASS

pnpm lint
PASS with existing boundaries legacy-selector warning

pnpm test
PASS: 349 files, 2153 tests
```

Browser smoke used a temporary hidden Chrome profile with CDP against `http://127.0.0.1:5173/`:

```json
{
  "tabCount": 7,
  "missing": [],
  "weakTitles": [],
  "selectedBeforeClick": "Overview",
  "profileCatalogVisible": true
}
```

## Audit

Findings: none accepted.

Rejected concern: the first browser attempt through the in-app browser control timed out on stale tab/dialog inspection. A separate real Chrome smoke was used instead and exited successfully.

## Rating

10/10

- Correctness: every Machine Setup tab has the expected stable help id and meaningful title.
- Safety: no machine-control behavior changed.
- UX: hover/help text now explains each Machine Setup section.
- Regression coverage: focused component test plus help registry and accessibility contracts.
- Real-artifact evidence: local real Chrome smoke against the running app.
- Maintainability: uses the existing help registry and shared `helpProps`.
