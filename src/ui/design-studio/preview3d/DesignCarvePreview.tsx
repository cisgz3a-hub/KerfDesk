// DesignCarvePreview — the Studio's live 3D carve view (ADR-271 Amendment 1,
// instant tier). The canvas stays mounted while collapsed (display:none) so
// the WebGL scene and the operator's orbit survive the toggle; the scene
// renders on demand, so a hidden pane costs nothing.
//
// Display-only (ADR-261 §3): this view informs, it never gates anything.

import type { ViewerContentInput } from '../../cnc-viewer3d/viewer3d-content';
import { useDesignStudioStore } from '../design-studio-store';
import { useDesignPreviewScene } from './use-design-preview-scene';

export function DesignCarvePreview(props: {
  readonly content: ViewerContentInput | null;
}): JSX.Element | null {
  const show = useDesignStudioStore((state) => state.session?.showPreview3d ?? true);
  const togglePreview3d = useDesignStudioStore((state) => state.togglePreview3d);
  const scene = useDesignPreviewScene(props.content);

  return (
    <section aria-label="Carve preview" style={{ ...sectionStyle, ...(show ? null : collapsedStyle) }}>
      <header style={headerStyle}>
        <button
          type="button"
          onClick={togglePreview3d}
          title={show ? 'Hide the 3D carve preview' : 'Show the 3D carve preview'}
          aria-expanded={show}
          style={toggleStyle}
        >
          {show ? '▾' : '▸'} Carve preview
        </button>
        <span style={tierStyle} title="What you are looking at: the target surface each layer asks for, at its depth, with its bit">
          design surface
        </span>
      </header>
      <div style={{ ...bodyStyle, ...(show ? null : hiddenStyle) }}>
        <canvas
          ref={scene.canvasRef}
          aria-label="3D carve preview canvas — drag to rotate, right-drag to orbit, wheel to zoom"
          style={canvasStyle}
        />
        {scene.state === 'ready' ? null : (
          <p style={stateStyle}>
            {scene.state === 'loading'
              ? 'Building the 3D preview…'
              : '3D preview unavailable here (WebGL required). The layers still apply and cut normally.'}
          </p>
        )}
      </div>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
};

const collapsedStyle: React.CSSProperties = { flex: 0 };

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
};

const toggleStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--lf-text)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
};

const tierStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: 'var(--lf-text-dim)',
  border: '1px solid var(--lf-border)',
  borderRadius: 999,
  padding: '1px 8px',
};

const bodyStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 120,
  margin: '0 8px 8px',
};

const hiddenStyle: React.CSSProperties = { display: 'none' };

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  borderRadius: 6,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
  display: 'block',
};

const stateStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  margin: 0,
  padding: 12,
  textAlign: 'center',
  fontSize: 11,
  color: 'var(--lf-text-dim)',
  pointerEvents: 'none',
};
