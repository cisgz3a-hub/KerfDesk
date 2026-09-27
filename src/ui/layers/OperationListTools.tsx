// Header of the "All operations" list: bulk Output / visibility switches and
// Sort cuts last (LBG-C07). Mirrors the per-row "•••" disclosure menu.
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import type { LayerFlagValue } from '../state/operation-list-actions';

type BulkTool = {
  readonly label: string;
  readonly title: string;
  readonly value: LayerFlagValue;
};

const OUTPUT_TOOLS: ReadonlyArray<BulkTool> = [
  {
    label: 'Turn output on for all',
    title: 'Include every operation in preview and machine output',
    value: true,
  },
  {
    label: 'Turn output off for all',
    title: 'Leave every operation out of preview and machine output',
    value: false,
  },
  {
    label: 'Invert output',
    title: 'Turn output off where it is on, and on where it is off',
    value: 'invert',
  },
];

const VISIBILITY_TOOLS: ReadonlyArray<BulkTool> = [
  { label: 'Show all', title: 'Show every operation on the workspace', value: true },
  { label: 'Hide all', title: 'Hide every operation on the workspace', value: false },
  {
    label: 'Invert visibility',
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
        <span aria-hidden="true">•••</span>
      </summary>
      <div className="lf-operation-card__management-body">
        <ToolGroup label="Output" tools={OUTPUT_TOOLS} onPick={setAllLayersOutput} />
        <ToolGroup label="Visibility" tools={VISIBILITY_TOOLS} onPick={setAllLayersVisible} />
        <div role="group" aria-label="Order" style={groupStyle}>
          <button
            type="button"
            disabled={isCnc}
            title={isCnc ? SORT_CUTS_LAST_CNC_TITLE : SORT_CUTS_LAST_TITLE}
            onClick={sortCutsLast}
          >
            Sort cuts last
          </button>
        </div>
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
    <div role="group" aria-label={props.label} style={groupStyle}>
      {props.tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          title={tool.title}
          onClick={() => props.onPick(tool.value)}
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
}

const groupStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
};
