import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Icon, type IconName } from '../kit/icons';
import { useLaserStore } from '../state/laser-store';
import { probePlateRemovalRequired } from '../state/work-z-zero-evidence';
import './MachineToolsDropdowns.css';

type Tool = 'origin' | 'placement' | 'console';

export interface MachineToolContents {
  readonly origin: ReactNode;
  readonly placement: ReactNode;
  readonly console: (active: boolean) => ReactNode;
}

/** Only the lower utilities move into dropdowns; jog and live-job actions stay put. */
export function MachineToolsDropdowns(props: MachineToolContents): JSX.Element {
  const [active, setActive] = useState<Tool | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setActive(null), []);
  const plateReminder = useLaserStore((state) =>
    probePlateRemovalRequired(state.workZZeroEvidence),
  );
  useLayoutEffect(() => {
    if (!plateReminder) return;
    const opener = group.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]');
    const panel = document.getElementById(opener?.getAttribute('aria-controls') ?? '');
    if (panel?.contains(document.activeElement)) opener?.focus();
    close();
  }, [plateReminder, close]);
  return (
    <div
      ref={group}
      className="lf-machine-tool-tabs"
      role="group"
      aria-label="Machine tool dropdowns"
    >
      <ToolDropdown
        tool="origin"
        group={group}
        label="Origin"
        icon="crosshair"
        active={active}
        onToggle={setActive}
        onClose={close}
      >
        {props.origin}
      </ToolDropdown>
      <ToolDropdown
        tool="placement"
        group={group}
        label="Placement & output"
        shortLabel="Placement"
        icon="fit-selection"
        active={active}
        onToggle={setActive}
        onClose={close}
      >
        {props.placement}
      </ToolDropdown>
      <ToolDropdown
        tool="console"
        group={group}
        label="Console"
        icon="terminal"
        active={active}
        onToggle={setActive}
        onClose={close}
      >
        {props.console(active === 'console')}
      </ToolDropdown>
    </div>
  );
}

function ToolDropdown(props: {
  readonly tool: Tool;
  readonly group: RefObject<HTMLDivElement>;
  readonly label: string;
  readonly shortLabel?: string;
  readonly icon: IconName;
  readonly active: Tool | null;
  readonly onToggle: (tool: Tool | null) => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = props.active === props.tool;
  return (
    <>
      <button
        ref={anchor}
        id={`${id}-trigger`}
        type="button"
        className="lf-btn lf-machine-tool-tab"
        aria-label={props.label}
        title={`Open ${props.label.toLowerCase()} tools.`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => props.onToggle(open ? null : props.tool)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            props.onToggle(props.tool);
          }
        }}
      >
        <Icon name={props.icon} size={16} />
        <span>{props.shortLabel ?? props.label}</span>
        <span className="lf-machine-tool-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      <AnchoredPopover
        id={id}
        label={props.label}
        role="dialog"
        anchorRef={anchor}
        sideAnchorRef={props.group}
        layoutRootSelector=".lf-machine-rail"
        className="lf-machine-tool-dropdown"
        open={open}
        closeOnTab={false}
        focusFallbackId={`${id}-trigger`}
        onClose={props.onClose}
      >
        <div className="lf-machine-tool-dropdown-heading">
          <strong>{props.label}</strong>
          <button
            type="button"
            className="lf-btn"
            aria-label={`Close ${props.label}`}
            title={`Close ${props.label.toLowerCase()} and return to its button.`}
            onClick={() => {
              props.onClose();
              anchor.current?.focus();
            }}
          >
            ×
          </button>
        </div>
        {props.children}
      </AnchoredPopover>
    </>
  );
}
