import { err, ok, type Result } from '../../core/result';
import type { Project } from '../../core/scene';
import type { DesignFrame } from '../../core/camera/pieces/piece-placements';
import { pieceUnder } from '../../core/camera/pieces/piece-placements';
import {
  normalizeFixtureTemplate,
  normalizeFixtureTemplates,
} from '../../core/camera/fixtures/fixture-template-normalize';
import type {
  FixtureBasis,
  FixtureCameraContext,
  FixtureTemplate,
} from '../../core/camera/fixtures/fixture-template';
import type { PieceScan } from '../camera/pieces/piece-scan-store';
import type { AppState } from './store';
import { pushUndo } from './undo-stack';

export function fixtureBasis(project: Project): FixtureBasis {
  return {
    kind: 'scene-mm',
    deviceProfileId: project.device.profileId ?? project.device.name,
    bedWidthMm: project.device.bedWidth,
    bedHeightMm: project.device.bedHeight,
  };
}
export function captureFixtureTemplate(args: {
  readonly project: Project;
  readonly scan: PieceScan;
  readonly design: DesignFrame | null;
  readonly camera?: FixtureCameraContext;
  readonly name: string;
  readonly id: string;
  readonly now: string;
}): Result<FixtureTemplate, { readonly message: string }> {
  const slots = args.scan.pieces.flatMap((piece, index) =>
    args.scan.excluded.has(index) ? [] : [{ id: `${args.id}:slot:${index + 1}`, piece }],
  );
  const samplePiece =
    args.design === null ? null : pieceUnder(args.scan.pieces, args.design.centre);
  const sample = slots.find((slot) => slot.piece === samplePiece);
  const value = normalizeFixtureTemplate({
    version: 1,
    id: args.id,
    name: args.name.trim(),
    createdAt: args.now,
    updatedAt: args.now,
    basis: fixtureBasis(args.project),
    slots,
    ...(args.camera === undefined ? {} : { camera: args.camera }),
    ...(sample === undefined || args.design === null
      ? {}
      : { sample: { slotId: sample.id, design: args.design } }),
  });
  return value === undefined
    ? err({
        message:
          'Enter a name and include valid pieces. The saved fixture must fit the documented geometry and metadata limits.',
      })
    : ok(value);
}
export function fixtureTemplateMutation(
  state: AppState,
  expectedProject: Project,
  expectedEpoch: number,
  edit: FixtureTemplate | { readonly deleteId: string },
): Result<Partial<AppState>, { readonly message: string }> {
  if (state.project !== expectedProject || state.projectDocumentEpoch !== expectedEpoch)
    return err({ message: 'The document changed. Review the fixture again.' });
  const previous = state.project.fixtureTemplates ?? [];
  const templates =
    'deleteId' in edit
      ? previous.filter((item) => item.id !== edit.deleteId)
      : [...previous.filter((item) => item.id !== edit.id), edit];
  const normalized = normalizeFixtureTemplates(templates);
  if (normalized === undefined)
    return err({ message: 'Fixture records are invalid or exceed the portable metadata limits.' });
  return ok({
    project: { ...state.project, fixtureTemplates: normalized },
    dirty: true,
    undoStack: pushUndo(state.project, state.undoStack, 'Save fixture intent'),
    redoStack: [],
  });
}
