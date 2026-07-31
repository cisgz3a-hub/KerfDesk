// DesignCarvePreview — the Studio's live 3D carve view (ADR-271 Amendment 1).
// Two labelled tiers: the instant DESIGN surface (target depths, recomputed as
// you draw) and the click-to-run BITS simulation (real toolpaths, each tool
// section stamped with its own bit's kernel). The canvas stays mounted while
// collapsed (display:none) so the WebGL scene and the orbit survive a toggle.
//
// Display-only (ADR-261 §3): this view informs, it never gates anything.

import { useMemo, useState } from 'react';
import { steppedSurfaceMesh } from '../../../core/heightfield';
import type { ViewerContentInput } from '../../cnc-viewer3d/viewer3d-content';
import { useDesignStudioStore } from '../design-studio-store';
import type { DesignCarveSource } from './design-carve-source';
import { useDesignPreviewScene } from './use-design-preview-scene';
import { useDesignSimulate } from './use-design-simulate';

export function DesignCarvePreview(props: {
  readonly content: ViewerContentInput | null;
  readonly source: DesignCarveSource | null;
}): JSX.Element | null {
  const show = useDesignStudioStore((state) => state.session?.showPreview3d ?? true);
  const togglePreview3d = useDesignStudioStore((state) => state.togglePreview3d);
  const [mode, setMode] = useState<'design' | 'bits'>('design');
  const sim = useDesignSimulate(props.source);

  const simContent = useMemo<ViewerContentInput | null>(() => {
    if (sim.simulate.kind !== 'ok' || props.source === null) return null;
    return {
      mesh: steppedSurfaceMesh(sim.simulate.grid),
      stockThicknessMm: props.source.stock.thicknessMm,
      ...(props.source.materialKey === undefined ? {} : { materialKey: props.source.materialKey }),
    };
  }, [sim.simulate, props.source]);

  const showingBits = mode === 'bits' && simContent !== null;
  const scene = useDesignPreviewScene(showingBits ? simContent : props.content);
  const failureReason =
    sim.simulate.kind === 'failed' || sim.simulate.kind === 'empty' ? sim.simulate.reason : null;

  return (
    <section
      aria-label="Carve preview"
      style={{ ...sectionStyle, ...(show ? null : collapsedStyle) }}
    >
      <PreviewHeader
        show={show}
        onToggle={togglePreview3d}
        hasSimulation={simContent !== null}
        showingBits={showingBits}
        isStale={sim.isStale}
        onMode={setMode}
        onSimulate={() => {
          sim.run();
          setMode('bits');
        }}
      />
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
      {failureReason === null || !show ? null : <p style={reasonStyle}>{failureReason}</p>}
    </section>
  );
}

function PreviewHeader(props: {
  readonly show: boolean;
  readonly onToggle: () => void;
  readonly hasSimulation: boolean;
  readonly showingBits: boolean;
  readonly isStale: boolean;
  readonly onMode: (mode: 'design' | 'bits') => void;
  readonly onSimulate: () => void;
}): JSX.Element {
  return (
    <header style={headerStyle}>
      <button
        type="button"
        onClick={props.onToggle}
        title={props.show ? 'Hide the 3D carve preview' : 'Show the 3D carve preview'}
        aria-expanded={props.show}
        style={toggleStyle}
      >
        {props.show ? '▾' : '▸'} Carve preview
      </button>
      {props.hasSimulation ? (
        <span role="group" aria-label="Preview tier" style={chipsStyle}>
          <TierChip
            label="Design"
            active={!props.showingBits}
            onClick={() => props.onMode('design')}
            title="The target surface each layer asks for — instant, updates as you draw"
          />
          <TierChip
            label={props.isStale ? 'Bits (stale)' : 'Bits'}
            active={props.showingBits}
            onClick={() => props.onMode('bits')}
            title={
              props.isStale
                ? 'Simulated with each layer’s real bit — the drawing changed since this ran, press Simulate again'
                : 'Simulated from real toolpaths, each tool section stamped with its own bit'
            }
          />
        </span>
      ) : null}
      <button
        type="button"
        onClick={props.onSimulate}
        title="Compile the layers into real toolpaths and carve them with each layer's bit shape"
        style={simulateStyle}
      >
        Simulate
      </button>
    </header>
  );
}

function TierChip(props: {
  readonly label: string;
  readonly active: boolean;
  readonly title: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-pressed={props.active}
      style={{ ...chipStyle, ...(props.active ? chipActiveStyle : null) }}
    >
      {props.label}
    </button>
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

const chipsStyle: React.CSSProperties = { display: 'flex', gap: 2, marginLeft: 4 };

const chipStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '1px 8px',
  borderRadius: 999,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text-dim)',
  cursor: 'pointer',
};

const chipActiveStyle: React.CSSProperties = {
  borderColor: 'var(--lf-accent)',
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-input)',
};

const simulateStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  padding: '2px 9px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
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

const reasonStyle: React.CSSProperties = {
  margin: '0 8px 8px',
  fontSize: 10,
  color: 'var(--lf-text-dim)',
};
