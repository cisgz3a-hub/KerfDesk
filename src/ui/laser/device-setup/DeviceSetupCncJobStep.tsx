import { useCallback, useEffect, useState } from 'react';
import { CHIPLOAD_MATERIALS } from '../../../core/cnc';
import type { CncMachineConfig, CncStock, CncTiling, CncTool, Layer } from '../../../core/scene';
import { CncBitPreviewToast } from '../../cnc-viewer3d/CncBitPreviewToast';
import { CncMaterialOptions } from '../../common/CncMaterialOptions';
import { MANUAL_FEEDS_LABEL } from '../../common/cnc-material-vocabulary';
import { CncToolOptions } from '../../machine/CncToolOptions';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupCncBitLibrary } from './DeviceSetupCncBitLibrary';
import { DeviceSetupCncStockFields } from './DeviceSetupCncStockFields';
import { DeviceSetupCncProfiles } from './DeviceSetupCncProfiles';
import { DeviceSetupCncTilingFields } from './DeviceSetupCncTilingFields';
import { DeviceSetupCncToolPlan } from './DeviceSetupCncToolPlan';
import { MachineSetupFieldAnchor } from './machine-setup-field-anchor';

const MANUAL_MATERIAL = '';

export function DeviceSetupCncJobStep(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly dispatch: DeviceSetupStepProps['dispatch'];
  readonly layers: ReadonlyArray<Layer>;
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly customTools: ReadonlyArray<CncTool>;
  readonly onApplyMaterial: (materialKey: string | null) => void;
  readonly onChangeOperation: (draft: CncStartupOperationDraft) => void;
  readonly onChangeCustomTools: (tools: ReadonlyArray<CncTool>) => void;
  readonly onRemoveTool: (toolId: string) => void;
}): JSX.Element {
  const machine = props.state.cncDraft;
  const editMachine = (next: CncMachineConfig): void =>
    props.dispatch({ kind: 'edit-machine', machine: next });
  const editStock = (stock: CncStock): void => editMachine({ ...machine, stock });
  const applyMaterial = (materialKey: string | null): void => {
    editStock(stockWithMaterial(machine.stock, materialKey));
    props.onApplyMaterial(materialKey);
  };
  return (
    <section style={sectionStyle} aria-label="CNC Startup Setup">
      <div style={introStyle}>
        <strong>CNC Startup Setup — current job</strong>
        <span>
          Set the stock, default bit, and operation tool plan once here. Artwork settings keep
          operation-specific depth, feed, plunge, and running spindle speed.
        </span>
      </div>
      <SetupCard title="Saved setup profiles">
        <DeviceSetupCncProfiles machine={machine} onApply={editMachine} />
      </SetupCard>
      <MaterialAndBitCards
        machine={machine}
        customTools={props.customTools}
        onApplyMaterial={applyMaterial}
        onChangeMachine={editMachine}
        onChangeCustomTools={props.onChangeCustomTools}
        onRemoveTool={props.onRemoveTool}
      />
      <MachineSetupFieldAnchor field="stock" label="Stock dimensions in Startup Setup">
        <SetupCard title="Stock">
          <DeviceSetupCncStockFields machine={machine} onChange={editStock} />
        </SetupCard>
      </MachineSetupFieldAnchor>
      <MachineSetupFieldAnchor field="tool-plan" label="Tool Plan in Startup Setup">
        <SetupCard title="Tool Plan">
          <DeviceSetupCncToolPlan
            machine={machine}
            layers={props.layers}
            drafts={props.operationDrafts}
            onChange={props.onChangeOperation}
          />
        </SetupCard>
      </MachineSetupFieldAnchor>
      <MachineSetupFieldAnchor field="tiling" label="Tiling in Startup Setup">
        <SetupCard title="Tiling">
          <DeviceSetupCncTilingFields
            tiling={machine.tiling}
            onChange={(tiling) => editMachine(machineWithTiling(machine, tiling))}
          />
        </SetupCard>
      </MachineSetupFieldAnchor>
    </section>
  );
}

function MaterialAndBitCards(props: {
  readonly machine: CncMachineConfig;
  readonly customTools: ReadonlyArray<CncTool>;
  readonly onApplyMaterial: (materialKey: string | null) => void;
  readonly onChangeMachine: (machine: CncMachineConfig) => void;
  readonly onChangeCustomTools: (tools: ReadonlyArray<CncTool>) => void;
  readonly onRemoveTool: (toolId: string) => void;
}): JSX.Element {
  return (
    <>
      <SetupCard title="Material and default bit">
        <MachineSetupFieldAnchor field="material" label="Project material in Startup Setup">
          <DraftMaterialPicker machine={props.machine} onApply={props.onApplyMaterial} />
        </MachineSetupFieldAnchor>
        <MachineSetupFieldAnchor field="default-bit" label="Default bit in Startup Setup">
          <DraftDefaultBitSelect machine={props.machine} onChange={props.onChangeMachine} />
        </MachineSetupFieldAnchor>
      </SetupCard>
      <SetupCard title="Bit library">
        <DeviceSetupCncBitLibrary
          machine={props.machine}
          customTools={props.customTools}
          onChange={props.onChangeMachine}
          onChangeCustomTools={props.onChangeCustomTools}
          onRemoveTool={props.onRemoveTool}
        />
      </SetupCard>
    </>
  );
}

