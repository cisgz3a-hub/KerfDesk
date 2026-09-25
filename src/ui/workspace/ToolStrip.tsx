// ToolStrip — vertical left-edge tool palette (ADR-051, Phase G). Sets the
// drawing tool-mode in the UI store; Select is always available (and Esc
// returns to it, wired in shortcuts.ts). Mounted as a left rail in App,
// mirroring the right-side panels. Toggle state shows via aria-pressed (the
// lf-btn pressed fill); the active name lives on each IconButton.

import { Fragment, useRef } from 'react';
import libraryIcon from 'lucide-static/icons/library.svg?raw';
import studioIcon from 'lucide-static/icons/shapes.svg?raw';

import { IconButton, type IconName } from '../kit';
import { useDesignStudioStore } from '../design-studio';
import { TOOL_HELP, toolHelpId, type ToolHelpKey } from '../help/help-topics';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { NodeActionBar } from './NodeActionBar';
import './tool-strip.css';

type Tool = {
  readonly mode: ToolMode;
  readonly helpKey: ToolHelpKey;
  readonly icon: IconName;
};

const TOOLS: ReadonlyArray<Tool> = [
  { mode: { kind: 'select' }, helpKey: 'select', icon: 'cursor' },
  { mode: { kind: 'node' }, helpKey: 'node', icon: 'nodes' },
  { mode: { kind: 'measure' }, helpKey: 'measure', icon: 'ruler' },
  { mode: { kind: 'text' }, helpKey: 'text', icon: 'text' },
  { mode: { kind: 'draw', shape: 'rect' }, helpKey: 'rect', icon: 'square' },
  { mode: { kind: 'draw', shape: 'ellipse' }, helpKey: 'ellipse', icon: 'circle' },
  { mode: { kind: 'draw', shape: 'polygon' }, helpKey: 'polygon', icon: 'pentagon' },
  { mode: { kind: 'draw', shape: 'star' }, helpKey: 'star', icon: 'star' },
  { mode: { kind: 'draw', shape: 'polyline' }, helpKey: 'polyline', icon: 'pen' },
  { mode: { kind: 'position-laser' }, helpKey: 'position-laser', icon: 'crosshair' },
];

export function ToolStrip(): JSX.Element {
  const nodeToolButtonRef = useRef<HTMLButtonElement>(null);
  const toolMode = useUiStore((s) => s.toolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const resetToolMode = useUiStore((s) => s.resetToolMode);
  const setLibraryDialogOpen = useUiStore((s) => s.setLibraryDialogOpen);
  return (
    <aside aria-label="Drawing tools" className="lf-rail lf-toolstrip">
      {TOOLS.map((tool) => (
        <Fragment key={tool.helpKey}>
          {tool.helpKey === 'select' || tool.helpKey === 'text' ? (
            <span className="lf-toolstrip__caption" aria-hidden="true">
              {tool.helpKey === 'select' ? 'Edit' : 'Draw'}
            </span>
          ) : null}
          {tool.helpKey === 'position-laser' ? (
            <span className="lf-toolstrip__divider" aria-hidden="true" />
          ) : null}
          <IconButton
            icon={tool.icon}
            label={TOOL_HELP[tool.helpKey].label}
            title={TOOL_HELP[tool.helpKey].tooltip}
            helpId={toolHelpId(tool.helpKey)}
            {...(tool.helpKey === 'node' ? { buttonRef: nodeToolButtonRef } : {})}
            onClick={() => {
              if (tool.mode.kind === 'draw' && isActive(toolMode, tool.mode)) resetToolMode();
              else setToolMode(tool.mode);
            }}
            pressed={isActive(toolMode, tool.mode)}
          />
          {tool.helpKey === 'measure' && toolMode.kind === 'node' ? (
            <NodeActionBar nodeToolButtonRef={nodeToolButtonRef} />
          ) : null}
        </Fragment>
      ))}
      <span className="lf-toolstrip__divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="Open design library"
        title="Insert ready-made line art from the bundled design library (ADR-105)."
        onClick={() => setLibraryDialogOpen(true)}
        className="lf-btn lf-iconbtn lf-toolstrip__launcher"
      >
        {/* Icons are pinned build assets, never user-supplied SVG. */}
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: libraryIcon }} />
      </button>
      <button
        type="button"
        aria-label="Open Design Studio"
        title="Draw a part to size by hand — precision tools, snapping, and dimensions in a full window (ADR-272)."
        onClick={() => useDesignStudioStore.getState().openStudio()}
        className="lf-btn lf-iconbtn lf-toolstrip__launcher"
      >
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: studioIcon }} />
      </button>
    </aside>
  );
}

function isActive(current: ToolMode, tool: ToolMode): boolean {
  if (current.kind === 'select') return tool.kind === 'select';
  if (current.kind === 'text') return tool.kind === 'text';
  if (current.kind === 'node') return tool.kind === 'node';
  if (current.kind === 'measure') return tool.kind === 'measure';
  if (current.kind === 'position-laser') return tool.kind === 'position-laser';
  if (current.kind === 'cnc-tabs') return false;
  return tool.kind === 'draw' && tool.shape === current.shape;
}
