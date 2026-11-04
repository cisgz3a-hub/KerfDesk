// The last ordinary Save G-code emission, reused while nothing it was built
// from has changed (performance audit S4-P3-2, ADR-598 Amendment 4). A second
// Save of an unchanged bed-sized photo prepared all 8 M lines again (13-16 s).
//
// The emission is a pure function of the immutable Project and the request:
// the emit options (build metadata is fixed per build, never a clock), the
// output scope, and the machine and controller evidence Save reads. So the
// entry is keyed by Project identity and by an exact serialization of that
// request, and a hit returns the same bytes a fresh preparation would.
// Time-bound saves (variable text, Print and Cut registration) evaluate a
// clock and are never stored. Only an emitted program is kept: a failure is
// shown again by preparing again.

import type { Project } from '../../core/scene';
import type { SaveOutputEmission } from '../laser/save-output-emission';
import { useStore } from '../state';

type ReusableSave = {
  readonly project: Project;
  readonly key: string;
  readonly emission: Extract<SaveOutputEmission, { readonly kind: 'emitted' }>;
};

// One entry: a Save of the open project. Holding more would keep old programs
// (76 MB for a bed photo) alive after the edits that replaced them.
let last: ReusableSave | null = null;

/** An exact key for plain request data: JSON, with the values JSON would
 * merge (-0 and 0, NaN and null, undefined and absent) kept apart. */
export function saveEmissionRequestKey(request: unknown): string {
  return JSON.stringify(request, (_key, value: unknown) => {
    if (value === undefined) return '#undefined';
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))
      return `#number:${Object.is(value, -0) ? '-0' : String(value)}`;
    return value;
  });
}

export function reusableSaveEmission(project: Project, key: string): SaveOutputEmission | null {
  return last !== null && last.project === project && last.key === key ? last.emission : null;
}

export function rememberSaveEmission(
  project: Project,
  key: string,
  emission: SaveOutputEmission,
): void {
  last = emission.kind === 'emitted' ? { project, key, emission } : null;
  if (last !== null) watchOpenProject();
}

let watching = false;
function watchOpenProject(): void {
  if (watching) return;
  watching = true;
  useStore.subscribe((state) => forgetSaveEmissionUnless(state.project));
}

/** Drop the program once the open project is no longer the one it was built from. */
export function forgetSaveEmissionUnless(project: Project): void {
  if (last !== null && last.project !== project) last = null;
}

export function resetSaveEmissionReuseForTests(): void {
  last = null;
}
