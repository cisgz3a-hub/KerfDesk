import { useEffect, useState } from 'react';
import { COLLAPSED_RAIL_WIDTH_PX } from '../common';
import { CutsLayersPanel } from '../layers';
import { LaserWindow } from '../laser';
import { Icon, type IconName } from '../kit';
import { useUiStore } from '../state/ui-store';
import { useMachineRailVisibility } from '../state/use-machine-rail-visibility';

type PanelId = 'cuts' | 'machine';

export function WorkspaceSidePanels(): JSX.Element {
  const compact = useCompactWorkspace();
  const [active, setActive] = useState<PanelId>('cuts');
  const [cutsOpen, setCutsOpen] = useState(true);
  const [machineOpen, setMachineOpen] = useState(true);
  const layersExpanded = useUiStore((state) => state.railPanelVisibility.layers);
  const machinePanel = useMachineRailVisibility();
  const runOrderOpen = useUiStore((state) => state.cutsLayersView === 'run-order');

  if (compact) {
    return (
      <section
        aria-label="Workspace side panels"
        style={{
          ...compactShellStyle,
          width: runOrderOpen ? 'min(46vw, 430px)' : 'min(38vw, 340px)',
          minWidth: runOrderOpen ? 320 : 260,
        }}
      >
        <div role="tablist" aria-label="Side panel" style={switcherStyle}>
          <PanelTab
            label="Cuts / Layers"
            selected={active === 'cuts'}
            onSelect={() => setActive('cuts')}
          />
          <PanelTab
            label="Machine"
            selected={active === 'machine'}
            onSelect={() => setActive('machine')}
          />
        </div>
        <div
          role="tabpanel"
          aria-label={active === 'cuts' ? 'Cuts / Layers' : 'Machine'}
          style={compactPanelStyle}
        >
          {active === 'cuts' ? <CutsLayersPanel /> : <LaserWindow />}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Workspace side panels" style={desktopShellStyle}>
      <div style={collapseBarStyle}>
        <PanelToggle
          label="Layers"
          icon="panel-left"
          expanded={cutsOpen}
          onToggle={() => setCutsOpen((open) => !open)}
        />
        <PanelToggle
          label="Machine"
          icon="panel-right"
          expanded={machineOpen}
          onToggle={() => setMachineOpen((open) => !open)}
        />
      </div>
      <div style={desktopPanelsStyle}>
        {cutsOpen ? (
          <ResizablePanel label="Cuts / Layers" wide={runOrderOpen} collapsed={!layersExpanded}>
            <CutsLayersPanel />
          </ResizablePanel>
        ) : null}
        {machineOpen ? (
          <ResizablePanel label="Machine controls" collapsed={!machinePanel.isExpanded}>
            <LaserWindow />
          </ResizablePanel>
        ) : null}
      </div>
    </section>
  );
}

function useCompactWorkspace(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setCompact(window.innerWidth <= 1199);
      return;
    }
    const query = window.matchMedia('(max-width: 1199px)');
    const update = (): void => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

function PanelTab(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      title={`Show ${props.label} panel`}
      className={props.selected ? 'lf-btn lf-btn--primary' : 'lf-btn lf-btn--ghost'}
      onClick={props.onSelect}
    >
      {props.label}
    </button>
  );
}

// The label stays constant; aria-pressed drives the accent fill (via
// .lf-btn[aria-pressed='true']) so the button reads as "on" when the panel is
// shown — the panel-toggle convention in VS Code / Figma / LightBurn, clearer
// than a label that flips between Hide and Show.
function PanelToggle(props: {
  readonly label: string;
  readonly icon: IconName;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      style={panelToggleStyle}
      aria-pressed={props.expanded}
      title={`${props.expanded ? 'Hide' : 'Show'} ${props.label} panel`}
      onClick={props.onToggle}
    >
      <Icon name={props.icon} size={14} />
      {props.label}
    </button>
  );
}

function ResizablePanel(props: {
  readonly label: string;
  readonly wide?: boolean;
  readonly collapsed: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      aria-label={`${props.label} resizable panel`}
      style={
        props.collapsed
          ? collapsedResizablePanelStyle
          : props.wide === true
            ? { ...resizablePanelStyle, width: 400, minWidth: 320 }
            : resizablePanelStyle
      }
    >
      {props.children}
    </div>
  );
}

const desktopShellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flexShrink: 0,
};
const collapseBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
  padding: 4,
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
};
const panelToggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
const desktopPanelsStyle: React.CSSProperties = { display: 'flex', minHeight: 0, flex: 1 };
const resizablePanelStyle: React.CSSProperties = {
  width: 300,
  minWidth: 240,
  maxWidth: 480,
  minHeight: 0,
  resize: 'horizontal',
  overflow: 'hidden',
};
const collapsedResizablePanelStyle: React.CSSProperties = {
  ...resizablePanelStyle,
  width: COLLAPSED_RAIL_WIDTH_PX,
  minWidth: COLLAPSED_RAIL_WIDTH_PX,
  maxWidth: COLLAPSED_RAIL_WIDTH_PX,
  resize: 'none',
};
const compactShellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  minHeight: 0,
};
const switcherStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 4,
  padding: 4,
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
};
const compactPanelStyle: React.CSSProperties = { minHeight: 0, flex: 1, overflow: 'hidden' };
