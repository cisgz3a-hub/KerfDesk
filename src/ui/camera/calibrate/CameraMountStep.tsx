// CameraMountStep — the guided setup's second screen (ADR-663): is the camera
// fixed above the bed, or does it ride on the laser head (ADR-449)? Two
// picture cards instead of a checkbox; the choice sets the target the next
// steps engrave and how the photo is taken.

import type { CSSProperties, ReactNode } from 'react';
import { useCameraCalibrationStore } from './camera-calibration-store';
import { WizardNav } from './WizardNav';
import { columnStyle } from './wizard-styles';

export function CameraMountStep(): JSX.Element {
  const headCamera = useCameraCalibrationStore((s) => s.settings.headCamera);
  const update = useCameraCalibrationStore((s) => s.updateSettings);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  return (
    <div style={columnStyle}>
      <p style={leadStyle}>Where is the camera?</p>
      <div style={cardsStyle} role="group" aria-label="Where the camera is mounted">
        <MountCard
          selected={!headCamera}
          title="Above the bed"
          text="In the lid, on the frame or on a stand. It sees the whole bed at once. Most lasers with a built-in camera have it here."
          picture={<AboveBedPicture />}
          onPick={() => update({ headCamera: false })}
        />
        <MountCard
          selected={headCamera}
          title="On the laser head"
          text="It moves with the head and sees a small patch of the bed. KerfDesk moves the head, laser off, to take pictures."
          picture={<OnHeadPicture />}
          onPick={() => update({ headCamera: true })}
        />
      </div>
      <WizardNav
        onBack={() => setStep({ kind: 'camera' })}
        onNext={() => setStep({ kind: 'picture' })}
        nextTitle="Check the camera picture next."
      />
    </div>
  );
}

function MountCard(props: {
  readonly selected: boolean;
  readonly title: string;
  readonly text: string;
  readonly picture: ReactNode;
  readonly onPick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      aria-pressed={props.selected}
      onClick={props.onPick}
      title={props.text}
      style={{
        ...cardStyle,
        borderColor: props.selected ? 'var(--lf-accent)' : 'var(--lf-border)',
        background: props.selected ? 'var(--lf-accent-wash)' : 'var(--lf-bg-1)',
      }}
    >
      {props.picture}
      <strong>{props.title}</strong>
      <span style={cardTextStyle}>{props.text}</span>
    </button>
  );
}

// A bed seen from the front with the camera above and its view over all of it.
function AboveBedPicture(): JSX.Element {
  return (
    <svg viewBox="0 0 120 64" width="120" height="64" aria-hidden="true" style={pictureStyle}>
      <path d="M52 6h16v9H52z" fill="currentColor" />
      <path d="M57 15 14 54M63 15l43 39" stroke="var(--lf-accent)" strokeDasharray="3 3" />
      <path d="M10 54h100v5H10z" fill="none" stroke="currentColor" />
    </svg>
  );
}

// The gantry with the head, and the camera beside it seeing a small patch.
function OnHeadPicture(): JSX.Element {
  return (
    <svg viewBox="0 0 120 64" width="120" height="64" aria-hidden="true" style={pictureStyle}>
      <path d="M10 14h100" stroke="currentColor" strokeWidth="3" />
      <path d="M50 14h14v14H50zM66 18h8v7h-8z" fill="currentColor" />
      <path d="M68 25 58 54M72 25l10 29" stroke="var(--lf-accent)" strokeDasharray="3 3" />
      <path d="M10 54h100v5H10z" fill="none" stroke="currentColor" />
    </svg>
  );
}

const leadStyle: CSSProperties = { margin: 0, fontWeight: 600 };
const cardsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 8,
};
const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  padding: 10,
  height: 'auto',
  textAlign: 'left',
  whiteSpace: 'normal',
  // A pressed lf-btn turns its text white; these cards mark the choice by border.
  color: 'var(--lf-text)',
  border: '1px solid',
  borderRadius: 8,
};
const cardTextStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const pictureStyle: CSSProperties = { color: 'var(--lf-text-faint)', alignSelf: 'center' };
