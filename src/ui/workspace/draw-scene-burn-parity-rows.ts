// The table of draw-scene-burn-parity.test.ts. A row's probes are named points, so
// it cannot pass by having nothing to compare; its clicks are what a click picks.
import {
  transformedBBox,
  type AABB,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import {
  addOperation,
  artCopies,
  BODY,
  caption,
  CENTRE,
  circle,
  fillOp,
  frameOuter,
  frameWindow,
  imageOp,
  IN_RIM,
  jigProject,
  lbrnCentre,
  lbrnProject,
  LINE_FIRST_STORE,
  lineOp,
  OP_LINE,
  OP_ONE,
  OP_TWO,
  photo,
  plate,
  PLATE_BOX,
  project,
  rect,
  square,
  SQUARE_EDGE,
  textOnPlate,
  withCopiesOverlapped,
  withLabelOnCopy,
} from './draw-scene-burn-parity-scenes';

export type ProbePoint = readonly [at: Vec2, shown: 'ink' | 'nothing' | 'photo', burned: boolean];
export type Row = {
  readonly name: string;
  readonly build: () => Project;
  /** Named points, so a row cannot pass by having nothing to compare. */
  readonly probes: (current: Project) => ReadonlyArray<ProbePoint>;
  readonly shownNotOutput?: AABB;
  readonly burnedNotShown?: AABB;
  /** What a click picks, in the ordinary view. */
  readonly clicks?: (current: Project) => ReadonlyArray<readonly [Vec2, string]>;
  /** What a click picks in Wireframe. */
  readonly wireframeClicks?: (current: Project) => ReadonlyArray<readonly [Vec2, string]>;
};

const RING_PROBES: ReadonlyArray<ProbePoint> = [
  [BODY, 'ink', true],
  [CENTRE, 'nothing', false],
];
const SOLID_PROBES: ReadonlyArray<ProbePoint> = [
  [BODY, 'ink', true],
  [CENTRE, 'ink', true],
];

export const ROWS: ReadonlyArray<Row> = [
  {
    name: 'plate and circle on one Fill operation',
    build: () => project([square(), plate(), circle()], [fillOp(), lineOp()]),
    probes: () => RING_PROBES,
    clicks: () => [
      [CENTRE, 'square'],
      [SQUARE_EDGE, 'square'],
      [IN_RIM, 'circle'],
      [BODY, 'plate'],
    ],
    wireframeClicks: () => [
      [CENTRE, 'square'],
      [IN_RIM, 'circle'],
      [BODY, 'plate'],
    ],
  },
  {
    name: 'Add operation on the circle, Output on',
    build: () => addOperation('circle', [square(), plate(), circle()], [fillOp(), lineOp()]),
    probes: () => SOLID_PROBES,
    clicks: () => [
      [CENTRE, 'circle'],
      [BODY, 'plate'],
    ],
    wireframeClicks: () => [
      [CENTRE, 'square'],
      [BODY, 'plate'],
    ],
  },
  {
    // R5-P1-1.
    name: 'Add operation on the circle, Output off on Operation 2',
    build: () =>
      addOperation('circle', [square(), plate(), circle()], [fillOp(), lineOp()], {
        output: false,
      }),
    probes: () => RING_PROBES,
    clicks: () => [
      [CENTRE, 'square'],
      [SQUARE_EDGE, 'square'],
      [BODY, 'plate'],
    ],
  },
  {
    name: 'overlapping parts, Output off on the upper part’s second operation',
    build: () =>
      addOperation('b', [rect('a', 10, 10, 30, 30), rect('b', 25, 25, 30, 30)], [fillOp()], {
        output: false,
      }),
    probes: () => [
      [{ x: 32, y: 32 }, 'nothing', false],
      [{ x: 15, y: 15 }, 'ink', true],
      [{ x: 50, y: 50 }, 'ink', true],
    ],
  },
  {
    name: 'Output off first on the circle: plate on F, circle on G off then F',
    build: () =>
      project([plate(), circle([OP_TWO, OP_ONE])], [fillOp(), fillOp(OP_TWO, { output: false })]),
    probes: () => RING_PROBES,
    clicks: () => [
      [CENTRE, 'circle'],
      [BODY, 'plate'],
    ],
  },
  {
    name: 'Output off on the plate’s operation, circle also on an Output-on one',
    build: () =>
      project(
        [plate([OP_TWO]), circle([OP_TWO, OP_ONE])],
        [fillOp(), fillOp(OP_TWO, { output: false })],
      ),
    probes: () => [
      [BODY, 'ink', false],
      [CENTRE, 'ink', true],
    ],
    shownNotOutput: PLATE_BOX,
  },
  {
    name: 'every member on an Output-off operation shows what it would burn',
    build: () => project([plate(), circle()], [fillOp(OP_ONE, { output: false })]),
    probes: () => [
      [BODY, 'ink', false],
      [CENTRE, 'nothing', false],
    ],
    shownNotOutput: PLATE_BOX,
  },
  {
    name: 'a lone object on an Output-off operation',
    build: () => project([plate()], [fillOp(OP_ONE, { output: false })]),
    probes: () => [[BODY, 'ink', false]],
    shownNotOutput: PLATE_BOX,
  },
  {
    name: 'Output-off Fill first, Output-on Line second: only the cut burns',
    build: () =>
      project(
        [plate(), circle([OP_TWO, OP_LINE])],
        [fillOp(), fillOp(OP_TWO, { output: false }), lineOp()],
      ),
    probes: () => SOLID_PROBES,
    clicks: () => [
      [CENTRE, 'plate'],
      [BODY, 'plate'],
    ],
  },
  {
    name: 'a hidden second operation shows nothing and picks nothing',
    build: () =>
      project(
        [square(), plate(), circle([OP_ONE, OP_TWO])],
        [fillOp(), fillOp(OP_TWO, { visible: false }), lineOp()],
      ),
    // A hidden operation with Output on still burns: the KNOWN layers-panel rule.
    probes: () => [
      [BODY, 'ink', true],
      [CENTRE, 'nothing', true],
    ],
    burnedNotShown: PLATE_BOX,
    clicks: () => [[CENTRE, 'square']],
  },
  {
    name: 'a hidden and disabled second operation',
    build: () =>
      project(
        [square(), plate(), circle([OP_ONE, OP_TWO])],
        [fillOp(), fillOp(OP_TWO, { visible: false, output: false }), lineOp()],
      ),
    probes: () => RING_PROBES,
    clicks: () => [[CENTRE, 'square']],
  },
  {
    name: 'a hidden first operation on both, Fill second',
    build: () =>
      project(
        [plate([OP_TWO, OP_ONE]), circle([OP_TWO, OP_ONE])],
        [fillOp(), fillOp(OP_TWO, { visible: false, output: false })],
      ),
    probes: () => RING_PROBES,
  },
  {
    name: 'one jig box: artwork on a copy pools with the copy',
    build: () => withLabelOnCopy(jigProject(1)),
    probes: (current) => {
      const label = transformedBBox(current.scene.objects.at(-1) as SceneObject);
      const middle = { x: label.minX + 5, y: label.minY + 5 };
      return [[middle, 'nothing', false]];
    },
  },
  {
    name: 'two jig boxes, nothing else',
    build: () => jigProject(2),
    probes: (current) =>
      artCopies(current).map((copy) => {
        const box = transformedBBox(copy);
        return [{ x: box.minX + 5, y: box.minY + 5 }, 'ink', true] as const;
      }),
  },
  {
    // R5-P1-2.
    name: 'two jig boxes: an ordinary label on a copy burns in its own run',
    build: () => withLabelOnCopy(jigProject(2)),
    probes: (current) => {
      const label = transformedBBox(current.scene.objects.at(-1) as SceneObject);
      return [[{ x: label.minX + 5, y: label.minY + 5 }, 'ink', true]];
    },
    clicks: (current) => {
      const label = transformedBBox(current.scene.objects.at(-1) as SceneObject);
      return [[{ x: label.minX + 5, y: label.minY + 5 }, 'label']];
    },
  },
  {
    // R5-P1-2.
    name: 'overlapping jig boxes and copies burn each in its own run',
    build: () => withCopiesOverlapped(jigProject(2)),
    probes: (current) => {
      const [first] = artCopies(current);
      const box = transformedBBox(first as SceneObject);
      return [[{ x: box.minX + 22, y: box.minY + 10 }, 'ink', true]];
    },
  },
  {
    // R5-P1-3.
    name: 'Line then Fill on the circle, plate on that Fill (real Add and Assign)',
    build: LINE_FIRST_STORE,
    probes: () => RING_PROBES,
    clicks: () => [
      [BODY, 'plate'],
      [IN_RIM, 'circle'],
    ],
    wireframeClicks: () => [
      [BODY, 'plate'],
      [IN_RIM, 'circle'],
    ],
  },
  {
    name: 'Line then Fill, alone: the fill shows, and so does its burn',
    build: () => project([circle([OP_LINE, OP_ONE])], [fillOp(), lineOp()]),
    probes: () => [[CENTRE, 'ink', true]],
    clicks: () => [[CENTRE, 'circle']],
  },
  {
    name: 'Fill then Line on the circle',
    build: () => project([plate(), circle([OP_ONE, OP_LINE])], [fillOp(), lineOp()]),
    probes: () => RING_PROBES,
  },
  {
    name: 'Line (Output off) then Fill',
    build: () =>
      project([plate(), circle([OP_LINE, OP_ONE])], [fillOp(), lineOp({ output: false })]),
    probes: () => RING_PROBES,
  },
  {
    name: 'Line then Fill (Output off): only the cut burns',
    build: () =>
      project(
        [plate(), circle([OP_LINE, OP_TWO])],
        [fillOp(), fillOp(OP_TWO, { output: false }), lineOp()],
      ),
    probes: () => SOLID_PROBES,
  },
  {
    // R5-P1-3, the import route.
    name: '.lbrn Cut layer with a Scan sub-layer',
    build: lbrnProject,
    probes: (current) => {
      const centre = lbrnCentre(current);
      const box = transformedBBox(current.scene.objects[0] as SceneObject);
      return [
        [{ x: box.minX + 4, y: box.minY + 4 }, 'ink', true],
        [centre, 'nothing', false],
      ];
    },
  },
  {
    name: 'a Line operation with a Fill sub-layer (only a hand-written file holds one)',
    build: () =>
      project(
        [plate([OP_LINE]), circle([OP_LINE])],
        [
          lineOp({
            subLayers: [
              {
                id: 'sub-1',
                label: 'Scan',
                enabled: true,
                settings: { ...fillOp(), mode: 'fill' },
              } as unknown as Layer['subLayers'][number],
            ],
          }),
        ],
      ),
    probes: () => RING_PROBES,
  },
  ...[
    ['square, plate, window', () => [square(), plate(), circle()]],
    ['plate, square, window', () => [plate(), square(), circle()]],
    ['plate, window, square', () => [plate(), circle(), square()]],
    ['window, plate, square', () => [circle(), plate(), square()]],
  ].map(
    ([order, objects]): Row => ({
      name: `plate and window drawn ${order as string}`,
      build: () => project((objects as () => SceneObject[])(), [fillOp(), lineOp()]),
      probes: () => RING_PROBES,
      clicks: () => [
        [CENTRE, 'square'],
        [SQUARE_EDGE, 'square'],
        [IN_RIM, 'circle'],
        [BODY, 'plate'],
      ],
      // R5-P2-2: nothing is painted, so nothing but the outlines takes a click.
      wireframeClicks: () => [
        [CENTRE, 'square'],
        [SQUARE_EDGE, 'square'],
        [BODY, 'plate'],
      ],
    }),
  ),
  {
    name: 'text in Fill on a plate',
    build: () => project([plate(), textOnPlate()], [fillOp()]),
    probes: () => [
      [BODY, 'ink', true],
      // The middle of two overlapping glyph contours: one region, so a hole.
      [{ x: 30, y: 25 }, 'nothing', false],
    ],
  },
  {
    name: 'a photo drawn between pool members',
    build: () => project([frameOuter(), frameWindow(), photo, caption()], [fillOp(), imageOp()]),
    probes: () => [
      [{ x: 15, y: 40 }, 'ink', true],
      [{ x: 25, y: 25 }, 'photo', false],
      [{ x: 50, y: 40 }, 'ink', true],
    ],
    clicks: () => [
      [{ x: 50, y: 40 }, 'caption'],
      [{ x: 25, y: 25 }, 'photo'],
    ],
  },
  {
    name: 'a photo drawn above every pool member',
    build: () => project([frameOuter(), frameWindow(), caption(), photo], [fillOp(), imageOp()]),
    probes: () => [
      [{ x: 15, y: 40 }, 'ink', true],
      [{ x: 50, y: 40 }, 'photo', true],
    ],
  },
  {
    name: 'a photo between members, and a second Fill operation on the upper one',
    build: () =>
      project(
        [frameOuter(), frameWindow(), photo, { ...caption(), operationIds: [OP_ONE, OP_TWO] }],
        [fillOp(), fillOp(OP_TWO), imageOp()],
      ),
    probes: () => [
      [{ x: 15, y: 40 }, 'ink', true],
      [{ x: 50, y: 40 }, 'ink', true],
    ],
  },
];
