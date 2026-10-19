// Header of the "All operations" list: bulk Output / visibility switches and
// Sort cuts last (LBG-C07), behind the same "•••" disclosure as each row.
// Each group shows its name; the button keeps the full action as its
// accessible name, which contains the shorter visible word.
import { useId } from 'react';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import type { LayerFlagValue } from '../state/operation-list-actions';
import { Icon } from '../kit/icons';

type BulkTool = {
  readonly label: string;
  readonly text: string;
  readonly title: string;
  readonly value: LayerFlagValue;
};

const OUTPUT_TOOLS: ReadonlyArray<BulkTool> = [
  {
    label: 'Turn output on for all',
    text: 'On for all',
    title: 'Include every operation in preview and machine output',
    value: true,
  },
  {
    label: 'Turn output off for all',
    text: 'Off for all',
    title: 'Leave every operation out of preview and machine output',
    value: false,
  },
  {
    label: 'Invert output',
    text: 'Invert',
    title: 'Turn output off where it is on, and on where it is off',
    value: 'invert',
  },
];

const VISIBILITY_TOOLS: ReadonlyArray<BulkTool> = [
  {
    label: 'Show all',
    text: 'Show all',
    title: 'Show every operation on the workspace',
    value: true,
  },
  {
    label: 'Hide all',
    text: 'Hide all',
    title: 'Hide every operation on the workspace',
    value: false,
  },
  {
    label: 'Invert visibility',
    text: 'Invert',
    title: 'Hide shown operations and show hidden ones. Output is not changed',
    value: 'invert',
  },
];

const SORT_CUTS_LAST_TITLE =
  'Engrave first and cut last: Line operations move after Fill and Image, weakest first, and Run order puts cutting artwork last';
const SORT_CUTS_LAST_CNC_TITLE = 'CNC already runs profiles last';

export function OperationListHeader(): JSX.Element {
  return (
    <div className="lf-operation-list__header">
      <p className="lf-artwork-hint">
        Select a drawing colour below. Use Run order to arrange the artwork in your job.
      </p>
      <OperationListTools />
    </div>
  );
}

function OperationListTools(): JSX.Element {
  const setAllLayersOutput = useStore((state) => state.setAllLayersOutput);
  const setAllLayersVisible = useStore((state) => state.setAllLayersVisible);
  const sortCutsLast = useStore((state) => state.sortCutsLast);
  const isCnc = useStore((state) => machineKindOf(state.project.machine) === 'cnc');
  return (
    <details className="lf-operation-card__management">
      <summary
        aria-label="Operation list tools"
        title="Output and visibility for every operation, and Sort cuts last"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
      >
        <Icon name="more" size={18} />
      </summary>
      <div className="lf-operation-card__management-body lf-operation-list-tools">
        <ToolGroup label="Output" tools={OUTPUT_TOOLS} onPick={setAllLayersOutput} />
        <ToolGroup label="Visibility" tools={VISIBILITY_TOOLS} onPick={setAllLayersVisible} />
        <ToolGroupFrame label="Order">
          <button
            type="button"
            className="lf-btn lf-btn--sm"
            disabled={isCnc}
            title={isCnc ? SORT_CUTS_LAST_CNC_TITLE : SORT_CUTS_LAST_TITLE}
            onClick={sortCutsLast}
          >
            Sort cuts last
          </button>
        </ToolGroupFrame>
      </div>
    </details>
  );
}

function ToolGroup(props: {
  readonly label: string;
  readonly tools: ReadonlyArray<BulkTool>;
  readonly onPick: (value: LayerFlagValue) => void;
}): JSX.Element {
  return (
    <ToolGroupFrame label={props.label}>
      {props.tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          className="lf-btn lf-btn--sm"
          aria-label={tool.label}
          title={tool.title}
          onClick={() => props.onPick(tool.value)}
        >
          {tool.text}
        </button>
      ))}
    </ToolGroupFrame>
  );
}

function ToolGroupFrame(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="lf-operation-list-tools__group">
      <span id={id} className="lf-operation-menu__label">
        {props.label}
      </span>
      <div className="lf-operation-list-tools__buttons">{props.children}</div>
    </div>
  );
}
