// Controller audit v4 E3-P2-1 / E3-P2-2 (ADR-392 Amendment 2), through the
// production tiled-save core and the bytes Run G-code file streams.
//
// P2-1: a tile runs only through Run G-code file, which streams an M0 to the
// controller (toolChangePause: false). Stock GRBL then reads no further line
// until cycle start, so the new bit could not be re-zeroed. A tile needing
// two bits is now two files with no M0.
// P2-2: tiles are zeroed by hand on their own frames, so the bed park
// (X0 Y380) is set aside rather than written as tile coordinates.

import { describe, expect, it } from 'vitest';
import { createStreamer, isTerminal, onAck, step } from '../../core/controllers/grbl/streamer';
import {
  normalizeExternalProgram,
  reviewExternalProgram,
  type ExternalProgram,
} from '../../core/external-program';
import { kerfDeskBitChangeLabels } from '../../core/external-program/kerfdesk-bit-changes';
import { kerfDeskBitFile } from '../../core/external-program/kerfdesk-bit-file';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { sanitizeGcodeCommentValue } from '../../core/gcode-comments';
import { DEFAULT_CNC_TOOLS, type CncTiling, type Project } from '../../core/scene';
import { cncGrblStrategy } from '../../core/output';
import { prepareOutput } from '../../io/gcode';
import type { CncGroup, Job } from '../../core/job';
import { tiledCncProject } from './save-tiled-gcode-testing';
import { TILE_BIT_FILES_ADVISORY, emitTileFiles, type TileFile } from './tile-emission';
import { tileFolderContents, tileFolderWarnings } from './tile-folder-check';
import { finalizeTiledOutput } from './tiled-output-preparation';

const REGISTRATION: NonNullable<CncTiling['registration']> = {
  toolId: 'em-6350',
  holeDiameterMm: 6.35,
  depthMm: 3,
  depthPerPassMm: 3,
  feedMmPerMin: 1000,
  plungeMmPerMin: 300,
  spindleRpm: 12000,
};

function toolName(id: string): string {
  const tool = DEFAULT_CNC_TOOLS.find((candidate) => candidate.id === id);
  if (tool === undefined) throw new Error(`missing starter tool ${id}`);
  return sanitizeGcodeCommentValue(tool.name, 40);
}

// Two 20 mm squares at X 10 and X 60 on the default 1/8" bit, cut across a
// two-column grid, with Machine Setup's bed park at X0 Y380 when asked.
function twoTileProject(options: {
  readonly registration: boolean;
  readonly park: boolean;
}): Project {
  const base = tiledCncProject();
  const machine = base.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
  return {
    ...base,
    machine: {
      ...machine,
      params: {
        ...machine.params,
        ...(options.park ? { parkXMm: 0, parkYMm: 380 } : {}),
      },
      tiling: {
        tileWidthMm: 50,
        tileHeightMm: 100,
        overlapMm: 10,
        registrationHoles: options.registration,
        ...(options.registration ? { registration: REGISTRATION } : {}),
      },
    },
  };
}

function readyTiles(project: Project) {
  const result = finalizeTiledOutput(prepareOutput(project, {}), 'job', null, null);
  if (result.kind !== 'ready') throw new Error(`expected tile files, got ${result.kind}`);
  return result;
}

function lastLine(file: TileFile): string | undefined {
  return file.gcode.trimEnd().split('\n').at(-1);
}

// The exact bytes Run G-code file streams, sent with its own options and
// acknowledged line by line, as a controller that never stops would.
function streamLikeRunGcodeFile(file: TileFile): ReadonlyArray<string> {
  const normalized = normalizeExternalProgram(file.gcode);
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('; '));
  let state = createStreamer(normalized.program.gcode, { toolChangePause: false });
  const sent: string[] = [];
  for (let guard = 0; guard < 100_000 && !isTerminal(state.status); guard += 1) {
    const stepped = step(state);
    sent.push(...stepped.toSend.split('\n').filter((line) => line !== ''));
    state = stepped.state;
    if (state.inFlight.length === 0) break;
    state = onAck(state, 'ok').state;
  }
  expect(state.status).toBe('done');
  return sent;
}

