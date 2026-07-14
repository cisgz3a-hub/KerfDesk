// FontPicker — custom dropdown for AddTextDialog that previews each
// bundled font in its own typeface. Replaces the native <select>
// because Chromium's font-family on <option> works on the row but
// not the closed-state label, and we want both to render in the
// font being picked.
//
// The picker registers every bundled font with the browser's
// FontFace API on first mount (lazy / fire-and-forget). Once a
// FontFace finishes loading, document.fonts auto-fires a refresh
// of any element using that family — the dropdown labels animate
// from system fallback to the real typeface as fonts arrive.
//
// Closes on outside click, Escape, and selection. Pure
// presentational state (open/closed) lives in local useState; the
// selected fontKey is owned by the parent dialog.

import { useEffect, useRef, useState } from 'react';
import { FONT_REGISTRY, type FontEntry, type KnownFontKey } from '../../core/text';
import type { EmbeddedFont } from '../../core/scene';
import { cssFamilyForFont, ensureFontCss } from './font-loader';
import { SingleLineFontPreview } from './SingleLineFontPreview';

type Props = {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly embeddedFonts?: ReadonlyArray<EmbeddedFont>;
};

type OutlineFontKey = Extract<FontEntry, { readonly geometry: 'outline' }>['key'];

function isOutlineFontKey(key: KnownFontKey): key is OutlineFontKey {
  return FONT_REGISTRY.find((font) => font.key === key)?.geometry === 'outline';
}

export function FontPicker(props: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useFontCssRegistration();
  useOutsideClickToClose(rootRef, open, () => setOpen(false));
  const selected = FONT_REGISTRY.find((f) => f.key === props.value);
  const selectedEmbedded = props.embeddedFonts?.find((font) => font.key === props.value);
  if (selected === undefined && props.value === '' && FONT_REGISTRY.length === 0) {
    // FONT_REGISTRY is a static non-empty array — this branch keeps
    // TS happy under noUncheckedIndexedAccess but is unreachable in
    // practice.
    return <span>No fonts available</span>;
  }
  const handleSelect = (key: KnownFontKey): void => {
    props.onChange(key);
    setOpen(false);
  };
  return (
    <div ref={rootRef} style={rootStyle}>
      <button
        type="button"
        className="lf-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Open the font picker and choose the text typeface."
        style={
          selected === undefined || !isOutlineFontKey(selected.key)
            ? triggerBaseStyle
            : triggerStyleFor(selected.key)
        }
      >
        {selectedEmbedded !== undefined ? (
          <>
            <span style={triggerNameStyle}>{selectedEmbedded.fileName}</span>
            <span style={triggerClassStyle}>(project font)</span>
          </>
        ) : selected === undefined ? (
          <>
            <span style={triggerNameStyle}>Missing font: {props.value}</span>
            <span style={triggerClassStyle}>(choose replacement)</span>
          </>
        ) : (
          <>
            <span style={triggerNameStyle}>{selected.displayName}</span>
            <span style={triggerClassStyle}>({selected.styleClass})</span>
          </>
        )}
        <span aria-hidden style={caretStyle}>
          ▾
        </span>
      </button>
      {open && (
        <ul role="listbox" className="lf-menu" style={menuStyle}>
          {FONT_REGISTRY.map((f) => (
            <li key={f.key} role="option" aria-selected={f.key === props.value}>
              <button
                type="button"
                className="lf-menu-item"
                onClick={() => handleSelect(f.key)}
                title={`Use ${f.displayName} for this text object.`}
                style={optionStyleFor(f.key, f.key === props.value)}
              >
                <FontOptionName font={f} />
                <span style={optionMetaStyle(f.key === props.value)}>({f.styleClass})</span>
              </button>
            </li>
          ))}
          <EmbeddedFontOptions
            fonts={props.embeddedFonts}
            selectedKey={props.value}
            select={(key) => {
              props.onChange(key);
              setOpen(false);
            }}
          />
        </ul>
      )}
    </div>
  );
}

