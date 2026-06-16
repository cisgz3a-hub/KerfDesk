import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';

const SETUP_CONFIRMATION =
  'Send persistent Neotronics / GRBL diode setup commands?\n\n' +
  '$32=1\n$30=1000\n$130=400\n$131=400\n$$\n\n' +
  'LaserForge does not change $22 homing here. Read $$ and export a backup first, then confirm Z travel, homing, and air assist wiring on the machine.';

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
        title="Open the one-time GRBL firmware write helper for Neotronics / GT4040-style diode controllers."
      >
        One-time GRBL Setup
      </summary>
      <div style={bodyStyle}>
        <p style={copyStyle}>
          Writes only the listed GRBL values after you have read and backed up controller settings.
          Normal connect already reads live settings; do not run setup every time.
        </p>
        <button
          type="button"
          onClick={handleSetup}
          disabled={disabled}
          title="Confirm and send persistent firmware writes: $32=1, $30=1000, $130=400, $131=400, then $$. Homing is not changed."
        >
          Apply one-time GRBL setup
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
