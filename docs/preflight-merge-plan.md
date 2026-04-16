# Preflight Merge Plan

## 1) Coverage matrix

| Check | Old (`PreflightChecker`) | New (`Preflight`) |
| --- | --- | --- |
| Scene has no output objects | ✓ (`design-empty`) | ✓ (`SCENE_EMPTY` / `NO_VISIBLE_LAYERS`) |
| Machine disconnected | ✓ (`machine-disconnected`, blocker) | ✗ |
| Machine in ALARM/HOLD/RUN/HOMING | ✓ | ✗ |
| Machine non-idle warning | ✓ | ✗ |
| Object outside material bounds | ✓ (full blocker / partial warning) | ✗ |
| Object outside bed (object bbox) | ✓ | ✓ (`OUT_OF_BOUNDS_MAX`, `OUT_OF_BOUNDS_MIN`) |
| Output/G-code exceeds bed bounds | ✓ (`output-exceed-x/y`) | partial (scene bounds only) |
| Negative output coordinates | ✓ (`output-negative-x/y`) | partial (`OUT_OF_BOUNDS_MIN` only) |
| Missing generated output (`output-no-gcode`) | ✓ | ✗ |
| Text too small / empty text warnings | ✓ | ✗ |
| Engrave fill tiny geometry warning | ✓ | ✗ |
| Image raster data missing blocker | ✓ | ✗ |
| Rotated/skewed image blocker | ✓ | ✗ |
| Layer zero power | partial (warning) | ✓ (`LAYER_POWER_ZERO`, error) |
| Layer speed too low/high/invalid | partial | ✓ (`LAYER_SPEED_*`) |
| Layer weak cut / overburn heuristics | ✓ | ✗ |
| Layer settings summary info | ✓ (`layer-output-summaries`) | ✗ |
| Missing bed size in profile | ✗ | ✓ (`MISSING_BED_SIZE`) |
| Missing max spindle | ✗ | ✓ (`MISSING_MAX_SPINDLE`) |
| Bed size mismatch vs live machine | ✗ | ✓ (`BED_SIZE_MISMATCH`) |
| Homing enabled but `$H` missing in header | ✗ | ✓ (`HOMING_ENABLED_NO_H`) |
| Accel-aware on but no accel params | ✗ | ✓ (`ACCEL_AWARE_NO_ACCEL_PARAM`) |
| Smart overscan exceeds bed | ✗ | ✓ (`OVERSCAN_EXCEEDS_BED`) |
| Calibration table non-monotonic | ✗ | ✓ (`CALIBRATION_NOT_MONOTONIC`) |
| Optimize-order disabled hint | ✗ | ✓ (`OPTIMIZE_ORDER_OFF`) |
| Long job warning | ✗ | ✓ (`LONG_JOB`) |

## 2) Schema diff

### Old
- `PreflightIssue`: `{ id, severity: blocker|warning|info, title, detail, fix?: string, category }`
- `PreflightResult`: `{ score, issues[], blockers, warnings, canStart }`

### New
- `PreflightResult` (item): `{ severity: error|warning|info, code, message, layerId?, objectId?, fix?: { label, action } }`
- Output is flat `PreflightResult[]`

### Semantic mapping
- `old.severity=blocker` <-> `new.severity=error`
- `old.id` <-> `new.code`
- `old.title/detail` <-> `new.message` (lossy unless expanded)
- `old.fix` string <-> `new.fix.label` (only partial)

### Non-matching fields
- Old-only: `score`, `blockers`, `warnings`, `canStart`, `category`, rich `detail`
- New-only: `layerId`, `objectId`, structured `fix.action` discriminated union

## 3) Callers

### Runtime/UI call sites
- `src/ui/components/ConnectionPanelMain.tsx`
  - Uses old checker (`runPreflight` from `PreflightChecker`).
  - Uses `PreflightResult` + `PreflightIssue` old shapes throughout render.
  - Uses `confirmPreflightForJobStart(preflight, ...)`.
  - Behavioral change risk if swapped directly: **high** (expects `score/canStart/issues/title/detail`).

### Helper
- `src/core/preflight/confirmPreflightForJobStart.ts`
  - Typed to old `PreflightResult`.
  - Expects blocker/warning counts + issue title/fix strings.

### Tests
- `tests/preflight-bounds.test.ts`: old checker.
- `tests/autosave-serialization.test.ts`: old checker.
- `tests/preflight.test.ts`: new engine.

## 4) Fix action vocabulary

### Old checker
- `fix?: string` human guidance only.
- Rendered today in `ConnectionPanelMain.tsx` as plain text (`issue.fix`), no action button/dispatch.

### New engine
- `fix` supports typed actions:
  - `fitToBed`
  - `clampToOrigin`
  - `setLayerPower`
  - `setLayerSpeed`
  - `enableHoming`
  - `disableSmartOverscan`

