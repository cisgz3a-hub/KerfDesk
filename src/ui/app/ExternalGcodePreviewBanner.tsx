import { Button } from '../kit';
import { useStore } from '../state';
import { externalGcodePreviewStartWarning } from '../state/external-gcode-preview-disclosure';
import { noticeBannerStyle, noticeBannerTextStyle } from './notice-banner-style';

export function ExternalGcodePreviewBanner(): JSX.Element | null {
  const preview = useStore((state) => state.externalGcodePreview);
  const close = useStore((state) => state.closeExternalGcodePreview);
  if (preview === null) return null;
  return (
    <section
      role="status"
      aria-label="External G-code preview disclosure"
      style={noticeBannerStyle}
    >
      <span style={noticeBannerTextStyle}>
        <strong>Imported G-code preview:</strong> {externalGcodePreviewStartWarning(preview.name)}
      </span>
      <Button onClick={close}>Show project toolpath</Button>
    </section>
  );
}
