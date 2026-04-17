/**
 * Preflight checker — validates a scene + machine state before job execution.
 * Returns a readiness score (0-100%) with categorized issues.
 *
 * Delegates core rules to `Preflight.ts` and keeps legacy-only checks here until step 3.
 */

import { type Scene, getOutputLayers } from '../scene/Scene';
import { type SceneObject } from '../scene/SceneObject';
import { type MachineState } from '../../controllers/ControllerInterface';
import { computeObjectBounds } from '../../geometry/bounds';
import {
  runPreflight as runNewPreflight,
  type PreflightContext,
  type PreflightResult as NewPreflightResult,
} from './Preflight';
import { createBlankProfile, getActiveProfile } from '../devices/DeviceProfile';

function hasUsableObjectBounds(bounds: ReturnType<typeof computeObjectBounds>): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
}

function isObjectOutsideMaterial(
  obj: SceneObject,
  material: { x: number; y: number; width: number; height: number },
): { outside: boolean; partial: boolean } {
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) return { outside: false, partial: false };

  const matMinX = material.x;
  const matMinY = material.y;
  const matMaxX = material.x + material.width;
  const matMaxY = material.y + material.height;

  const fullyOutside =
    bounds.maxX < matMinX ||
    bounds.minX > matMaxX ||
    bounds.maxY < matMinY ||
    bounds.minY > matMaxY;

  if (fullyOutside) return { outside: true, partial: false };

  const partiallyOutside =
    bounds.minX < matMinX ||
    bounds.maxX > matMaxX ||
    bounds.minY < matMinY ||
    bounds.maxY > matMaxY;

  return { outside: false, partial: partiallyOutside };
}

function isObjectOutsideBed(
  obj: SceneObject,
  canvas: { width: number; height: number },
): boolean {
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) return false;
  return (
    bounds.minX < 0 ||
    bounds.minY < 0 ||
    bounds.maxX > canvas.width ||
    bounds.maxY > canvas.height
  );
}

export type IssueSeverity = 'blocker' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix?: string;
  category: 'machine' | 'design' | 'settings' | 'output';
}

export interface PreflightResult {
  score: number;
  issues: PreflightIssue[];
  blockers: number;
  warnings: number;
  canStart: boolean;
}

function categorizeCode(code: string): 'machine' | 'design' | 'settings' | 'output' {
  if (code.startsWith('MACHINE_')) return 'machine';
  if (code === 'NO_GCODE') return 'output';
  if (code.includes('BOUNDS') || code.includes('EMPTY') || code.includes('SCENE')) return 'design';
  if (code.includes('LAYER') || code.includes('POWER') || code.includes('SPEED')) return 'settings';
  return 'output';
}

function mapCodeToLegacyIssueId(code: string): string {
  if (code === 'NO_GCODE') return 'output-no-gcode';
  return code;
}

function newEngineIssueToLegacy(r: NewPreflightResult, i: number): PreflightIssue {
  const id = mapCodeToLegacyIssueId(r.code) || `preflight-${i}`;
  const severity: IssueSeverity = r.severity === 'error' ? 'blocker' : r.severity;
  const dot = r.message.indexOf('.');
  const title = (dot >= 0 ? r.message.slice(0, dot) : r.message) || r.code;
  return {
    id,
    severity,
    title,
    detail: r.message,
    fix: r.fix?.label,
    category: categorizeCode(r.code),
  };
}

function runLegacyBoundsChecks(
  machinePlanBounds: { minX: number; minY: number; maxX: number; maxY: number },
  bedWidth: number,
  bedHeight: number,
  issues: PreflightIssue[],
): void {
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
}

