// CameraWizardFrame — shared chrome for the camera wizards (calibration and
// bed alignment). Expanded, it is the modal Dialog; minimized, it is a small
// non-modal panel pinned bottom-right so the operator can watch the live
// camera AND reach the machine while capturing/burning. The SAME children
// render in both states, so detection loops and the burn watcher keep running
// when minimized. Every state has a visible Minimize/Expand and Exit (×) — the
// bare Dialog only closed on Escape, which is why "there was no exit button".

import type { CSSProperties, ReactNode } from 'react';
import { Dialog } from '../../kit';

export function CameraWizardFrame(props: {
  readonly title: string;
  readonly minimized: boolean;
  readonly onToggleMinimize: () => void;
  readonly onExit: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const header = (
    <div style={headerStyle}>
      <strong>{props.title}</strong>
      <div style={buttonRowStyle}>
        <button
          type="button"
          className="lf-btn"
          onClick={props.onToggleMinimize}
          title={
            props.minimized
              ? 'Expand the wizard back to full size.'
              : 'Minimize — keep the camera visible and reach the machine while you work.'
          }
        >
          {props.minimized ? 'Expand' : 'Minimize'}
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={props.onExit}
          aria-label={`Close ${props.title}`}
          title="Close the wizard."
        >
          ×
        </button>
      </div>
    </div>
  );

  if (props.minimized) {
    return (
      <div role="dialog" aria-label={props.title} style={miniStyle}>
        {header}
        {props.children}
      </div>
    );
  }
  return (
    <Dialog ariaLabel={props.title} size="lg" onClose={props.onExit}>
      {header}
      {props.children}
    </Dialog>
  );
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
  gap: 8,
};
const buttonRowStyle: CSSProperties = { display: 'flex', gap: 6 };
// Non-modal, pinned bottom-right (the Camera panel sits bottom-left), above
// the canvas and panels so it is never hidden behind them.
const miniStyle: CSSProperties = {
  position: 'fixed',
  bottom: 12,
  right: 12,
  zIndex: 20,
  width: 340,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 8,
  boxShadow: 'var(--lf-shadow)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
};
