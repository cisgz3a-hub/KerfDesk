// InspectorSourcePane — the program text beside the 3D view (ADR-255 stage
// 7). Every line carries its accountability category, the executing line
// follows the playhead, and clicking a line jumps the playhead to it.
//
// Windowed: only the visible rows exist in the DOM, so a million-line
// program scrolls without building a million nodes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LINE_CATEGORY } from '../../core/gcode-view';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';
import { useGcodeSourceLines } from './use-gcode-source-lines';
import { explainLine } from './word-glossary';

const ROW_HEIGHT_PX = 18;
const OVERSCAN_ROWS = 12;
const DEFAULT_VIEWPORT_PX = 320;

const CATEGORY_BADGE: Readonly<Record<number, string>> = {
  [LINE_CATEGORY.motion]: 'move',
  [LINE_CATEGORY.modalOnly]: 'modal',
  [LINE_CATEGORY.event]: 'event',
  [LINE_CATEGORY.comment]: 'note',
  [LINE_CATEGORY.blank]: '',
  [LINE_CATEGORY.marker]: '%',
  [LINE_CATEGORY.unsupported]: 'skip',
  [LINE_CATEGORY.junk]: 'junk',
  [LINE_CATEGORY.afterEnd]: 'after',
};

export function InspectorSourcePane(props: {
  readonly source: GcodeInspectionSource;
  readonly sourceIndex: GcodeSourceLineIndex;
  readonly categories: Uint8Array;
  /** Line the playhead is executing; drives highlight and auto-scroll. */
  readonly activeLine: number | null;
  readonly selectedLine: number | null;
  readonly onSelectLine: (line: number) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportPx, setViewportPx] = useState(DEFAULT_VIEWPORT_PX);
  const { activeLine } = props;

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportPx(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the executing line in view during playback without fighting a
  // manual scroll: only correct when it has actually left the window.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || activeLine === null || activeLine >= props.sourceIndex.starts.length)
      return;
    const top = activeLine * ROW_HEIGHT_PX;
    const bottom = top + ROW_HEIGHT_PX;
    if (top >= element.scrollTop && bottom <= element.scrollTop + element.clientHeight) return;
    element.scrollTop = Math.max(0, top - element.clientHeight / 2);
  }, [activeLine, props.sourceIndex.starts.length]);

  const shown = useMemo(
    () => visibleRange(scrollTop, viewportPx, props.sourceIndex.starts.length),
    [scrollTop, viewportPx, props.sourceIndex.starts.length],
  );
  const visible = useGcodeSourceLines(props.source, props.sourceIndex, shown.first, shown.last);
  const selectedInWindow =
    props.selectedLine !== null &&
    props.selectedLine >= shown.first &&
    props.selectedLine < shown.last;
  const selected = useGcodeSourceLines(
    props.source,
    props.sourceIndex,
    selectedInWindow || props.selectedLine === null ? 0 : props.selectedLine,
    selectedInWindow || props.selectedLine === null ? 0 : props.selectedLine + 1,
  );
  const selectedText = selectedInWindow
    ? (visible.lines[props.selectedLine - shown.first] ?? null)
    : (selected.lines[0] ?? null);
  const sourceError = visible.error ?? selected.error;

  return (
    <div style={paneStyle} aria-label="Program source">
      <div
        ref={scrollRef}
        style={scrollStyle}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          style={{ height: props.sourceIndex.starts.length * ROW_HEIGHT_PX, position: 'relative' }}
        >
          {Array.from({ length: shown.last - shown.first }, (_, offset) => {
            const line = shown.first + offset;
            const text = visible.lines[offset] ?? '';
            return (
              <SourceRow
                key={line}
                line={line}
                text={text}
                badge={CATEGORY_BADGE[props.categories[line] ?? LINE_CATEGORY.blank] ?? ''}
                isActive={line === props.activeLine}
                isSelected={line === props.selectedLine}
                onSelect={props.onSelectLine}
              />
            );
          })}
        </div>
      </div>
      <SourceError error={sourceError} />
      <WordDetail line={props.selectedLine} text={selectedText} />
    </div>
  );
}

