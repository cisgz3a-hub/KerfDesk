import { cncAnchorShiftSince1028 } from '../../core/cnc/cnc-anchor-shift-since-1028';
import { passThroughLinesUpWithScan } from '../../core/job/raster-pass-through-grid';
import { imageScanPassRuns } from '../../core/job/scan-pass-angles';
import { rasterScanFrame } from '../../core/raster/raster-scan-frame';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type RasterImage,
  type TextObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import {
  frameInkSizes,
  sameSize,
  storedFrameRule,
  type FrameInkSize,
  type SingleLineFrameText,
} from '../../core/text/single-line-frame-rule';
import { evaluateVariableTemplate } from '../../core/variables';
import { frameTextWithoutRule } from './migrate-v20-recover-frame-line-rule';
import type { RawProject } from './migrations';
import {
  projectLoadResult,
  type LoadedProject,
  type OldProjectBurnNotice,
} from './project-load-metadata';

// What an upgraded project burns differently, read from what the file holds
// rather than from one release's notes, which a skipped release never shows
// (ADR-682 Amendment 3). Schema 19 is 1.0.28 and 18 is everything before it;
// schema 20 was never released, and only its frames can have lost the rule.
const FIRST_EM_SCHEMA = 19;
const FIRST_RULE_SCHEMA = 20;
const LAST_SCHEMA_WITHOUT_RECOVERY = 20;
// A CSV can hold thousands of rows. Past this many, a frame is reported as
// uncertain rather than walked to the end at load.
const MAX_RECORDS_CHECKED = 500;
const NO_CLOCK = new Date(0);

type ReadProject = (json: string) => {
  readonly kind: string;
  readonly oldProjectBurn?: OldProjectBurnNotice;
};

/** The load result, with what an upgraded project burns differently now. */
export function upgradedLoadResult(
  original: RawProject,
  migrated: RawProject,
  settled: { readonly project: Project; readonly keptPhotosOff: number },
  version: number | undefined,
  read: ReadProject,
): LoadedProject {
  return projectLoadResult(
    migrated,
    settled.project,
    version,
    settled.keptPhotosOff,
    version === undefined ? undefined : upgradeBurnNotice(original, version, settled.project, read),
  );
}

// The file's own objects, and a frozen production design, which is read only at output.
function upgradeBurnNotice(
  original: RawProject,
  version: number,
  project: Project,
  read: ReadProject,
): OldProjectBurnNotice | undefined {
  const manifest = original['productionManifest'] as { designProjectJson?: unknown } | undefined;
  const design = manifest?.designProjectJson;
  return mergedBurnNotices(
    oldProjectBurnNotice(original, version, project),
    typeof design === 'string' ? read(design).oldProjectBurn : undefined,
  );
}

function oldProjectBurnNotice(
  original: RawProject,
  version: number,
  project: Project,
): OldProjectBurnNotice | undefined {
  const notice: OldProjectBurnNotice = {
    repairedFrames: repairedFrames(original, version, project),
    uncertainFrames: uncertainFrames(version, original, project),
    movedRecords: movedRecords(version, project),
    imageDose: version < FIRST_EM_SCHEMA ? imageDoseChanges(project) : [],
    cncJobOrigin: version < FIRST_RULE_SCHEMA ? cncJobOriginShift(project) : [],
  };
  return Object.values(notice).some((list) => list.length > 0) ? notice : undefined;
}

export function mergedBurnNotices(
  first: OldProjectBurnNotice | undefined,
  second: OldProjectBurnNotice | undefined,
): OldProjectBurnNotice | undefined {
  if (first === undefined || second === undefined) return first ?? second;
  return {
    repairedFrames: [...first.repairedFrames, ...second.repairedFrames],
    uncertainFrames: [...first.uncertainFrames, ...second.uncertainFrames],
    movedRecords: [...first.movedRecords, ...second.movedRecords],
    imageDose: [...first.imageDose, ...second.imageDose],
    cncJobOrigin: [...first.cncJobOrigin, ...second.cncJobOrigin].slice(0, 1),
  };
}

// Every release up to 1.0.28 (schema 19) left a crossing loop or a flat Drill
// contour out of the Job Origin anchor (cnc-anchor-shift-since-1028.ts).
function cncJobOriginShift(project: Project): OldProjectBurnNotice['cncJobOrigin'] {
  const shift = cncAnchorShiftSince1028(project);
  return shift === null ? [] : [{ xMm: shift.x, yMm: shift.y }];
}

function textObjects(project: Project): ReadonlyArray<TextObject> {
  return project.scene.objects.filter((object): object is TextObject => object.kind === 'text');
}

function repairedFrames(
  original: RawProject,
  version: number,
  project: Project,
): OldProjectBurnNotice['repairedFrames'] {
  if (version < FIRST_EM_SCHEMA || version > LAST_SCHEMA_WITHOUT_RECOVERY) return [];
  const candidates = originalFrameIds(original);
  return textObjects(project).flatMap((text) => {
    if (!candidates.has(text.id) || text.textBox?.legacyLineEm === undefined) return [];
    const frame = text as SingleLineFrameText;
    const sample = differingRecord(frame, text, project).sample ?? {
      record: text.content,
      ...(frameInkSizes(frame, text.content) ?? { em: null, legacy: null }),
    };
    if (sample.em === null || sample.legacy === null) return [];
    return [
      {
        objectId: text.id,
        label: text.content,
        ...(text.variableTemplate === undefined ? {} : { record: sample.record }),
        before: sample.em,
        after: sample.legacy,
      },
    ];
  });
}

