/**
 * Preflight checker — validates a scene + machine state before job execution.
 * Returns a readiness score (0-100%) with categorized issues.
 *
 * This is the core of LaserForge's "avoid mistakes before they happen" philosophy.
 */

import { type Scene } from '../scene/Scene';
import { type MachineState } from '../../controllers/ControllerInterface';

export type IssueSeverity = 'blocker' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix?: string;          // Suggested action
  category: 'machine' | 'design' | 'settings' | 'output';
}

export interface PreflightResult {
  score: number;         // 0-100
  issues: PreflightIssue[];
  blockers: number;
  warnings: number;
  canStart: boolean;     // false if any blockers
}

/**
 * Run all preflight checks against the current scene and machine state.
 * Machine state is optional — design checks run even when disconnected.
 */
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
      // Non-idle but not one of the above specific states
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

  // Text objects that will be silently dropped
  const textObjs = visibleObjects.filter(o =>
    o.geometry.type === 'text' &&
    visibleLayers.some(l => l.id === o.layerId)
  );
  if (textObjs.length > 0) {
    issues.push({
      id: 'design-text-unconverted',
      severity: 'warning',
      title: `${textObjs.length} text object(s) will be skipped`,
      detail: textObjs.map(o => o.name || (o.geometry as { text?: string }).text || 'Text').join(', '),
      fix: 'Right-click → "Text to Path" to convert before cutting',
      category: 'design',
    });
  }

  // Objects outside material bounds
  if (scene.material) {
    const mat = scene.material;
    for (const obj of visibleObjects) {
      if (obj.geometry.type === 'text' || obj.geometry.type === 'image') continue;
      // Simple bounds check using transform position
      const tx = obj.transform.tx;
      const ty = obj.transform.ty;
      if (tx < mat.x || ty < mat.y || tx > mat.x + mat.width || ty > mat.y + mat.height) {
        issues.push({
          id: `design-outside-material-${obj.id}`,
          severity: 'warning',
          title: `"${obj.name || obj.type}" may be outside material`,
          detail: `Object at (${tx.toFixed(0)}, ${ty.toFixed(0)})mm, material at (${mat.x}, ${mat.y}) ${mat.width}×${mat.height}mm`,
          category: 'design',
        });
        break; // Only report once
      }
    }
  }

  // ─── SETTINGS CHECKS ─────────────────────────────────
  for (const layer of visibleLayers) {
    if (!layer.output) continue;

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
  }

  // ─── OUTPUT CHECKS ──────────────────────────────────
  if (gcode) {
    // Check G-code bounds against bed
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
        severity: 'warning',
        title: `G-code exceeds bed width (${maxX.toFixed(1)}mm > ${bedWidth}mm)`,
        detail: 'Objects extend beyond the machine workspace',
        category: 'output',
      });
    }
    if (maxY > bedHeight + 1) {
      issues.push({
        id: 'output-exceed-y',
        severity: 'warning',
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
  score -= blockers * 30;   // Each blocker costs 30 points
  score -= warnings * 10;   // Each warning costs 10 points
  score -= infos * 2;       // Info items barely affect score
  score = Math.max(0, Math.min(100, score));

  // Blockers force score below 50
  if (blockers > 0) score = Math.min(score, 40);

  return {
    score,
    issues,
    blockers,
    warnings: warnings,
    canStart: blockers === 0,
  };
}
