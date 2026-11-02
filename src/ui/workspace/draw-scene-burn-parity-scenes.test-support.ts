// The scenes of draw-scene-burn-parity.test.ts, through the real store actions
// and importer where a route exists.
import { importLightBurnProject } from '../../io/lightburn/lbrn-import';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  transformedBBox,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { SPACING_MM } from './draw-scene-burn-parity-harness.test-support';

// Scene-data colours: the operations and paths under test, not UI chrome.
/* eslint-disable no-restricted-syntax */
const INK = '#000000';
const BLUE = '#2563eb';
const RED = '#ff0000';
const GREY = '#808080';
/* eslint-enable no-restricted-syntax */

export const PLATE_BOX = { minX: 10, minY: 10, maxX: 50, maxY: 40 };
export const BODY: Vec2 = { x: 14, y: 14 };
export const CENTRE: Vec2 = { x: 30, y: 25 };
export const SQUARE_EDGE: Vec2 = { x: 26, y: 25 };
export const IN_RIM: Vec2 = { x: 23.5, y: 25 };
export const OP_ONE = 'op-one';
export const OP_TWO = 'op-two';
export const OP_LINE = 'op-line';

export function fillOp(id = OP_ONE, overrides: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id, color: id === OP_ONE ? INK : RED, mode: 'fill' }),
    hatchSpacingMm: SPACING_MM,
    ...overrides,
  };
}

export function lineOp(overrides: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: OP_LINE, color: BLUE, mode: 'line' }), ...overrides };
}

export function project(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
): Project {
  return { ...createProject(), scene: { layers: [...layers], objects: [...objects] } };
}

export function rect(
  id: string,
  x: number,
  y: number,
  widthMm: number,
  heightMm: number,
  operationIds: ReadonlyArray<string> = [OP_ONE],
): SceneObject {
  return {
    ...createRectangle({
      id,
      color: INK,
      spec: { widthMm, heightMm, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y },
    }),
    operationIds: [...operationIds],
  };
}

export const plate = (operationIds?: ReadonlyArray<string>): SceneObject =>
  rect('plate', 10, 10, 40, 30, operationIds);

export const circle = (operationIds: ReadonlyArray<string> = [OP_ONE]): SceneObject => ({
  ...createEllipse({
    id: 'circle',
    color: INK,
    spec: { widthMm: 16, heightMm: 16 },
    transform: { ...IDENTITY_TRANSFORM, x: 22, y: 17 },
  }),
  operationIds: [...operationIds],
});

/** A Line square inside the circle, under everything unless a row says otherwise. */
export const square = (): SceneObject => rect('square', 26, 21, 8, 8, [OP_LINE]);

function withSpacing(current: Project): Project {
  return {
    ...current,
    scene: {
      ...current.scene,
      layers: current.scene.layers.map((layer) => ({ ...layer, hatchSpacingMm: SPACING_MM })),
    },
  };
}

/** The real inspector path: Add operation on `id`, then the given edits to the new operation. */
export function addOperation(
  id: string,
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  patch: Partial<Layer> = {},
): Project {
  resetStore();
  useStore.setState({ project: project(objects, layers), selectedObjectId: id });
  useStore.getState().addOperationForSelection();
  const known = new Set(layers.map((layer) => layer.id));
  const added = useStore.getState().project.scene.layers.find((layer) => !known.has(layer.id));
  if (added === undefined) throw new Error('Add operation made no operation');
  if (Object.keys(patch).length > 0) useStore.getState().setLayerParam(added.id, patch);
  return withSpacing(useStore.getState().project);
}

export const LINE_FIRST_STORE = (): Project => {
  // A logo on a Line operation; Add operation; the new one is switched to Fill
  // and a plate is Assigned to it. The logo now binds Line, then Fill.
  addOperation(
    'circle',
    [circle([OP_LINE]), rect('plate', 10, 10, 40, 30, [OP_LINE])],
    [lineOp()],
    {
      mode: 'fill',
    },
  );
  const operationIds = useStore.getState().project.scene.objects[0]?.operationIds ?? [];
  useStore.setState({ selectedObjectId: 'plate' });
  useStore.getState().useOperationForSelection(operationIds[1] as string);
  return withSpacing(useStore.getState().project);
};

