import { describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { buildTextObject } from '../text/build-text-object';
import { prepareOutputRequest } from './output-preparation';

vi.mock('../text/font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Pacifico-Regular.ttf')).buffer;
  },
}));

// Rolling audit v8 N4-P1-2 and N4-P1-3 (ADR-591 Amendment 2): a project with no variable data
// prepares a large job in the background without a snapshot. Start, Save and .rd still name a
// plain text's missing characters there, as the snapshot's preparation does.
const WARNING = 'Text “Café 李”: Pacifico has no 李; each engraves as a box, or not at all.';
const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: null,
};

describe('background output without a snapshot names a plain text’s missing characters', () => {
  it('in Start’s warnings', async () => {
    const response = await prepareOutputRequest({
      kind: 'start',
      project: await cafeProject(),
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    expect(response.result.warnings).toContain(WARNING);
  });

  it('in Save’s warnings and the .rd export’s advisories', async () => {
    const saved = await prepareOutputRequest({
      kind: 'save',
      project: await cafeProject(),
      options: {},
    });
    if (saved.kind !== 'save' || saved.result.kind !== 'emitted')
      throw new Error('Save did not prepare.');
    expect(saved.result.machineWarnings).toContain(WARNING);

    const rd = await prepareOutputRequest({
      kind: 'rd',
      project: await cafeProject(),
      options: {},
    });
    if (rd.kind !== 'rd' || !rd.result.ok) throw new Error('.rd did not prepare.');
    expect(rd.result.advisories).toContainEqual({ code: 'text-missing-glyphs', message: WARNING });
  });
});

async function cafeProject(): Promise<Project> {
  const built = await buildTextObject(
    { mode: 'add' },
    {
      content: 'Café 李',
      fontKey: 'pacifico-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: true,
    },
  );
  const text = { ...built, transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50 } };
  return {
    ...createProject(),
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}
