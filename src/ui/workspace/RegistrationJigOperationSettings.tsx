import {
  captureLayerOperationSettings,
  findRegistrationLayer,
  type LayerOperationSettings,
  type Scene,
} from '../../core/scene';
import { Button } from '../kit';
import { LayerRowCutSettings } from '../layers/LayerRowCutSettings';
import { LayerRowSettingsFields } from '../layers/LayerRowFields';
import { useCutSettingsLauncher } from '../layers/use-cut-settings-launcher';
import { useStore } from '../state';

export function RegistrationJigOperationSettings(): JSX.Element | null {
  const scene = useStore((state) => state.project.scene);
  const setLayerParam = useStore((state) => state.setLayerParam);
  return <RegistrationJigOperationSettingsEditor scene={scene} onChange={setLayerParam} />;
}

export function RegistrationJigOperationSettingsEditor(props: {
  readonly scene: Scene;
  readonly onChange: (operationId: string, patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element | null {
  const layer = findRegistrationLayer(props.scene);
  const { settingsOpen, cutSettingsBlocked, openSettings, closeSettings } =
    useCutSettingsLauncher();
  if (layer === null) return null;
  const commit = (patch: Partial<LayerOperationSettings>): void => props.onChange(layer.id, patch);
  return (
    <section aria-label="Registration jig outline settings" style={sectionStyle}>
      <strong>Outline laser settings</strong>
      <LayerRowSettingsFields
        layer={layer}
        operationTarget={{
          settings: captureLayerOperationSettings(layer),
          selectedObjectCount: 0,
          ariaContext: 'registration jig outline',
          commit,
        }}
      />
      <details>
        <summary title="Show air assist and the advanced outline settings">
          More outline settings
        </summary>
        <div style={moreStyle}>
          <p style={hintStyle}>
            These settings drive the outline run and appear again in Job Review. Tune them for the
            base material before Frame and Start.
          </p>
          <label style={airAssistStyle}>
            <input
              type="checkbox"
              checked={layer.airAssist}
              aria-label="Air assist for registration jig outline"
              title="Turn job-controlled air assist on for the registration outline run"
              onChange={(event) => commit({ airAssist: event.target.checked })}
            />{' '}
            Air assist
          </label>
          <Button
            disabled={cutSettingsBlocked}
            title="Open advanced settings for the registration outline Line operation"
            onClick={openSettings}
          >
            Advanced outline settings
          </Button>
        </div>
      </details>
      {settingsOpen ? (
        <LayerRowCutSettings layer={layer} onClose={closeSettings} onApply={commit} />
      ) : null}
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  paddingTop: 8,
  borderTop: '1px solid var(--lf-border-subtle)',
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.4,
};
const airAssistStyle: React.CSSProperties = { fontSize: 12 };
const moreStyle: React.CSSProperties = { display: 'grid', gap: 6, marginTop: 6 };
