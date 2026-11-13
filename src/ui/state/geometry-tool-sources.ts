// Which selected objects the geometry tools may rebuild (ADR-350 Amendment 1).
// They all work on an object's stored outlines. For variable text those are
// the template glyphs ("SN {{serial:4}}") and for a variable barcode the code
// stored when it was made, so a rebuilt copy would burn the braces or one
// repeated serial on every record (tools audit T1, T26-P1-1 and T28-P1-1).
// Weld and the Booleans also replace their sources with a new object, which
// takes jig artwork out of its box and dissolves the jig's piece-by-piece
// burn order (T28-P2-1), so those tools leave the registration jig alone too.

import { isRegistrationBox, type Scene, type SceneObject } from '../../core/scene';
import { registrationJigArtworkInstances } from '../../core/scene/registration-jig-artwork';
import { findRegistrationBoxes } from '../../core/scene/registration-layer';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';

/**
 * - `variable`: the tool rebuilds objects as plain paths (Offset, Dogbone), so
 *   variable text and variable barcodes are left out.
 * - `replace`: the tool also replaces its sources with a new object (Weld,
 *   Subtract / Intersect / Exclude), so the registration jig's outlines and
 *   artwork are left out as well.
 */
export type GeometryToolGuard = 'variable' | 'replace';

export type GeometryToolSkips = {
  readonly variableText: number;
  readonly variableBarcode: number;
  readonly jig: number;
};

type SkipReason = keyof GeometryToolSkips;

/** The objects a geometry tool may rebuild, and how many of each kind it left out. */
export function geometryToolSources<T extends SceneObject>(
  scene: Scene,
  objects: ReadonlyArray<T>,
  guard: GeometryToolGuard,
): { readonly kept: ReadonlyArray<T>; readonly skipped: GeometryToolSkips } {
  const isSkipped = geometryToolSkipReasons(scene, guard);
  const skipped = { variableText: 0, variableBarcode: 0, jig: 0 };
  const kept = objects.filter((object) => {
    const reason = isSkipped(object);
    if (reason === null) return true;
    skipped[reason] += 1;
    return false;
  });
  return { kept, skipped };
}

/** A per-object test for menu gating; the jig is indexed once per call. */
export function geometryToolSkipReasons(
  scene: Scene,
  guard: GeometryToolGuard,
): (object: SceneObject) => SkipReason | null {
  const jigIds = guard === 'replace' ? registrationJigObjectIds(scene) : null;
  return (object) => {
    const template = objectVariableTemplate(object);
    if (template !== undefined) return object.kind === 'text' ? 'variableText' : 'variableBarcode';
    if (jigIds !== null && (isRegistrationBox(object) || jigIds.has(object.id))) return 'jig';
    return null;
  };
}

/** The notice for what a geometry tool left out; empty when it left out nothing. */
export function geometryToolSkippedNotice(skipped: GeometryToolSkips): string {
  const parts: string[] = [];
  if (skipped.variableText > 0) parts.push(variableTextSkippedNotice(skipped.variableText));
  if (skipped.variableBarcode > 0) {
    parts.push(
      `${skipped.variableBarcode === 1 ? 'A variable barcode was left as it is' : `${skipped.variableBarcode} variable barcodes were left as they are`}: use Bake Variable Text first to fix its value.`,
    );
  }
  if (skipped.jig > 0) {
    parts.push('The registration jig was left as it is: change its artwork in the jig editor.');
  }
  return parts.join(' ');
}

/** The wording Convert to Path introduced for variable text (#1875). */
export function variableTextSkippedNotice(count: number): string {
  return `${count === 1 ? 'Variable text was' : `${count} variable texts were`} left as text: use Bake Variable Text first to fix its value.`;
}

function registrationJigObjectIds(scene: Scene): ReadonlySet<string> {
  if (findRegistrationBoxes(scene).length === 0) return new Set();
  return new Set(
    registrationJigArtworkInstances(scene).flatMap((instance) =>
      instance.objects.map((object) => object.id),
    ),
  );
}
