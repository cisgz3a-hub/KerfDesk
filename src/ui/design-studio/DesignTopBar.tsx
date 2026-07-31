// DesignTopBar — the Studio's title row (ADR-271, DS-2).
//
// Controls that act on the whole session live here; controls that act on the
// armed tool live in the options bar below it, and controls that act on the
// selection live in the inspector. That three-way split is Figma's and
// LightBurn's shared convention and is what keeps any one bar from becoming a
// junk drawer.
//
// Apply is the session-level action, so it lives here. It stays enabled only
// while there is output geometry that has changed since the last Apply — an
// inert control, not a policy gate (rule 7).

import { canRedo, canUndo } from './design-history';
import { useDesignApply } from './use-design-apply';
import { useDesignStudioStore } from './design-studio-store';

export function DesignTopBar(props: { readonly onFit: () => void }): JSX.Element | null {
  const session = useDesignStudioStore((state) => state.session);
  const undo = useDesignStudioStore((state) => state.undo);
  const redo = useDesignStudioStore((state) => state.redo);
  const closeStudio = useDesignStudioStore((state) => state.closeStudio);
  const toggleSnap = useDesignStudioStore((state) => state.toggleSnap);
  const toggleOrtho = useDesignStudioStore((state) => state.toggleOrtho);
  const toggleGrid = useDesignStudioStore((state) => state.toggleGrid);
  const togglePreview3d = useDesignStudioStore((state) => state.togglePreview3d);
  const applyHandlers = useDesignApply();
  if (session === null) return null;
  return (
    <header style={barStyle}>
      <h2 style={titleStyle}>Design Studio</h2>

      <BarButton
        label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={undo}
        disabled={!canUndo(session.history)}
      />
      <BarButton
        label="Redo"
        title="Redo (Ctrl+Y)"
        onClick={redo}
        disabled={!canRedo(session.history)}
      />

      <span style={dividerStyle} role="presentation" />

      <BarButton label="Fit" title="Frame the bed (Shift+F)" onClick={props.onFit} />
      <BarToggle
        label="Snap"
        title="Snap to grid and geometry (Shift+S)"
        on={session.snapEnabled}
        onClick={toggleSnap}
      />
      <BarToggle
        label="Ortho"
        title="Constrain to horizontal and vertical (Shift+O)"
        on={session.orthoEnabled}
        onClick={toggleOrtho}
      />
      <BarToggle
        label="Grid"
        title="Show the grid (Shift+G)"
        on={session.showGrid}
        onClick={toggleGrid}
      />
      <BarToggle
        label="3D"
        title="Show the 3D carve preview — each layer at its depth, with its bit"
        on={session.showPreview3d}
        onClick={togglePreview3d}
      />

      <span style={spacerStyle} />

      <BarButton
        label="Apply"
        title="Add this drawing to the project as cuttable artwork. One undo step; the Studio stays open."
        onClick={applyHandlers.apply}
        disabled={!applyHandlers.canApply}
      />
      <BarButton
        label="Apply & Close"
        title="Add the drawing to the project, then close the Studio. Your drawing is kept."
        onClick={applyHandlers.applyAndClose}
        disabled={!applyHandlers.canApply}
      />
      <BarButton
        label="Close"
        title="Close the Studio (Esc). Nothing is applied and your drawing is kept."
        onClick={closeStudio}
      />
    </header>
  );
}

function BarButton(props: {
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled === true}
      style={{ ...buttonStyle, ...(props.disabled === true ? disabledStyle : null) }}
    >
      {props.label}
    </button>
  );
}

function BarToggle(props: {
  readonly label: string;
  readonly title: string;
  readonly on: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-pressed={props.on}
      style={{ ...buttonStyle, ...(props.on ? onStyle : null) }}
    >
      {props.label}
    </button>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  marginRight: 'var(--lf-space-3)',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--lf-text)',
};

const buttonStyle: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
};

const onStyle: React.CSSProperties = {
  borderColor: 'var(--lf-accent)',
  background: 'var(--lf-bg-input)',
};

// Undo with nothing to undo is inert, not forbidden — this is a no-op control,
// not a policy gate (rule 7).
const disabledStyle: React.CSSProperties = { opacity: 0.4, cursor: 'default' };

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'var(--lf-border)',
  margin: '0 4px',
};

const spacerStyle: React.CSSProperties = { marginLeft: 'auto' };
