// ShapeInspector — the floating precision box for the selected shape
// (ADR-272, DS-3b).
//
// Appears when exactly one shape is selected, anchored beside it so the numbers
// sit next to the thing they describe, and draggable by its header because the
// best place for it depends on where you are working. Clamped into the viewport so
// it can never be dragged off-screen.
//
// Fields come from design-entity-fields, so this component never switches on
// entity kind: a rectangle shows corner radius, a circle shows diameter and
// circumference, an arc shows sweep and chord — all from the same render.

import { useEffect, useRef, useState } from 'react';
import { findEntity, type SketchEntity } from '../../core/design';
import { entityFields, type FieldGroup } from './design-entity-fields';
import { useDesignStudioStore } from './design-studio-store';
import { ShapeInspectorField } from './ShapeInspectorField';

const GROUPS: ReadonlyArray<{ readonly group: FieldGroup; readonly heading: string }> = [
  { group: 'position', heading: 'Position' },
  { group: 'size', heading: 'Size' },
  { group: 'shape', heading: 'Shape' },
  { group: 'derived', heading: 'Measured' },
];

const KIND_LABEL: Readonly<Record<SketchEntity['kind'], string>> = {
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  line: 'Line',
  arc: 'Arc',
  path: 'Path',
};

const DUPLICATE_OFFSET_MM = 5;
// Anchored to the RIGHT edge, not the top-left. The first version defaulted to
// {24, 96}, which put a 215x262 panel directly over the area most people draw in
// first — and because a floating panel legitimately swallows pointer events, a drag
// started under it silently did nothing. Reported as "cannot draw a square and a
// circle".
const DEFAULT_RIGHT_INSET_PX = 20;
const DEFAULT_TOP_PX = 16;
const PANEL_WIDTH_PX = 214;

export function ShapeInspector(): JSX.Element | null {
  const session = useDesignStudioStore((state) => state.session);
  const selectedId = onlySelectedId(session?.selectedIds);
  const entity =
    session === null || selectedId === null
      ? null
      : findEntity(session.history.present, selectedId);
  const [position, setPosition] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const resolved = position ?? defaultPosition(hostRef.current);
  const drag = useDragHandle(resolved, setPosition);
  if (entity === null) return null;
  return (
    <aside
      ref={hostRef}
      style={{ ...boxStyle, left: resolved.x, top: resolved.y }}
      aria-label={`${KIND_LABEL[entity.kind]} properties`}
    >
      <header style={headerStyle} onPointerDown={drag.onPointerDown}>
        <span style={titleStyle}>{KIND_LABEL[entity.kind]}</span>
        {entity.construction === true ? <span style={badgeStyle}>guide</span> : null}
      </header>
      <div style={bodyStyle}>
        {GROUPS.map((group) => (
          <FieldGroupRows
            key={group.group}
            entity={entity}
            group={group.group}
            heading={group.heading}
          />
        ))}
      </div>
      <InspectorActions entity={entity} />
    </aside>
  );
}

function FieldGroupRows(props: {
  readonly entity: SketchEntity;
  readonly group: FieldGroup;
  readonly heading: string;
}): JSX.Element | null {
  const fields = entityFields(props.entity).filter((field) => field.group === props.group);
  if (fields.length === 0) return null;
  return (
    <section style={sectionStyle}>
      <h4 style={headingStyle}>{props.heading}</h4>
      {fields.map((field) => (
        <ShapeInspectorField key={field.key} entityId={props.entity.id} field={field} />
      ))}
    </section>
  );
}

function InspectorActions(props: { readonly entity: SketchEntity }): JSX.Element {
  const duplicateEntity = useDesignStudioStore((state) => state.duplicateEntity);
  const deleteSelected = useDesignStudioStore((state) => state.deleteSelected);
  const setConstruction = useDesignStudioStore((state) => state.setConstruction);
  const isGuide = props.entity.construction === true;
  return (
    <footer style={footerStyle}>
      <button
        type="button"
        style={actionStyle}
        title="Copy this shape, offset slightly so both are visible"
        onClick={() => duplicateEntity(props.entity.id, crypto.randomUUID(), DUPLICATE_OFFSET_MM)}
      >
        Duplicate
      </button>
      <button
        type="button"
        style={actionStyle}
        aria-pressed={isGuide}
        title="Construction geometry is drawn as a guide and is left out of the output"
        onClick={() => setConstruction(props.entity.id, !isGuide)}
      >
        Guide
      </button>
      <button
        type="button"
        style={{ ...actionStyle, marginLeft: 'auto' }}
        title="Delete this shape (Ctrl+Z restores it)"
        onClick={deleteSelected}
      >
        Delete
      </button>
    </footer>
  );
}

// Right-anchored until the operator drags it somewhere they prefer, after which
// their position sticks for the session.
function defaultPosition(host: HTMLElement | null): { readonly x: number; readonly y: number } {
  const parentWidth = host?.parentElement?.clientWidth ?? window.innerWidth;
  return {
    x: Math.max(0, parentWidth - PANEL_WIDTH_PX - DEFAULT_RIGHT_INSET_PX),
    y: DEFAULT_TOP_PX,
  };
}

function onlySelectedId(ids: ReadonlySet<string> | undefined): string | null {
  if (ids === undefined || ids.size !== 1) return null;
  return [...ids][0] ?? null;
}

// Drag by the header, clamped so the box cannot be lost off any edge.
function useDragHandle(
  position: { readonly x: number; readonly y: number },
  setPosition: (next: { readonly x: number; readonly y: number }) => void,
): { readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void } {
  const grabRef = useRef<{ readonly dx: number; readonly dy: number } | null>(null);
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const grab = grabRef.current;
      if (grab === null) return;
      setPosition({
        x: clamp(event.clientX - grab.dx, 0, window.innerWidth - 80),
        y: clamp(event.clientY - grab.dy, 0, window.innerHeight - 40),
      });
    };
    const onUp = (): void => {
      grabRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setPosition]);
  return {
    onPointerDown: (event) => {
      grabRef.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const boxStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 3,
  width: PANEL_WIDTH_PX,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 8,
  border: '1px solid var(--lf-border-strong)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
  cursor: 'grab',
  touchAction: 'none',
};

const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--lf-text)' };

const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '1px 5px',
  borderRadius: 999,
  border: '1px solid var(--lf-border)',
  color: 'var(--lf-text-muted)',
};

const bodyStyle: React.CSSProperties = {
  padding: '4px 8px 6px',
  maxHeight: '52vh',
  overflowY: 'auto',
};

const sectionStyle: React.CSSProperties = { paddingBottom: 4 };

const headingStyle: React.CSSProperties = {
  margin: '4px 0 2px',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--lf-text-muted)',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '5px 8px',
  borderTop: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
};

const actionStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 7px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
};
