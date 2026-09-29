// What a variable barcode looks like on the canvas (ADR-386 item 3, Amendment
// 2): the code for the value its template has now. Insert and edit store the
// code for the value at that moment, and a later serial, record or setting
// change moves only project.variables, so the canvas re-encodes each variable
// barcode through materializeVariableBarcode, the step every output takes, and
// draws that instead. Like a text draft or a Warp preview this is display
// only: the project, its output and its undo history are untouched.

import { useEffect, useMemo, useState } from 'react';
import { isBarcodeObject, type BarcodeObject, type BarcodeShape } from '../../core/barcode';
import type { Bounds, ColoredPath, Project, SceneObject } from '../../core/scene';
import { evaluateVariableTemplate } from '../../core/variables';
import { materializeVariableBarcode } from '../../io/gcode/materialize-variable-barcode';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { renderVariableText } from '../text/render-variable-text';

/** A code's geometry for one value, without operation bindings. */
type Encoded = { readonly bounds: Bounds; readonly paths: readonly ColoredPath[] };

type Entry =
  | { readonly kind: 'ready'; readonly encoded: Encoded }
  /** The value cannot be encoded: output stops on it, and the canvas keeps the stored code. */
  | { readonly kind: 'failed' }
  | { readonly kind: 'pending'; readonly done: Promise<void> };

type Entries = Map<string, Entry>;

type Waiting = { readonly object: BarcodeObject; readonly key: string; readonly now: Date };

export type VariableBarcodeDisplay = {
  readonly source: Project;
  readonly project: Project;
  /** Values still being encoded; derive again once they land. */
  readonly waiting: readonly Waiting[];
};

// Encoded codes by spec, then by colour and value. Each derivation keeps only
// the values it needs, plus the last code shown for each colour.
const encodings = new WeakMap<BarcodeShape, Entries>();
const displayed = new WeakMap<
  BarcodeObject,
  { readonly encoded: Encoded; readonly shown: SceneObject }
>();
// One clock per project state, so re-deriving after a code lands evaluates
// the same value instead of chasing a date or time field.
const evaluatedAt = new WeakMap<Project, Date>();

/** The project as the canvas draws it: each variable barcode shows its current value. */
export function useVariableBarcodeDisplay(
  project: Project,
  render: VariableTextRenderer = renderVariableText,
): Project {
  const derived = useMemo(() => deriveVariableBarcodeDisplay(project), [project]);
  const [landed, setLanded] = useState<VariableBarcodeDisplay | null>(null);
  const current = landed?.source === project ? landed : derived;
  useEffect(() => {
    if (current.waiting.length === 0) return undefined;
    let active = true;
    void encodeWaiting(current.waiting, project, render).then(() => {
      if (active) setLanded(deriveVariableBarcodeDisplay(project));
    });
    return () => {
      active = false;
    };
  }, [current, project, render]);
  return current.project;
}

/** Substitutes every variable barcode whose current value is encoded; lists the rest. */
export function deriveVariableBarcodeDisplay(project: Project): VariableBarcodeDisplay {
  const now = evaluationTime(project);
  const waiting: Waiting[] = [];
  const needed = new Map<Entries, Set<string>>();
  let changed = false;
  const objects = project.scene.objects.map((object) => {
    if (!isBarcodeObject(object) || object.spec.variableTemplate === undefined) return object;
    const key = valueKey(object, project, now);
    if (key === null) return object;
    const entries = entriesFor(object.spec);
    needed.set(entries, (needed.get(entries) ?? new Set<string>()).add(key));
    const entry = entries.get(key);
    if (entry === undefined || entry.kind === 'pending') waiting.push({ object, key, now });
    if (entry?.kind === 'failed') return object;
    // While a new value encodes, keep showing the last one rather than the stored code.
    const encoded = entry?.kind === 'ready' ? entry.encoded : latestReady(entries, object.color);
    if (encoded === undefined) return object;
    changed = true;
    return shownWith(object, encoded);
  });
  for (const [entries, keys] of needed) prune(entries, keys);
  const shown = changed ? { ...project, scene: { ...project.scene, objects } } : project;
  return { source: project, project: shown, waiting };
}

