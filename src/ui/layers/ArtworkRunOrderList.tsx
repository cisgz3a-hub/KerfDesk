import { useEffect, useRef, useState } from 'react';
import { ArtworkRunOrderRow } from './ArtworkRunOrderRow';
import type { ArtworkRunOrderRowModel } from './artwork-run-order-view-model';

const ROW_HEIGHT = 152;
const OVERSCAN = 3;

export function ArtworkRunOrderList(props: {
  readonly rows: ReadonlyArray<ArtworkRunOrderRowModel>;
  readonly activeKey: string | null;
  readonly machineKind: 'laser' | 'cnc';
  readonly reveal: { readonly position: number; readonly token: number } | null;
  readonly onFocus: (row: ArtworkRunOrderRowModel) => void;
  readonly onMove: (row: ArtworkRunOrderRowModel, position: number) => void;
  readonly onEditSettings: (row: ArtworkRunOrderRowModel) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = (): void => setViewportHeight(element.clientHeight || 480);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    if (props.reveal === null) return;
    const index = props.rows.findIndex((row) => row.position === props.reveal?.position);
    const element = ref.current;
    if (index < 0 || element === null) return;
    const top = index * ROW_HEIGHT;
    if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: 'smooth' });
    else element.scrollTop = top;
  }, [props.reveal, props.rows]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(props.rows.length, start + visibleCount);
  return (
    <div
      ref={ref}
      aria-label="Artwork run order list"
      style={viewportStyle}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: start * ROW_HEIGHT }} />
      <div style={itemsStyle}>
        {props.rows.slice(start, end).map((row) => (
          <ArtworkRunOrderRow
            key={row.key}
            row={row}
            active={props.activeKey === row.key}
            machineKind={props.machineKind}
            onFocus={() => props.onFocus(row)}
            onMove={(position) => props.onMove(row, position)}
            onEditSettings={() => props.onEditSettings(row)}
          />
        ))}
      </div>
      <div style={{ height: (props.rows.length - end) * ROW_HEIGHT }} />
    </div>
  );
}

const viewportStyle: React.CSSProperties = {
  minHeight: 240,
  flex: 1,
  overflowY: 'auto',
  paddingRight: 3,
};
const itemsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
