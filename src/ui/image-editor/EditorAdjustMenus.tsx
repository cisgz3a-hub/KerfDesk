// The Image Studio top-bar menus (ADR-242, PP-E): Image (size ops), Adjust,
// and Filter — Photoshop's Image ▸ Image Size / Canvas Size / Adjustments
// and Filter menus reduced to one level each. Picking an entry opens its
// dialog (or commits instantly for parameterless ones like Invert).

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { movePopoverFocus } from '../common/AnchoredPopover';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { ADJUSTMENTS, type AdjustmentSpec } from './editor-adjustments';
import { useResizeDialogStore } from './resize-dialog-store';
import { useTextDialogStore } from './text-dialog-store';
import { useImageEditorStore } from './image-editor-store';

type MenuItem = {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly title: string;
  readonly pick: () => void;
};

export function EditorAdjustMenus(): JSX.Element {
  const openAdjust = useAdjustDialogStore((s) => s.open);
  const openResize = useResizeDialogStore((s) => s.open);
  const transforming = useImageEditorStore((s) => s.transform !== null);
  const disabledReason = transforming
    ? 'Finish or cancel Free Transform first (Enter / Esc).'
    : undefined;
  const imageItems: readonly MenuItem[] = [
    {
      key: 'image-size',
      label: 'Image Size',
      hint: '',
      title: 'Resample the image to new pixel dimensions (physical size unchanged)',
      pick: () => openResize('image-size'),
    },
    {
      key: 'canvas-size',
      label: 'Canvas Size',
      hint: '',
      title: 'Grow (white padding) or shrink the canvas without scaling content',
      pick: () => openResize('canvas-size'),
    },
  ];
  const openText = useTextDialogStore((s) => s.open);
  return (
    <span style={menusStyle}>
      <MenuButton label="Image" items={imageItems} disabledReason={disabledReason} />
      <MenuButton
        label="Adjust"
        items={catalogItems('adjust', openAdjust)}
        disabledReason={disabledReason}
      />
      <MenuButton
        label="Filter"
        items={catalogItems('filter', openAdjust)}
        disabledReason={disabledReason}
      />
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        onClick={openText}
        title="Add text on a new layer (T)"
      >
        Text…
      </button>
    </span>
  );
}

function catalogItems(
  menu: AdjustmentSpec['menu'],
  open: (id: AdjustmentSpec['id']) => void,
): readonly MenuItem[] {
  return ADJUSTMENTS.filter((a) => a.menu === menu).map((entry) => ({
    key: entry.id,
    label: entry.label,
    hint: entry.shortcutHint,
    title:
      entry.params.length === 0 && entry.id !== 'curves'
        ? `Apply ${entry.label} immediately`
        : `Open the ${entry.label} dialog`,
    pick: () => open(entry.id),
  }));
}

function MenuButton(props: {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly disabledReason: string | undefined;
}): JSX.Element {
  const menu = useOperationMenu(props.disabledReason);
  const menuId = useId();
  return (
    <span style={anchorStyle}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="lf-btn lf-btn--ghost"
        disabled={props.disabledReason !== undefined}
        onClick={menu.toggle}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          menu.openAt(event.key === 'ArrowUp' ? 'last' : 'first');
        }}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        aria-controls={menu.isOpen ? menuId : undefined}
        title={
          props.disabledReason ?? `${props.label} menu — image operations for the Studio document`
        }
      >
        {props.label} ▾
      </button>
      {menu.isOpen ? (
        <>
          <div style={catcherStyle} onClick={menu.close} aria-hidden="true" />
          <div
            ref={menu.menuRef}
            id={menuId}
            role="menu"
            aria-label={`${props.label} menu`}
            style={listStyle}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault();
                event.stopPropagation();
                menu.close();
                return;
              }
              movePopoverFocus(event);
            }}
          >
            {props.items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                style={itemStyle}
                className="lf-btn lf-btn--ghost"
                onClick={() => {
                  menu.close();
                  item.pick();
                }}
                title={item.title}
              >
                <span>{item.label}</span>
                {item.hint === '' ? null : <span style={hintStyle}>{item.hint}</span>}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </span>
  );
}

function useOperationMenu(disabledReason: string | undefined) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (disabledReason !== undefined) {
      setIsOpen(false);
      return;
    }
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const index = initialFocus === 'last' ? (items?.length ?? 1) - 1 : 0;
    items?.[index]?.focus();
  }, [isOpen, initialFocus, disabledReason]);
  return {
    isOpen,
    triggerRef,
    menuRef,
    close: (): void => {
      triggerRef.current?.focus();
      setIsOpen(false);
    },
    toggle: (): void => {
      setInitialFocus('first');
      setIsOpen((open) => !open);
    },
    openAt: (edge: 'first' | 'last'): void => {
      setInitialFocus(edge);
      setIsOpen(true);
    },
  };
}

const menusStyle: React.CSSProperties = { display: 'inline-flex', gap: 4 };
const anchorStyle: React.CSSProperties = { position: 'relative', display: 'inline-flex' };

const catcherStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 6,
};

const listStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 7,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 220,
  maxHeight: 'min(420px, 60vh)',
  overflowY: 'auto',
  padding: 4,
  borderRadius: 6,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  textAlign: 'left',
};

const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
