import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cncToolSectionProject,
  preparedCncToolSections,
} from '../../__fixtures__/cnc-tool-programs';
import type { CncGroup } from '../../core/job';
import { emitPreparedGcode, prepareOutput, type EmitGcodeOptions } from '../gcode';
import { emitSavePreparedOutput } from '../../ui/laser/save-output-emission';
import { prepareOutputRequest } from '../../ui/laser/output-preparation';
import {
  buildCncToolPrograms,
  nameCncToolPrograms,
  type CncToolProgramsResult,
} from './cnc-tool-programs';

function programs(result: CncToolProgramsResult) {
  if (result.kind !== 'ready') throw new Error(result.message);
  return result.programs;
}
const OPTIONS: EmitGcodeOptions = {
  metadata: {
    appName: 'KerfDesk',
    appVersion: 'test',
    gitSha: 'exact',
    buildTimeUtc: '2026-10-08',
    emitterRevision: 'native',
  },
};

describe('ordered exact prepared cutter programs', () => {
  it('preserves contiguous A-A, B, A order and native bytes without recompiling the source scene', () => {
    const prepared = preparedCncToolSections();
    const original = JSON.stringify(prepared.job);
    const result = programs(buildCncToolPrograms(prepared, OPTIONS));
    expect(
      result.map((program) => [program.order, program.toolId, program.jobGroupIndices]),
    ).toEqual([
      [1, 'A', [0, 1]],
      [2, 'B', [2]],
      [3, 'A', [3]],
    ]);
    expect(result.map((program) => program.operationIds)).toEqual([
      ['rough-1', 'rough-2'],
      ['detail'],
      ['release'],
    ]);
    for (const program of result) {
      expect(program.gcode).toBe(
        emitPreparedGcode(
          {
            ...prepared,
            job: {
              ...prepared.job,
              groups: program.jobGroupIndices.map((index) => prepared.job.groups[index]!),
            },
          },
          { ...OPTIONS, sourceGeometryChecks: 'compiled-evidence-only' },
        ).gcode,
      );
      expect(program.sha256).toBe(
        'sha256:' + createHash('sha256').update(program.gcode).digest('hex'),
      );
      expect(program.byteLength).toBe(Buffer.byteLength(program.gcode, 'utf8'));
    }
    expect(result[0]?.gcode).toContain('G0 X50.000 Y30.000');
    expect(result[0]?.gcode).toContain('F101');
    expect(result[0]?.gcode).toContain('F202');
    expect(result[1]?.gcode).toContain('F303');
    expect(result[2]?.gcode).toContain('F404');
    expect(JSON.stringify(prepared.job)).toBe(original);
  });

  it('starts each file with full modal state and safe lift and ends with native spindle/coolant stop and park', () => {
    const result = programs(buildCncToolPrograms(preparedCncToolSections(), {}));
    for (const program of result) {
      expect(program.gcode).toMatch(
        /^G21\nG90\nG54\nG94\nG17\nG0 Z5\.000\nM3 S12000\nG4 P0\.250\nM8\n/,
      );
      expect(program.gcode).toMatch(/G0 Z8\.000\nM5\nM9\nG0 X13\.000 Y17\.000\n$/);
      expect(program.gcode).not.toMatch(/^M0$/m);
      expect(program.gcode).not.toMatch(/^M6|^T\d/m);
    }
    expect(result[0]?.gcode).toContain('G0 Z5.000\nM3 S9000\nG4 P0.250');
  });

  it('retains current-position finish semantics when no explicit park was prepared', () => {
    const source = preparedCncToolSections();
    const prepared = {
      ...source,
      job: {
        groups: source.job.groups.map((group) => {
          if (group.kind !== 'cnc') throw new Error('Expected CNC fixture');
          const { parkXMm: _x, parkYMm: _y, ...rest } = group;
          return rest;
        }),
      },
    };
    const result = programs(
      buildCncToolPrograms(prepared, {
        jobOrigin: {
          startFrom: 'current-position',
          anchor: 'front-left',
          currentPosition: { x: 23, y: 29 },
        },
      }),
    );
    expect(result.every((program) => program.gcode.endsWith('G0 X23.000 Y29.000\n'))).toBe(true);
  });

  it('keeps the default M0 program byte-identical and carries complete clone-safe tool records', () => {
    const prepared = preparedCncToolSections();
    const emission = emitSavePreparedOutput(prepared, OPTIONS);
    expect(emission.gcode).toBe(emitPreparedGcode(prepared, OPTIONS).gcode);
    expect(emission.gcode.match(/^M0$/gm)).toHaveLength(2);
    if (emission.kind !== 'emitted') throw new Error('Fixture did not emit');
    expect(emission.cncToolPrograms).toHaveLength(3);
    expect(structuredClone(emission)).toEqual(emission);
    const named = nameCncToolPrograms(emission.cncToolPrograms ?? [], '../part.nc');
    expect(named.map((program) => program.filename)).toEqual([
      'part-001-tool-A.gcode',
      'part-002-tool-B.gcode',
      'part-003-tool-A.gcode',
    ]);
    expect(named.map((program) => [program.gcode, program.sha256, program.byteLength])).toEqual(
      emission.cncToolPrograms?.map((program) => [
        program.gcode,
        program.sha256,
        program.byteLength,
      ]),
    );
  });

  it('does not return a partial manifest when a later section has unencodable motion', () => {
    const source = preparedCncToolSections();
    const second = source.job.groups[2] as CncGroup;
    const broken: CncGroup = {
      ...second,
      passes: [
        {
          kind: 'contour',
          closed: false,
          zMm: -1,
          polyline: [
            { x: Number.POSITIVE_INFINITY, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    };
    const result = buildCncToolPrograms(
      { ...source, job: { groups: [source.job.groups[0]!, broken] } },
      {},
    );
    expect(result.kind).toBe('unavailable');
    expect(result).not.toHaveProperty('programs');
    if (result.kind !== 'unavailable') throw new Error('Expected failure');
    expect(result.message).toContain('section 2');
  });

  it('retains an unresolved legacy default cutter without inventing a tool identity', () => {
    const source = preparedCncToolSections();
    const group = source.job.groups[0] as CncGroup;
    const { toolId: _id, toolName: _name, ...legacy } = group;
    const result = programs(buildCncToolPrograms({ ...source, job: { groups: [legacy] } }, {}));
    expect(result[0]).toMatchObject({
      toolId: null,
      toolName: null,
      filename: 'job-001-tool-default.gcode',
    });
  });
});

it('carries real compiler A-B-A sections through the unchanged Save worker response contract', async () => {
  const project = cncToolSectionProject();
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Real fixture failed to prepare');
  const direct = emitSavePreparedOutput(prepared, OPTIONS);
  const response = await prepareOutputRequest({ kind: 'save', project, options: OPTIONS });
  if (response.kind !== 'save' || response.result.kind !== 'emitted')
    throw new Error('Worker Save fixture failed to emit');
  expect(response.result.gcode).toBe(direct.gcode);
  expect(response.result.cncToolPrograms?.map((program) => program.toolId)).toEqual([
    'A',
    'B',
    'A',
  ]);
  expect(response.result.cncToolPrograms).toEqual(
    direct.kind === 'emitted' ? direct.cncToolPrograms : undefined,
  );
  expect(structuredClone(response).result).toEqual(response.result);
});

it('reuses the already emitted exact combined bytes for a one-tool job', () => {
  const source = preparedCncToolSections();
  const prepared = { ...source, job: { ...source.job, groups: source.job.groups.slice(0, 2) } };
  const emitted = emitPreparedGcode(prepared, OPTIONS);
  const result = programs(buildCncToolPrograms(prepared, OPTIONS, emitted));
  expect(result).toHaveLength(1);
  expect(result[0]?.gcode).toBe(emitted.gcode);
  expect(result[0]?.warnings).toEqual(emitted.preflight.issues.map((issue) => issue.message));
  const saved = emitSavePreparedOutput(prepared, OPTIONS);
  if (saved.kind !== 'emitted') throw new Error('Single-tool job did not emit');
  expect(saved.cncToolPrograms?.[0]?.gcode).toBe(saved.gcode);
});