### Overlap
- Conceptual overlap exists ("what to do"), but no executable fix actions are currently wired in UI.

## 5) Recommendation

**(c) Merge into a single engine with both codebases' checks.**

Rationale:
- Old checker owns critical send-time machine safety checks and has proven integration.
- New checker introduces structured codes/fixes and Phase-2 feature checks that should be first-class.
- Keeping both long-term creates drift and contradictory severity semantics.

Suggested migration approach:
1. Keep `PreflightChecker.ts` API stable short-term, but make it a thin adapter over a merged core.
2. Merged core should use new schema (`error|warning|info`, `code`, typed `fix`) and include all old critical checks.
3. Migrate `ConnectionPanelMain` + `confirmPreflightForJobStart` to merged schema in one controlled step, then remove adapter compatibility.

## Disclosure

### 1) `PreflightIssue.fix` shape + old-checker examples

Exact old-checker type:

```ts
export interface PreflightIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix?: string;
  category: 'machine' | 'design' | 'settings' | 'output';
}
```

Real non-null `fix` issue literals from `PreflightChecker.ts`:

```ts
issues.push({
  id: 'machine-alarm',
  severity: 'blocker',
  title: 'Machine in ALARM state',
  detail: `Alarm code: ${machineState.alarmCode ?? 'unknown'}`,
  fix: 'Click Unlock ($X) to clear the alarm',
  category: 'machine',
});
```

```ts
issues.push({
  id: `design-text-small-${obj.id}`,
  severity: 'warning',
  title: `Text "${obj.name}" has a very small font (${fontSize.toFixed(1)}mm)`,
  detail: 'Small or thin text may not convert to outlines correctly and could be missing from the job output',
  fix: 'Increase the font size to at least 4mm, or use a bolder font',
  category: 'design',
});
```

```ts
issues.push({
  id: `settings-overburn-${layer.id}`,
  severity: 'warning',
  title: `Layer "${layer.name}" high power + slow speed`,
  detail: `${layer.settings.power.max}% at ${layer.settings.speed}mm/min may cause burning or fire`,
  fix: 'Reduce power or increase speed',
  category: 'settings',
});
```

### 2) How `fix` is rendered in `ConnectionPanelMain.tsx`

```ts
const issuesSection = isConnected && !isRunning && !displayPaused && (issues.length > 0 || readinessScore != null) && React.createElement('div', {
  style: { padding: '10px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
},
  React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 } }, 'Issues'),
  ...issues.map((issue: PreflightIssue, i: number) =>
    React.createElement('div', {
      key: issue.id ?? i,
      style: {
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '6px 0',
        borderBottom: i < issues.length - 1 ? '1px solid #12121e' : 'none',
      },
    },
      React.createElement('span', {
        style: {
          fontSize: 12, flexShrink: 0, marginTop: 1,
          color: issue.severity === 'blocker'
            ? '#ff4466'
            : issue.severity === 'info'
              ? '#8888aa'
              : '#ffd444',
        },
      }, issue.severity === 'blocker' ? '✗' : issue.severity === 'info' ? 'ℹ' : '⚠'),
      React.createElement('div', null,
        React.createElement('div', {
          style: {
            fontSize: 11,
            color: issue.severity === 'blocker' ? '#ff4466' : issue.severity === 'info' ? '#c0c0d8' : '#ffd444',
          },
        }, issue.title),
        issue.detail && React.createElement('div', {
          style: { fontSize: 9, color: '#555570', marginTop: 2, whiteSpace: 'pre-line' as const, fontFamily: mono },
        }, issue.detail),
        issue.fix && React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 2 } }, issue.fix),
      ),
    ),
  ),
  readinessScore != null && React.createElement('div', {
    style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 },
  },
```

Conclusion: `fix` is rendered as plain text (`div`), not a button/link; no callback/store dispatch is wired.

### 3) Output-bounds logic (preferred `machinePlanBounds` + G-code fallback)

