import { useLayoutEffect, useRef } from 'react';
import type { FontEntry } from '../../core/text';
import { cssFamilyForFont } from './font-loader';
import { SingleLineFontPreview } from './SingleLineFontPreview';

export type PickerFont = {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly font: FontEntry | null;
};

/** Reserve the same row height for outline, stroke and embedded font specimens. */
export function FontPickerOptions(props: {
  readonly fonts: ReadonlyArray<PickerFont>;
  readonly value: string;
  readonly sample: string;
  readonly select: (key: string) => void;
}): JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    const reveal = (): void => revealSelectedFont(element);
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [props.value, props.fonts]);
  const focusedKey =
    props.fonts.find((font) => font.key === props.value)?.key ?? props.fonts[0]?.key;
  return (
    <ul ref={list} role="listbox" aria-label="Fonts" className="lf-font-picker-list">
      {props.fonts.length === 0 ? (
        <li role="presentation" className="lf-font-picker-empty">
          No fonts match your search.
        </li>
      ) : null}
      {props.fonts.map((font) => (
        <li key={font.key} role="option" aria-selected={font.key === props.value}>
          <button
            type="button"
            className="lf-menu-item lf-font-picker-option"
            data-font-key={font.key}
            tabIndex={font.key === focusedKey ? 0 : -1}
            onClick={() => props.select(font.key)}
            title={
              font.font === null
                ? `Use embedded font ${font.name}.`
                : `Use ${font.name} for this text object.`
            }
          >
            <span className="lf-font-picker-description">
              <span className="lf-font-picker-name">{font.name}</span>
              <span className="lf-font-picker-category">{font.category}</span>
            </span>
            {font.font?.geometry === 'single-line' ? (
              <span className="lf-font-picker-specimen" aria-hidden="true">
                <SingleLineFontPreview fontKey={font.font.key} />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="lf-font-picker-specimen"
                style={{
                  fontFamily: `'${cssFamilyForFont(font.key)}', ${font.category === 'serif' ? 'serif' : font.category === 'mono' ? 'monospace' : 'system-ui, sans-serif'}`,
                }}
              >
                {props.sample}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function revealSelectedFont(list: HTMLUListElement): void {
  const row = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (row === null) return;
  const bounds = list.getBoundingClientRect();
  const selected = row.getBoundingClientRect();
  if (selected.top < bounds.top) list.scrollTop += Math.floor(selected.top - bounds.top);
  else if (selected.bottom > bounds.bottom) {
    list.scrollTop += Math.ceil(selected.bottom - bounds.bottom);
  }
}
