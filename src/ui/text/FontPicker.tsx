import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FONT_REGISTRY } from '../../core/text';
import type { EmbeddedFont } from '../../core/scene';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { cssFamilyForFont, ensureFontCss } from './font-loader';
import { FontPickerOptions, type PickerFont } from './FontPickerOptions';
import './font-picker.css';

type Props = {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly embeddedFonts?: ReadonlyArray<EmbeddedFont>;
  readonly previewText?: string;
  readonly disabled?: boolean;
};

/** Readable names and real specimens, outside the text panel's clipping/scroll. */
export function FontPicker(props: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useFontCssRegistration(props.embeddedFonts);
  useEffect(() => {
    if (props.disabled) close();
  }, [props.disabled, close]);
  const fonts = useMemo(() => pickerFonts(props.embeddedFonts), [props.embeddedFonts]);
  const selected = fonts.find((font) => font.key === props.value);
  const select = (key: string): void => {
    if (props.disabled) return;
    props.onChange(key);
    close();
    trigger.current?.focus();
  };
  return (
    <div className="lf-font-picker">
      <button
        ref={trigger}
        type="button"
        className="lf-btn lf-font-picker-trigger"
        aria-label="Font"
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDownCapture={(event) => {
          if (open) fontChooserKeyBoundary(event, close, trigger);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        title="Open the font picker and choose the text typeface."
      >
        <span className="lf-font-picker-name">
          {selected?.name ?? `Missing font: ${props.value}`}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && !props.disabled ? (
        <FontChooser
          id={id}
          anchor={trigger}
          fonts={fonts}
          value={props.value}
          sample={previewSample(props.previewText)}
          onSelect={select}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function FontChooser(props: {
  readonly id: string;
  readonly anchor: React.RefObject<HTMLButtonElement>;
  readonly fonts: ReadonlyArray<PickerFont>;
  readonly value: string;
  readonly sample: string;
  readonly onSelect: (key: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase();
  const fonts = useMemo(
    () =>
      props.fonts.filter((font) =>
        `${font.name} ${font.category}`.toLocaleLowerCase().includes(term),
      ),
    [props.fonts, term],
  );
  return (
    <AnchoredPopover
      id={props.id}
      label="Choose a font"
      role="dialog"
      anchorRef={props.anchor}
      portalHost={props.anchor.current?.closest('[role="dialog"][aria-modal="true"]') ?? null}
      className="lf-font-picker-popup"
      initialFocus="input"
      onClose={props.onClose}
      onKeyDownCapture={(event) => fontChooserKeyBoundary(event, props.onClose, props.anchor)}
      onKeyDown={(event) => browseFonts(event, props.value)}
    >
      <div className="lf-font-picker-search">
        <input
          className="lf-input"
          type="search"
          aria-label="Search fonts"
          placeholder="Search fonts…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>Arrow keys to browse · Enter to choose</span>
      </div>
      <FontPickerOptions
        fonts={fonts}
        value={props.value}
        sample={props.sample}
        select={props.onSelect}
      />
    </AnchoredPopover>
  );
}

function fontChooserKeyBoundary(
  event: React.KeyboardEvent<HTMLElement>,
  close: () => void,
  anchor: React.RefObject<HTMLButtonElement>,
): void {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
    event.stopPropagation();
    return;
  }
  if (event.key !== 'Escape' && event.key !== 'Tab') return;
  if (event.key === 'Escape') event.preventDefault();
  event.stopPropagation();
  anchor.current?.focus();
  close();
}

function browseFonts(event: React.KeyboardEvent<HTMLDivElement>, selected: string): void {
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"] button'),
  ];
  const search = event.target instanceof HTMLInputElement;
  if (search && event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    (buttons.find((button) => button.dataset['fontKey'] === selected) ?? buttons[0])?.click();
    return;
  }
  const index = buttons.findIndex((button) => button === document.activeElement);
  const next = fontFocusIndex(event.key, index, buttons.length, search);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  buttons[next]?.focus({ preventScroll: true });
  buttons[next]?.scrollIntoView?.({ block: 'nearest' });
}

function fontFocusIndex(key: string, index: number, count: number, search: boolean): number | null {
  if (count === 0 || (search && key !== 'ArrowDown' && key !== 'ArrowUp')) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return index <= 0 ? count - 1 : index - 1;
  return null;
}

function pickerFonts(embedded: ReadonlyArray<EmbeddedFont> | undefined): ReadonlyArray<PickerFont> {
  return [
    ...FONT_REGISTRY.map((font) => ({
      key: font.key,
      name: font.displayName,
      category: font.styleClass,
      font,
    })),
    ...(embedded ?? []).map((font) => ({
      key: font.key,
      name: font.fileName,
      category: 'project font',
      font: null,
    })),
  ];
}

function previewSample(text: string | undefined): string {
  const firstLine = text?.split(/\r?\n/)[0]?.trim() ?? '';
  return Array.from(firstLine).slice(0, 40).join('') || 'Aa Bb 123';
}

function useFontCssRegistration(embedded: ReadonlyArray<EmbeddedFont> | undefined): void {
  useEffect(() => {
    const keys = [
      ...FONT_REGISTRY.filter((font) => font.geometry === 'outline').map((font) => font.key),
      ...(embedded ?? []).map((font) => font.key),
    ];
    for (const key of keys) {
      ensureFontCss(key, embedded).catch((error: unknown) => {
        console.warn(`FontPicker: failed to register ${cssFamilyForFont(key)} CSS:`, error);
      });
    }
  }, [embedded]);
}
