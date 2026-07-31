// ShapeInspectorField — one dimension row in the floating inspector
// (ADR-271, DS-3b).
//
// The row is where "precise" is actually delivered:
//  - the value is typed, not nudged, and commits on Enter or on blur (the repo's
//    commit-on-blur convention, so a half-typed number never reaches the geometry);
//  - focusing or hovering the row calls out that exact distance on the shape, and
//    leaving it takes the call-out away;
//  - Escape abandons the edit and restores the shown value.
//
// Derived rows (area, perimeter, arc length) render as read-only readouts but STILL
// annotate on hover, because "show me what that number measures" is useful even
// when the number cannot be typed.

import { useState } from 'react';
import {
  formatFieldNumber,
  parseFieldNumber,
  unitSuffix,
  type EntityField,
} from './design-field-format';
import { useDesignStudioStore } from './design-studio-store';

export function ShapeInspectorField(props: {
  readonly entityId: string;
  readonly field: EntityField;
}): JSX.Element {
  const { entityId, field } = props;
  const editEntityField = useDesignStudioStore((state) => state.editEntityField);
  const setActiveMeasurement = useDesignStudioStore((state) => state.setActiveMeasurement);
  // While `draft` is null the input mirrors the geometry, so dragging the shape
  // updates the number live; once typing starts the draft owns the input until it
  // commits or is abandoned, so keystrokes are never fought by a re-render.
  const shown = formatFieldNumber(field);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    if (draft === null) return;
    const parsed = parseFieldNumber(draft);
    setDraft(null);
    if (parsed === null) return;
    if (field.min !== undefined && parsed < field.min) return;
    editEntityField(entityId, field.key, parsed);
  };

  return (
    <label
      style={rowStyle}
      onPointerEnter={() => setActiveMeasurement(field.key)}
      onPointerLeave={() => setActiveMeasurement(null)}
    >
      <span style={labelStyle}>{field.label}</span>
      {field.editable ? (
        <input
          type="text"
          inputMode="decimal"
          value={draft ?? shown}
          aria-label={`${field.label} in ${unitSuffix(field.unit) || 'units'}`}
          title={editableTooltip(field)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setActiveMeasurement(field.key)}
          onBlur={() => {
            commit();
            setActiveMeasurement(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.preventDefault();
              return;
            }
            if (event.key === 'Escape') {
              setDraft(null);
              event.stopPropagation();
            }
          }}
          style={inputStyle}
        />
      ) : (
        <output style={readoutStyle} title={derivedTooltip(field)}>
          {shown}
        </output>
      )}
      <span style={unitStyle}>{unitSuffix(field.unit)}</span>
    </label>
  );
}

// The a11y contract (src/ui/a11y/button-hover-contract.test.ts) requires every raw
// control to explain itself on hover. That is the right requirement here anyway:
// the tooltip is where "press Enter to commit" and the unit belong, so neither has
// to be guessed from the layout.
function editableTooltip(field: EntityField): string {
  const unit = unitSuffix(field.unit);
  const measured = unit === '' ? field.label : `${field.label} in ${unit}`;
  const floor = field.min === undefined ? '' : ` Minimum ${field.min}.`;
  return `${measured}. Type a value and press Enter to apply; Esc cancels. Hover to see it measured on the shape.${floor}`;
}

function derivedTooltip(field: EntityField): string {
  const unit = unitSuffix(field.unit);
  const measured = unit === '' ? field.label : `${field.label} in ${unit}`;
  return `${measured}, measured from the shape. Read-only. Hover to see what it measures.`;
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 74px 26px',
  alignItems: 'center',
  gap: 6,
  padding: '1px 0',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// Tabular figures everywhere a dimension appears, so a column of numbers does not
// shift sideways as digits change.
const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  padding: '2px 5px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
};

const readoutStyle: React.CSSProperties = {
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  color: 'var(--lf-text-muted)',
  padding: '2px 5px',
};

const unitStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--lf-text-muted)',
};