function runLegacyGcodeBoundsChecks(
  gcode: string,
  bedWidth: number,
  bedHeight: number,
  issues: PreflightIssue[],
): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of gcode.split('\n')) {
    const xm = line.match(/X([-\d.]+)/);
    const ym = line.match(/Y([-\d.]+)/);
    if (xm) {
      const x = parseFloat(xm[1]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (ym) {
      const y = parseFloat(ym[1]);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
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
}

export function runPreflight(
  scene: Scene,
  gcode: string | null,
  machineState: MachineState | null,
  bedWidth: number,
  bedHeight: number,
  /** Machine-space plan bounds (from applyMachineTransform). Preferred over gcode parsing. */
  machinePlanBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null,
): PreflightResult {
  const issues: PreflightIssue[] = [];

  if (!machineState) {
    issues.push({
      id: 'machine-disconnected',
      severity: 'blocker',
      title: 'Not connected to a machine',
      detail: 'Connect to a laser or use the simulator',
      fix: 'Click Connect in the toolbar',
      category: 'machine',
    });
  }

  const activeProfile = getActiveProfile();
  const profile =
    activeProfile ??
    {
      ...createBlankProfile('Bed (scene)'),
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
    };

  const ctx: PreflightContext = {
    scene,
    profile,
    optimizeOrderEnabled: scene.compileOptions?.optimizeOrder !== false,
    machineStatus: machineState?.status ?? null,
    machineAlarmCode: machineState?.alarmCode ?? null,
    hasGcode: gcode != null && gcode.length > 0,
    skipNoGcodeCheck: !!machinePlanBounds,
    liveMachineInfo: {
      bedWidthMm: bedWidth > 0 ? bedWidth : undefined,
      bedHeightMm: bedHeight > 0 ? bedHeight : undefined,
    },
  };

  const newResults = runNewPreflight(ctx);
  for (let i = 0; i < newResults.length; i++) {
    issues.push(newEngineIssueToLegacy(newResults[i]!, i));
  }

  // ─── DESIGN CHECKS ──────────────────────────────────
  // Match JobCompiler: only objects on visible layers with output enabled (see getOutputLayers).
  const outputLayers = getOutputLayers(scene);
  const outputLayerIds = new Set(outputLayers.map(l => l.id));
  const outputObjects = scene.objects.filter(o => o.visible && outputLayerIds.has(o.layerId));

  if (outputObjects.length === 0) {
    issues.push({
      id: 'design-empty',
      severity: 'blocker',
      title: 'No objects on output layers',
      detail:
        'Nothing will be sent to the laser — objects are hidden, on hidden layers, or on layers excluded from output.',
      fix: 'Show objects, enable layer output, or move artwork onto a layer that is included in the job',
      category: 'design',
    });
  }

  // Objects outside material bounds (world-space AABB, respects rotation/scale)
  if (scene.material && scene.material.enabled !== false) {
    const mat = scene.material;
    for (const obj of outputObjects) {
      const { outside, partial } = isObjectOutsideMaterial(obj, mat);

      if (outside) {
        issues.push({
          id: `design-outside-material-full-${obj.id}`,
          severity: 'blocker',
          title: `Object "${obj.name || obj.id}" is completely outside the material area`,
          detail: `Material: ${mat.width}×${mat.height}mm at (${mat.x}, ${mat.y})`,
          fix: 'Move the object onto the material or resize the material',
          category: 'design',
        });
      } else if (partial) {
        issues.push({
          id: `design-outside-material-partial-${obj.id}`,
          severity: 'warning',
          title: `Object "${obj.name || obj.id}" extends past the material edge`,
          detail: `Material: ${mat.width}×${mat.height}mm at (${mat.x}, ${mat.y})`,
          fix: 'Move or rotate the object so it fits on the material',
          category: 'design',
        });
      }
    }
  }

  for (const obj of outputObjects) {
    if (isObjectOutsideBed(obj, scene.canvas)) {
      issues.push({
        id: `design-outside-bed-${obj.id}`,
        severity: 'blocker',
        title: `Object "${obj.name || obj.id}" is outside the laser bed travel area`,
        detail: `Bed workspace: ${scene.canvas.width}×${scene.canvas.height}mm`,
        fix: 'Move the object within the bed or resize the canvas in setup',
        category: 'design',
      });
    }
  }

  // Text on output layers: warn about small fonts / empty text (outputObjects already scoped)
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

  // Engrave + fill: very small shapes vs line spacing (may get outline fallback or sparse lines)
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

  // Images with rotation/skew: raster compile only supports scale + translate.
  // Rotated or skewed images would burn at the wrong position/size.
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

  // ─── SETTINGS CHECKS ─────────────────────────────────
  for (const layer of outputLayers) {
    if (layer.settings.power.max === 0) {
      issues.push({
        id: `settings-zero-power-${layer.id}`,
        severity: 'warning',
        title: `Layer "${layer.name}" has 0% power`,
        detail: 'This layer will produce no visible output',
        fix: 'Increase power in layer settings',
        category: 'settings',
      });
    }

    if (layer.settings.speed < 10) {
      issues.push({
        id: `settings-slow-speed-${layer.id}`,
        severity: 'warning',
        title: `Layer "${layer.name}" speed is very slow (${layer.settings.speed} mm/min)`,
        detail: 'Extremely slow speeds may cause overburn or fire risk',
        category: 'settings',
      });
    }

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
  }

  if (outputLayers.length > 0) {
    const modeLabel = (m: string) =>
      m === 'cut' ? 'Cut' : m === 'engrave' ? 'Engrave' : m === 'score' ? 'Score' : m === 'image' ? 'Image' : m;
    const lines = outputLayers.map(layer => {
      const label = modeLabel(layer.settings.mode);
      const p = layer.settings.passes;
      const passWord = p === 1 ? '1 pass' : `${p} passes`;
      return `${label}: "${layer.name}" — ${layer.settings.power.max}% power, ${layer.settings.speed} mm/min, ${passWord}`;
    });
    issues.push({
      id: 'layer-output-summaries',
      severity: 'info',
      title: 'Layer laser settings (output layers)',
      detail: lines.join('\n'),
      category: 'settings',
    });
  }

  // ─── OUTPUT CHECKS (legacy machine / G-code bounds; step 2 migrates to new engine) ─
  if (machinePlanBounds) {
    runLegacyBoundsChecks(machinePlanBounds, bedWidth, bedHeight, issues);
  } else if (gcode) {
    runLegacyGcodeBoundsChecks(gcode, bedWidth, bedHeight, issues);
  }
  if (!machinePlanBounds && !gcode && !issues.some(i => i.id === 'output-no-gcode')) {
    issues.push({
      id: 'output-no-gcode',
      severity: 'blocker',
      title: 'No G-code generated',
      detail: 'Add objects and connect to generate output',
      category: 'output',
    });
  }

  // ─── COMPUTE SCORE ──────────────────────────────────
  const blockers = issues.filter(i => i.severity === 'blocker').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  let score = 100;
  score -= blockers * 30;
  score -= warnings * 10;
  score -= infos * 2;
  score = Math.max(0, Math.min(100, score));
  if (blockers > 0) score = Math.min(score, 40);

  return {
    score,
    issues,
    blockers,
    warnings,
    canStart: blockers === 0,
  };
}