function reviewWarnings(program: ExternalProgram, sourceText: string): ReadonlyArray<string> {
  const model = buildGcodeRenderModel(program.gcode, { machineKind: 'cnc' });
  if (model.kind !== 'ok') throw new Error(model.reason);
  return reviewExternalProgram(program.gcode, model.model, {
    machineKind: 'cnc',
    laserMaxPowerS: 1000,
    controllerKind: 'grbl-v1.1',
    kerfDeskBitChanges: kerfDeskBitChangeLabels(sourceText),
  }).warnings;
}

describe('tiled save, a separate registration cutter (E3-P2-1)', () => {
  it('writes each bit of a tile as its own file, in order, with no M0 bit change', () => {
    const result = readyTiles(twoTileProject({ registration: true, park: false }));
    expect(result.files.map((file) => file.name)).toEqual([
      'job_tile-r1-c1_bit-1-of-2',
      'job_tile-r1-c1_bit-2-of-2',
      'job_tile-r1-c2_bit-1-of-2',
      'job_tile-r1-c2_bit-2-of-2',
    ]);
    const [registration, job] = result.files;
    // Registration is clearing work, so it runs before the profiles (ADR-310).
    expect(registration?.gcode).toContain(
      `; bit 1 of 2 for this tile: ${toolName('em-6350')}\n` +
        '; load this bit and zero Z on the stock top before running this file\n',
    );
    expect(job?.gcode).toContain(
      `; bit 2 of 2 for this tile: ${toolName('em-3175')}\n` +
        "; keep this tile's X/Y zero; change to this bit and re-zero Z on the stock top",
    );
    for (const file of result.files) {
      expect(file.gcode).not.toMatch(/^M0$/m);
      expect(file.gcode).not.toContain('; tool change: load');
      expect(file.gcode).toMatch(/; tile: row 1, column [12]\n/);
    }
    expect(result.emissionAdvisories).toContain(TILE_BIT_FILES_ADVISORY);
  });

  it('streams every bit file to its end through Run G-code file without sending an M0', () => {
    const result = readyTiles(twoTileProject({ registration: true, park: false }));
    for (const file of result.files) {
      const sent = streamLikeRunGcodeFile(file);
      expect(sent).not.toContain('M0');
      expect(sent.filter((line) => line.startsWith('M3'))).toHaveLength(1);
      expect(reviewWarnings(normalizedProgram(file), file.gcode).join('\n')).not.toContain(
        'changes bits',
      );
    }
  });

  // Rolling audit v5 J1-P2-1 (ADR-392 Amendment 5): Run G-code file read only
  // a file's first four lines, and a tile's bit line falls below its metadata
  // header, so no tile bit file ever voided Work Z or held X/Y between bits.
  it('names each bit file to Run G-code file, below the metadata header', () => {
    const result = readyTiles(twoTileProject({ registration: true, park: false }));
    const bits = [toolName('em-6350'), toolName('em-3175')];
    for (const [index, file] of result.files.entries()) {
      const order = (index % 2) + 1;
      const lines = file.gcode.split('\n');
      expect(lines.findIndex((line) => line.startsWith('; bit '))).toBeGreaterThan(3);
      expect(kerfDeskBitFile(file.gcode)).toEqual({ order, count: 2, bitName: bits[order - 1] });
    }
  });

  it('warns in the Run review when a file still changes bits at a KerfDesk M0', () => {
    // A tile file saved before this change: the whole project in one file.
    const project = twoTileProject({ registration: false, park: false });
    const prepared = prepareOutput(
      {
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((layer) =>
            layer.id === 'L2' && layer.cnc !== undefined
              ? { ...layer, cnc: { ...layer.cnc, toolId: 'em-6350' } }
              : layer,
          ),
        },
      },
      {},
    );
    if (!prepared.ok) throw new Error('expected prepared output');
    const text = cncGrblStrategy.emit(prepared.job, prepared.project.device);
    expect(text).toMatch(/^M0$/m);
    const warnings = reviewWarnings(normalizedProgram({ name: 'old', gcode: text }), text);
    const warning = warnings.find((message) => message.startsWith('This file changes bits'));
    expect(warning).toContain(`(load ${toolName('em-6350')})`);
    expect(warning).toContain("it would cut at the old bit's Z zero");
  });
});

describe('tiled save, one bit for the whole set', () => {
  it('keeps one file per tile with the names and body it had', () => {
    const result = readyTiles(twoTileProject({ registration: false, park: false }));
    expect(result.files.map((file) => file.name)).toEqual(['job_tile-r1-c1', 'job_tile-r1-c2']);
    for (const file of result.files) expect(file.gcode).not.toContain('; bit');
    expect(result.emissionAdvisories).not.toContain(TILE_BIT_FILES_ADVISORY);
  });
});

