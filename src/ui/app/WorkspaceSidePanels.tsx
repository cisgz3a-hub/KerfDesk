import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { COLLAPSED_RAIL_WIDTH_PX } from '../common';
import { CutsLayersPanel } from '../layers';
import { LaserWindow } from '../laser';
import { WorkspaceJobActions } from '../laser/WorkspaceJobActions';
import { Icon, type IconName } from '../kit';
import { useUiStore } from '../state/ui-store';
import { useWorkspaceLayoutStore } from '../state/workspace-layout-store';
import { useMachineRailVisibility } from '../state/use-machine-rail-visibility';
import type { RailPanelId } from '../state/ui-rail-panel';
import { useWorkspaceLayout } from './use-workspace-layout';

export function WorkspaceSidePanels(): JSX.Element {
  const layout = useWorkspaceLayout();
  const [active, setActive] = useState<RailPanelId>('layers');
  const [cutsOpen, setCutsOpen] = useState(true);
  const [machineOpen, setMachineOpen] = useState(true);
  const layersExpanded = useUiStore((state) => state.railPanelVisibility.layers);
  const machinePanel = useMachineRailVisibility();
  const panelId = useId();
  useWorkspacePanelFocus(setActive, setCutsOpen, setMachineOpen);

  function selectPanel(panel: RailPanelId): void {
    setActive(panel);
    useUiStore.getState().setRailPanelVisible(panel, true);
  }

  if (layout === 'compact') {
    const collapsed = active === 'layers' ? !layersExpanded : !machinePanel.isExpanded;
    return (
      <section
        aria-label="Workspace side panels"
        data-layout="compact"
        className="lf-workspace-panels lf-workspace-panels--compact"
        style={collapsed ? collapsedCompactPanelStyle : undefined}
      >
        <CompactPanelTabs
          panelId={panelId}
          active={active}
          collapsed={collapsed}
          onSelect={selectPanel}
        />
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${panelId}-${active}`}
          className="lf-workspace-panel-body"
        >
          {active === 'layers' ? <CutsLayersPanel /> : <LaserWindow dockedJobActions />}
        </div>
        {!collapsed ? <WorkspaceJobActions /> : null}
      </section>
    );
  }

  return (
    <section
      aria-label="Workspace side panels"
      data-layout="spacious"
      className="lf-workspace-panels"
    >
      <div className="lf-workspace-panel-toggles">
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
      <div className="lf-workspace-desktop-panels">
        {cutsOpen ? (
          <ResizablePanel label="Cuts / Layers" collapsed={!layersExpanded}>
            <CutsLayersPanel />
          </ResizablePanel>
        ) : null}
        {machineOpen ? (
          <ResizablePanel label="Machine controls" collapsed={!machinePanel.isExpanded}>
            <div className="lf-workspace-machine-body">
              <LaserWindow dockedJobActions />
            </div>
            {machinePanel.isExpanded ? <WorkspaceJobActions /> : null}
          </ResizablePanel>
        ) : null}
      </div>
    </section>
  );
}

function CompactPanelTabs(props: {
  readonly panelId: string;
  readonly active: RailPanelId;
  readonly collapsed: boolean;
  readonly onSelect: (panel: RailPanelId) => void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Side panel"
      aria-orientation={props.collapsed ? 'vertical' : 'horizontal'}
      className={`lf-workspace-panel-tabs${props.collapsed ? ' lf-workspace-panel-tabs--collapsed' : ''}`}
    >
      <PanelTab
        id={`${props.panelId}-layers`}
        controls={props.panelId}
        label="Artwork"
        icon="layers"
        selected={props.active === 'layers'}
        onSelect={() => props.onSelect('layers')}
      />
      <PanelTab
        id={`${props.panelId}-machine`}
        controls={props.panelId}
        label="Machine"
        icon="sliders"
        selected={props.active === 'machine'}
        onSelect={() => props.onSelect('machine')}
      />
    </div>
  );
}

function useWorkspacePanelFocus(
  setActive: (panel: RailPanelId) => void,
  setCutsOpen: (open: boolean) => void,
  setMachineOpen: (open: boolean) => void,
): void {
  const request = useUiStore((state) => state.railPanelFocusRequest);
  const resetRevision = useWorkspaceLayoutStore((state) => state.resetRevision);
  useEffect(() => {
    setActive('layers');
    setCutsOpen(true);
    setMachineOpen(true);
  }, [resetRevision, setActive, setCutsOpen, setMachineOpen]);
  useEffect(() => {
    if (request?.panel === 'layers') {
      setActive('layers');
      setCutsOpen(true);
    } else if (request?.panel === 'machine') {
      setActive('machine');
      setMachineOpen(true);
    }
  }, [request, setActive, setCutsOpen, setMachineOpen]);
}

function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>): void {
  const vertical =
    event.currentTarget.parentElement?.getAttribute('aria-orientation') === 'vertical';
  const [previousKey, nextKey] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
    return;
  // Both arrow axes belong to the focused tabs. Even an unused axis must not
  // bubble to the window's selected-artwork nudge shortcut.
  event.preventDefault();
  event.stopPropagation();
  if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
  );
  if (buttons.length === 0) return;
  const index = buttons.indexOf(event.currentTarget);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === nextKey ? 1 : -1) + buttons.length) % buttons.length;
  const target = buttons[next];
  if (target === undefined) return;
  target.click();
  target.focus();
}

function PanelTab(props: {
  readonly id: string;
  readonly controls: string;
  readonly label: string;
  readonly icon: IconName;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      id={props.id}
      type="button"
      role="tab"
      aria-label={props.label}
      aria-controls={props.controls}
      aria-selected={props.selected}
      tabIndex={props.selected ? 0 : -1}
      title={`Show ${props.label} panel`}
      className={props.selected ? 'lf-btn lf-btn--primary' : 'lf-btn lf-btn--ghost'}
      onClick={props.onSelect}
      onKeyDown={moveTabFocus}
    >
      <Icon name={props.icon} size={15} />
      <span className="lf-workspace-panel-label">{props.label}</span>
    </button>
  );
}

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
      aria-pressed={props.expanded}
      title={`${props.expanded ? 'Hide' : 'Show'} ${props.label} panel`}
      onClick={props.onToggle}
    >
      <Icon name={props.icon} size={14} />
      {props.label}
    </button>
  );
}

// One panel width, whatever view is showing (ADR-348). Switching the Artwork /
// Operations panel to Run order used to widen the whole rail, which moved the
// canvas under the operator mid-task and overwrote any width they had dragged
// for themselves.
function ResizablePanel(props: {
  readonly label: string;
  readonly collapsed: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      aria-label={`${props.label} resizable panel`}
      className="lf-workspace-resizable-panel"
      style={props.collapsed ? collapsedResizablePanelStyle : resizablePanelStyle}
    >
      {props.children}
    </div>
  );
}

const resizablePanelStyle: React.CSSProperties = {
  width: 300,
  minWidth: 240,
  maxWidth: 480,
  minHeight: 0,
  resize: 'horizontal',
  overflow: 'hidden',
};
const collapsedCompactPanelStyle: React.CSSProperties = {
  width: COLLAPSED_RAIL_WIDTH_PX,
  maxWidth: COLLAPSED_RAIL_WIDTH_PX,
  boxSizing: 'border-box',
};
const collapsedResizablePanelStyle: React.CSSProperties = {
  ...resizablePanelStyle,
  width: COLLAPSED_RAIL_WIDTH_PX,
  minWidth: COLLAPSED_RAIL_WIDTH_PX,
  maxWidth: COLLAPSED_RAIL_WIDTH_PX,
  resize: 'none',
};