const LBRN_CUT_WITH_SCAN = `<?xml version="1.0"?>
<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
  <CutSetting index="0" type="Cut" speed="10" maxPower="80">
    <SubLayer type="Scan" speed="100" maxPower="20" interval="0.5" />
  </CutSetting>
  <Shape Type="Rect" CutIndex="0" W="40" H="30"><XForm>1 0 0 1 60 60</XForm></Shape>
  <Shape Type="Ellipse" CutIndex="0" Rx="8" Ry="8"><XForm>1 0 0 1 60 60</XForm></Shape>
</LightBurnProject>`;

export function lbrnProject(): Project {
  const imported = importLightBurnProject(LBRN_CUT_WITH_SCAN, 'cut-scan.lbrn2');
  if (!imported.ok) throw new Error(imported.reason);
  return withSpacing(imported.project);
}

export const lbrnCentre = (current: Project): Vec2 => {
  const box = transformedBBox(current.scene.objects[1] as SceneObject);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
};

/** Real jig actions: `columns` outlines, the artwork fitted into each, on a Fill operation. */
export function jigProject(columns: number): Project {
  resetStore();
  const store = useStore.getState();
  store.replaceRegistrationJigSet({
    outline: { kind: 'rectangle', widthMm: 60, heightMm: 40 },
    rows: 1,
    columns,
    spacingX: 10,
    spacingY: 0,
  });
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: INK,
      spec: { widthMm: 30, heightMm: 20, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 },
    }),
  );
  const art = useStore.getState().project.scene.objects.find((object) => object.id === 'art');
  const operationId = art?.operationIds?.[0];
  if (operationId === undefined) throw new Error('artwork has no operation');
  useStore.getState().setLayerParam(operationId, { mode: 'fill' });
  useStore.getState().centerSelectionInRegistrationBox();
  return withSpacing(useStore.getState().project);
}

export function artCopies(current: Project): ReadonlyArray<SceneObject> {
  return current.scene.objects.filter(
    (object) => !isRegistrationBox(object) && object.id.includes('art'),
  );
}

export function withLabelOnCopy(current: Project): Project {
  const copy = artCopies(current).at(-1) as SceneObject;
  const box = transformedBBox(copy);
  const label = {
    ...rect('label', box.minX + 10, box.minY + 5, 10, 10),
    operationIds: copy.operationIds ?? [],
  };
  return { ...current, scene: { ...current.scene, objects: [...current.scene.objects, label] } };
}

/** The grid action cannot overlap boxes, so the last box and its copy are moved by hand. */
export function withCopiesOverlapped(current: Project): Project {
  const first = artCopies(current)[0] as SceneObject;
  const last = artCopies(current).at(-1) as SceneObject;
  const lastBox = current.scene.objects.filter(isRegistrationBox).at(-1) as SceneObject;
  const dx = first.transform.x + 15 - last.transform.x;
  const moved = new Set([last.id, lastBox.id]);
  return {
    ...current,
    scene: {
      ...current.scene,
      objects: current.scene.objects.map((object) =>
        moved.has(object.id)
          ? { ...object, transform: { ...object.transform, x: object.transform.x + dx } }
          : object,
      ),
    },
  };
}

export const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,AAAA',
  pixelWidth: 60,
  pixelHeight: 40,
  bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
  transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
  color: GREY,
  operationIds: [GREY],
  dither: 'threshold',
  linesPerMm: 10,
};
export const imageOp = (): Layer => createLayer({ id: GREY, color: GREY, mode: 'image' });
export const frameOuter = (): SceneObject => rect('outer', 10, 10, 80, 60);
export const frameWindow = (): SceneObject => rect('window', 20, 20, 60, 40);
export const caption = (): SceneObject => rect('caption', 35, 37, 30, 6);

/** Overlapping glyph contours on a text object: its non-zero union is one region. */
export function textOnPlate(): SceneObject {
  const contour = (x: number, y: number, w: number, h: number) => ({
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  });
  return {
    kind: 'text',
    id: 'text',
    content: 'H',
    fontKey: 'test',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: INK,
    bounds: { minX: 22, minY: 17, maxX: 38, maxY: 33 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [OP_ONE],
    paths: [{ color: INK, polylines: [contour(22, 17, 12, 12), contour(26, 21, 12, 12)] }],
  } as unknown as SceneObject;
}
