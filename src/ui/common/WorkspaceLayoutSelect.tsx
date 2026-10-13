import { useCallback, useId, useRef, useState } from 'react';
import { Icon } from '../kit/icons';
import {
  useWorkspaceLayoutStore,
  type WorkspaceLayoutPreference,
} from '../state/workspace-layout-store';
import { AnchoredPopover, movePopoverFocus } from './AnchoredPopover';
import './WorkspaceLayoutSelect.css';

export const LAYOUT_OPTIONS: ReadonlyArray<{
  value: WorkspaceLayoutPreference;
  label: string;
  title: string;
}> = [
  { value: 'auto', label: 'Auto layout', title: 'Adapt the layout to this window’s size' },
  {
    value: 'compact',
    label: 'Compact',
    title: 'Switch between Artwork and Machine in one sidebar',
  },
  {
    value: 'spacious',
    label: 'Spacious',
    title: 'Show both side panels when there is enough room',
  },
];

export function WorkspaceLayoutSelect(): JSX.Element {
  const preference = useWorkspaceLayoutStore((state) => state.preference);
  const setPreference = useWorkspaceLayoutStore((state) => state.setPreference);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const valueId = useId();
  const close = useCallback(() => setOpen(false), []);
  const choose = (value: WorkspaceLayoutPreference): void => {
    setPreference(value);
    close();
    triggerRef.current?.focus();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lf-btn lf-btn--ghost lf-workspace-layout-select"
        aria-label="Workspace layout"
        aria-describedby={valueId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Choose how the workspace fits this window"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon name="panels" size={18} />
        <span id={valueId}>
          {LAYOUT_OPTIONS.find((option) => option.value === preference)?.label}
        </span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open ? (
        <AnchoredPopover
          id={menuId}
          label="Workspace layout options"
          role="menu"
          anchorRef={triggerRef}
          className="lf-workspace-layout-menu"
          initialFocus={'button[aria-checked="true"]'}
          onClose={close}
          onKeyDown={movePopoverFocus}
        >
          <LayoutOptions preference={preference} onChoose={choose} />
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function LayoutOptions(props: {
  readonly preference: WorkspaceLayoutPreference;
  readonly onChoose: (value: WorkspaceLayoutPreference) => void;
}): JSX.Element {
  return (
    <>
      {LAYOUT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          className="lf-workspace-layout-option"
          aria-label={option.label}
          aria-checked={option.value === props.preference}
          title={option.title}
          tabIndex={-1}
          onClick={() => props.onChoose(option.value)}
        >
          <span>{option.label}</span>
          <span className="lf-workspace-layout-check" aria-hidden="true">
            <Icon name="check" size={15} />
          </span>
        </button>
      ))}
    </>
  );
}
