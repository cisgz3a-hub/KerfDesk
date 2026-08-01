// DesignLayersCard — the Studio's carve layers panel (ADR-272 Amendment 1):
// the layer list, the active layer's settings, and the two actions that give
// layers meaning — New layer and Assign selection. Layer edits ride the sketch
// history, so Ctrl+Z walks them like any drawing step.

import { useMemo } from 'react';
import type { Sketch } from '../../../core/design';
import { entityDesignLayer, sketchLayers, type DesignLayer } from '../../../core/design/layers';
import type { CncTool } from '../../../core/scene';
import { carveLayerTool } from '../../../core/design-carve';
import { useDesignStudioStore } from '../design-studio-store';
import { DesignLayerRow } from './DesignLayerRow';
import { DesignLayerSettings } from './DesignLayerSettings';

export function DesignLayersCard(props: {
  readonly tools: ReadonlyArray<CncTool>;
  readonly activeTool: CncTool;
  readonly stockThicknessMm: number;
}): JSX.Element | null {
  const sketch = useDesignStudioStore((state) =>
    state.session === null ? null : state.session.history.present,
  );
  const activeLayerId = useDesignStudioStore((state) => state.session?.activeLayerId ?? null);
  // The Set itself, not just its size: the panel marks which rows hold the
  // selection so Assign has a visible before and after. The store replaces the
  // Set only when the selection changes, so this stays reference-stable.
  const selectedIds = useDesignStudioStore((state) => state.session?.selectedIds ?? null);
  const selectionCount = selectedIds?.size ?? 0;
  const setActiveLayer = useDesignStudioStore((state) => state.setActiveLayer);
  const addLayer = useDesignStudioStore((state) => state.addLayer);
  const patchLayer = useDesignStudioStore((state) => state.patchLayer);
  const removeLayer = useDesignStudioStore((state) => state.removeLayer);
  const moveLayer = useDesignStudioStore((state) => state.moveLayer);
  const assignSelectionToLayer = useDesignStudioStore((state) => state.assignSelectionToLayer);

  const layers = useMemo(() => (sketch === null ? [] : sketchLayers(sketch)), [sketch]);
  const tally = useMemo(
    () => tallyLayers(sketch, layers, selectedIds),
    [sketch, layers, selectedIds],
  );
  const { countByLayer, layersWithSelection } = tally;

  if (sketch === null) return null;
  const active = layers.find((layer) => layer.id === activeLayerId) ?? layers[0];

  return (
    <section aria-label="Carve layers" style={cardStyle}>
      <LayersCardHeader
        selectionCount={selectionCount}
        canAssign={selectionCount > 0 && active !== undefined}
        onAssign={() => {
          if (active !== undefined) assignSelectionToLayer(active.id);
        }}
        onNew={() => addLayer(crypto.randomUUID())}
      />
      <div style={listStyle}>
        {layers.map((layer, index) => (
          <DesignLayerRow
            key={layer.id}
            layer={layer}
            isActive={layer.id === active?.id}
            hasSelection={layersWithSelection.has(layer.id)}
            entityCount={countByLayer.get(layer.id) ?? 0}
            tool={carveLayerTool(
              { tools: props.tools, activeTool: props.activeTool },
              layer.toolId,
            )}
            canRemove={layers.length > 1}
            canMoveUp={index > 0}
            canMoveDown={index < layers.length - 1}
            onSelect={() => setActiveLayer(layer.id)}
            onMove={(direction) => moveLayer(layer.id, direction)}
            onRemove={() => removeLayer(layer.id)}
          />
        ))}
      </div>
      {active === undefined ? null : (
        <DesignLayerSettings
          layer={active}
          tools={props.tools}
          stockThicknessMm={props.stockThicknessMm}
          onPatch={(patch) => patchLayer(active.id, patch)}
        />
      )}
    </section>
  );
}

// One pass over the entities for both readouts: how many shapes each layer
// holds, and which layers hold the current selection — the answer to "what
// layer is this shape on?", which the panel could not previously show.
function tallyLayers(
  sketch: Sketch | null,
  layers: ReadonlyArray<DesignLayer>,
  selectedIds: ReadonlySet<string> | null,
): {
  readonly countByLayer: ReadonlyMap<string, number>;
  readonly layersWithSelection: ReadonlySet<string>;
} {
  const countByLayer = new Map<string, number>();
  const layersWithSelection = new Set<string>();
  if (sketch === null) return { countByLayer, layersWithSelection };
  for (const entity of sketch.entities) {
    if (entity.construction === true) continue;
    const id = entityDesignLayer(entity, layers).id;
    countByLayer.set(id, (countByLayer.get(id) ?? 0) + 1);
    if (selectedIds?.has(entity.id) === true) layersWithSelection.add(id);
  }
  return { countByLayer, layersWithSelection };
}

function LayersCardHeader(props: {
  readonly selectionCount: number;
  readonly canAssign: boolean;
  readonly onAssign: () => void;
  readonly onNew: () => void;
}): JSX.Element {
  const { selectionCount } = props;
  return (
    <header style={headerStyle}>
      <h3 style={titleStyle}>Carve layers</h3>
      <button
        type="button"
        title={
          selectionCount > 0
            ? `Move the ${selectionCount} selected shape${selectionCount === 1 ? '' : 's'} onto the active layer`
            : 'Select shapes on the canvas first, then assign them to the active layer'
        }
        disabled={!props.canAssign}
        onClick={props.onAssign}
        style={actionButtonStyle}
      >
        Assign
      </button>
      <button
        type="button"
        title="Add a carve layer — draw the next shapes on it with its own cut, depth, and bit"
        onClick={props.onNew}
        style={actionButtonStyle}
      >
        + New
      </button>
    </header>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  padding: '8px 8px 6px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  marginRight: 'auto',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--lf-text)',
};

const actionButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  minHeight: 0,
  maxHeight: 220,
};
