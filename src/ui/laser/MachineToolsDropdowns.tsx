import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Icon, type IconName } from '../kit/icons';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { probePlateRemovalRequired } from '../state/work-z-zero-evidence';
import './MachineToolsDropdowns.css';

type Tool = 'origin' | 'placement' | 'console';
type ToolDescription = {
  readonly tool: Tool;
  readonly label: string;
  readonly shortLabel?: string;
  readonly icon: IconName;
};
const TOOLS: ReadonlyArray<ToolDescription> = [
  { tool: 'origin', label: 'Origin', icon: 'crosshair' },
  {
    tool: 'placement',
    label: 'Placement & output',
    shortLabel: 'Placement',
    icon: 'fit-selection',
  },
  { tool: 'console', label: 'Console', icon: 'terminal' },
];

export interface MachineToolContents {
  readonly origin: ReactNode;
  readonly placement: ReactNode;
  readonly console: (active: boolean) => ReactNode;
}

/** Utilities expand inside Machine, below jog and above the separate job dock. */
export function MachineToolsDropdowns(props: MachineToolContents): JSX.Element {
  const [active, setActive] = useState<Tool | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setActive(null), []);
  useProbeReminderDismissal(group, close);
  return (
    <div ref={group} className="lf-machine-tools">
      <div className="lf-machine-tool-tabs" role="group" aria-label="Machine tool dropdowns">
        {TOOLS.map((tool) => (
          <ToolTrigger
            key={tool.tool}
            {...tool}
            id={`${id}-${tool.tool}`}
            open={active === tool.tool}
            onToggle={setActive}
          />
        ))}
      </div>
      {TOOLS.map((tool) => (
        <ToolPanel
          key={tool.tool}
          id={`${id}-${tool.tool}`}
          label={tool.label}
          open={active === tool.tool}
          onClose={close}
        >
          {toolContents(props, tool.tool, active)}
        </ToolPanel>
      ))}
    </div>
  );
}

function toolContents(props: MachineToolContents, tool: Tool, active: Tool | null): ReactNode {
  if (tool === 'origin') return props.origin;
  if (tool === 'placement') return props.placement;
  return props.console(active === 'console');
}

function useProbeReminderDismissal(group: RefObject<HTMLDivElement>, close: () => void): void {
  const plateReminder = useLaserStore((state) =>
    probePlateRemovalRequired(state.workZZeroEvidence),
  );
  const modalDepth = useUiStore((state) => state.modalDepth);
  const pending = useRef(false);
  useLayoutEffect(() => {
    pending.current = plateReminder;
  }, [plateReminder]);
  useLayoutEffect(() => {
    if (!pending.current || modalDepth > 0) return;
    const opener = group.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]');
    const panel = document.getElementById(opener?.getAttribute('aria-controls') ?? '');
    // A child may register its modal in this commit before our subscription rerenders.
    // Never hide a live inline dialog or leave its modal registration invisible.
    if (panel?.querySelector('[aria-modal="true"]')) return;
    pending.current = false;
    if (panel?.contains(document.activeElement)) opener?.focus();
    close();
  }, [plateReminder, modalDepth, close, group]);
}

function ToolTrigger(
  props: ToolDescription & {
    readonly id: string;
    readonly open: boolean;
    readonly onToggle: (tool: Tool | null) => void;
  },
): JSX.Element {
  return (
    <button
      id={`${props.id}-trigger`}
      type="button"
      className="lf-btn lf-machine-tool-tab"
      aria-label={props.label}
      title={`Open ${props.label.toLowerCase()} tools.`}
      aria-expanded={props.open}
      aria-controls={props.id}
      onClick={() => props.onToggle(props.open ? null : props.tool)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        props.onToggle(props.tool);
        if (props.open) focusToolPanel(props.id);
      }}
    >
      <Icon name={props.icon} size={12} />
      <span>{props.shortLabel ?? props.label}</span>
      <span className="lf-machine-tool-chevron" aria-hidden="true">
        ⌄
      </span>
    </button>
  );
}

function ToolPanel(props: {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  useLayoutEffect(() => {
    if (props.open) focusToolPanel(props.id);
  }, [props.open, props.id]);
  const close = (): void => {
    props.onClose();
    document.getElementById(`${props.id}-trigger`)?.focus();
  };
  return (
    <div
      id={props.id}
      role="region"
      aria-labelledby={`${props.id}-trigger`}
      hidden={!props.open}
      tabIndex={-1}
      className="lf-machine-tool-dropdown"
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement)
          event.target.dataset['dialogFocusFallback'] = `${props.id}-trigger`;
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          event.stopPropagation();
          return;
        }
        if (event.key !== 'Escape') return;
        if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className="lf-machine-tool-dropdown-heading">
        <span className="lf-machine-tool-caption">{props.label}</span>
        <button
          type="button"
          className="lf-btn"
          aria-label={`Close ${props.label}`}
          title={`Close ${props.label.toLowerCase()} and return to its button.`}
          onClick={close}
        >
          ×
        </button>
      </div>
      {props.children}
    </div>
  );
}

function focusToolPanel(id: string): void {
  const panel = document.getElementById(id);
  const control = panel?.querySelector<HTMLElement>('button:not(:disabled)');
  (control ?? panel)?.focus();
}
