import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { preparedCncToolSections } from '../../__fixtures__/cnc-tool-programs';
import { emitPreparedGcode } from '../gcode';
import { cncProgramFacts } from './cnc-program-facts';
import { buildCncSetupDocument } from './cnc-setup-document';
import { buildCncToolPrograms } from './cnc-tool-programs';

function packageInput() {
  const prepared = preparedCncToolSections();
  const result = buildCncToolPrograms(prepared, {});
  if (result.kind !== 'ready') throw new Error(result.message);
  return {
    project: prepared.project,
    facts: cncProgramFacts(prepared.job, prepared.project),
    gcode: emitPreparedGcode(prepared).gcode,
    cncToolPrograms: result.programs,
    programFilename: 'sign.nc',
    placementLabel: 'absolute · front-left',
    warnings: [],
    generatedAtIso: '2026-10-08T00:00:00Z',
  };
}
function programDownloads(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(parsed.querySelectorAll<HTMLAnchorElement>('a[download]'))
    .filter((anchor) => anchor.download.endsWith('.gcode'))
    .map((anchor) => ({
      filename: anchor.download,
      bytes: Buffer.from(anchor.href.split(',')[1] ?? '', 'base64'),
    }));
}

describe('separate-tool offline package', () => {
  it('includes every A-B-A file exactly once with matching order, byte digest and load/touch-off instructions', () => {
    const input = packageInput();
    const built = buildCncSetupDocument({ ...input, exportMode: 'separate-tools' });
    const manifest = JSON.parse(built.manifestJson) as {
      exportMode: string;
      program?: unknown;
      combinedProgram: { sha256: string; byteLength: number };
      programs: {
        order: number;
        filename: string;
        toolId: string;
        sha256: string;
        byteLength: number;
      }[];
    };
    const files = programDownloads(built.html);
    expect(manifest.exportMode).toBe('separate-tools');
    expect(manifest.program).toBeUndefined();
    expect(
      manifest.programs.map((program) => [program.order, program.filename, program.toolId]),
    ).toEqual([
      [1, 'sign-001-tool-A.gcode', 'A'],
      [2, 'sign-002-tool-B.gcode', 'B'],
      [3, 'sign-003-tool-A.gcode', 'A'],
    ]);
    expect(files.map((file) => file.filename)).toEqual(
      manifest.programs.map((program) => program.filename),
    );
    for (const [index, file] of files.entries()) {
      expect(file.bytes.toString('utf8')).toBe(input.cncToolPrograms[index]?.gcode);
      expect(manifest.programs[index]?.sha256).toBe(
        'sha256:' + createHash('sha256').update(file.bytes).digest('hex'),
      );
      expect(manifest.programs[index]?.byteLength).toBe(file.bytes.length);
    }
    expect(manifest.combinedProgram).toEqual({
      sha256: built.programSha256,
      byteLength: Buffer.byteLength(input.gcode),
    });
    expect(built.html).toContain('including a later return to the same cutter');
    expect(built.html).toContain('re-zero Z on stock top');
    expect(built.html).toContain('same G54 XY datum');
    expect(built.html).toContain('change tools between files');
    expect(built.html).toContain('spindle to stop');
    expect(built.html).toContain(
      'Controller, fixture, material and physical-machine qualification are separate',
    );
  });

  it('keeps default single-file bytes and manual M0 stops identical when tool programs also exist', () => {
    const input = packageInput();
    const built = buildCncSetupDocument(input);
    const encoded = /download="sign.nc" href="data:application\/octet-stream;base64,([^"]+)"/.exec(
      built.html,
    )?.[1];
    expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe(input.gcode);
    expect(input.gcode.match(/^M0$/gm)).toHaveLength(2);
    expect(built.html).toBe(buildCncSetupDocument({ ...input, exportMode: 'single-file' }).html);
    expect(built.html).not.toContain('download="sign-001-tool-A.gcode"');
  });

  it('never fabricates tool programs from facts and rejects missing, reordered or modified records', () => {
    const input = packageInput();
    const build = (cncToolPrograms: typeof input.cncToolPrograms | undefined) =>
      buildCncSetupDocument({
        ...input,
        exportMode: 'separate-tools',
        ...(cncToolPrograms === undefined ? {} : { cncToolPrograms }),
      });
    const { cncToolPrograms: _programs, ...factsOnly } = input;
    expect(() => buildCncSetupDocument({ ...factsOnly, exportMode: 'separate-tools' })).toThrow(
      'prepared Job',
    );
    expect(() => build(input.cncToolPrograms.slice(0, 2))).toThrow('count');
    expect(() => build([...input.cncToolPrograms].reverse())).toThrow();
    expect(() =>
      build(
        input.cncToolPrograms.map((program, index) =>
          index === 1
            ? {
                ...program,
                operationIds: ['substituted-operation'],
              }
            : program,
        ),
      ),
    ).toThrow('operations');
    expect(() =>
      build(
        input.cncToolPrograms.map((program, index) =>
          index === 1
            ? {
                ...program,
                gcode: program.gcode + '; changed\n',
              }
            : program,
        ),
      ),
    ).toThrow('digest');
    expect(() =>
      build(
        input.cncToolPrograms.map((program, index) =>
          index === 1
            ? {
                ...program,
                sha256: 'sha256:incorrect',
              }
            : program,
        ),
      ),
    ).toThrow('digest');
  });
});
