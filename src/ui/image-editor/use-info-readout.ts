// The Info readout chip (ADR-242, PP-F): live cursor position in document
// pixels and workspace millimetres plus the ink under the cursor — the
// Photoshop Info-panel essentials, docked at the canvas corner. Driven
// imperatively (same pattern as the brush cursor and mode badge) so pointer
// moves never re-render React.

import { useCallback, useRef } from 'react';
import { canvasToDoc } from './editor-canvas-draw';
import { useImageEditorStore } from './image-editor-store';
import type { EditorSession } from './editor-session';

type InfoReadout = {
  readonly infoRef: React.RefObject<HTMLDivElement>;
  readonly updateInfo: (e: React.PointerEvent<HTMLElement>, host: HTMLElement | null) => void;
  readonly hideInfo: () => void;
};

export function useInfoReadout(): InfoReadout {
  const infoRef = useRef<HTMLDivElement>(null);

  const hideInfo = useCallback((): void => {
    const info = infoRef.current;
    if (info !== null) info.style.display = 'none';
  }, []);

  const updateInfo = useCallback(
    (e: React.PointerEvent<HTMLElement>, host: HTMLElement | null): void => {
      const info = infoRef.current;
      if (info === null || host === null) return;
      const state = useImageEditorStore.getState();
      const session = state.session;
      const view = state.view;
      if (session === null || view === null) {
        info.style.display = 'none';
        return;
      }
      const rect = host.getBoundingClientRect();
      const point = canvasToDoc(view, e.clientX - rect.left, e.clientY - rect.top);
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      if (x < 0 || y < 0 || x >= session.doc.width || y >= session.doc.height) {
        info.style.display = 'none';
        return;
      }
      info.textContent = readoutText(session, x, y);
      info.style.display = 'block';
    },
    [],
  );

  return { infoRef, updateInfo, hideInfo };
}

function readoutText(session: EditorSession, x: number, y: number): string {
  const base = (y * session.doc.width + x) * 4;
  const r = session.doc.data[base] ?? 0;
  const g = session.doc.data[base + 1] ?? 0;
  const b = session.doc.data[base + 2] ?? 0;
  // Ink %: 0 = white (no burn), 100 = black — the laser-relevant reading.
  const ink = Math.round(100 - ((r + g + b) / 3 / 255) * 100);
  const { minX, minY, maxX, maxY } = session.sourceBounds;
  const mmPerPxX = (maxX - minX) / session.base.width;
  const mmPerPxY = (maxY - minY) / session.base.height;
  const mmX = minX + (session.cropOffset.x + x + 0.5) * mmPerPxX;
  const mmY = minY + (session.cropOffset.y + y + 0.5) * mmPerPxY;
  return `${x}, ${y} px · ${mmX.toFixed(1)}, ${mmY.toFixed(1)} mm · RGB ${r},${g},${b} · K ${ink}%`;
}

export const INFO_READOUT_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 8,
  bottom: 8,
  display: 'none',
  pointerEvents: 'none',
  fontSize: 11,
  lineHeight: 1.4,
  padding: '2px 8px',
  borderRadius: 4,
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
  color: 'var(--lf-text-muted)',
  fontVariantNumeric: 'tabular-nums',
};
