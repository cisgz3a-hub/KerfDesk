// DogboneRow — relieve sharp interior corners of the selected closed shapes
// with bit-sized overcuts (ADR-103 G6, F-CNC26). CNC-only: dogbones exist so
// square joinery seats into routed slots; a laser kerf has no such limit.
// The bit diameter prefills from the machine's active bit.

import { TutorialButton } from '../tutorials/TutorialButton';
import { activeCncTool } from '../../core/scene';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useSourceTrackedState } from '../common/use-source-tracked-state';
import { selectionCanWeld } from '../commands/selection-command-state';
import { useStore } from '../state';

const MIN_BIT_MM = 0.1;
const MAX_BIT_MM = 50;

export function DogboneRow(): JSX.Element | null {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const dogboneSelection = useStore((s) => s.dogboneSelection);
  const machine = project.machine;
  const cncMachine = machine?.kind === 'cnc' ? machine : null;
  const activeTool = cncMachine === null ? null : activeCncTool(cncMachine);
  // Prefills from the active bit and keeps following it: a typed override used
  // to pin forever, so switching the machine's bit left this row sizing
  // overcuts to the previous cutter.
  const [bitMm, setBitMm] = useSourceTrackedState(
    activeTool?.diameterMm ?? MIN_BIT_MM,
    activeTool?.id ?? 'no-tool',
  );
  if (cncMachine === null) return null;
  const selectedIds = [
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ];
  if (!selectionCanWeld(project, selectedIds)) return null;
  return (
    <section aria-label="Dogbone corners" className="lf-artwork-tool">
      <div className="lf-artwork-tool__heading">
        <h4>Corner relief · dogbones</h4>
        <TutorialButton tutorialId="dogbone" compact label="Dogbone corners" />
      </div>
      <p className="lf-artwork-hint">
        Add clearance to inside corners so square parts can fit around a round bit’s cut.
      </p>
      <label className="lf-artwork-tool__field">
        <span>Bit diameter</span>
        <ClearableNumberField
          ariaLabel="Dogbone bit diameter"
          title="Bit diameter used to size the corner overcut circles."
          min={MIN_BIT_MM}
          max={MAX_BIT_MM}
          step={0.01}
          value={bitMm}
          onCommit={setBitMm}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
      </label>
      <div className="lf-artwork-tool__actions">
        <button
          type="button"
          onClick={() => dogboneSelection(bitMm)}
          title="Relieve corners sharper than 135° with bit-radius overcuts so square parts seat fully."
        >
          Relieve corners
        </button>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = { width: 64, boxSizing: 'border-box' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