function DraftDefaultBitSelect(props: {
  readonly machine: CncMachineConfig;
  readonly onChange: (machine: CncMachineConfig) => void;
}): JSX.Element {
  const [previewTool, setPreviewTool] = useState<CncTool | null>(null);
  const dismissPreview = useCallback(() => setPreviewTool(null), []);
  const changeDefaultBit = (toolId: string): void => {
    if (toolId === props.machine.toolId) return;
    const selectedTool = props.machine.tools.find((tool) => tool.id === toolId);
    if (selectedTool === undefined) return;
    props.onChange({ ...props.machine, toolId });
    setPreviewTool(selectedTool);
  };
  return (
    <>
      <label style={fieldRowStyle}>
        <span style={fieldLabelStyle}>Default bit</span>
        <select
          value={props.machine.toolId}
          onChange={(event) => changeDefaultBit(event.target.value)}
          aria-label="Default CNC bit"
          title="The bit currently in the spindle. Operations follow it unless Tool Plan assigns an override."
        >
          <CncToolOptions tools={props.machine.tools} />
        </select>
      </label>
      {previewTool === null ? null : (
        <CncBitPreviewToast tool={previewTool} onDismiss={dismissPreview} />
      )}
    </>
  );
}

function DraftMaterialPicker(props: {
  readonly machine: CncMachineConfig;
  readonly onApply: (materialKey: string | null) => void;
}): JSX.Element {
  const activeKey = props.machine.stock.materialKey ?? MANUAL_MATERIAL;
  const [pendingKey, setPendingKey] = useState(activeKey);
  useEffect(() => setPendingKey(activeKey), [activeKey]);
  const preset = CHIPLOAD_MATERIALS.find((material) => material.value === pendingKey) ?? null;
  return (
    <div style={materialStyle}>
      <label style={fieldRowStyle}>
        <span style={fieldLabelStyle}>Material</span>
        <select
          value={pendingKey}
          onChange={(event) => setPendingKey(event.target.value)}
          aria-label="Project material"
          title="Browse without changing the draft, then Apply to stage the material for every operation."
        >
          <option value={MANUAL_MATERIAL}>{MANUAL_FEEDS_LABEL}</option>
          <CncMaterialOptions />
        </select>
      </label>
      <p style={hintStyle}>{materialHint(preset?.label ?? null)}</p>
      <button
        type="button"
        onClick={() => props.onApply(preset?.value ?? null)}
        title={
          preset === null
            ? 'Stage manual feeds while preserving every current operation number.'
            : `Stage ${preset.label} starting values for every operation; final Save commits them.`
        }
      >
        {preset === null ? `Use ${MANUAL_FEEDS_LABEL}` : `Apply ${preset.label} to operations`}
      </button>
    </div>
  );
}

function materialHint(label: string | null): string {
  return label === null
    ? 'Manual keeps every operation’s current numeric cutting values.'
    : `Apply recalculates and stages ${label} starting values for every operation. Save commits them once. Later machine or default-bit refreshes preserve manual values.`;
}

function stockWithMaterial(stock: CncStock, materialKey: string | null): CncStock {
  const { materialKey: _removed, ...withoutMaterial } = stock;
  return materialKey === null ? withoutMaterial : { ...withoutMaterial, materialKey };
}

function machineWithTiling(
  machine: CncMachineConfig,
  tiling: CncTiling | undefined,
): CncMachineConfig {
  const { tiling: _removed, ...withoutTiling } = machine;
  return tiling === undefined ? withoutTiling : { ...withoutTiling, tiling };
}

function SetupCard(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <article style={cardStyle}>
      <h3 style={cardHeadingStyle}>{props.title}</h3>
      {props.children}
    </article>
  );
}

const sectionStyle: React.CSSProperties = { display: 'grid', gap: 10 };
const introStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, lineHeight: 1.45 };
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 9,
  display: 'grid',
  gap: 8,
};
const cardHeadingStyle: React.CSSProperties = { margin: 0, fontSize: 12 };
const materialStyle: React.CSSProperties = { display: 'grid', gap: 5 };
const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const fieldLabelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.35,
};
