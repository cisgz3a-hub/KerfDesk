import type { DesignSession } from './design-session';
import type { Bounds } from '../../core/scene';
import { Icon } from '../kit/icons';
import { useDesignStudioStore } from './design-studio-store';
import { selectionBounds } from './design-handles';
import { ShapeInspector } from './ShapeInspector';
import './design-selection-panel.css';

const NAMES = {
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  line: 'Line',
  arc: 'Arc',
  path: 'Path',
} as const;
const ALIGN = [
  ['left', 'Left'],
  ['center-x', 'Centre X'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['center-y', 'Centre Y'],
  ['bottom', 'Bottom'],
] as const;
const DISTRIBUTE = [
  ['horizontal-spacing', 'Horizontal gaps'],
  ['vertical-spacing', 'Vertical gaps'],
  ['horizontal-centers', 'Horizontal centres'],
  ['vertical-centers', 'Vertical centres'],
] as const;

/** One stable home for selection controls in both 2D and 3D. */
export function DesignSelectionPanel({
  photoSelected = false,
}: {
  readonly photoSelected?: boolean;
}): JSX.Element | null {
  const session = useDesignStudioStore((s) => s.session);
  if (session === null) return null;
  const sketch = session.history.present;
  const selected = sketch.entities.filter((entity) => session.selectedIds.has(entity.id));
  const bounds = selectionBounds(sketch, session.selectedIds);
  return (
    <section className="design-selection" aria-label="Artwork properties">
      <header className="design-selection__heading">
        <h3>Artwork</h3>
        <span>
          {selected.length > 0
            ? `${selected.length} selected`
            : photoSelected
              ? 'Photo selected'
              : 'Nothing selected'}
        </span>
      </header>
      {selected.length === 1 ? <ShapeInspector docked /> : null}
      {selected.length > 0 ? <TransformSelection /> : null}
      {selected.length === 0 ? (
        <p className="design-selection__hint">
          {photoSelected
            ? 'Use Edit selected photo below to edit its layers. Select a shape to edit vector dimensions.'
            : 'Choose a drawing tool on the left. Select a shape to set its exact dimensions here. Shift+click adds to your selection.'}
        </p>
      ) : null}
      {bounds !== null && selected.length > 1 ? (
        <SelectionLayout count={selected.length} bounds={bounds} />
      ) : null}
      <ShapeList session={session} />
    </section>
  );
}

function formatMm(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function TransformSelection(): JSX.Element {
  const transform = useDesignStudioStore((s) => s.transformSelection);
  return (
    <section className="design-selection__transform" aria-label="Rotate and flip selected shapes">
      <h4>Rotate &amp; flip</h4>
      <div className="design-selection__transform-buttons">
        <button
          type="button"
          title="Rotate selection 90° anticlockwise"
          onClick={() => transform('rotate-left')}
        >
          <Icon name="rotate-left" size={15} /> 90° left
        </button>
        <button
          type="button"
          title="Rotate selection 90° clockwise"
          onClick={() => transform('rotate-right')}
        >
          <Icon name="rotate-right" size={15} /> 90° right
        </button>
        <button
          type="button"
          title="Mirror selection from left to right"
          onClick={() => transform('flip-horizontal')}
        >
          Flip horizontal
        </button>
        <button
          type="button"
          title="Mirror selection from top to bottom"
          onClick={() => transform('flip-vertical')}
        >
          Flip vertical
        </button>
      </div>
    </section>
  );
}

function SelectionLayout({
  count,
  bounds,
}: {
  readonly count: number;
  readonly bounds: Bounds;
}): JSX.Element {
  const duplicate = useDesignStudioStore((s) => s.duplicateSelection);
  const remove = useDesignStudioStore((s) => s.deleteSelected);
  return (
    <>
      {count > 1 && bounds !== null ? (
        <>
          <dl className="design-selection__bounds" aria-label="Selection size">
            <div>
              <dt>Width</dt>
              <dd>{formatMm(bounds.maxX - bounds.minX)} mm</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{formatMm(bounds.maxY - bounds.minY)} mm</dd>
            </div>
          </dl>
          <div className="design-selection__actions">
            <button
              type="button"
              title="Duplicate selected shapes together (Ctrl+D)"
              onClick={duplicate}
            >
              Duplicate
            </button>
            <button
              type="button"
              title="Delete selected shapes; Undo restores them"
              onClick={remove}
            >
              Delete
            </button>
          </div>
        </>
      ) : null}

      <ArrangeSelection count={count} />
    </>
  );
}
function ArrangeSelection({ count }: { readonly count: number }): JSX.Element {
  const align = useDesignStudioStore((s) => s.alignSelection);
  const distribute = useDesignStudioStore((s) => s.distributeSelection);
  return (
    <>
      {count >= 2 ? (
        <section className="design-selection__arrange" aria-label="Arrange selected shapes">
          <h4>Align to selection</h4>
          <div className="design-selection__align">
            {ALIGN.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                title={`Align ${label.toLowerCase()} within the selected shapes`}
                onClick={() => align(kind)}
              >
                {label}
              </button>
            ))}
          </div>
          <h4>Distribute</h4>
          <div className="design-selection__distribute">
            {DISTRIBUTE.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                disabled={count < 3}
                title={
                  count < 3
                    ? 'Select at least three shapes to distribute'
                    : `Make ${label.toLowerCase()} equal; keep the outer shapes in place`
                }
                onClick={() => distribute(kind)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
function ShapeList({ session }: { readonly session: DesignSession }): JSX.Element {
  const sketch = session.history.present;
  const selectAll = useDesignStudioStore((s) => s.selectAll);
  const select = useDesignStudioStore((s) => s.setSelection);
  const setTool = useDesignStudioStore((s) => s.setTool);
  return (
    <section className="design-selection__objects" aria-label="Shapes in this drawing">
      <header className="design-selection__heading">
        <h4>
          Shapes <span>({sketch.entities.length})</span>
        </h4>
        <button
          type="button"
          disabled={sketch.entities.length === 0}
          title="Select every shape (Ctrl+A)"
          onClick={selectAll}
        >
          Select all
        </button>
      </header>
      {sketch.entities.length === 0 ? (
        <p className="design-selection__hint">Your shapes will appear here as you draw.</p>
      ) : (
        <div className="design-selection__list">
          {sketch.entities.map((entity, index) => (
            <button
              type="button"
              key={entity.id}
              aria-pressed={session.selectedIds.has(entity.id)}
              title="Select this shape; Shift+click adds or removes it from the selection"
              onClick={(event) => {
                const ids = event.shiftKey ? new Set(session.selectedIds) : new Set<string>();
                if (event.shiftKey && ids.has(entity.id)) ids.delete(entity.id);
                else ids.add(entity.id);
                setTool('select');
                select([...ids]);
              }}
            >
              <span>
                {NAMES[entity.kind]} {index + 1}
              </span>
              <small>
                {entity.construction === true
                  ? 'Guide'
                  : (sketch.layers?.find((layer) => layer.id === entity.layerId)?.name ??
                    'Artwork')}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