function SourceRow(props: {
  readonly line: number;
  readonly text: string;
  readonly badge: string;
  readonly isActive: boolean;
  readonly isSelected: boolean;
  readonly onSelect: (line: number) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      title={`Jump the playhead to line ${props.line + 1}`}
      onClick={() => props.onSelect(props.line)}
      style={{
        ...rowStyle,
        top: props.line * ROW_HEIGHT_PX,
        background: rowBackground(props.isActive, props.isSelected),
      }}
    >
      <span style={gutterStyle}>{props.line + 1}</span>
      <span style={badgeStyle}>{props.badge}</span>
      <span style={textStyle}>{props.text === '' ? ' ' : props.text}</span>
    </button>
  );
}

function SourceError(props: { readonly error: string | null }): JSX.Element | null {
  if (props.error === null) return null;
  return (
    <p role="alert" style={sourceErrorStyle}>
      Source unavailable: {props.error}
    </p>
  );
}

function rowBackground(isActive: boolean, isSelected: boolean): string {
  if (isActive) return 'var(--lf-accent-wash)';
  return isSelected ? 'var(--lf-bg-2)' : 'transparent';
}

function WordDetail(props: {
  readonly line: number | null;
  readonly text: string | null;
}): JSX.Element {
  const words = useMemo(() => (props.text === null ? [] : explainLine(props.text)), [props.text]);
  if (props.line === null) {
    return <p style={detailEmptyStyle}>Select a line to see what each word does.</p>;
  }
  return (
    <div style={detailStyle}>
      <div style={detailHeadStyle}>Line {props.line + 1}</div>
      {props.text === null ? (
        <p style={detailNoWordsStyle}>Loading source line...</p>
      ) : words.length === 0 ? (
        <p style={detailNoWordsStyle}>No G-code words on this line.</p>
      ) : (
        <dl style={detailListStyle}>
          {words.map((word, index) => (
            <div key={`${word.text}-${index}`} style={detailRowStyle}>
              <dt style={detailWordStyle}>{word.text}</dt>
              <dd style={detailMeaningStyle}>{word.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Row range to mount for a scroll position — pure, so the windowing maths
 * is unit-tested without a DOM. */
export function visibleRange(
  scrollTop: number,
  viewportPx: number,
  lineCount: number,
): { readonly first: number; readonly last: number } {
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const rows = Math.ceil(viewportPx / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
  return { first, last: Math.min(lineCount, first + rows) };
}

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 320,
  flexShrink: 0,
  borderLeft: '1px solid var(--lf-border)',
  minHeight: 0,
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 'var(--lf-text-xs)',
};

const rowStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  height: ROW_HEIGHT_PX,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 6px',
  border: 'none',
  textAlign: 'left',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  font: 'inherit',
};

const gutterStyle: React.CSSProperties = {
  width: 44,
  flexShrink: 0,
  textAlign: 'right',
  color: 'var(--lf-text-faint)',
  fontVariantNumeric: 'tabular-nums',
};

const badgeStyle: React.CSSProperties = {
  width: 34,
  flexShrink: 0,
  color: 'var(--lf-text-muted)',
};

const textStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: 'pre',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const detailStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  padding: '6px 8px',
  maxHeight: 168,
  overflowY: 'auto',
  fontSize: 'var(--lf-text-xs)',
};

const detailHeadStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  marginBottom: 4,
};

const detailListStyle: React.CSSProperties = { margin: 0, display: 'grid', gap: 2 };

const detailRowStyle: React.CSSProperties = { display: 'flex', gap: 8 };

const detailWordStyle: React.CSSProperties = {
  margin: 0,
  width: 60,
  flexShrink: 0,
  fontFamily: 'ui-monospace, monospace',
};

const detailMeaningStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };

const detailNoWordsStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };

const detailEmptyStyle: React.CSSProperties = {
  margin: 0,
  padding: '6px 8px',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
  borderTop: '1px solid var(--lf-border)',
};

const sourceErrorStyle: React.CSSProperties = {
  margin: 0,
  padding: '6px 8px',
  color: 'var(--lf-danger)',
  fontSize: 'var(--lf-text-xs)',
  borderTop: '1px solid var(--lf-border)',
};
