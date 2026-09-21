import { TutorialButton } from '../tutorials/TutorialButton';

type ArtworkRunOrderToolbarProps = {
  readonly search: string;
  readonly total: number;
  readonly jumpPosition: string;
  readonly numbering:
    | { readonly kind: 'idle' }
    | { readonly kind: 'active'; readonly nextPosition: number; readonly canUndo: boolean };
  readonly onSearch: (value: string) => void;
  readonly onJumpPosition: (value: string) => void;
  readonly onJump: () => void;
  readonly onStartNumbering: () => void;
  readonly onUndoNumbering: () => void;
  readonly onDoneNumbering: () => void;
  readonly onCancelNumbering: () => void;
};

export function ArtworkRunOrderToolbar(props: ArtworkRunOrderToolbarProps): JSX.Element {
  if (props.numbering.kind === 'active') {
    return <CanvasNumberingControls {...props} numbering={props.numbering} />;
  }
  return <RunOrderTools {...props} />;
}

function CanvasNumberingControls(
  props: Pick<
    ArtworkRunOrderToolbarProps,
    'total' | 'onUndoNumbering' | 'onDoneNumbering' | 'onCancelNumbering'
  > & {
    readonly numbering: Extract<ArtworkRunOrderToolbarProps['numbering'], { kind: 'active' }>;
  },
): JSX.Element {
  return (
    <section aria-label="Canvas numbering controls" className="lf-run-order-numbering">
      <div className="lf-run-order-numbering-heading" role="status">
        <strong>Click artwork for run #{props.numbering.nextPosition}</strong>
        <span>
          {props.numbering.nextPosition - 1} of {props.total} assigned
        </span>
      </div>
      <p>Click artwork on the canvas in the order you want it to run.</p>
      <div className="lf-run-order-numbering-actions">
        <button
          type="button"
          title="Undo the most recent canvas run-number assignment"
          disabled={!props.numbering.canUndo}
          onClick={props.onUndoNumbering}
        >
          Undo last
        </button>
        <button
          type="button"
          title="Finish numbering and save it as one undoable change"
          className="lf-btn lf-btn--primary"
          onClick={props.onDoneNumbering}
        >
          Done
        </button>
        <button
          type="button"
          title="Cancel numbering and restore the original run order"
          className="lf-btn lf-btn--ghost"
          onClick={props.onCancelNumbering}
        >
          Cancel
        </button>
      </div>
      <p>Done keeps your changes. Cancel restores the previous order.</p>
    </section>
  );
}

function RunOrderTools(
  props: Pick<
    ArtworkRunOrderToolbarProps,
    | 'search'
    | 'total'
    | 'jumpPosition'
    | 'onSearch'
    | 'onJumpPosition'
    | 'onJump'
    | 'onStartNumbering'
  >,
): JSX.Element {
  const jump = Number(props.jumpPosition);
  const canJump = Number.isInteger(jump) && jump >= 1 && jump <= props.total;
  return (
    <section aria-label="Artwork run order tools" className="lf-run-order-toolbar">
      <div className="lf-run-order-toolbar-actions">
        <button
          type="button"
          title="Assign run numbers by clicking artwork on the canvas"
          className="lf-btn lf-btn--primary"
          onClick={props.onStartNumbering}
        >
          Number on canvas
        </button>
        <TutorialButton tutorialId="operations" label="Run order tutorial" />
      </div>
      <label className="lf-run-order-search">
        <span>Find artwork</span>
        <input
          type="search"
          value={props.search}
          aria-label="Search artwork jobs"
          title="Find runs by artwork name, operation or setting"
          placeholder="Name, operation or setting"
          onChange={(event) => props.onSearch(event.currentTarget.value)}
        />
      </label>
      <div className="lf-run-order-jump">
        <label>
          <span>Jump to run</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, props.total)}
            step={1}
            value={props.jumpPosition}
            aria-label="Jump to run number"
            title={`Enter a whole run number from 1 to ${props.total}`}
            onChange={(event) => props.onJumpPosition(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canJump) props.onJump();
            }}
          />
        </label>
        <button
          type="button"
          title="Reveal the entered run number"
          disabled={!canJump}
          onClick={props.onJump}
        >
          Go
        </button>
        {props.search.length > 0 ? (
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            title="Clear the search to show every artwork run"
            onClick={() => props.onSearch('')}
          >
            Clear search
          </button>
        ) : null}
      </div>
    </section>
  );
}
