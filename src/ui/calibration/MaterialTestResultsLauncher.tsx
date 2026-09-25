// Inspector entry to the Material Test results (ADR-381): shown while the
// selection holds cells of a generated test, on laser machines.

import { useMemo, useState } from 'react';
import { findMaterialTests, materialTestPrefixOf } from '../../core/job/material-test-cells';
import type { SceneObject } from '../../core/scene';
import { useStore } from '../state';
import { MaterialTestResultsDialog } from './MaterialTestResultsDialog';

export function MaterialTestResultsLauncher(props: {
  readonly objects: ReadonlyArray<SceneObject>;
}): JSX.Element | null {
  const scene = useStore((s) => s.project.scene);
  const laser = useStore((s) => s.project.machine?.kind !== 'cnc');
  const [open, setOpen] = useState(false);
  const prefix = useMemo(
    () => props.objects.map(materialTestPrefixOf).find((found) => found !== null) ?? null,
    [props.objects],
  );
  const tests = useMemo(() => (prefix === null ? [] : findMaterialTests(scene)), [prefix, scene]);
  const test = tests.find((candidate) => candidate.prefix === prefix);
  if (!laser || test === undefined) return null;
  return (
    <section aria-label="Material test results" className="lf-operation-inspector">
      <h3 className="lf-operation-inspector__heading">{test.name}</h3>
      <p className="lf-artwork-hint">
        After burning, pick the cell that looks best to save it as a preset or apply it to an
        operation.
      </p>
      <button
        type="button"
        className="lf-btn"
        title="Open the test's cells and choose the best one."
        onClick={() => setOpen(true)}
      >
        Pick the best cell...
      </button>
      {open ? (
        <MaterialTestResultsDialog
          test={test}
          testPrefixes={tests.map((candidate) => candidate.prefix)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
