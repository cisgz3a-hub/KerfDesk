import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { jogAxisSignsForOrigin } from '../../../core/devices';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { JogArrowGrid } from '../JogArrowGrid';
import { clampJogFeed, type JogVector } from '../jog-control-policy';
import { useJogControlPreferences } from '../jog-control-preferences';

const FINE_JOG_STEPS_MM = [0.1, 1, 10] as const;
const DEFAULT_FINE_JOG_STEP_MM = 1;
const FINE_JOG_FEED_CAP_MM_PER_MIN = 3000;

export type BoardFineJogControlsProps = {
  readonly disabled: boolean;
  readonly onError?: (message: string | null) => void;
};

/**
 * Compact, beam-off XY adjustment controls for correcting a captured board
 * point. The laser store owns the live safety checks; in particular, it
 * rejects jogs while Fire or any other controller/motion owner is active.
 */
export function BoardFineJogControls(props: BoardFineJogControlsProps): JSX.Element {
  const { disabled, onError } = props;
  const preferredStep = useJogControlPreferences((state) => state.stepMm);
  const setPreferredStep = useJogControlPreferences((state) => state.setStepMm);
  const requestedFeed = useJogControlPreferences((state) => state.requestedFeedMmPerMin);
  const device = useStore((state) => state.project.device);
  const jog = useLaserStore((state) => state.jog);
  const statusReport = useLaserStore((state) => state.statusReport);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const [localError, setLocalError] = useState<string | null>(null);

  const stepMm = fineJogStep(preferredStep);
  const safeRequestedFeed =
    Number.isFinite(requestedFeed) && requestedFeed > 0
      ? Math.min(requestedFeed, FINE_JOG_FEED_CAP_MM_PER_MIN)
      : FINE_JOG_FEED_CAP_MM_PER_MIN;
  const feed = clampJogFeed(safeRequestedFeed, device.maxFeed);
  const signs = useMemo(() => jogAxisSignsForOrigin(device.origin), [device.origin]);
  const position = inferCurrentMachinePosition(statusReport, wcoCache);

  const clearError = useCallback((): void => {
    setLocalError(null);
    onError?.(null);
  }, [onError]);
  const reportError = useCallback(
    (error: unknown): void => {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `Fine jog failed: ${detail}`;
      setLocalError(message);
      onError?.(message);
    },
    [onError],
  );
  const sendVector = useCallback(
    (vector: JogVector): void => {
      clearError();
      try {
        void jog(vector).catch(reportError);
      } catch (error) {
        reportError(error);
      }
    },
    [clearError, jog, reportError],
  );

  return (
    <div style={containerStyle} aria-label="Fine board-position adjustment">
      <fieldset style={stepFieldsetStyle} disabled={disabled}>
        <legend style={legendStyle}>Fine jog step</legend>
        <div style={stepButtonsStyle}>
          {FINE_JOG_STEPS_MM.map((option) => (
            <Button
              key={option}
              pressed={stepMm === option}
              onClick={() => setPreferredStep(option)}
              aria-label={`Set fine jog step to ${option} millimeters`}
            >
              {option} mm
            </Button>
          ))}
        </div>
      </fieldset>
      <JogArrowGrid
        disabled={disabled}
        stepMm={stepMm}
        feed={feed}
        signs={signs}
        position={position}
        bed={{ width: device.bedWidth, height: device.bedHeight }}
        continuousJogSupported={false}
        onJog={sendVector}
        onCancel={() => undefined}
      />
      <p style={feedHintStyle}>Jog speed: {feed} mm/min</p>
      <p role="status" aria-live="polite" style={errorStyle}>
        {localError}
      </p>
    </div>
  );
}

function fineJogStep(preferredStep: number): (typeof FINE_JOG_STEPS_MM)[number] {
  return FINE_JOG_STEPS_MM.some((option) => option === preferredStep)
    ? (preferredStep as (typeof FINE_JOG_STEPS_MM)[number])
    : DEFAULT_FINE_JOG_STEP_MM;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
};
const stepFieldsetStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  border: 0,
};
const legendStyle: CSSProperties = {
  marginBottom: 4,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const stepButtonsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 4,
};
const feedHintStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const errorStyle: CSSProperties = {
  minHeight: 15,
  margin: 0,
  fontSize: 11,
  lineHeight: 1.3,
  color: 'var(--lf-danger-fg)',
};
