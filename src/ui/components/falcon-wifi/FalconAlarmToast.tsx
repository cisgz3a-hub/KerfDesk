/**
 * Tiny self-contained toast stack for Falcon WiFi alarms (type === 1 only).
 *
 * Why roll our own instead of pulling in a toast library?
 *   - Phase 1 brief forbids new npm dependencies.
 *   - The surface area is minimal: top-right stack, auto-dismiss after 6s,
 *     click to dismiss early. Nothing else in LaserForge needs toasts today.
 *   - Keeping it in `src/ui/components/falcon-wifi/` means it ships in one
 *     self-contained folder per the Phase 1 mandate.
 *
 * Usage: mount <FalconAlarmToastStack /> once near the app root and call
 * `pushFalconAlarmToast({...})` from anywhere — it uses a module-scoped
 * pub/sub so it doesn't need a React context.
 */
import React, { useEffect, useState } from 'react';

export interface FalconAlarmToast {
  id: string;
  title: string;
  detail?: string;
  code?: string;
  tone?: 'warning' | 'info';
}

type Listener = (toasts: FalconAlarmToast[]) => void;

let toasts: FalconAlarmToast[] = [];
const listeners = new Set<Listener>();
const TOAST_TTL_MS = 6000;

function notify(): void {
  for (const l of listeners) {
    try {
      l([...toasts]);
    } catch (err) {
      console.error('[falcon-toast] listener threw:', err);
    }
  }
}

function scheduleDismiss(id: string): void {
  setTimeout(() => {
    dismissFalconAlarmToast(id);
  }, TOAST_TTL_MS);
}

export function pushFalconAlarmToast(next: Omit<FalconAlarmToast, 'id'>): string {
  const id = `ft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  toasts = [...toasts, { id, ...next }];
  notify();
  scheduleDismiss(id);
  return id;
}

export function dismissFalconAlarmToast(id: string): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) notify();
}

export function clearFalconAlarmToasts(): void {
  if (toasts.length === 0) return;
  toasts = [];
  notify();
}

export function FalconAlarmToastStack(): React.ReactElement | null {
  const [items, setItems] = useState<FalconAlarmToast[]>([...toasts]);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  return React.createElement(
    'div',
    {
      style: {
        position: 'fixed' as const,
        top: 16,
        right: 16,
        zIndex: 5000,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 8,
        pointerEvents: 'none' as const,
        maxWidth: 360,
      },
    },
    ...items.map((t) =>
      React.createElement(
        'div',
        {
          key: t.id,
          onClick: () => dismissFalconAlarmToast(t.id),
          style: {
            pointerEvents: 'auto' as const,
            cursor: 'pointer',
            background: t.tone === 'info' ? 'rgba(0, 212, 255, 0.08)' : 'rgba(255, 170, 80, 0.12)',
            border:
              t.tone === 'info' ? '1px solid rgba(0, 212, 255, 0.4)' : '1px solid rgba(255, 170, 80, 0.55)',
            borderRadius: 8,
            padding: '10px 14px',
            color: t.tone === 'info' ? '#00d4ff' : '#ffaa50',
            fontFamily: font,
            fontSize: 12,
            lineHeight: 1.4,
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            minWidth: 240,
          },
        },
        React.createElement(
          'div',
          { style: { fontWeight: 600, marginBottom: t.detail || t.code ? 4 : 0 } },
          t.title,
        ),
        t.detail &&
          React.createElement(
            'div',
            { style: { color: '#c0c0d0', fontSize: 11, fontWeight: 400 } },
            t.detail,
          ),
        t.code &&
          React.createElement(
            'div',
            { style: { color: '#8888aa', fontSize: 10, fontFamily: mono, marginTop: 2 } },
            `Code: ${t.code}`,
          ),
      ),
    ),
  );
}
