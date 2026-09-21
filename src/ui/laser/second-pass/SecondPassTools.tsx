import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { SecondPassTool } from './SecondPassCanvas';

type SecondPassToolsProps = {
  tool: SecondPassTool;
  diameter: number;
  power: number;
  disabled: boolean;
  strokes: LaserSecondPassSelection['strokes'];
  selected: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: SecondPassTool) => void;
  onDiameter: (mm: number) => void;
  onPower: (percent: number) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
};

export function SecondPassTools(props: SecondPassToolsProps): JSX.Element {
  return (
    <aside className="second-pass-tools" aria-label="Second-pass painting tools">
      <h3>Mark the areas to darken</h3>
      <BrushControls {...props} />
      <p className="second-pass-hint">
        100% repeats the saved power. 150% adds half as much power again, up to the machine maximum.
        Grayscale and speed stay as saved. Colour shows the painted mask, not a prediction of
        darkness.
      </p>
      <HistoryControls {...props} />
      <h3>Brush strokes · {props.strokes.length}</h3>
      <p className="second-pass-hint">
        Select a painted stroke to change its power. The latest stroke wins where areas overlap.
        Eraser strokes remove engraving from the pass.
      </p>
      <StrokeList {...props} />
    </aside>
  );
}

const TOOLS: ReadonlyArray<{ tool: SecondPassTool; label: string; title: string }> = [
  {
    tool: 'paint',
    label: 'Paintbrush',
    title:
      'Mark engraving to repeat at the chosen power; the latest stroke wins where marks overlap.',
  },
  {
    tool: 'erase',
    label: 'Eraser',
    title: 'Remove covered engraving from the second pass without changing the saved original job.',
  },
  {
    tool: 'pan',
    label: 'Hand',
    title: 'Drag to move the canvas view without changing painted areas.',
  },
];

function BrushControls(props: SecondPassToolsProps): JSX.Element {
  return (
    <>
      <div className="second-pass-tool-buttons" role="group" aria-label="Drawing tools">
        {TOOLS.map(({ tool, label, title }) => (
          <button
            className="lf-btn lf-btn--sm"
            key={tool}
            title={title}
            disabled={props.disabled}
            aria-pressed={props.tool === tool}
            onClick={() => props.onTool(tool)}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        Brush diameter (mm)
        <input
          className="lf-input"
          type="number"
          min={0.01}
          step={0.1}
          value={props.diameter}
          title="Diameter of new paint or eraser strokes, measured in the original job's millimetres."
          disabled={props.disabled}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            if (Number.isFinite(n) && n > 0) props.onDiameter(n);
          }}
        />
      </label>
      <label>
        {props.selected ? 'Selected stroke power (% of original)' : 'Paint power (% of original)'}
        <input
          className="lf-input"
          type="number"
          min={1}
          step={5}
          value={props.power}
          title="Power for the selected stroke or new paint, as a percentage of saved power. 100% repeats it; machine maximum still applies."
          disabled={props.disabled || props.tool === 'erase'}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            if (Number.isFinite(n) && n > 0) props.onPower(n);
          }}
        />
      </label>
    </>
  );
}

function HistoryControls(props: SecondPassToolsProps): JSX.Element {
  return (
    <div className="second-pass-tool-buttons">
      <button
        className="lf-btn lf-btn--sm"
        disabled={props.disabled || !props.canUndo}
        onClick={props.onUndo}
        title="Undo the last stroke, removal, or power change."
      >
        Undo
      </button>
      <button
        className="lf-btn lf-btn--sm"
        disabled={props.disabled || !props.canRedo}
        onClick={props.onRedo}
        title="Restore the last change that was undone."
      >
        Redo
      </button>
      <button
        className="lf-btn lf-btn--sm"
        disabled={props.disabled || props.strokes.length === 0}
        onClick={props.onClear}
        title="Remove every paint and eraser stroke from this second-pass draft."
      >
        Clear areas
      </button>
    </div>
  );
}

function StrokeList(props: SecondPassToolsProps): JSX.Element {
  return (
    <ol className="second-pass-strokes">
      {props.strokes.map((stroke, index) => (
        <li key={stroke.id}>
          <button
            className="lf-btn lf-btn--sm"
            disabled={props.disabled || stroke.mode === 'erase'}
            aria-pressed={props.selected === stroke.id}
            title={
              stroke.mode === 'erase'
                ? 'This eraser stroke removes covered engraving from the second pass.'
                : 'Select this painted stroke to adjust its power.'
            }
            onClick={() => props.onSelect(stroke.id)}
          >
            {stroke.mode === 'erase' ? 'Erase' : 'Paint'} {index + 1}
            {stroke.mode === 'paint' ? ` · ${Math.round(stroke.powerScale * 100)}%` : ''}
          </button>
          <button
            className="lf-btn lf-btn--sm"
            aria-label={`Remove stroke ${index + 1}`}
            title="Remove this stroke; earlier overlapping paint or eraser strokes then apply."
            disabled={props.disabled}
            onClick={() => props.onRemove(stroke.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ol>
  );
}
