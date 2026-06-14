import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';

const SETUP_CONFIRMATION =
  'Send persistent GRBL setup commands?\n\n' +
  '$X\n$32=1\n$22=0\n$30=1000\n$130=400\n$131=400\n$$\n\n' +
  'Only continue if this controller should be configured like the tested GT4040 / GRBL laser workflow.';

export function GrblLaserSetupPanel({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const configure = useLaserStore((s) => s.configureGrblLaserSetup);
  const handleSetup = (): void => {
    if (!jobAwareConfirm(SETUP_CONFIRMATION)) return;
    void configure().catch(() => undefined);
  };
  return (
    <details style={panelStyle}>
      <summary
        style={summaryStyle}
        title="Open GRBL firmware setup commands for GT4040-style controllers."
      >
        GRBL setup
      </summary>
      <div style={bodyStyle}>
        <p style={copyStyle}>
          Sends persistent laser-mode settings used by the GT4040 LightBurn workflow.
        </p>
        <button
          type="button"
          onClick={handleSetup}
          disabled={disabled}
          title="Confirm and send $X, $32=1, $22=0, $30=1000, $130=400, $131=400, then $$."
        >
          GRBL laser setup
        </button>
      </div>
    </details>
  );
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 6,
  background: 'var(--lf-bg-2)',
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 6,
};
const copyStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.3,
};
