import { describe, expect, it } from 'vitest';

import { createBarcodeObject, defaultBarcodeSpec, type BarcodeShape } from '../../core/barcode';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Project,
} from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import type { VariableTextRenderer } from '../../io/gcode';
import { prepareStartJobSnapshot } from './start-job-readiness';

// ADR-386 Amendment 2, PROJECT.md non-negotiable 21. Insert and Edit stop at
// 132 x 132, whose reader layout is pinned. A variable value that needs
// 144 x 144 at output is still a code KerfDesk can build, so Frame and Start
// prepare it and Job Review warns; only a value no Data Matrix can hold is a
// factual refusal.

const NOW = new Date('2026-09-29T09:00:00.000Z');

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: { x: 0, y: 0, z: 0 },
};

const noText: VariableTextRenderer = async () => ({
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  paths: [],
});

// At serial 41: 1302 letters and three digit pairs, 1305 codewords, one more
// than 132 x 132 holds. 1556 letters make 1559, one more than 144 x 144 holds.
const NEEDS_144 = `${'A'.repeat(1302)}{{serial:6}}`;
const FITS_132 = `${'A'.repeat(1301)}{{serial:6}}`;
const BEYOND_144 = `${'A'.repeat(1556)}{{serial:6}}`;

const WARNING =
  'Barcode plate-code is a 144 × 144 Data Matrix. 144 × 144 Data Matrix codes may not scan ' +
  'in common readers, so test-scan one before a run.';

/** A variable Data Matrix inserted while its value still fitted, on its own Fill. */
async function plateProject(source: string): Promise<Project> {
  const parsed = parseVariableTemplateSource(source);
  if (!parsed.ok) throw new Error(parsed.message);
  const spec: BarcodeShape = {
    ...defaultBarcodeSpec('data-matrix'),
    moduleMm: 0.25,
    data: source,
    variableTemplate: parsed.template,
  };
  const created = await createBarcodeObject({
    id: 'plate-code',
    color: '#000000',
    spec,
    value: 'KERF-0001',
    renderCaption: () => Promise.reject(new Error('Data Matrix has no text')),
  });
  if (!created.ok) throw new Error(created.message);
  const project = createProject();
  const bound = createArtworkOperation(project.scene, created.object, { mode: 'fill' });
  return {
    ...project,
    variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 41 },
    scene: addLayer(addObject(project.scene, bound.object), bound.operation),
  };
}

function prepareStart(project: Project) {
  return prepareStartJobSnapshot(
    project,
    { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
    { statusReport: idleStatus, alarmCode: null, hasActiveStreamer: false },
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    { clock: () => NOW, renderVariableText: noText, requireFrame: false },
  );
}

describe('a variable Data Matrix that needs 144 x 144 at Start', () => {
  it('prepares the job with the 144 x 144 code and warns in Job Review', async () => {
    const result = await prepareStart(await plateProject(NEEDS_144));
    expect(result.ok ? 'prepared' : result.messages).toBe('prepared');
    if (!result.ok) return;
    const code = result.prepared.project.scene.objects.find(({ id }) => id === 'plate-code');
    // 144 modules and the standard two-module quiet zone on each side.
    expect(code?.bounds).toEqual({ minX: 0, minY: 0, maxX: 148 * 0.25, maxY: 148 * 0.25 });
    expect(result.warnings.filter((warning) => warning.includes('Data Matrix'))).toEqual([WARNING]);
  });

  it('does not warn about a value that fits 132 x 132', async () => {
    const result = await prepareStart(await plateProject(FITS_132));
    expect(result.ok ? 'prepared' : result.messages).toBe('prepared');
    if (result.ok) expect(result.warnings.join('\n')).not.toContain('Data Matrix');
  });

  it('still refuses a value longer than 144 x 144 holds, which no code can carry', async () => {
    const result = await prepareStart(await plateProject(BEYOND_144));
    expect(result.ok ? [] : result.messages.map((message) => message.slice(0, 26))).toEqual([
      'Barcode plate-code cannot ',
    ]);
    if (!result.ok) {
      expect(result.messages[0]).toContain(
        'Too much data for a Data Matrix: this text needs 1559 codewords and the largest size ' +
          'KerfDesk makes, 144 × 144, holds 1558. Shorten the text or use a QR Code.',
      );
    }
  });
});