function originalFrameIds(original: RawProject): ReadonlySet<string> {
  const scene = original['scene'] as { objects?: unknown } | undefined;
  const objects = Array.isArray(scene?.objects) ? scene.objects : [];
  return new Set(
    objects.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const text = value as Record<string, unknown>;
      return frameTextWithoutRule(text) === null ? [] : [String(text['id'])];
    }),
  );
}

// Variable text only: a plain frame burns its stored geometry, which is right
// under either rule until someone edits it, and an edit shows the new fit.
function uncertainFrames(
  version: number,
  original: RawProject,
  project: Project,
): OldProjectBurnNotice['uncertainFrames'] {
  if (version < FIRST_EM_SCHEMA || version > LAST_SCHEMA_WITHOUT_RECOVERY) return [];
  const candidates = originalFrameIds(original);
  return textObjects(project).flatMap((text) => {
    const frame = text.textBox?.legacyLineEm === undefined ? text : undefined;
    if (frame?.variableTemplate === undefined || !candidates.has(text.id)) return [];
    const single = frame as SingleLineFrameText;
    const stored = {
      widthMm: text.bounds.maxX - text.bounds.minX,
      heightMm: text.bounds.maxY - text.bounds.minY,
      paths: text.paths,
    };
    if (storedFrameRule(single, stored) !== 'either') return [];
    const { sample, complete } = differingRecord(single, text, project);
    if (sample === undefined && complete) return [];
    return [
      {
        objectId: text.id,
        label: text.content,
        ...(sample === undefined
          ? {}
          : { record: sample.record, now: sample.em, before: sample.legacy }),
      },
    ];
  });
}

type RecordSample = {
  readonly record: string;
  readonly em: FrameInkSize;
  readonly legacy: FrameInkSize;
};

/** The first record the two rules fit differently, and whether every record was looked at. */
function differingRecord(
  frame: SingleLineFrameText,
  text: TextObject,
  project: Project,
): { readonly sample?: RecordSample; readonly complete: boolean } {
  const template = text.variableTemplate;
  if (template === undefined) return { complete: true };
  const readsOnlyCsv = template.tokens.every(
    (token) => typeof token === 'object' && (token.kind === 'csv' || token.kind === 'literal'),
  );
  const rows = project.variables?.csv?.records.length ?? 0;
  const count = readsOnlyCsv ? Math.min(rows, MAX_RECORDS_CHECKED) : 1;
  for (let recordIndex = 0; recordIndex < count; recordIndex += 1) {
    const evaluated = evaluateVariableTemplate(template, text, project, {
      now: NO_CLOCK,
      recordIndex,
    });
    if (!evaluated.ok) continue;
    const sizes = frameInkSizes(frame, evaluated.value);
    if (sizes !== null && !sameSize(sizes.em, sizes.legacy))
      return { sample: { record: evaluated.value, ...sizes }, complete: false };
  }
  return { complete: readsOnlyCsv && rows > 0 && rows <= MAX_RECORDS_CHECKED };
}

// ADR-682 D5, D6 and Amendment 1 item 3: bent, path and framed records from before
// schema 19 now take the template's baseline, and framed records from schema 19
// that shrink or wrap take it at any size. Unframed straight records do not move.
function movedRecords(version: number, project: Project): OldProjectBurnNotice['movedRecords'] {
  if (version >= FIRST_RULE_SCHEMA) return [];
  return textObjects(project).flatMap((text) => {
    if (text.variableTemplate === undefined) return [];
    const framed = text.textBox !== undefined;
    const placed = (text.bendDeg ?? 0) !== 0 || text.pathText !== undefined;
    return framed || (placed && version < FIRST_EM_SCHEMA)
      ? [{ objectId: text.id, label: text.content }]
      : [];
  });
}

// ADR-458 Amendment 1 and ADR-492 Amendment 1. A dither with Dot Width and an
// upright Pass-Through image are unchanged.
function imageDoseChanges(project: Project): OldProjectBurnNotice['imageDose'] {
  if (project.machine?.kind === 'cnc') return [];
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  return project.scene.objects.flatMap((object) => {
    if (object.kind !== 'raster-image') return [];
    const effective = operations
      .filter((operation) => sceneObjectUsesOperation(object, operation))
      .map((operation) => effectiveOperationForObject(operation, object))
      .filter((operation) => operation.mode === 'image');
    const changes = [
      ...(effective.some(trimsInsideBurnedLines) ? (['dot-width'] as const) : []),
      ...(effective.some((operation) => isTurnedPassThrough(operation, object, project))
        ? (['turned-pass-through'] as const)
        : []),
    ];
    return changes.map((change) => ({ objectId: object.id, label: object.source, change }));
  });
}

function trimsInsideBurnedLines(operation: Layer): boolean {
  return (
    operation.dotWidthCorrectionMm > 0 &&
    (operation.passThrough || operation.ditherAlgorithm === 'grayscale')
  );
}

function isTurnedPassThrough(operation: Layer, image: RasterImage, project: Project): boolean {
  if (!operation.passThrough) return false;
  // A rotary scans every pass along X (ADR-492 Decision 9).
  const angles =
    project.device.rotary?.enabled === true
      ? [0]
      : imageScanPassRuns(operation).map((run) => run.angleDeg);
  return angles.some(
    (angle) => !passThroughLinesUpWithScan(image, project.device, rasterScanFrame(angle)),
  );
}
