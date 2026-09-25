// After a Material Test is burned (ADR-381): click the cell that came out
// best, then save it as a material preset — prefilled with everything the
// cell burned with and where it was calibrated — or apply it to one of the
// design's operations. LightBurn's Material Test stops at the burned grid.

import { useState } from 'react';
import {
  materialTestBurnedSettings,
  materialTestCellPatch,
  type MaterialTestResult,
} from '../../core/job/material-test-cells';
import type { Layer, LayerOperationSettings } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { MaterialPresetWizard } from '../material-library/wizard';
import { seedFromTestCell } from '../material-library/wizard/wizard-seed';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { MaterialTestCellGrid } from './MaterialTestCellGrid';
import { cellName, modeName, settingsSummary } from './material-test-results-format';

export function MaterialTestResultsDialog(props: {
  readonly test: MaterialTestResult;
  /** Every test in the project: their operations are not apply targets. */
  readonly testPrefixes: ReadonlyArray<string>;
  readonly onClose: () => void;
}): JSX.Element {
  const device = useStore((s) => s.project.device);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const cell = props.test.cells.find((candidate) => candidate.objectId === selectedId);
  const burned = cell === undefined ? undefined : materialTestBurnedSettings(cell, device.maxFeed);
  const name = cell === undefined ? '' : cellName(props.test, cell);
  return (
    <>
      <Dialog title="Pick the best cell" onClose={props.onClose} size="lg">
        <p className="lf-subheading">
          Click the cell of {props.test.name} that burned best, then save it as a preset or apply it
          to an operation.
        </p>
        <MaterialTestCellGrid
          test={props.test}
          maxFeedMmPerMin={device.maxFeed}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {burned === undefined ? null : (
          <section aria-label="Chosen cell" style={panelStyle}>
            <strong>{name}</strong>
            <p style={summaryStyle}>{settingsSummary(burned)}</p>
            <Button
              variant="primary"
              title="Start a material preset with this cell's settings."
              onClick={() => setWizardOpen(true)}
            >
              New preset from this cell...
            </Button>
            <ApplyToOperation burned={burned} cellName={name} testPrefixes={props.testPrefixes} />
          </section>
        )}
        <DialogActions>
          <Button onClick={props.onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      {wizardOpen && burned !== undefined ? (
        <MaterialPresetWizard
          seed={seedFromTestCell({
            settings: burned,
            cellLabel: name,
            device,
            date: new Date().toISOString().slice(0, 10),
          })}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}
    </>
  );
}

function ApplyToOperation(props: {
  readonly burned: LayerOperationSettings;
  readonly cellName: string;
  readonly testPrefixes: ReadonlyArray<string>;
}): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const targets = layers.filter((layer) => !isTestOperation(layer, props.testPrefixes));
  const [targetId, setTargetId] = useState<string | null>(null);
  const target = targets.find((layer) => layer.id === targetId) ?? targets[0];
  if (target === undefined) {
    return (
      <p style={summaryStyle}>
        The design has no other operations yet. Add artwork to apply these settings to it.
      </p>
    );
  }
  const { patch, intervalSkipped } = materialTestCellPatch(props.burned, target);
  const apply = (): void => {
    setLayerParam(target.id, patch);
    useToastStore.getState().pushToast(`Applied ${props.cellName} to ${target.name}.`, 'success');
  };
  return (
    <div style={applyStyle}>
      <label style={applyLabelStyle}>
        <span>Apply to</span>
        <select
          className="lf-select"
          aria-label="Operation to apply the cell to"
          title="Choose the operation that takes this cell's settings."
          value={target.id}
          onChange={(event) => setTargetId(event.target.value)}
        >
          {targets.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name} ({modeName(layer.mode)})
            </option>
          ))}
        </select>
      </label>
      <Button title="Write this cell's settings into the chosen operation." onClick={apply}>
        Apply to operation
      </Button>
      {intervalSkipped ? (
        <p style={summaryStyle}>
          The {modeName(props.burned.mode)} interval is not applied: {target.name} is a{' '}
          {modeName(target.mode)} operation and keeps its mode. Power, speed, passes and air assist
          are applied.
        </p>
      ) : null}
    </div>
  );
}

function isTestOperation(layer: Layer, prefixes: ReadonlyArray<string>): boolean {
  return prefixes.some((prefix) => layer.id.startsWith(`${prefix}-`));
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  marginTop: 12,
  paddingTop: 10,
  borderTop: '1px solid var(--lf-border)',
};
const summaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const applyStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: 8,
};
const applyLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
};
