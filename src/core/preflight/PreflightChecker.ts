/**
 * Preflight checker — validates a scene + machine state before job execution.
 * Returns a readiness score (0-100%) with categorized issues.
 */

import { type Scene } from '../scene/Scene';
import { type SceneObject } from '../scene/SceneObject';
import { type MachineState } from '../../controllers/ControllerInterface';
import { computeObjectBounds } from '../../geometry/bounds';

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

export function runPreflight(
  scene: Scene,
  gcode: string | null,
  machineState: MachineState | null,
  bedWidth: number,
  bedHeight: number,
): PreflightResult {
  const issues: PreflightIssue[] = [];

  // ─── MACHINE CHECKS ──────────────────────────────────
  if (machineState) {
    if (machineState.status === 'alarm') {
      issues.push({
        id: 'machine-alarm',
        severity: 'blocker',
        title: 'Machine in ALARM state',
        detail: `Alarm code: ${machineState.alarmCode ?? 'unknown'}`,
        fix: 'Click Unlock ($X) to clear the alarm',
        category: 'machine',
      });
    }
    if (machineState.status === 'hold') {
      issues.push({
        id: 'machine-hold',
        severity: 'blocker',
        title: 'Machine is paused',
        detail: 'A previous job is paused or the machine is in feed hold',
        fix: 'Click Resume or Stop before starting a new job',
        category: 'machine',
      });
    }
    if (machineState.status === 'run') {
      issues.push({
        id: 'machine-running',
        severity: 'blocker',
        title: 'A job is already running',
        detail: 'Wait for the current job to finish or stop it first',
        category: 'machine',
      });
    }
    if (machineState.status === 'homing') {
      issues.push({
        id: 'machine-homing',
        severity: 'blocker',
        title: 'Machine is homing',
        detail: 'Wait for homing to complete',
        category: 'machine',
      });
    }
    if (machineState.status !== 'idle') {
      if (!issues.some(i => i.category === 'machine' && i.severity === 'blocker')) {
        issues.push({
          id: 'machine-not-idle',
          severity: 'warning',
          title: `Machine state: ${machineState.status}`,
          detail: 'Machine may not be ready. Expected: idle',
          category: 'machine',
        });
      }
    }
  } else {
    issues.push({
      id: 'machine-disconnected',
      severity: 'blocker',
      title: 'Not connected to a machine',
      detail: 'Connect to a laser or use the simulator',
      fix: 'Click Connect in the toolbar',
      category: 'machine',
    });
  }

  // ─── DESIGN CHECKS ──────────────────────────────────
  const visibleObjects = scene.objects.filter(o => o.visible);
  const visibleLayers = scene.layers.filter(l => l.visible);

  if (visibleObjects.length === 0) {
    issues.push({
      id: 'design-empty',
      severity: 'blocker',
      title: 'No objects on canvas',
      detail: 'Add or import objects before starting a job',
      category: 'design',
    });
  }

  // Objects outside material bounds (world-space AABB, respects rotation/scale)
  if (scene.material && scene.material.enabled !== false) {
    const mat = scene.material;
    for (const obj of visibleObjects) {
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

  for (const obj of visibleObjects) {
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

  // Text objects on output layers: warn about small fonts that may not convert to outlines
  const outputLayerIds = new Set(
    scene.layers.filter(l => l.visible && l.output !== false).map(l => l.id),
  );
  for (const obj of visibleObjects) {
    if (obj.geometry.type !== 'text') continue;
    if (!outputLayerIds.has(obj.layerId)) continue;
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

  // ─── SETTINGS CHECKS ─────────────────────────────────
  for (const layer of visibleLayers) {
    if (layer.output === false) continue;

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

  const outputLayers = visibleLayers.filter(l => l.output !== false);
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

  // ─── OUTPUT CHECKS ──────────────────────────────────
  if (gcode) {
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
        severity: 'blocker',
        title: `G-code has negative X (${minX.toFixed(1)}mm)`,
        detail: 'Laser will hit the left limit switch',
        fix: 'Move objects right or re-zero the machine',
        category: 'output',
      });
    }
    if (minY < -1) {
      issues.push({
        id: 'output-negative-y',
        severity: 'blocker',
        title: `G-code has negative Y (${minY.toFixed(1)}mm)`,
        detail: 'Laser will hit a limit switch',
        fix: 'Move objects down or re-zero the machine',
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
