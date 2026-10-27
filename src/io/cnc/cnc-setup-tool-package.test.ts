import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { preparedCncToolSections } from '../../__fixtures__/cnc-tool-programs';
import { emitPreparedGcode } from '../gcode';
import { cncProgramFacts } from './cnc-program-facts';
import { buildCncSetupDocument, defaultCncSetupExportMode } from './cnc-setup-document';
import { buildCncToolPrograms } from './cnc-tool-programs';

/** The A-A, B, A fixture, or its first `groupCount` groups (2 is a one-bit A-A job). */
function packageInput(groupCount?: number) {
  const source = preparedCncToolSections();
  const prepared =
    groupCount === undefined
      ? source
      : { ...source, job: { ...source.job, groups: source.job.groups.slice(0, groupCount) } };
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

  // CNC audit v1 F8-P2-1, ADR-392 Amendment 3. A package's program runs outside project Start,
  // where an M0 reaches the controller and no jog or Zero Z can follow it.
  it('defaults a multi-bit package to one file per bit, with no M0 in any download', () => {
    const input = packageInput();
    const built = buildCncSetupDocument(input);
    expect(built.html).toBe(buildCncSetupDocument({ ...input, exportMode: 'separate-tools' }).html);
    expect((JSON.parse(built.manifestJson) as { exportMode: string }).exportMode).toBe(
      'separate-tools',
    );
    const files = programDownloads(built.html);
    expect(files.map((file) => file.filename)).toEqual([
      'sign-001-tool-A.gcode',
      'sign-002-tool-B.gcode',
      'sign-003-tool-A.gcode',
    ]);
    for (const file of files) expect(file.bytes.toString('utf8')).not.toMatch(/^M0$/m);
    expect(built.html).toContain('Ordered separate-tool files');
    expect(built.html).toContain('controller is idle and takes jog, Zero Z and probing');
    expect(built.html).toContain("Each file's first lines name its cutter and what to zero.");
    expect(built.html).not.toContain('At each M0');
  });

  it('keeps the explicit single-file bytes and M0 stops, and says where a bit change at an M0 works', () => {
    const input = packageInput();
    const built = buildCncSetupDocument({ ...input, exportMode: 'single-file' });
    const encoded = /download="sign.nc" href="data:application\/octet-stream;base64,([^"]+)"/.exec(
      built.html,
    )?.[1];
    expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe(input.gcode);
    expect(input.gcode.match(/^M0$/gm)).toHaveLength(2);
    expect(built.html).not.toContain('download="sign-001-tool-A.gcode"');
    expect(built.html).toContain('Single file with M0 bit changes');
    expect(built.html).toContain('Rough cutter A → Detail cutter B → Rough cutter A');
    // The instruction the audit found cannot be followed is gone.
    expect(built.html).not.toContain('At each M0');
    expect(built.html).not.toContain('before resuming');
    expect(built.html).toContain(
      'Do not change bits at an M0 the controller has received.</strong> Stock GRBL parses no ' +
        'further line while it is held at an M0, so it takes no jog or Zero Z',
    );
    expect(built.html).toContain('start the job from its KerfDesk project');
    expect(built.html).toContain('a sender that holds at the M0 itself instead of sending it');
    expect(built.html).toContain("KerfDesk's Run G-code file sends the M0");
    expect(built.html).toContain('save this package again as ordered separate-tool files');
  });

  it('stays single-file for a one-bit job, and for a multi-bit job with no prepared tool files', () => {
    const oneBit = packageInput(2);
    expect(oneBit.facts.toolPlan).toHaveLength(1);
    expect(oneBit.cncToolPrograms).toHaveLength(1);
    expect(defaultCncSetupExportMode(oneBit.facts, oneBit.cncToolPrograms)).toBe('single-file');
    const oneBitHtml = buildCncSetupDocument(oneBit).html;
    expect(oneBitHtml).toContain('download="sign.nc"');
    expect(oneBitHtml).toContain('Single-file program for one cutter: Rough cutter A.');
    expect(oneBitHtml).not.toContain('M0 bit changes');
    expect(oneBitHtml).not.toContain('Do not change bits');
    expect(oneBit.gcode).not.toMatch(/^M0$/m);
    // Chosen anyway, its one file is the combined program, with no bit header to promise.
    const oneBitSeparate = buildCncSetupDocument({ ...oneBit, exportMode: 'separate-tools' }).html;
    expect(oneBitSeparate).not.toContain('first lines name its cutter');
    const input = packageInput();
    const { cncToolPrograms: _programs, ...factsOnly } = input;
    expect(defaultCncSetupExportMode(input.facts, undefined)).toBe('single-file');
    expect(defaultCncSetupExportMode(input.facts, [])).toBe('single-file');
    const factsOnlyHtml = buildCncSetupDocument(factsOnly).html;
    expect(factsOnlyHtml).toContain('download="sign.nc"');
    expect(factsOnlyHtml).toContain('Do not change bits at an M0 the controller has received.');
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
