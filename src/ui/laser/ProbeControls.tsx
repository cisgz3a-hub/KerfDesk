// ProbeControls — the reusable touch-plate probing body (mode / corner / plate
// / bit + Run), extracted from ProbePanel so both the CNC Material & Bit panel
// and the Device-Setup wizard can host it (F-CNC20) without duplicating the
// G38.2 logic. CNC-only (null otherwise); the caller supplies the chrome.

import { type ProbeCorner, type ZProbeParams } from '../../core/controllers/grbl';
import { type CornerProbeParams, type ProbeRequest } from '../../core/controllers/grbl/probe';
import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { describeProbeResult } from '../state/probe-actions';
import { useToastStore } from '../state/toast-store';
import {
  CornerProbeGeometryFields,
  type CornerProbeGeometryDraft,
} from './CornerProbeGeometryFields';
import { ProbeNumberField } from './ProbeNumberField';
import { effectiveProbeBitDiameterMm, useProbeFormStore, type ProbeMode } from './probe-form-store';

type ProbeFieldsProps = {
  readonly mode: ProbeMode;
  readonly corner: ProbeCorner;
  readonly zParams: ZProbeParams;
  readonly bitDiameterMm: number;
  readonly cornerGeometry: CornerProbeGeometryDraft;
  readonly onMode: (mode: ProbeMode) => void;
  readonly onCorner: (corner: ProbeCorner) => void;
  readonly onZParams: (params: ZProbeParams) => void;
  readonly onBitDiameter: (value: number) => void;
  readonly onCornerGeometry: (value: CornerProbeGeometryDraft) => void;
};

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
  // One shared form across all three mounts (rail, wizard step, ProbePanel):
  // per-component state meant plate geometry dialled in one was invisible to
  // the other, which then probed with defaults.
  const mode = useProbeFormStore((s) => s.mode);
  const setMode = useProbeFormStore((s) => s.setMode);
  const corner = useProbeFormStore((s) => s.corner);
  const setCorner = useProbeFormStore((s) => s.setCorner);
  const zParams = useProbeFormStore((s) => s.zParams);
  const setZParams = useProbeFormStore((s) => s.setZParams);
  const bitDiameterMm = useProbeFormStore((s) => s.bitDiameterMm);
  const bitDiameterToolId = useProbeFormStore((s) => s.bitDiameterToolId);
  const setBitDiameterMm = useProbeFormStore((s) => s.setBitDiameterMm);
  const cornerGeometry = useProbeFormStore((s) => s.cornerGeometry);
  const setCornerGeometry = useProbeFormStore((s) => s.setCornerGeometry);
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

  const effectiveTool = activeCncTool(machine);
  // A typed diameter applies only while the bit it was typed against is still
  // active; swapping bits re-follows the machine rather than probing with the
  // previous cutter's diameter.
  const effectiveBitDiameter = effectiveProbeBitDiameterMm(
    { bitDiameterMm, bitDiameterToolId },
    effectiveTool.id,
    effectiveTool.diameterMm,
  );
  const toolSupported = mode !== 'corner' || effectiveTool.kind === 'end-mill';
  const readiness = probeControlReadiness({
    isConnected: connection.kind === 'connected',
    isIdle: statusReport?.state === 'Idle',
    isBusy: probeBusy,
    toolSupported,
  });

  const run = (): void => {
    const request = buildProbeRequest({
      mode,
      zParams,
      bitDiameterMm: effectiveBitDiameter,
      toolKind: effectiveTool.kind,
      corner,
      cornerGeometry,
    });
    void probe(request).then((result) => {
      const described = describeProbeResult(result);
      pushToast(described.message, described.variant);
    });
  };

  return (
    <>
      <p style={hintStyle}>
        {probeHint(mode)}
        {' Spindle must be off.'}
      </p>
      <ProbeFields
        mode={mode}
        corner={corner}
        zParams={zParams}
        bitDiameterMm={effectiveBitDiameter}
        cornerGeometry={cornerGeometry}
        onMode={setMode}
        onCorner={setCorner}
        onZParams={setZParams}
        onBitDiameter={(value) => setBitDiameterMm(value, effectiveTool.id)}
        onCornerGeometry={setCornerGeometry}
      />
      <button type="button" onClick={run} disabled={!readiness.ready} title={readiness.title}>
        {probeButtonLabel(probeBusy)}
      </button>
    </>
  );
}

function probeControlReadiness(input: {
  readonly isConnected: boolean;
  readonly isIdle: boolean;
  readonly isBusy: boolean;
  readonly toolSupported: boolean;
}): { readonly ready: boolean; readonly title: string } {
  if (!input.toolSupported) {
    return {
      ready: false,
      title: 'XYZ corner probing requires a cylindrical end mill with a straight flank.',
    };
  }
  const ready = input.isConnected && input.isIdle && !input.isBusy;
  return {
    ready,
    title: ready
      ? 'Start the probing cycle. The bit moves toward the plate at the seek feed.'
      : 'Connect and wait for Idle before probing.',
  };
}

function probeHint(mode: ProbeMode): string {
  return mode === 'z'
    ? 'Rest the plate on the stock top under the bit and clip the probe lead to the bit. Z0 lands on the stock top.'
    : 'Rest the plate flush on the chosen stock corner with the bit at the measured X/Y offsets, 5–15 mm above. X0 Y0 Z0 land on that corner.';
}

function probeButtonLabel(isBusy: boolean): string {
  return isBusy ? 'Probing…' : 'Run probe';
}

function buildProbeRequest(input: {
  readonly mode: ProbeMode;
  readonly zParams: ZProbeParams;
  readonly bitDiameterMm: number;
  readonly toolKind: CornerProbeParams['toolKind'];
  readonly corner: ProbeCorner;
  readonly cornerGeometry: CornerProbeGeometryDraft;
}): ProbeRequest {
  if (input.mode === 'z') return { kind: 'z', params: input.zParams };
  return {
    kind: 'corner',
    params: {
      ...input.zParams,
      bitDiameterMm: input.bitDiameterMm,
      toolKind: input.toolKind,
      corner: input.corner,
      ...input.cornerGeometry,
    },
  };
}

function ProbeFields(props: ProbeFieldsProps): JSX.Element {
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
        <ProbeNumberField
          label="Plate thickness"
          value={props.zParams.plateThicknessMm}
          onCommit={(v) => props.onZParams({ ...props.zParams, plateThicknessMm: v })}
        />
        <ProbeNumberField
          label="Max travel"
          value={props.zParams.maxTravelMm}
          onCommit={(v) => props.onZParams({ ...props.zParams, maxTravelMm: v })}
        />
      </div>
      {props.mode === 'corner' && (
        <CornerProbeGeometryFields
          bitDiameterMm={props.bitDiameterMm}
          geometry={props.cornerGeometry}
          onBitDiameter={props.onBitDiameter}
          onGeometry={props.onCornerGeometry}
        />
      )}
    </>
  );
}

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
