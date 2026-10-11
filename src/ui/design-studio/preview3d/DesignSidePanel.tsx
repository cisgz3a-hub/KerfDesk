// DesignSidePanel — the Studio's right rail (ADR-272 Amendment 2): the carve
// layers card, resizable from its left edge. The 3D view no longer lives
// here — the CANVAS is the 3D space now; this rail is where the layer plan
// reads and edits. Machine facts (tools, active bit, stock) come from the
// cheap source derivation, never the heightmap — the viewport owns that.

import { useMemo } from 'react';
import { useStore } from '../../state';
import { DesignLayersCard } from '../layers/DesignLayersCard';
import { designCarveSource } from './design-carve-source';
import { useDesignPaneWidth } from './use-design-pane-width';
import { DesignSelectionPanel } from '../DesignSelectionPanel';
import { DesignProjectPhotoList } from '../DesignProjectPhotoList';
import type { DesignPhotoActions } from '../design-project-photos';
import { DesktopEditorsButton } from '../../artcraft-studio/DesktopEditorsButton';

export function DesignSidePanel(photoActions: DesignPhotoActions = {}): JSX.Element {
  const project = useStore((state) => state.project);
  const source = useMemo(() => designCarveSource(project), [project]);
  const resize = useDesignPaneWidth();

  return (
    <aside aria-label="Carve layers panel" style={{ ...panelStyle, width: resize.widthPx }}>
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
        <DesignSelectionPanel
          photoSelected={project.scene.objects.some(
            (object) =>
              object.kind === 'raster-image' && object.id === photoActions.selectedPhotoId,
          )}
        />
        <DesignProjectPhotoList {...photoActions} />
        <details className="design-selection__cut-settings">
          <summary title="Expand carve layers and cutting settings">
            Carve layers &amp; cutting
          </summary>
          <DesignLayersCard
            tools={source.tools}
            activeTool={source.activeTool}
            stockThicknessMm={source.stock.thicknessMm}
          />
        </details>
        {(project.studioDocuments?.length ?? 0) > 0 ? (
          <details className="design-selection__cut-settings">
            <summary title="Access native editor documents already saved in this project">
              Legacy editor documents
            </summary>
            <DesktopEditorsButton />
          </details>
        ) : null}
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
  overflowY: 'auto',
};