```ts
if (machinePlanBounds) {
  // Preferred path: use pre-computed machine-space bounds from applyMachineTransform
  const { minX, maxX, minY, maxY } = machinePlanBounds;

  if (minX < -1) {
    issues.push({
      id: 'output-negative-x',
      severity: 'warning',
      title: `Output has negative X (${minX.toFixed(1)}mm)`,
      detail:
        'Many setups use negative work coordinates after zeroing; this is only a problem if the job exceeds your machine travel.',
      fix: 'Verify your work zero and soft limits match this job, or move the design in the editor',
      category: 'output',
    });
  }
  if (minY < -1) {
    issues.push({
      id: 'output-negative-y',
      severity: 'warning',
      title: `Output has negative Y (${minY.toFixed(1)}mm)`,
      detail:
        'Top-left homing often uses negative Y in work space; confirm the job still fits your envelope and soft limits.',
      fix: 'Verify your work zero and machine limits, or adjust the design / start position',
      category: 'output',
    });
  }
  if (maxX > bedWidth + 1) {
    issues.push({
      id: 'output-exceed-x',
      severity: 'blocker',
      title: `Output exceeds bed width (${maxX.toFixed(1)}mm > ${bedWidth}mm)`,
      detail: 'Objects extend beyond the machine workspace',
      category: 'output',
    });
  }
  if (maxY > bedHeight + 1) {
    issues.push({
      id: 'output-exceed-y',
      severity: 'blocker',
      title: `Output exceeds bed height (${maxY.toFixed(1)}mm > ${bedHeight}mm)`,
      detail: 'Objects extend beyond the machine workspace',
      category: 'output',
    });
  }
} else if (gcode) {
  // Fallback: parse raw G-code text (legacy path, kept for backward compat)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const line of gcode.split('\n')) {
    const xm = line.match(/X([-\d.]+)/);
    const ym = line.match(/Y([-\d.]+)/);
    if (xm) { const x = parseFloat(xm[1]); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (ym) { const y = parseFloat(ym[1]); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }

  if (minX < -1) {
    issues.push({
      id: 'output-negative-x',
      severity: 'warning',
      title: `G-code has negative X (${minX.toFixed(1)}mm)`,
      detail:
        'Many setups use negative work coordinates after zeroing; this is only a problem if the job exceeds your machine travel.',
      fix: 'Verify your work zero and soft limits match this job, or move the design in the editor',
      category: 'output',
    });
  }
  if (minY < -1) {
    issues.push({
      id: 'output-negative-y',
      severity: 'warning',
      title: `G-code has negative Y (${minY.toFixed(1)}mm)`,
      detail:
        'Top-left homing often uses negative Y in work space; confirm the job still fits your envelope and soft limits.',
      fix: 'Verify your work zero and machine limits, or adjust the design / start position',
      category: 'output',
    });
  }
  if (maxX > bedWidth + 1) {
    issues.push({
      id: 'output-exceed-x',
      severity: 'blocker',
      title: `G-code exceeds bed width (${maxX.toFixed(1)}mm > ${bedWidth}mm)`,
      detail: 'Objects extend beyond the machine workspace',
      category: 'output',
    });
  }
  if (maxY > bedHeight + 1) {
    issues.push({
      id: 'output-exceed-y',
      severity: 'blocker',
      title: `G-code exceeds bed height (${maxY.toFixed(1)}mm > ${bedHeight}mm)`,
      detail: 'Objects extend beyond the machine workspace',
      category: 'output',
    });
  }
} else {
  issues.push({
    id: 'output-no-gcode',
    severity: 'blocker',
    title: 'No G-code generated',
    detail: 'Add objects and connect to generate output',
    category: 'output',
  });
}
```

`machinePlanBounds` shape:

```ts
machinePlanBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null
```

Caller origin: passed from `ConnectionPanelMain` prop (`machinePlanBounds`) to `runPreflight(...)`. That prop comment says it comes from `applyMachineTransform`.

### 4) Text / image / fill heuristics (verbatim)

```ts
for (const obj of outputObjects) {
  if (obj.geometry.type !== 'text') continue;
  const g = obj.geometry;
  const fontSize = g.fontSize || 10;
  if (fontSize < 4) {
    issues.push({
      id: `design-text-small-${obj.id}`,
      severity: 'warning',
      title: `Text "${obj.name}" has a very small font (${fontSize.toFixed(1)}mm)`,
      detail: 'Small or thin text may not convert to outlines correctly and could be missing from the job output',
      fix: 'Increase the font size to at least 4mm, or use a bolder font',
      category: 'design',
    });
  }
  if (!g.text?.trim()) {
    issues.push({
      id: `design-text-empty-${obj.id}`,
      severity: 'warning',
      title: `Text object "${obj.name}" is empty`,
      detail: 'This text object has no content and will produce no output',
      fix: 'Add text content or remove the object',
      category: 'design',
    });
  }
}
```

```ts
for (const obj of outputObjects) {
  const layer = scene.layers.find(l => l.id === obj.layerId);
  if (!layer || layer.settings.mode !== 'engrave') continue;
  const rawIv = Number(layer.settings.fill.interval);
  const interval = Math.max(0.01, Number.isFinite(rawIv) && rawIv > 0 ? rawIv : 0.1);
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) continue;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const minDim = Math.min(w, h);
  if (minDim < 2 * interval) {
    issues.push({
      id: `design-engrave-small-fill-${obj.id}`,
      severity: 'warning',
      title: `Object "${obj.name || obj.id}" may be too small for engrave fill`,
      detail:
        `Smallest span ≈ ${minDim.toFixed(2)}mm with line spacing ${interval.toFixed(2)}mm — ` +
        'fill may produce few or no scanlines (outline fallback).',
      fix: 'Use a tighter line spacing, enlarge the shape, or switch to score/outline-style engraving.',
      category: 'design',
    });
  }
}
```

