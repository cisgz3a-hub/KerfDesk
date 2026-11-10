// Shown in place of the advanced laser settings while Simple view is on
// (ADR-698): every hidden setting that changes this burn, with its value, and
// the way back to all of them.

import type { LayerOperationSettings } from '../../core/scene';
import { useSimpleViewStore } from '../state/simple-view';
import type { MixedOperationFields } from './selected-operation-mixed';
import { simpleViewHiddenValues } from './simple-view-hidden-values';

export function SimpleViewSettingsNote(props: {
  readonly settings: LayerOperationSettings;
  readonly mixedFields: MixedOperationFields;
}): JSX.Element {
  const setEnabled = useSimpleViewStore((state) => state.setEnabled);
  const hidden = simpleViewHiddenValues(props.settings, props.mixedFields);
  return (
    <section className="lf-simple-view-note" aria-label="Settings Simple view hides">
      {hidden.length === 0 ? (
        <p className="lf-laser-help">
          Simple view shows power, speed and passes. The other settings are at their usual values.
        </p>
      ) : (
        <>
          <p className="lf-laser-help">Also set for this burn (hidden by Simple view):</p>
          <ul className="lf-simple-view-note__values" aria-label="Hidden settings in use">
            {hidden.map((entry) => (
              <li key={entry.key}>
                {entry.label}: <strong>{entry.value}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        title="Turn Simple view off and show every operation setting. Window → Simple view turns it back on."
        onClick={() => setEnabled(false)}
      >
        Show all settings
      </button>
    </section>
  );
}
