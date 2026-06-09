# Adjust Image Built-In Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LightBurn-style built-in presets to the Adjust Image dialog without changing burn output until the operator clicks OK.

**Architecture:** Keep preset state local to `AdjustImageDialog.tsx` as part of the existing draft. A preset selection writes the same draft fields the operator can already edit manually, so preview and OK behavior continue through existing code paths.

**Tech Stack:** React 18, TypeScript, Vitest, existing `AdjustImageDialog` component.

---

## Research Basis

- LightBurn Adjust Image exposes presets above Image Settings.
- Selecting a preset immediately applies its saved settings to the dialog.
- Built-in presets are `Basic` and `Black Paint on White`.
- LightBurn docs describe `Basic` as a starting point and `Black Paint on White` as similar but inverted for light marks on dark surfaces.
- LightBurn docs do not publish exact numeric preset values, so LaserForge will implement semantic presets:
  - `Basic`: neutral image adjustment, current layer defaults preserved except dark-material toggles are disabled.
  - `Black Paint on White`: neutral image adjustment plus `negativeImage: true` and `invertDisplay: true`.

## Files

- Modify: `src/ui/raster/AdjustImageDialog.tsx`
- Create: `src/ui/raster/AdjustImageDialog.presets.tsx`
- Modify: `src/ui/raster/AdjustImageDialog.test.tsx`

## Task 1: Built-In Preset Selector

- [x] **Step 1: Write the failing test**

Add a test to `src/ui/raster/AdjustImageDialog.test.tsx`:

```tsx
it('applies built-in presets to the local draft before OK', async () => {
  const onApply = vi.fn();
  const { host, root } = await renderDialog({ onApply });
  try {
    change(host, 'input[name="brightness"]', '25');
    click(host, 'input[name="negativeImage"]');
    click(host, 'input[name="invertDisplay"]');

    change(host, 'select[name="imagePreset"]', 'basic');

    expect((host.querySelector('input[name="brightness"]') as HTMLInputElement).value).toBe('0');
    expect((host.querySelector('input[name="negativeImage"]') as HTMLInputElement).checked).toBe(
      false,
    );
    expect((host.querySelector('input[name="invertDisplay"]') as HTMLInputElement).checked).toBe(
      false,
    );

    change(host, 'select[name="imagePreset"]', 'black-paint-on-white');

    expect((host.querySelector('input[name="negativeImage"]') as HTMLInputElement).checked).toBe(
      true,
    );
    expect((host.querySelector('input[name="invertDisplay"]') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(onApply).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx
```

Expected: FAIL because `select[name="imagePreset"]` does not exist.

- [x] **Step 3: Add minimal implementation**

Add a local preset type and selector in `AdjustImageDialog.tsx`:
If the dialog crosses the repo file-size limit, put this preset-specific code in
`src/ui/raster/AdjustImageDialog.presets.tsx` and import it from the dialog.

```tsx
type BuiltInImagePresetId = 'custom' | 'basic' | 'black-paint-on-white';

const BUILT_IN_IMAGE_PRESETS = [
  { id: 'custom', label: 'Custom' },
  { id: 'basic', label: 'Basic' },
  { id: 'black-paint-on-white', label: 'Black Paint on White' },
] as const;
```

Add `presetId` to `Draft`, default it to `custom`, and add:

```tsx
function applyPreset(draft: Draft, presetId: BuiltInImagePresetId): Draft {
  if (presetId === 'custom') return { ...draft, presetId };
  const base = {
    ...draft,
    presetId,
    brightness: 0,
    contrast: 0,
    gamma: 1,
    negativeImage: false,
    invertDisplay: false,
  };
  if (presetId === 'black-paint-on-white') {
    return { ...base, negativeImage: true, invertDisplay: true };
  }
  return base;
}
```

Render a `select[name="imagePreset"]` before the numeric image controls. On change, call `setDraft((prev) => normalizeDraft(applyPreset(prev, parsePreset(event.target.value))))`.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx
```

Expected: all `AdjustImageDialog` tests pass.

- [x] **Step 5: Focused verification**

Run:

```bash
pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx src/ui/commands/command-registry.test.ts src/ui/state/store.test.ts src/core/raster/luma-adjust.test.ts src/ui/workspace/draw-raster-preview.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/io/project/project.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
pnpm test
pnpm build:web
```

Expected: all commands exit 0; lint may keep the existing boundaries warning.

- [x] **Step 6: Audit and commit**

Audit checklist:

- Presets are local draft-only until OK.
- `Black Paint on White` uses `negativeImage` for burn output and `invertDisplay` for preview.
- `Basic` does not invent undocumented numeric values.
- No production code references old Trace adjustment controls.

Commit:

```bash
git add src/ui/raster/AdjustImageDialog.tsx src/ui/raster/AdjustImageDialog.presets.tsx src/ui/raster/AdjustImageDialog.test.tsx docs/superpowers/plans/2026-06-08-adjust-image-built-in-presets.md
git commit -m "feat(raster): add adjust image built-in presets"
git push origin wip/checkpoint-2026-06-03
```

Verification completed:

- RED: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx` failed before implementation because `select[name="imagePreset"]` was missing.
- GREEN: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx` passed.
- Focused tests: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx src/ui/commands/command-registry.test.ts src/ui/state/store.test.ts src/core/raster/luma-adjust.test.ts src/ui/workspace/draw-raster-preview.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/io/project/project.test.ts` passed.
- Full gates: `pnpm typecheck`, `pnpm format:check`, `pnpm lint`, `pnpm check:file-size`, `pnpm test`, and `pnpm build:web` passed.
- Audit: `git diff --check` passed, and presets remain local-draft only until OK.
