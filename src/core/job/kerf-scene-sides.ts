// Which side of a closed Line contour the kerf offset goes to (ADR-486
// Amendment 3): how many part edges hold it, judged among the scene's contours
// as laser leads judge their scrap side (laser-lead-sides.ts, ADR-626
// Amendment 1), so a hole cut by its own operation is offset as a hole, and
// Cut selected graphics or an operation with output off cannot change it.
//
// The contours are every closed polyline of every burning Line operation,
// output on or off, selected or not (sceneLeadSideContours). Copies count
// once: one scene contour cut by several operations is one contour, and
// artworks drawn on top of each other are matched by shape
// (laser-lead-copies.ts).
//
// A holder is a part edge when it is cut by the contour's own operation, which
// is how the kerf has always judged it (ADR-486 Amendment 2: every closed
// contour of one operation counts, its own kerf zero or not), or by an
// operation whose settings say it cuts parts out: a kerf offset, leads or
// tabs. A closed shape on any other burning Line operation may be a part cut
// without compensation, or only a score line or a sheet border, and parity
// cannot tell which. The kerf takes it for the latter, as it did before this
// file, so a score ring or a border cannot turn a hole into an outline, and
// names it so Job Review can say what was assumed.
//
// The contour's own path is left to compile, which already knows it (and the
// depth carried with a traced path, ADR-531).

import type { DeviceProfile } from '../devices';
import { isRegistrationLayer, withClosingPoint, type Layer, type Scene } from '../scene';
import { copyRepresentatives, leadOutline, type LeadOutline } from './laser-lead-copies';
import { laserLeadSpecFor } from './laser-lead-settings';
import { sceneLeadSideContours, type SceneLineContour } from './laser-lead-sides';
import { properContourAncestors } from './proper-contour-containment';

export type KerfSceneHolders = {
  /** Part edges outside the contour's own path that hold it, copies once. */
  readonly outside: number;
  /** The operation of a closed shape that holds it but was not counted. */
  readonly assumedAround?: string;
};

/** `count` kerf contours of a layer sit inside a closed shape on operation
 * `aroundName`, which has no kerf offset, leads or tabs, so the offset took
 * that shape for a score line or border, not a part edge (a JobDiagnostic). */
export type KerfSideAssumedDiagnostic = {
  readonly kind: 'kerf-side-assumed';
  readonly layerId: string;
  readonly layerName: string;
  readonly count: number;
  readonly aroundName: string;
  readonly kerfOffsetMm: number;
};

/** The holders of the scene contour `key` as cut by `operationId`; undefined
 * when the scene has no such contour. */
export type KerfSceneSides = (key: string, operationId: string) => KerfSceneHolders | undefined;

/** The scene's sides, read on first use: a job without kerf never pays. */
export function lazyKerfSceneSides(
  scene: Pick<Scene, 'layers' | 'objects'>,
  device: DeviceProfile,
): () => KerfSceneSides {
  let sides: KerfSceneSides | undefined;
  return () => (sides ??= kerfSceneSides(sceneLeadSideContours(scene, device)));
}

type CopyClass = {
  readonly paths: Set<string>;
  readonly operations: Set<string>;
  cutsParts: boolean;
  readonly name: string;
};

type Entry = {
  readonly outline: LeadOutline;
  readonly path: string;
  readonly members: SceneLineContour[];
};

export function kerfSceneSides(contours: ReadonlyArray<SceneLineContour>): KerfSceneSides {
  const byKey = new Map<string, Entry>();
  for (const contour of contours) {
    // A registration jig's box is a placement scribe (ADR-057), never a part.
    if (isRegistrationLayer(contour.operation)) continue;
    const known = byKey.get(contour.key);
    if (known === undefined) {
      byKey.set(contour.key, {
        outline: leadOutline(withClosingPoint(contour.points, true)),
        path: contour.path,
        members: [contour],
      });
    } else known.members.push(contour);
  }
  const entries = [...byKey.values()];
  const representatives = copyRepresentatives(entries.map((entry) => entry.outline));
  const classes = new Map<number, CopyClass>();
  entries.forEach((entry, index) => {
    const representative = representatives[index] ?? index;
    const copyClass = classes.get(representative) ?? {
      paths: new Set<string>(),
      operations: new Set<string>(),
      cutsParts: false,
      name: entry.members[0]?.operationName ?? '',
    };
    classes.set(representative, copyClass);
    copyClass.paths.add(entry.path);
    for (const member of entry.members) {
      copyClass.operations.add(member.operation.id);
      if (cutsParts(member.operation)) copyClass.cutsParts = true;
    }
  });
  const unique = entries.flatMap((_, index) => (representatives[index] === index ? [index] : []));
  // A contour's own path is skipped below, so its rings need not be tested
  // against each other: one forest per path.
  const ancestors = properContourAncestors(
    unique.map((index) => ({
      polyline: entries[index]?.outline.points ?? [],
      closed: true,
      nesting: { forest: entries[index]?.path ?? '', depth: 0 },
    })),
  );
  const holderClasses = ancestors.map((positions) =>
    positions.flatMap((position) => classes.get(unique[position] ?? -1) ?? []),
  );
  const at = new Map(unique.map((index, position) => [index, position]));
  const indexOf = new Map([...byKey.keys()].map((key, index) => [key, index]));
  return (key, operationId) => {
    const index = indexOf.get(key);
    if (index === undefined) return undefined;
    const holders = holderClasses[at.get(representatives[index] ?? index) ?? -1] ?? [];
    return countHolders(holders, entries[index]?.path ?? '', operationId);
  };
}

function countHolders(
  holders: ReadonlyArray<CopyClass>,
  ownPath: string,
  operationId: string,
): KerfSceneHolders {
  let outside = 0;
  let assumedAround: string | undefined;
  for (const holder of holders) {
    if (holder.paths.has(ownPath)) continue;
    if (holder.cutsParts || holder.operations.has(operationId)) outside += 1;
    else assumedAround ??= holder.name;
  }
  return assumedAround === undefined ? { outside } : { outside, assumedAround };
}

// Settings only an operation that cuts parts out has.
function cutsParts(operation: Layer): boolean {
  return (
    operation.kerfOffsetMm !== 0 || operation.tabsEnabled || laserLeadSpecFor(operation) !== null
  );
}