describe('tiled save, a bed park (E3-P2-2)', () => {
  it.each([
    ['one bit', false],
    ['a registration cutter', true],
  ] as const)('parks each tile file at its own X0 Y0 and says so (%s)', (_label, registration) => {
    const project = twoTileProject({ registration, park: true });
    // The single file keeps the bed park: Absolute artwork is in bed numbers.
    const single = prepareOutput(project, {});
    if (!single.ok) throw new Error('expected prepared output');
    expect(cncGrblStrategy.emit(single.job, project.device)).toContain('G0 X0.000 Y380.000');

    const result = readyTiles(project);
    for (const file of result.files) {
      expect(file.gcode).not.toContain('Y380.000');
      expect(lastLine(file)).toBe('G0 X0.000 Y0.000');
    }
    expect(result.tileAdvisories).toContain(
      'The Machine Setup park at bed X 0 · Y 380 mm is not used in tile files: each tile is ' +
        'zeroed by hand on its own frame, so where that frame sits on the bed is unknown. Every ' +
        "tile file ends at the tile's X0 Y0 instead.",
    );
  });

  it('says nothing about a park when Machine Setup has none', () => {
    const result = readyTiles(twoTileProject({ registration: true, park: false }));
    expect(result.tileAdvisories.join('\n')).not.toContain('Machine Setup park');
  });
});

describe('tile emission edges', () => {
  it.each(['em-6350', 'G2', 'G3'])('omits a point-only bit named %s', (noncuttingToolId) => {
    const project = twoTileProject({ registration: false, park: false });
    const machine = project.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC project');
    const cut = (toolId: string, toX: number): CncGroup => ({
      kind: 'cnc',
      layerId: toolId,
      color: '#ff0000',
      cutType: 'engrave',
      toolId,
      toolName: toolId,
      toolDiameterMm: 3.175,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 3,
      safeZMm: 3.81,
      passes: [
        {
          kind: 'contour',
          zMm: -1,
          closed: false,
          polyline: [
            { x: 10, y: 10 },
            { x: toX, y: 10 },
          ],
        },
      ],
    });
    // A path whose vertex sits on the tile edge clips to a zero-length piece
    // there, which emits no move at all.
    const job: Job = { groups: [cut('em-3175', 30), cut(noncuttingToolId, 10)] };
    const tile = { row: 0, col: 0, rect: { minX: 0, minY: 0, maxX: 50, maxY: 50 } };
    const emitted = emitTileFiles(project, machine, [{ tile, job }], 'job', job);
    if (emitted.kind !== 'ready') throw new Error(emitted.messages.join('; '));
    expect(emitted.files.map((file) => file.name)).toEqual(['job_tile-r1-c1']);
    expect(emitted.files[0]?.gcode).toContain('; bit: em-3175\n');
    expect(emitted.files[0]?.gcode).not.toMatch(/^M0$/m);
  });

  it('names the files a save replaces and the one-file tiles an earlier save left', async () => {
    const files: ReadonlyArray<TileFile> = [
      { name: 'job_tile-r1-c1_bit-1-of-2', gcode: '' },
      { name: 'job_tile-r1-c1_bit-2-of-2', gcode: '' },
      { name: 'job_tile-r1-c2', gcode: '' },
    ];
    const present = new Set(['job_tile-r1-c1.nc', 'job_tile-r1-c2.nc', 'other.nc']);
    const contents = await tileFolderContents(
      {
        file: () => {
          throw new Error('not written here');
        },
        exists: async (name) => present.has(name),
      },
      files,
    );
    expect(contents).toEqual({
      replaced: ['job_tile-r1-c2.nc'],
      earlier: ['job_tile-r1-c1.nc'],
    });
    expect(tileFolderWarnings(contents)).toEqual([
      'This save replaced 1 file(s) already in the folder: job_tile-r1-c2.nc.',
      'These tile files in the folder are from an earlier save, not this one: ' +
        "job_tile-r1-c1.nc. Delete or move them, so only this save's files are cut.",
    ]);
    expect(await tileFolderContents(undefined, files)).toEqual({ replaced: [], earlier: [] });
  });
});

function normalizedProgram(file: TileFile): ExternalProgram {
  const normalized = normalizeExternalProgram(file.gcode);
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('; '));
  return normalized.program;
}
