// ProbeControls — the reusable touch-plate probing body (mode / corner / plate
// / bit + Run), extracted from ProbePanel so both the CNC Machine rail
// and the Device-Setup wizard can host it (F-CNC20) without duplicating the
// G38.2 logic. CNC-only (null otherwise); the caller supplies the chrome.

import { type ProbeCorner, type ZProbeParams } from '../../core/controllers/grbl';
import { type CornerProbeParams, type ProbeRequest } from '../../core/controllers/grbl/probe';
import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { describeProbeResult } from '../state/probe-actions';
import {
  probeCircuitBlockReason,
  probeCircuitCheck,
  type ProbeCircuitCheck,
} from '../state/probe-test-touch';
import { useToastStore } from '../state/toast-store';
import {
  CornerProbeGeometryFields,
  type CornerProbeGeometryDraft,
} from './CornerProbeGeometryFields';
import { ProbeNumberField } from './ProbeNumberField';
import {
  effectiveProbeBitDiameterMm,
  probeFormContextKey,
  probeFormForContext,
  useProbeFormStore,
  type ProbeMode,
} from './probe-form-store';

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
  /** A tool-change hold re-zeroes Z only, so the corner cycle is not offered. */
  readonly cornerUnavailable: boolean;
};

const CORNERS: ReadonlyArray<{ readonly value: ProbeCorner; readonly label: string }> = [
  { value: 'front-left', label: 'Front-left' },
  { value: 'front-right', label: 'Front-right' },
  { value: 'back-left', label: 'Back-left' },
  { value: 'back-right', label: 'Back-right' },
];

export function ProbeControls(): JSX.Element | null {
  const project = useStore((s) => s.project);
  const contextKey = useProbeFormContextKey();
  const machine = project.machine;
  const probingSupported = useLaserStore((s) => s.capabilities.probing);
  const live = useProbeLiveState();
  const toolChangeHold = useLaserStore((s) => s.streamer?.status === 'tool-change');
  const probe = useLaserStore((s) => s.probe);
  const pushToast = useToastStore((s) => s.pushToast);
  // Every mount in the same document/profile/controller session shares one
  // draft. Open/New, a committed profile switch, or a new controller session
  // selects a fresh draft, so plate geometry from a different physical setup
  // cannot silently become this Run's input.
  const form = useProbeFormStore((s) => probeFormForContext(s, contextKey));
  const setMode = useProbeFormStore((s) => s.setMode);
  const setCorner = useProbeFormStore((s) => s.setCorner);
  const setZParams = useProbeFormStore((s) => s.setZParams);
  const setBitDiameterMm = useProbeFormStore((s) => s.setBitDiameterMm);
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
    form,
    effectiveTool.id,
    effectiveTool.diameterMm,
  );
  // The held job runs on the X/Y origin it started with, so a tool-change hold
  // offers the Z cycle only; the store refuses the corner cycle there too. The
  // draft keeps its mode for after the job (ADR-375 Amendment 3).
  const mode: ProbeMode = toolChangeHold ? 'z' : form.mode;
  const toolSupported = mode !== 'corner' || effectiveTool.kind === 'end-mill';
  const readiness = probeControlReadiness({ ...live, toolSupported });

  const run = (): void => {
    const request = buildProbeRequest({
      mode,
      zParams: form.zParams,
      bitDiameterMm: effectiveBitDiameter,
      toolKind: effectiveTool.kind,
      corner: form.corner,
      cornerGeometry: form.cornerGeometry,
    });
    void probe(request).then((result) => {
      const described = describeProbeResult(result);
      pushToast(described.message, described.variant);
    });
  };

  return (
    <>
      <p style={hintStyle}>
        {probeHint(mode, toolChangeHold)}
        {' Spindle must be off.'}
      </p>
      <ProbeCircuitLine />
      <ProbeFields
        key={contextKey}
        mode={mode}
        cornerUnavailable={toolChangeHold}
        corner={form.corner}
        zParams={form.zParams}
        bitDiameterMm={effectiveBitDiameter}
        cornerGeometry={form.cornerGeometry}
        onMode={(value) => setMode(contextKey, value)}
        onCorner={(value) => setCorner(contextKey, value)}
        onZParams={(value) => setZParams(contextKey, value)}
        onBitDiameter={(value) => setBitDiameterMm(contextKey, value, effectiveTool.id)}
        onCornerGeometry={(value) => setCornerGeometry(contextKey, value)}
      />
      <button type="button" onClick={run} disabled={!readiness.ready} title={readiness.title}>
        {probeButtonLabel(live.isBusy)}
      </button>
    </>
  );
}

