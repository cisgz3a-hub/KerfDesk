import { useState } from 'react';
import { controller } from '../core/controller';
import { canEdit, store } from '../core/store';
import type { Operation } from '../core/types';
import { useApp } from './hooks';
import { Icon } from './icons';
import { MODES, OperationSheet } from './operation-sheet';
import { Banner, Segmented, Sheet } from './primitives';

export function LayersScreen() {
  const workspace = useApp((state) => state.workspace);
  const editable = useApp(canEdit);
  const sheet = useApp((state) => state.sheet);
  const selection = useApp((state) => state.selection);
  const operations = workspace?.operations ?? [];
  const design = controller.designControl();
  return (
    <div className="screen">
      <div className="stack">
        <h1 className="screen-title">Layers</h1>
        <p className="screen-sub">
          {workspace?.mode === 'cnc'
            ? 'CNC operations run top to bottom.'
            : 'Each colour is a laser operation. They run top to bottom.'}
        </p>
        {workspace === null ? <div className="skeleton" style={{ height: 180 }} /> : null}
        {operations.length === 0 && workspace !== null ? (
          <Banner tone="info">No layers yet. Add artwork and KerfDesk creates one.</Banner>
        ) : null}
        <div className="list">
          {operations.map((operation, index) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              index={index}
              editable={editable}
            />
          ))}
        </div>
        {editable && design ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => store.set({ sheet: { kind: 'new-operation' } })}
            >
              <Icon name="plus" /> New layer
            </button>
          </div>
        ) : null}
        {editable && !design ? (
          <p className="note">
            Update KerfDesk on the PC to add, reorder and delete layers from here.
          </p>
        ) : null}
        {selection.length > 0 && editable && design ? (
          <p className="note">
            {selection.length} selected · open a layer and choose “Move selection here”.
          </p>
        ) : null}
      </div>
      {sheet?.kind === 'operation' ? <OperationSheet id={sheet.id} /> : null}
      {sheet?.kind === 'new-operation' ? <NewOperationSheet /> : null}
    </div>
  );
}

function summary(operation: Operation, mode: 'laser' | 'cnc'): string {
  if (mode === 'cnc') {
    const cnc = operation.cnc;
    return cnc === undefined
      ? operation.type
      : `${cnc.cutType} · ${cnc.depthMm ?? '—'} mm deep · ${cnc.feedMmPerMin ?? '—'} mm/min`;
  }
  return `${operation.powerPercent ?? '—'}% · ${operation.speedMmPerMin ?? '—'} mm/min · ${operation.passes ?? 1}×`;
}

function OperationRow({
  operation,
  index,
  editable,
}: {
  operation: Operation;
  index: number;
  editable: boolean;
}) {
  const mode = useApp((state) => state.workspace?.mode ?? 'laser');
  return (
    <div className="card" style={{ padding: '4px 4px 4px 14px' }}>
      <div className="row">
        <span className="swatch" style={{ background: operation.color ?? '#888' }} />
        <button
          type="button"
          className="grow"
          style={{
            textAlign: 'left',
            background: 'none',
            border: 0,
            padding: '8px 0',
            cursor: 'pointer',
            minWidth: 0,
          }}
          onClick={() => store.set({ sheet: { kind: 'operation', id: operation.id } })}
        >
          <div className="title">
            {operation.name ?? `Layer ${index + 1}`}{' '}
            <span className="chip" style={{ marginLeft: 6 }}>
              {mode === 'laser'
                ? (MODES.find((item) => item.value === operation.type)?.label ?? operation.type)
                : 'CNC'}
            </span>
          </div>
          <div className="muted small">
            {summary(operation, mode)}
            {operation.artworkCount === undefined
              ? ''
              : ` · ${operation.artworkCount} item${operation.artworkCount === 1 ? '' : 's'}`}
          </div>
        </button>
        <label
          className="switch"
          style={{ minHeight: 40 }}
          aria-label={operation.enabled ? 'Output on' : 'Output off'}
        >
          <input
            type="checkbox"
            role="switch"
            checked={operation.enabled}
            disabled={!editable}
            onChange={(event) =>
              void controller.write('update_operation', {
                operationId: operation.id,
                patch: { enabled: event.target.checked },
              })
            }
          />
        </label>
        <button
          type="button"
          className="btn btn-icon small"
          aria-label="Edit layer"
          onClick={() => store.set({ sheet: { kind: 'operation', id: operation.id } })}
        >
          <Icon name="chevron" size={18} />
        </button>
      </div>
    </div>
  );
}

function NewOperationSheet() {
  const mode = useApp((state) => state.workspace?.mode ?? 'laser');
  const [layerMode, setLayerMode] = useState<'line' | 'fill' | 'image'>('line');
  const [name, setName] = useState('');
  const close = () => store.set({ sheet: null });
  const create = async () => {
    const result = await controller.write<{ operationId?: string }>('create_operation', {
      ...(mode === 'laser' ? { mode: layerMode } : {}),
      ...(name.trim() === '' ? {} : { name: name.trim() }),
    });
    if (result?.operationId !== undefined)
      store.set({ sheet: { kind: 'operation', id: result.operationId } });
  };
  return (
    <Sheet
      title="New layer"
      onClose={close}
      footer={
        <button type="button" className="btn btn-primary" onClick={() => void create()}>
          Create layer
        </button>
      }
    >
      <label className="field">
        <span>Name (optional)</span>
        <input
          className="input"
          value={name}
          maxLength={128}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {mode === 'laser' ? (
        <Segmented label="Mode" value={layerMode} options={MODES} onChange={setLayerMode} />
      ) : null}
      <p className="note">The layer gets the next free colour and your usual defaults.</p>
    </Sheet>
  );
}
