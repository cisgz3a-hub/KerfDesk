// DesignSidePanel — the Studio's right rail (ADR-271 Amendment 1): carve
// layers on top, the live 3D preview below, one drag handle on the left edge.
// The research plan's window layout put exactly this column here; the floating
// shape inspector stays independent of it.

import { DesignLayersCard } from '../layers/DesignLayersCard';
import { DesignCarvePreview } from './DesignCarvePreview';
import { useDesignCarveContent } from './use-design-carve-content';
import { useDesignPaneWidth } from './use-design-pane-width';

export function DesignSidePanel(): JSX.Element {
  const carve = useDesignCarveContent();
  const resize = useDesignPaneWidth();

  return (
    <aside aria-label="Carve layers and preview" style={{ ...panelStyle, width: resize.widthPx }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the layers panel"
        title="Drag to resize the layers panel; arrow keys work too"
        tabIndex={0}
        onPointerDown={resize.onHandlePointerDown}
        onKeyDown={resize.onHandleKeyDown}
        style={handleStyle}
      />
      <div style={contentStyle}>
        {carve === null ? null : (
          <DesignLayersCard
            tools={carve.source.tools}
            activeTool={carve.source.activeTool}
            stockThicknessMm={carve.source.stock.thicknessMm}
          />
        )}
        <DesignCarvePreview content={carve?.content ?? null} source={carve?.source ?? null} />
      </div>
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  borderLeft: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  minHeight: 0,
};

const handleStyle: React.CSSProperties = {
  position: 'absolute',
  left: -3,
  top: 0,
  bottom: 0,
  width: 6,
  cursor: 'col-resize',
  zIndex: 1,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};
