# Step 7F: Detected Settings Review Help Metadata

## Goal

Make the machine-settings auto-detection review flow teachable and auditable by adding stable help metadata to the detected-settings banner and its review actions. Scope is UI metadata only; no controller, serial, firmware, or machine-profile behavior changed.

## Research Evidence

- `src/ui/laser/DetectedSettingsToast.tsx` already raises the Machine Setup toast after `lastSettingsReadAt` changes.
- `src/ui/laser/MachineSetupController.tsx` renders `DetectedSettingsBanner` in the Controller Settings tab.
- `src/ui/laser/DetectedSettingsBanner.tsx` had user-facing titles but no stable `data-help-id` contract for help coverage or automation.
- `src/ui/a11y/button-hover-contract.test.ts` scans raw JSX attributes, so raw buttons need explicit `title` and `data-help-id` attributes rather than spread-only props.

## Red Proof

Added `DetectedSettingsBanner` coverage for explicit help metadata, then ran:

```text
pnpm vitest run src/ui/laser/DetectedSettingsBanner.test.ts --testNamePattern "explicit help metadata"
```

Initial result failed because the detected-settings region did not expose `control:laser.detected-settings.review`.

## Implementation

- Added help topics for:
  - `control:laser.detected-settings.review`
  - `control:laser.detected-settings.dismiss`
  - `control:laser.detected-settings.apply-safe`
  - `control:laser.detected-settings.powered-z`
- Added explicit metadata to the detected-settings review region, Dismiss button, Apply safe settings button, and powered-Z review action.
- Made `ReviewAction.helpId` required so new review actions cannot silently skip metadata.
- Updated help-topic and banner tests.

## Browser Smoke

Headless Chrome loaded `http://127.0.0.1:5173/` with a fake Web Serial GRBL controller. The app connected through the normal serial adapter, wrote `$$`, collected settings, showed the auto-detection toast, opened Machine Setup, selected Controller Settings, and verified:

```json
{
  "toastVisible": true,
  "regionHelpId": "control:laser.detected-settings.review",
  "dismissHelpId": "control:laser.detected-settings.dismiss",
  "applyHelpId": "control:laser.detected-settings.apply-safe",
  "poweredZHelpId": "control:laser.detected-settings.powered-z",
  "writes": ["?", "$$\\n"],
  "consoleErrors": []
}
```

No hardware was touched.

## Verification

Passed before this report was added:

```text
pnpm vitest run src/ui/laser/DetectedSettingsBanner.test.ts src/ui/laser/LaserWindow.test.tsx src/ui/help/help-topics.test.ts src/ui/a11y/button-hover-contract.test.ts
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
```

## Audit

Findings: none accepted.

Rejected false positives:

- The change does not add firmware behavior or controller writes; it only labels the existing review surface.
- The fake serial smoke does not claim hardware compatibility; it proves the browser UI path and serial-handshake plumbing without machine risk.
- `data-help-id` values are duplicated as literals on raw buttons intentionally because the existing accessibility scanner cannot inspect JSX spread props.

## Rating

10/10 for this slice: correctness, safety, UX metadata, regression coverage, browser evidence, maintainability, and audit clarity all pass with no accepted findings.
