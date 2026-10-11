import { useState } from 'react';
import { controller } from '../core/controller';
import { canEdit, store } from '../core/store';
import type { Operation } from '../core/types';
import { useApp } from './hooks';
import { Icon } from './icons';
import { Banner, NumberField, Segmented, Sheet, Toggle } from './primitives';

export const MODES = [
  { value: 'line', label: 'Line' },
  { value: 'fill', label: 'Fill' },
  { value: 'image', label: 'Image' },
] as const;
const CUTS = [
  ['profile-on-path', 'On the line'],
  ['profile-outside', 'Outside (cut out)'],
  ['profile-inside', 'Inside (hole)'],
  ['pocket', 'Pocket'],
  ['engrave', 'Engrave'],
  ['v-carve', 'V-carve (Pro)'],
  ['inlay-pair', 'Inlay pair'],
  ['drill', 'Drill'],
] as const;

export function OperationSheet({ id }: { id: string }) {
  const operation = useApp((state) => state.workspace?.operations.find((item) => item.id === id));
  const mode = useApp((state) => state.workspace?.mode ?? 'laser');
  const editable = useApp(canEdit);
  const recipes = useApp((state) => state.recipes);
  const selection = useApp((state) => state.selection);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = () => store.set({ sheet: null });
  if (operation === undefined) return null;
  const design = controller.designControl();
  const patch = (value: Record<string, unknown>) =>
    controller.write('update_operation', { operationId: id, patch: value });
  return (
    <Sheet title={operation.name ?? 'Layer'} onClose={close}>
      {mode === 'laser' ? (
        <>
          {design ? (
            <Segmented
              label="Mode"
              value={(operation.type as 'line' | 'fill' | 'image') ?? 'line'}
              options={MODES}
              onChange={(value) => void patch({ mode: value })}
            />
          ) : null}
          <div className="field">
            <span>Power · {operation.powerPercent ?? 0}%</span>
            <input
              className="range"
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={!editable}
              defaultValue={operation.powerPercent ?? 0}
              key={`p${operation.powerPercent}`}
              onChange={() => undefined}
              onPointerUp={(event) =>
                void patch({ powerPercent: Number((event.target as HTMLInputElement).value) })
              }
              onKeyUp={(event) =>
                void patch({ powerPercent: Number((event.target as HTMLInputElement).value) })
              }
            />
          </div>
          <div className="grid-2">
            <NumberField
              label="Power"
              unit="%"
              min={0}
              max={100}
              value={operation.powerPercent}
              disabled={!editable}
              onCommit={(powerPercent) => void patch({ powerPercent })}
            />
            <NumberField
              label="Speed"
              unit="mm/min"
              min={0.01}
              max={100000}
              value={operation.speedMmPerMin}
              disabled={!editable}
              onCommit={(speedMmPerMin) => void patch({ speedMmPerMin })}
            />
            <NumberField
              label="Passes"
              min={1}
              max={1000}
              value={operation.passes}
              disabled={!editable}
              onCommit={(passes) => void patch({ passes: Math.round(passes) })}
            />
            {design ? (
              <NumberField
                label="Min power"
                unit="%"
                min={0}
                max={100}
                value={operation.minPowerPercent}
                disabled={!editable}
                onCommit={(minPowerPercent) => void patch({ minPowerPercent })}
              />
            ) : null}
          </div>
          {design && operation.type === 'fill' ? (
            <div className="grid-2">
              <NumberField
                label="Line interval"
                unit="mm"
                min={0.01}
                max={10}
                value={operation.fillIntervalMm}
                disabled={!editable}
                onCommit={(fillIntervalMm) => void patch({ fillIntervalMm })}
              />
              <NumberField
                label="Angle"
                unit="°"
                min={-360}
                max={360}
                value={operation.fillAngleDeg}
                disabled={!editable}
                onCommit={(fillAngleDeg) => void patch({ fillAngleDeg })}
              />
            </div>
          ) : null}
          {design && operation.type === 'fill' ? (
            <>
              <Toggle
                label="Bidirectional"
                checked={operation.fillBidirectional === true}
                disabled={!editable}
                onChange={(fillBidirectional) => void patch({ fillBidirectional })}
              />
              <Toggle
                label="Cross-hatch"
                checked={operation.fillCrossHatch === true}
                disabled={!editable}
                onChange={(fillCrossHatch) => void patch({ fillCrossHatch })}
              />
            </>
          ) : null}
          {design && operation.type === 'image' ? (
            <>
              <NumberField
                label="Lines per mm"
                min={1}
                max={100}
                value={operation.linesPerMm}
                disabled={!editable}
                onCommit={(linesPerMm) => void patch({ linesPerMm })}
              />
              <Toggle
                label="Negative image"
                checked={operation.negativeImage === true}
                disabled={!editable}
                onChange={(negativeImage) => void patch({ negativeImage })}
              />
            </>
          ) : null}
          {design ? (
            <Toggle
              label="Air assist"
              checked={operation.airAssist === true}
              disabled={!editable}
              onChange={(airAssist) => void patch({ airAssist })}
            />
          ) : null}
        </>
      ) : (
        <CncFields
          operation={operation}
          editable={editable && design}
          patch={(cnc) => void patch({ cnc })}
        />
      )}
      <Toggle
        label="Output"
        hint="Off layers stay in the design but aren’t sent to the machine."
        checked={operation.enabled}
        disabled={!editable}
        onChange={(enabled) => void patch({ enabled })}
      />
      {design && recipes.length > 0 && mode === 'laser' ? (
        <label className="field">
          <span>Apply a saved recipe</span>
          <select
            className="select"
            value=""
            disabled={!editable}
            onChange={(event) =>
              event.target.value !== '' &&
              void controller.write(
                'apply_material_recipe',
                { operationId: id, recipeId: event.target.value },
                { success: 'Recipe applied.' },
              )
            }
          >
            <option value="">Choose a recipe…</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name}
                {recipe.powerPercent === undefined
                  ? ''
                  : ` · ${recipe.powerPercent}% ${recipe.speedMmPerMin ?? ''}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {design && editable ? (
        <div className="stack">
          {selection.length > 0 ? (
            <button
              type="button"
              className="btn btn-block"
              onClick={() =>
                void controller.write(
                  'assign_artwork_to_operation',
                  { artworkIds: selection, operationId: id },
                  { success: 'Moved to this layer.' },
                )
              }
            >
              Move selection here ({selection.length})
            </button>
          ) : null}
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() =>
                void controller.write('reorder_operation', { operationId: id, direction: 'up' })
              }
            >
              <Icon name="up" size={18} /> Earlier
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void controller.write('reorder_operation', { operationId: id, direction: 'down' })
              }
            >
              <Icon name="down" size={18} /> Later
            </button>
          </div>
          {confirmDelete ? (
            <Banner tone="danger">
              <span style={{ flex: 1 }}>
                Delete this layer and the artwork only it uses? You can Undo.
              </span>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await controller.write(
                    'delete_operation',
                    { operationId: id },
                    { success: 'Layer deleted.' },
                  );
                  close();
                }}
              >
                Delete
              </button>
            </Banner>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--danger-fg)' }}
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" size={18} /> Delete layer
            </button>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function CncFields({
  operation,
  editable,
  patch,
}: {
  operation: Operation;
  editable: boolean;
  patch: (value: Record<string, unknown>) => void;
}) {
  const cnc = operation.cnc;
  if (cnc === undefined)
    return <Banner tone="info">This operation has no CNC settings yet.</Banner>;
  return (
    <>
      <label className="field">
        <span>Cut</span>
        <select
          className="select"
          value={cnc.cutType}
          disabled={!editable}
          onChange={(event) => patch({ cutType: event.target.value })}
        >
          {CUTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <NumberField
          label="Depth"
          unit="mm"
          min={0.05}
          max={200}
          value={cnc.depthMm}
          disabled={!editable}
          onCommit={(depthMm) => patch({ depthMm })}
        />
        <NumberField
          label="Per pass"
          unit="mm"
          min={0.01}
          max={50}
          value={cnc.depthPerPassMm}
          disabled={!editable}
          onCommit={(depthPerPassMm) => patch({ depthPerPassMm })}
        />
        <NumberField
          label="Feed"
          unit="mm/min"
          min={1}
          max={100000}
          value={cnc.feedMmPerMin}
          disabled={!editable}
          onCommit={(feedMmPerMin) => patch({ feedMmPerMin })}
        />
        <NumberField
          label="Plunge"
          unit="mm/min"
          min={1}
          max={100000}
          value={cnc.plungeMmPerMin}
          disabled={!editable}
          onCommit={(plungeMmPerMin) => patch({ plungeMmPerMin })}
        />
        <NumberField
          label="Spindle"
          unit="rpm"
          min={0}
          max={100000}
          value={cnc.spindleRpm}
          disabled={!editable}
          onCommit={(spindleRpm) => patch({ spindleRpm })}
        />
        <NumberField
          label="Step-over"
          unit="%"
          min={1}
          max={100}
          value={cnc.stepoverPercent}
          disabled={!editable}
          onCommit={(stepoverPercent) => patch({ stepoverPercent })}
        />
      </div>
      {cnc.cutType === 'pocket' ? (
        <Segmented
          label="Pocket strategy"
          value={
            (cnc.pocketStrategy as 'offset' | 'raster-x' | 'raster-y' | 'adaptive') ?? 'offset'
          }
          options={[
            { value: 'offset', label: 'Offset' },
            { value: 'raster-x', label: 'Rows X' },
            { value: 'raster-y', label: 'Rows Y' },
            { value: 'adaptive', label: 'Adaptive' },
          ]}
          onChange={(pocketStrategy) => patch({ pocketStrategy })}
        />
      ) : null}
      <p className="note">
        Check feeds, depths and the tool on the PC before cutting. Pro strategies need Pro on the
        PC.
      </p>
    </>
  );
}