```ts
for (const obj of outputObjects) {
  if (obj.geometry.type !== 'image') continue;
  const layer = scene.layers.find(l => l.id === obj.layerId);
  if (layer?.settings.mode === 'image') {
    const g = obj.geometry;
    const hasRasterPixels =
      ((g.adjustedData?.length ?? 0) > 0 || (g.grayscaleData?.length ?? 0) > 0) &&
      (g.grayscaleWidth ?? 0) > 0 &&
      (g.grayscaleHeight ?? 0) > 0;
    if (!hasRasterPixels) {
      issues.push({
        id: `design-image-missing-raster-data-${obj.id}`,
        severity: 'blocker',
        title: `Image "${obj.name || obj.id}" has no raster data loaded`,
        detail:
          'This image cannot produce engraving output right now (common after autosave crash recovery before image processing finishes).',
        fix: 'Reopen or reprocess the image, then confirm preview/compile before starting the job',
        category: 'design',
      });
    }
  }
  const t = obj.transform;
  // b and c are the rotation/skew components of the 2D affine matrix.
  // If non-zero, the image is rotated or skewed — not supported by raster compile.
  const EPS = 0.001;
  if (Math.abs(t.b) > EPS || Math.abs(t.c) > EPS) {
    issues.push({
      id: `design-image-rotated-${obj.id}`,
      severity: 'blocker',
      title: `Image "${obj.name || obj.id}" is rotated or skewed`,
      detail:
        'Rotated/skewed images cannot be compiled correctly — the burn position and size would not match the editor preview.',
      fix: 'Reset the image rotation to 0° or flatten it to a non-rotated copy before running the job',
      category: 'design',
    });
  }
}
```

Thresholds explicitly used: `fontSize < 4`, `interval = max(0.01, ...)`, tiny-fill trigger `minDim < 2 * interval`, image rotation/skew epsilon `EPS = 0.001`, raster-present requires non-zero pixel buffer and positive width/height.

### 5) Weak-cut / overburn heuristic (verbatim)

```ts
if (layer.settings.mode === 'cut' && layer.settings.power.max < 20) {
  issues.push({
    id: `settings-weak-cut-${layer.id}`,
    severity: 'info',
    title: `Layer "${layer.name}" cut power is low (${layer.settings.power.max}%)`,
    detail: 'This may not cut through the material. Consider increasing power or passes.',
    category: 'settings',
  });
}

if (layer.settings.mode === 'cut' && layer.settings.power.max > 95 && layer.settings.speed < 100) {
  issues.push({
    id: `settings-overburn-${layer.id}`,
    severity: 'warning',
    title: `Layer "${layer.name}" high power + slow speed`,
    detail: `${layer.settings.power.max}% at ${layer.settings.speed}mm/min may cause burning or fire`,
    fix: 'Reduce power or increase speed',
    category: 'settings',
  });
}
```

### 6) Scoring formula (verbatim)

```ts
const blockers = issues.filter(i => i.severity === 'blocker').length;
const warnings = issues.filter(i => i.severity === 'warning').length;
const infos = issues.filter(i => i.severity === 'info').length;

let score = 100;
score -= blockers * 30;
score -= warnings * 10;
score -= infos * 2;
score = Math.max(0, Math.min(100, score));
if (blockers > 0) score = Math.min(score, 40);
```

### 7) `canStart` synthesis (verbatim)

```ts
return {
  score,
  issues,
  blockers,
  warnings,
  canStart: blockers === 0,
};
```

### 8) `layer-output-summaries` info issue example

```ts
issues.push({
  id: 'layer-output-summaries',
  severity: 'info',
  title: 'Layer laser settings (output layers)',
  detail: lines.join('\n'),
  category: 'settings',
});
```

### 9) Import surface (`from .*core/preflight`)

- `src/ui/components/ConnectionPanelMain.tsx`
  - `runPreflight`, `PreflightResult`, `PreflightIssue` from `../../core/preflight/PreflightChecker`
  - `confirmPreflightForJobStart` from `../../core/preflight/confirmPreflightForJobStart`
- `tests/preflight-bounds.test.ts`
  - `runPreflight` from `../src/core/preflight/PreflightChecker`
- `tests/autosave-serialization.test.ts`
  - `runPreflight` from `../src/core/preflight/PreflightChecker`
- `tests/preflight.test.ts`
  - `runPreflight`, `hasBlockingErrors`, `groupBySeverity`, `PREFLIGHT_CODES`, `PreflightContext` from `../src/core/preflight/Preflight`