/** Encodes the waiting values into the shared cache; settles once all have landed. */
export async function encodeWaiting(
  waiting: readonly Waiting[],
  project: Project,
  render: VariableTextRenderer,
): Promise<void> {
  await Promise.all(waiting.map((item) => encodeValue(item, project, render)));
}

function encodeValue(item: Waiting, project: Project, render: VariableTextRenderer): Promise<void> {
  const entries = entriesFor(item.object.spec);
  const known = entries.get(item.key);
  if (known?.kind === 'pending') return known.done;
  if (known !== undefined) return Promise.resolve();
  const done: Promise<void> = materializeVariableBarcode(
    item.object,
    project,
    { now: item.now },
    render,
  )
    .then(
      (result): Entry =>
        result.ok ? { kind: 'ready', encoded: withoutBindings(result.object) } : { kind: 'failed' },
      (): Entry => ({ kind: 'failed' }),
    )
    .then((entry) => {
      // Only the entry this call started is replaced.
      const current = entries.get(item.key);
      if (current?.kind === 'pending' && current.done === done) entries.set(item.key, entry);
    });
  entries.set(item.key, { kind: 'pending', done });
  return done;
}

function entriesFor(spec: BarcodeShape): Entries {
  let entries = encodings.get(spec);
  if (entries === undefined) {
    entries = new Map();
    encodings.set(spec, entries);
  }
  return entries;
}

function valueKey(object: BarcodeObject, project: Project, now: Date): string | null {
  const template = object.spec.variableTemplate;
  if (template === undefined) return null;
  const evaluated = evaluateVariableTemplate(template, object, project, { now });
  // A value that cannot be evaluated stops output with the reason; nothing to draw.
  return evaluated.ok ? `${object.color}\n${evaluated.value}` : null;
}

function latestReady(entries: Entries, color: string): Encoded | undefined {
  const key = latestReadyKey(entries, color);
  const entry = key === undefined ? undefined : entries.get(key);
  return entry?.kind === 'ready' ? entry.encoded : undefined;
}

function latestReadyKey(entries: Entries, color: string): string | undefined {
  let latest: string | undefined;
  for (const [key, entry] of entries) {
    if (entry.kind === 'ready' && key.startsWith(`${color}\n`)) latest = key;
  }
  return latest;
}

// Keeps the values in use, what is still encoding, and the last code shown
// for each colour in use, which stands in while a new value encodes.
function prune(entries: Entries, needed: ReadonlySet<string>): void {
  const keep = new Set(needed);
  for (const key of needed) {
    const fallback = latestReadyKey(entries, key.slice(0, key.indexOf('\n')));
    if (fallback !== undefined) keep.add(fallback);
  }
  for (const [key, entry] of [...entries]) {
    if (!keep.has(key) && entry.kind !== 'pending') entries.delete(key);
  }
}

// The object keeps its placement, bindings and settings; only the code changes.
// Bindings on the first path carry over as materializeVariableBarcode does.
function shownWith(object: BarcodeObject, encoded: Encoded): SceneObject {
  const known = displayed.get(object);
  if (known?.encoded === encoded) return known.shown;
  const operationIds = object.paths[0]?.operationIds;
  const shown: SceneObject = {
    ...object,
    bounds: encoded.bounds,
    paths:
      operationIds === undefined
        ? encoded.paths
        : encoded.paths.map((path) => ({ ...path, operationIds })),
  };
  displayed.set(object, { encoded, shown });
  return shown;
}

function withoutBindings(object: SceneObject): Encoded {
  const paths = 'paths' in object ? object.paths : [];
  return {
    bounds: object.bounds,
    paths: paths.map(({ operationIds: _operationIds, ...path }) => path),
  };
}

function evaluationTime(project: Project): Date {
  let now = evaluatedAt.get(project);
  if (now === undefined) {
    now = new Date();
    evaluatedAt.set(project, now);
  }
  return now;
}
