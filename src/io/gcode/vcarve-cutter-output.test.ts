import { describe, expect, it } from 'vitest';
import { prepareOutput } from './prepare-output';
import { cncGrblStrategy } from '../../core/output';
import { runCncPreflight } from '../../core/preflight/cnc-preflight';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Project,
} from '../../core/scene';

const BASE_TOOL: CncTool = {
  id: 'active',
  name: 'Selected cutter',
  kind: 'end-mill',
  diameterMm: 6,
};
const PROFILE_TOOL: CncTool = {
  id: 'profile',
  name: 'Profile end mill',
  kind: 'end-mill',
  diameterMm: 3,
};
const CLEAR_TOOL: CncTool = {
  id: 'clear',
  name: 'Clearing end mill',
  kind: 'end-mill',
  diameterMm: 3,
};
const UNSUPPORTED: readonly CncTool[] = [
  BASE_TOOL,
  { ...BASE_TOOL, name: 'End mill with stray angle', tipAngleDeg: 90 },
  { ...BASE_TOOL, name: 'Ball nose with stray angle', kind: 'ball-nose', tipAngleDeg: 30 },
  {
    ...BASE_TOOL,
    name: 'Tapered ball nose',
    kind: 'tapered-ball-nose',
    tipAngleDeg: 10.8,
    tipDiameterMm: 1.5,
  },
  { ...BASE_TOOL, name: 'Angleless engraving bit', kind: 'engraving' },
  { ...BASE_TOOL, name: 'Invalid engraving angle', kind: 'engraving', tipAngleDeg: 179.5 },
  {
    ...BASE_TOOL,
    name: 'Oversized engraving tip',
    kind: 'engraving',
    tipAngleDeg: 90,
    tipDiameterMm: 7,
  },
];

function square(id: string, color: string, x: number): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: id + '.svg',
    operationIds: [id],
    bounds: { minX: x, minY: 10, maxX: x + 20, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 10 },
              { x: x + 20, y: 10 },
              { x: x + 20, y: 30 },
              { x, y: 30 },
            ],
          },
        ],
      },
    ],
  };
}
function projectFor(
  tool: CncTool,
  clearToolId = CLEAR_TOOL.id,
): Project & { machine: CncMachineConfig } {
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: tool.id,
      tools: [tool, PROFILE_TOOL, CLEAR_TOOL],
    },
    scene: {
      objects: [square('carve', '#ff0000', 10), square('profile', '#00ff00', 50)],
      layers: [
        {
          ...createLayer({ id: 'carve', color: '#ff0000' }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            toolId: tool.id,
            depthMm: 1,
            depthPerPassMm: 1,
            vResolutionMm: 0.25,
            vCarveFlatDepthEnabled: true,
            vClearToolId: clearToolId,
          },
        },
        {
          ...createLayer({ id: 'profile', color: '#00ff00' }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            toolId: PROFILE_TOOL.id,
            depthMm: 1,
            depthPerPassMm: 1,
            tabsEnabled: false,
          },
        },
      ],
    },
  };
}

describe('V-carve conical cutter executable output', () => {
  it.each(UNSUPPORTED)(
    'omits $name and its clearing stage while retaining exact other-layer output',
    (tool) => {
      const project = projectFor(tool);
      const prepared = prepareOutput(project);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || project.machine.kind !== 'cnc')
        throw new Error('Expected prepared CNC output');
      expect(prepared.job.groups).toHaveLength(1);
      expect(prepared.job.groups[0]).toMatchObject({
        kind: 'cnc',
        layerId: 'profile',
        cutType: 'profile-on-path',
      });
      const onlyProfile = prepareOutput({
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((layer) =>
            layer.id === 'carve' ? { ...layer, output: false } : layer,
          ),
        },
      });
      if (!onlyProfile.ok) throw new Error('Expected unchanged profile output');
      const emitted = cncGrblStrategy.emit(prepared.job, project.device);
      expect(emitted).toBe(cncGrblStrategy.emit(onlyProfile.job, project.device));
      const review = runCncPreflight(project, project.machine, emitted, {
        compiledJob: prepared.job,
      });
      expect(
        review.issues.filter((issue) => issue.message.includes('produces no V-carve toolpath')),
      ).toHaveLength(1);
      expect(review.issues.some((issue) => issue.code === 'cnc-layer-empty')).toBe(false);
      expect(review.issues.some((issue) => issue.code === 'cnc-tool-geometry-invalid')).toBe(false);
    },
  );

  it('does not refuse other output for a missing clearing bit on an unplannable V-carve', () => {
    const prepared = prepareOutput(projectFor(BASE_TOOL, 'missing-clearing-bit'));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Expected profile to remain executable');
    expect(prepared.job.groups.map((group) => group.layerId)).toEqual(['profile']);
  });

  it.each(['v-bit', 'engraving'] as const)('retains both real stages for a modelled %s', (kind) => {
    const project = projectFor({
      ...BASE_TOOL,
      kind,
      tipAngleDeg: 90,
      ...(kind === 'engraving' ? { tipDiameterMm: 0.4 } : {}),
    });
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Expected a real conical tool to compile');
    expect(
      prepared.job.groups.flatMap((group) =>
        group.kind === 'cnc' && group.layerId === 'carve' ? [group.cutType] : [],
      ),
    ).toEqual(['pocket', 'v-carve']);
    expect(
      prepared.job.groups.every((group) => group.kind === 'cnc' && group.passes.length > 0),
    ).toBe(true);
  });
});
