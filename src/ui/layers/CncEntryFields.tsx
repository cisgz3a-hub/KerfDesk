import type { CncLayerSettings, Layer } from '../../core/scene';
import { RailSection } from '../kit';
import { HelicalEntryRows, MotionPolishRows } from './CncLayerToolFields';
import { CncProfileLeadFields } from './CncProfileLeadFields';
import { CncRetractPassesField } from './CncRetractPassesField';

export function CncEntryFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element | null {
  const { layer, settings, onCommit } = props;
  const applies =
    settings.cutType.startsWith('profile') ||
    settings.cutType === 'pocket' ||
    settings.cutType === 'engrave' ||
    settings.cutType === 'v-carve';
  if (!applies) return null;
  return (
    <RailSection
      label="Entry & travel"
      hint="Choose cut direction, how the bit enters the material and movement between passes."
    >
      <p className="lf-cnc-settings-hint">
        Control how the bit enters a cut and moves between passes.
      </p>
      <MotionPolishRows {...props} />
      <CncProfileLeadFields layer={layer} settings={settings} onCommit={onCommit} />
      {settings.cutType === 'pocket' && settings.pocketStrategy !== 'adaptive' ? (
        <HelicalEntryRows {...props} />
      ) : null}
      <CncRetractPassesField layer={layer} settings={settings} onCommit={onCommit} />
    </RailSection>
  );
}
