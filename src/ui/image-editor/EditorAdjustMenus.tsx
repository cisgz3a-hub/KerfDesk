// The Image Studio Adjust / Filter menus (ADR-242, PP-E): two top-bar
// dropdowns listing the adjustment catalog, Photoshop's Image ▸ Adjustments
// and Filter menus reduced to one level. Picking an entry opens its slider
// dialog (or commits instantly for parameterless ones like Invert).

import { useState } from 'react';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { ADJUSTMENTS, type AdjustmentSpec } from './editor-adjustments';

export function EditorAdjustMenus(): JSX.Element {
  return (
    <span style={menusStyle}>
      <MenuButton label="Adjust" entries={ADJUSTMENTS.filter((a) => a.menu === 'adjust')} />
      <MenuButton label="Filter" entries={ADJUSTMENTS.filter((a) => a.menu === 'filter')} />
    </span>
  );
}

function MenuButton(props: {
  readonly label: string;
  readonly entries: readonly AdjustmentSpec[];
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const openDialog = useAdjustDialogStore((s) => s.open);
  return (
    <span style={anchorStyle}>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={`${props.label} menu — tone adjustments and filters for the image`}
      >
        {props.label} ▾
      </button>
      {isOpen ? (
        <>
          <div style={catcherStyle} onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div role="menu" aria-label={`${props.label} menu`} style={listStyle}>
            {props.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                style={itemStyle}
                className="lf-btn lf-btn--ghost"
                onClick={() => {
                  setIsOpen(false);
                  openDialog(entry.id);
                }}
                title={
                  entry.params.length === 0
                    ? `Apply ${entry.label} immediately`
                    : `Open the ${entry.label} dialog`
                }
              >
                <span>{entry.label}</span>
                {entry.shortcutHint === '' ? null : (
                  <span style={hintStyle}>{entry.shortcutHint}</span>
                )}
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
