import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { emitPreparedGcode, prepareOutput } from '../gcode';
import { cncProgramFacts } from './cnc-program-facts';
import { buildCncSetupDocument, safeProgramFilename } from './cnc-setup-document';

function document() {
  const project = {
    ...projectWithLine(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    cncSetup: {
      ...defaultCncMachiningSetup(),
      name: '<script>bad</script>',
      notes: 'A & B <fixture>',
    },
  };
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Fixture failed to prepare');
  const gcode = emitPreparedGcode(prepared).gcode;
  return {
    project,
    gcode,
    facts: cncProgramFacts(prepared.job, prepared.project),
    programFilename: 'my-job.gcode',
    placementLabel: 'absolute · front-left',
    warnings: ['Unknown holder'],
    generatedAtIso: '2026-10-08T00:00:00Z',
  };
}

describe('CNC setup sheet exact artifact', () => {
  it('embeds the exact program bytes and binds filename, digest and resolved tool order', () => {
    const input = document(),
      built = buildCncSetupDocument(input);
    const encoded =
      /download="my-job.gcode" href="data:application\/octet-stream;base64,([^"]+)"/.exec(
        built.html,
      )?.[1];
    expect(encoded).toBeDefined();
    expect(Buffer.from(encoded!, 'base64').toString('utf8')).toBe(input.gcode);
    const manifest = JSON.parse(built.manifestJson) as {
      program: { filename: string; sha256: string; byteLength: number };
      operations: unknown[];
      toolPlan: unknown[];
    };
    expect(manifest.program).toEqual({
      filename: 'my-job.gcode',
      sha256: `sha256:${createHash('sha256').update(input.gcode).digest('hex')}`,
      byteLength: Buffer.byteLength(input.gcode),
    });
    expect(manifest.operations).toEqual(input.facts.operations);
    expect(manifest.toolPlan).toEqual(input.facts.toolPlan);
    expect(built.html).toContain('Unknown holder');
  });
  it('escapes annotations and changes identity when the prepared program changes', () => {
    const input = document(),
      built = buildCncSetupDocument(input);
    expect(built.html).not.toContain('<script>bad</script>');
    expect(built.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(
      buildCncSetupDocument({ ...input, gcode: `${input.gcode}\n; changed` }).programSha256,
    ).not.toBe(built.programSha256);
  });
});

it('normalizes invalid filename characters and ASCII controls without changing the extension', () => {
  expect(safeProgramFilename('/tmp/a' + String.fromCharCode(0, 31) + ':report?.NC')).toBe(
    'a___report_.NC',
  );
  expect(safeProgramFilename('')).toBe('job.gcode');
  expect(safeProgramFilename('new job')).toBe('new job.gcode');
});
