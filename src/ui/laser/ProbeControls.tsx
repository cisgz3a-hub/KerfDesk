// ProbeControls — the reusable touch-plate probing body (mode / corner / plate
// / bit + Run), extracted from ProbePanel so both the CNC Material & Bit panel
// and the Device-Setup wizard can host it (F-CNC20) without duplicating the
// G38.2 logic. CNC-only (null otherwise); the caller supplies the chrome.

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
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { describeProbeResult } from '../state/probe-actions';
import { probePlateRemovalRequired } from '../state/work-z-zero-evidence';
import { useToastStore } from '../state/toast-store';

type ProbeMode = 'z' | 'corner';

const CORNERS: ReadonlyArray<{ readonly value: ProbeCorner; readonly label: string }> = [
  { value: 'front-left', label: 'Front-left' },
  { value: 'front-right', label: 'Front-right' },
  { value: 'back-left', label: 'Back-left' },
  { value: 'back-right', label: 'Back-right' },
];

export function ProbeControls(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const probingSupported = useLaserStore((s) => s.capabilities.probing);
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
  if (!probingSupported) {
    // The probe runner speaks the GRBL response grammar; on firmwares with a
    // different grammar a cycle could report false success and zero Z at the
    // wrong height, so the controls are withheld entirely.
    return (
      <p style={{ fontSize: 12, color: 'var(--lf-text-faint)' }}>
        Touch-plate probing is not supported on this controller. Zero the work coordinates manually
        (jog to the stock top and set Z0).
      </p>
    );
  }

  const effectiveBitDiameter = bitDiameterMm ?? activeCncTool(machine).diameterMm;
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
    <>
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
      <ProbePlateRemovalConfirmation />
    </>
  );
}

function ProbePlateRemovalConfirmation(): JSX.Element | null {
  const required = useLaserStore((state) => probePlateRemovalRequired(state.workZZeroEvidence));
  const confirm = useLaserStore((state) => state.confirmProbePlateRemoved);
  if (!required) return null;
  return (
    <div role="alert" style={plateRemovalStyle}>
      <strong>Probe complete â€” spindle start is still blocked.</strong>
      <span>Remove the touch plate and probe lead from the stock and cutter.</span>
      <button type="button" onClick={confirm}>
        Confirm plate removed
      </button>
    </div>
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
        <ClearableNumberField
          ariaLabel={props.label}
          title={NUMBER_FIELD_TITLES[props.label] ?? props.label}
          value={props.value}
          min={PROBE_VALUE_MIN_MM}
          max={PROBE_VALUE_MAX_MM}
          step={0.01}
          onCommit={props.onCommit}
          style={inputStyle}
        />
        mm
      </span>
    </label>
  );
}

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  margin: '6px 0',
};
const plateRemovalStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  marginTop: 8,
  padding: 8,
  border: '1px solid var(--lf-warning)',
  borderRadius: 4,
  fontSize: 12,
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 6 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const unitWrapStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const inputStyle: React.CSSProperties = { width: 70 };
