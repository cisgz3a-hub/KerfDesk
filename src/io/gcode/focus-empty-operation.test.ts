import { describe, expect, it, vi } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import { createProject, type Project } from '../../core/scene';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';

function fixture(
  mode: 'line' | 'fill' | 'image',
  executable: boolean,
  unsupported: boolean,
): Project {
  const project = createProject();
  const scene = generateFocusTest({
    steps: 2,
    minOffsetMm: -1,
    maxOffsetMm: 1,
    lineLengthMm: 20,
    spacingMm: 3,
    speed: 1200,
    power: 10,
    travelFeedMmPerMin: 300,
  });
  return {
    ...project,
    device: { ...project.device, controllerKind: unsupported ? 'marlin' : 'grbl-v1.1' },
    scene: {
      ...scene,
      layers: scene.layers.map((layer, index) => {
        if (index === 0) return { ...layer, mode };
        const { focusTest: _focus, ...ordinary } = layer;
        return ordinary;
      }),
      objects: scene.objects.map((object, index) =>
        index !== 0 || executable || object.kind !== 'imported-svg'
          ? object
          : {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                polylines: [{ closed: false, points: [{ x: 0, y: 0 }] }],
              })),
            },
      ),
    },
  };
}

describe('Focus validation follows actual operation compilation', () => {
  it.each(['line', 'fill', 'image'] as const)(
    'keeps ordinary output with empty %s Focus on an unsupported controller',
    async (mode) => {
      const project = fixture(mode, false, true);
      const sync = prepareOutput(project);
      expect(sync.ok).toBe(true);
      expect(
        await prepareOutputAsync(project, {}, { jobId: 'empty-focus', runCncTasks: vi.fn() }),
      ).toEqual(sync);
      if (!sync.ok) throw new Error('Expected ordinary output');
      expect(sync.job.groups.length).toBeGreaterThan(0);
      expect(
        sync.job.groups.every((group) => group.kind !== 'cut' || group.focusTest === undefined),
      ).toBe(true);
    },
  );
  it.each(['operation', 'artwork'] as const)(
    'keeps ordinary output with zero effective Focus power from %s on an unsupported controller',
    async (source) => {
      const base = fixture('line', true, true);
      const project = {
        ...base,
        scene: {
          ...base.scene,
          layers: base.scene.layers.map((layer, index) =>
            index === 0 && source === 'operation' ? { ...layer, power: 0 } : layer,
          ),
          objects: base.scene.objects.map((object, index) =>
            index === 0 && source === 'artwork' ? { ...object, powerScale: 0 } : object,
          ),
        },
      };
      const sync = prepareOutput(project);
      expect(sync.ok).toBe(true);
      expect(
        await prepareOutputAsync(project, {}, { jobId: 'zero-focus-power', runCncTasks: vi.fn() }),
      ).toEqual(sync);
      if (!sync.ok) throw new Error('Expected ordinary output');
      expect(sync.job.groups.length).toBeGreaterThan(0);
      expect(
        sync.job.groups.every((group) => group.kind !== 'cut' || group.focusTest === undefined),
      ).toBe(true);
    },
  );
  it('retains refusal for executable Focus on an unsupported controller', async () => {
    const project = fixture('line', true, true);
    const sync = prepareOutput(project);
    expect(sync.ok).toBe(false);
    expect(
      await prepareOutputAsync(project, {}, { jobId: 'real-focus', runCncTasks: vi.fn() }),
    ).toEqual(sync);
  });
  it('retains non-Line refusal for a contributing fill', async () => {
    const source = fixture('fill', true, false);
    const project = {
      ...source,
      scene: {
        ...source.scene,
        objects: source.scene.objects.map((object, index) =>
          index !== 0 || object.kind !== 'imported-svg'
            ? object
            : {
                ...object,
                paths: object.paths.map((path) => ({
                  ...path,
                  polylines: [
                    {
                      closed: true,
                      points: [
                        { x: 0, y: 0 },
                        { x: 20, y: 0 },
                        { x: 20, y: 10 },
                        { x: 0, y: 10 },
                      ],
                    },
                  ],
                })),
              },
        ),
      },
    };
    const sync = prepareOutput(project);
    expect(sync.ok).toBe(false);
    expect(
      await prepareOutputAsync(project, {}, { jobId: 'fill-focus', runCncTasks: vi.fn() }),
    ).toEqual(sync);
  });
});