function FontOptionName(props: { readonly font: FontEntry }): JSX.Element {
  return (
    <span style={optionNameStyle}>
      <span>{props.font.displayName}</span>
      {props.font.geometry === 'single-line' && <SingleLineFontPreview fontKey={props.font.key} />}
    </span>
  );
}

function EmbeddedFontOptions(props: {
  readonly fonts: ReadonlyArray<EmbeddedFont> | undefined;
  readonly selectedKey: string;
  readonly select: (key: string) => void;
}): JSX.Element {
  return (
    <>
      {props.fonts?.map((font) => (
        <li key={font.key} role="option" aria-selected={font.key === props.selectedKey}>
          <button
            type="button"
            className="lf-menu-item"
            onClick={() => props.select(font.key)}
            title={`Use embedded font ${font.fileName}.`}
            style={optionBaseStyle}
          >
            <span style={optionNameStyle}>{font.fileName}</span>
            <span style={optionMetaStyle(font.key === props.selectedKey)}>(project)</span>
          </button>
        </li>
      ))}
    </>
  );
}

// Kicks off CSS-side registration of every bundled font on mount.
// We don't await — the dropdown is usable immediately with system
// fallback, and each row swaps to its real font as soon as its
// FontFace finishes loading. Errors are swallowed (logged) because
// a bad font file shouldn't crash the dialog; the row just stays in
// the fallback typeface.
function useFontCssRegistration(): void {
  useEffect(() => {
    for (const f of FONT_REGISTRY) {
      if (!isOutlineFontKey(f.key)) continue;
      ensureFontCss(f.key).catch((err: unknown) => {
        console.warn(`FontPicker: failed to register ${f.key} CSS:`, err);
      });
    }
  }, []);
}

function useOutsideClickToClose(
  ref: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, ref]);
}

// Chrome comes from tokens.css (.lf-btn trigger, .lf-menu/.lf-menu-item
// rows — hover and focus states for free); inline styles carry only the
// per-row font-family hop and layout. The regression this replaces:
// rows hardcoded a white background with INHERITED text color, which
// turned white-on-white the moment the dialog went dark (ADR-047).
function triggerStyleFor(key: OutlineFontKey): React.CSSProperties {
  return {
    ...triggerBaseStyle,
    fontFamily: cssFontFamilyStack(key),
  };
}

function optionStyleFor(key: KnownFontKey, selected: boolean): React.CSSProperties {
  return {
    ...optionBaseStyle,
    ...(isOutlineFontKey(key) ? { fontFamily: cssFontFamilyStack(key) } : {}),
    fontWeight: selected ? 600 : 400,
    ...(selected ? { background: 'var(--lf-accent)', color: 'var(--lf-on-fill)' } : {}),
  };
}

function optionMetaStyle(selected: boolean): React.CSSProperties {
  return {
    fontFamily: 'system-ui, sans-serif',
    fontSize: 11,
    color: selected ? 'inherit' : 'var(--lf-text-muted)',
  };
}

// CSS font stack with a sensible per-class fallback so labels stay
// readable while the real font is still loading.
function cssFontFamilyStack(key: OutlineFontKey): string {
  const entry = FONT_REGISTRY.find((f) => f.key === key);
  const fallback = entry?.styleClass === 'mono' ? 'monospace' : 'system-ui, sans-serif';
  return `'${cssFamilyForFont(key)}', ${fallback}`;
}

const rootStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
};

const triggerBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  fontSize: 14,
  textAlign: 'left',
};

const triggerNameStyle: React.CSSProperties = { flex: 1 };
const triggerClassStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const caretStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

// Position/scroll only — surface chrome comes from .lf-menu.
const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 2px)',
  left: 0,
  right: 0,
  margin: 0,
  listStyle: 'none',
  maxHeight: 240,
  overflowY: 'auto',
};

const optionBaseStyle: React.CSSProperties = {
  fontSize: 16,
};

const optionNameStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flex: 1,
};
