import { Button } from '../kit';
import { useStore } from '../state';
import { externalGcodePreviewStartWarning } from '../state/external-gcode-preview-disclosure';

export function ExternalGcodePreviewBanner(): JSX.Element | null {
  const preview = useStore((state) => state.externalGcodePreview);
  const close = useStore((state) => state.closeExternalGcodePreview);
  if (preview === null) return null;
  return (
    <section role="status" aria-label="External G-code preview disclosure" style={bannerStyle}>
      <span>
        <strong>Imported G-code preview:</strong> {externalGcodePreviewStartWarning(preview.name)}
      </span>
      <Button onClick={close}>Show project toolpath</Button>
    </section>
  );
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-warning-border)',
  background: 'var(--lf-warning-bg)',
  color: 'var(--lf-text)',
  fontSize: 12,
};
