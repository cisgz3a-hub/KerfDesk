// ProbePanel — guided touch-plate probing (ADR-102 G2, F-CNC20). CNC-only:
// laser projects auto-focus instead. Builds the G38.2 sequence from the
// editable plate/bit geometry and hands it to the store's probe action.

import { useState } from 'react';
import {
  buildCornerProbeLines,
  buildZProbeLines,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
  type ProbeCorner,
  type ZProbeParams,
} from '../../core/controllers/grbl';
import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { describeProbeResult } from '../state/probe-actions';
import { useToastStore } from '../state/toast-store';

type ProbeMode = 'z' | 'corner';

const CORNERS: ReadonlyArray<{ readonly value: ProbeCorner; readonly label: string }> = [
  { value: 'front-left', label: 'Front-left' },
  { value: 'front-right', label: 'Front-right' },
  { value: 'back-left', label: 'Back-left' },
  { value: 'back-right', label: 'Back-right' },
];

export function ProbePanel(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const connection = useLaserStore((s) => s.connection);
  const statusReport = useLaserStore((s) => s.statusReport);
  const probeBusy = useLaserStore((s) => s.probeBusy);
  const probe = useLaserStore((s) => s.probe);
  const pushToast = useToastStore((s) => s.pushToast);
  const [mode, setMode] = useState<ProbeMode>('z');
  const [corner, setCorner] = useState<ProbeCorner>('front-left');
  const [zParams, setZParams] = useState<ZProbeParams>(DEFAULT_Z_PROBE_PARAMS);
  const [bitDiameterMm, setBitDiameterMm] = useState<number | null>(null);
  if (machine?.kind !== 'cnc') return null;

  const machineBitDiameter = activeCncTool(machine).diameterMm;
  const effectiveBitDiameter = bitDiameterMm ?? machineBitDiameter;
  const ready = connection.kind === 'connected' && statusReport?.state === 'Idle' && !probeBusy;

  const run = (): void => {
    const lines =
      mode === 'z'
        ? buildZProbeLines(zParams)
        : buildCornerProbeLines({
            ...zParams,
            bitDiameterMm: effectiveBitDiameter,
            corner,
            sideDropMm: DEFAULT_SIDE_DROP_MM,
            sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
          });
    void probe(lines).then((result) => {
      const described = describeProbeResult(result);
      pushToast(described.message, described.variant);
    });
  };

  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Zero the work coordinates with a conductive touch plate (G38.2)."
      >
        Probe (touch plate)
      </summary>
      <p style={hintStyle}>
        {mode === 'z'
          ? 'Rest the plate on the stock top under the bit and clip the probe lead to the bit. Z0 lands on the stock top.'
          : 'Rest the plate flush on the chosen stock corner with the bit hovering over the plate center, 5–15 mm above. X0 Y0 Z0 land on that corner.'}
        {' Spindle must be off.'}
      </p>
      <ProbeFields
        mode={mode}
        corner={corner}
        zParams={zParams}
        bitDiameterMm={effectiveBitDiameter}
        onMode={setMode}
        onCorner={setCorner}
        onZParams={setZParams}
        onBitDiameter={setBitDiameterMm}
      />
      <button
        type="button"
        onClick={run}
        disabled={!ready}
        title={
          ready
            ? 'Start the probing cycle. The bit moves toward the plate at the seek feed.'
            : 'Connect and wait for Idle before probing.'
        }
      >
        {probeBusy ? 'Probing…' : 'Run probe'}
      </button>
    </details>
  );
}

function ProbeFields(props: {
  readonly mode: ProbeMode;
  readonly corner: ProbeCorner;
  readonly zParams: ZProbeParams;
  readonly bitDiameterMm: number;
  readonly onMode: (mode: ProbeMode) => void;
  readonly onCorner: (corner: ProbeCorner) => void;
  readonly onZParams: (params: ZProbeParams) => void;
  readonly onBitDiameter: (value: number) => void;
}): JSX.Element {
  return (
    <>
      <div style={rowStyle}>
        <label style={fieldStyle}>
          Mode
          <select
            aria-label="Probe mode"
            title="Choose what to zero: Z only on the stock top, or X, Y, and Z on a corner plate."
            value={props.mode}
            onChange={(e) => props.onMode(e.target.value === 'corner' ? 'corner' : 'z')}
          >
            <option value="z">Z only (stock top)</option>
            <option value="corner">XYZ corner</option>
          </select>
        </label>
        {props.mode === 'corner' && (
          <label style={fieldStyle}>
            Corner
            <select
              aria-label="Probe corner"
              title="Which stock corner the plate sits on — probe directions and zero signs mirror to match."
              value={props.corner}
              onChange={(e) => {
                const next = CORNERS.find((c) => c.value === e.target.value);
                if (next !== undefined) props.onCorner(next.value);
              }}
            >
              {CORNERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div style={rowStyle}>
        <NumberField
          label="Plate thickness"
          value={props.zParams.plateThicknessMm}
          onCommit={(v) => props.onZParams({ ...props.zParams, plateThicknessMm: v })}
        />
        <NumberField
          label="Max travel"
          value={props.zParams.maxTravelMm}
          onCommit={(v) => props.onZParams({ ...props.zParams, maxTravelMm: v })}
        />
      </div>
      {props.mode === 'corner' && (
        <div style={rowStyle}>
          <NumberField
            label="Bit diameter"
            value={props.bitDiameterMm}
            onCommit={props.onBitDiameter}
          />
        </div>
      )}
    </>
  );
}

const PROBE_VALUE_MIN_MM = 0.1;
const PROBE_VALUE_MAX_MM = 100;

const NUMBER_FIELD_TITLES: Readonly<Record<string, string>> = {
  'Plate thickness': 'Distance from the plate top to its underside — sets where work Z0 lands.',
  'Max travel': 'How far a probe move may travel before failing with ALARM:5.',
  'Bit diameter': 'Used to offset the X and Y zeros by one bit radius at side contact.',
};

function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <span style={unitWrapStyle}>
        <input
          type="number"
          aria-label={props.label}
          title={NUMBER_FIELD_TITLES[props.label] ?? props.label}
          value={props.value}
          min={PROBE_VALUE_MIN_MM}
          max={PROBE_VALUE_MAX_MM}
          step={0.01}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= PROBE_VALUE_MIN_MM && v <= PROBE_VALUE_MAX_MM) {
              props.onCommit(v);
            }
          }}
          style={inputStyle}
        />
        mm
      </span>
    </label>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  margin: '6px 0',
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 6 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const unitWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};
const inputStyle: React.CSSProperties = { width: 70 };
