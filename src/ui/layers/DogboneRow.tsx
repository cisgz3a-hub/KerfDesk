// DogboneRow — relieve sharp interior corners of the selected closed shapes
// with bit-sized overcuts (ADR-102 G6, F-CNC26). CNC-only: dogbones exist so
// square joinery seats into routed slots; a laser kerf has no such limit.
// The bit diameter prefills from the machine's active bit.

import { useState } from 'react';
import { activeCncTool } from '../../core/scene';
import { selectionCanWeld } from '../commands/selection-command-state';
import { useStore } from '../state';

const MIN_BIT_MM = 0.1;
const MAX_BIT_MM = 50;

export function DogboneRow(): JSX.Element | null {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const dogboneSelection = useStore((s) => s.dogboneSelection);
  const [bitOverrideMm, setBitOverrideMm] = useState<number | null>(null);
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return null;
  const selectedIds = [
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ];
  if (!selectionCanWeld(project, selectedIds)) return null;
  const bitMm = bitOverrideMm ?? activeCncTool(machine).diameterMm;
  return (
    <section aria-label="Dogbone corners" style={sectionStyle}>
      <span style={labelStyle}>Dogbone</span>
      <span style={controlStyle}>
        <input
          type="number"
          aria-label="Dogbone bit diameter"
          title="Bit diameter used to size the corner overcut circles."
          min={MIN_BIT_MM}
          max={MAX_BIT_MM}
          step={0.01}
          value={bitMm}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= MIN_BIT_MM && v <= MAX_BIT_MM) setBitOverrideMm(v);
          }}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
        <button
          type="button"
          onClick={() => dogboneSelection(bitMm)}
          title="Relieve corners sharper than 135° with bit-radius overcuts so square parts seat fully."
        >
          Relieve corners
        </button>
      </span>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginTop: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: 64,
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