function useProbeFormContextKey(): string {
  const controllerSessionEpoch = useLaserStore((s) => s.controllerSessionEpoch);
  return useStore((s) =>
    probeFormContextKey(s.projectDocumentEpoch, s.probeSetupEpoch, controllerSessionEpoch),
  );
}

type ProbeLiveState = {
  readonly isConnected: boolean;
  readonly isIdle: boolean;
  readonly isBusy: boolean;
  /** Why the probe circuit is not tested yet, or null (ADR-103 Amendment 2). */
  readonly circuitBlock: string | null;
};

function useProbeLiveState(): ProbeLiveState {
  const isConnected = useLaserStore((s) => s.connection.kind === 'connected');
  const isIdle = useLaserStore((s) => s.statusReport?.state === 'Idle');
  const isBusy = useLaserStore((s) => s.probeBusy);
  const circuitBlock = useLaserStore(probeCircuitBlockReason);
  return { isConnected, isIdle, isBusy, circuitBlock };
}

/** The live probe input and its test touch (ADR-103 Amendment 2). */
function ProbeCircuitLine(): JSX.Element | null {
  const circuit = useLaserStore(probeCircuitCheck);
  const shown = useLaserStore((s) => s.connection.kind === 'connected' && !s.probeBusy);
  if (!shown) return null;
  return (
    <p role="status" aria-label="Probe circuit" style={circuitStyle(circuit)}>
      {probeCircuitLine(circuit)}
    </p>
  );
}

function probeControlReadiness(input: ProbeLiveState & { readonly toolSupported: boolean }): {
  readonly ready: boolean;
  readonly title: string;
} {
  if (!input.toolSupported) {
    return {
      ready: false,
      title: 'XYZ corner probing requires a cylindrical end mill with a straight flank.',
    };
  }
  if (!input.isConnected || !input.isIdle || input.isBusy) {
    return { ready: false, title: 'Connect and wait for Idle before probing.' };
  }
  if (input.circuitBlock !== null) return { ready: false, title: input.circuitBlock };
  return {
    ready: true,
    title: 'Start the probing cycle. The bit moves toward the plate at the seek feed.',
  };
}

function probeCircuitLine(circuit: ProbeCircuitCheck): string {
  switch (circuit) {
    case 'untested':
      return 'Probe circuit: not tested. Hold the plate against the bit until this reads closed, then take it away.';
    case 'closed':
      return 'Probe circuit: closed. Take the plate away from the bit.';
    case 'tested':
      return 'Probe circuit: tested. Place the plate, then Run probe.';
  }
}

function circuitStyle(circuit: ProbeCircuitCheck): React.CSSProperties {
  return {
    ...hintStyle,
    color: circuit === 'tested' ? 'var(--lf-success-fg)' : 'var(--lf-text)',
    fontWeight: circuit === 'tested' ? 400 : 600,
  };
}

const TOOL_CHANGE_PROBE_HINT =
  'Tool change: probe Z only. The X/Y origin stays where the job started.';

function probeHint(mode: ProbeMode, toolChangeHold: boolean): string {
  const hint =
    mode === 'z'
      ? 'Rest the plate on the stock top under the bit and clip the probe lead to the bit. Z0 lands on the stock top.'
      : 'Rest the plate flush on the chosen stock corner with the bit at the measured X/Y offsets, 5–15 mm above. X0 Y0 Z0 land on that corner.';
  return toolChangeHold ? `${TOOL_CHANGE_PROBE_HINT} ${hint}` : hint;
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
            <option value="corner" disabled={props.cornerUnavailable}>
              XYZ corner
            </option>
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
