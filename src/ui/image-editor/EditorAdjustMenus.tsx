// The Image Studio top-bar menus (ADR-242, PP-E): Image (size ops), Adjust,
// and Filter — Photoshop's Image ▸ Image Size / Canvas Size / Adjustments
// and Filter menus reduced to one level each. Picking an entry opens its
// dialog (or commits instantly for parameterless ones like Invert).

import { useState } from 'react';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { ADJUSTMENTS, type AdjustmentSpec } from './editor-adjustments';
import { useResizeDialogStore } from './resize-dialog-store';

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
  return (
    <span style={menusStyle}>
      <MenuButton label="Image" items={imageItems} />
      <MenuButton label="Adjust" items={catalogItems('adjust', openAdjust)} />
      <MenuButton label="Filter" items={catalogItems('filter', openAdjust)} />
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
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <span style={anchorStyle}>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={`${props.label} menu — image operations for the Studio document`}
      >
        {props.label} ▾
      </button>
      {isOpen ? (
        <>
          <div style={catcherStyle} onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div role="menu" aria-label={`${props.label} menu`} style={listStyle}>
            {props.items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                style={itemStyle}
                className="lf-btn lf-btn--ghost"
                onClick={() => {
                  setIsOpen(false);
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
