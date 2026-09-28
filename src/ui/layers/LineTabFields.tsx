// Cut Settings → Line detail → Tabs / Bridges (ADR-494, LBG-C05): size, how
// automatic tabs are placed (a count per shape, or one per spacing with an
// optional cap), the share of the cut power that burns them, and the tool that
// places tabs by hand on the selected artwork.

import { useState } from 'react';
import { DEFAULT_TAB_SPACING_MM } from '../../core/job/operation-cut-extras';
import {
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import type { TabLayoutMode } from '../../core/scene/layer';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { controlStyle, Field, NumberInput } from './CutSettingsInputs';
import { MAX_TAB_SPACING_MM, MAX_TABS_PER_SHAPE, MIN_TAB_SPACING_MM } from './cut-settings-draft';

export function LineTabFields(props: { readonly layer: Layer }): JSX.Element {
  const { layer } = props;
  const [tabsOn, setTabsOn] = useState(layer.tabsEnabled);
  const [placeBy, setPlaceBy] = useState<TabLayoutMode>(layer.tabLayout ?? 'count');
  return (
    <fieldset
      className="lf-fieldset"
      title="Leave small uncut bridges on closed Line cuts so parts stay attached until you remove them."
    >
      <legend>Tabs / Bridges</legend>
      <p className="lf-laser-help">Small uncut gaps keep parts attached to the sheet.</p>
      <Field label="Enable">
        <input
          name="tabsEnabled"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={layer.tabsEnabled}
          onChange={(event) => setTabsOn(event.target.checked)}
          aria-label="Cut settings enable tabs"
          title="Enable automatic bridge gaps on closed Line cuts."
        />
      </Field>
      <Field label="Size">
        <NumberInput
          name="tabSizeMm"
          value={layer.tabSizeMm}
          min={0.01}
          max={100}
          step={0.01}
          label="tab size"
          title="Set the length of each uncut bridge gap in millimeters."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Place by">
        <select
          name="tabLayout"
          className="lf-select"
          value={placeBy}
          onChange={(event) => setPlaceBy(event.target.value === 'spacing' ? 'spacing' : 'count')}
          aria-label="Cut settings place tabs by"
          title="Put the same number of tabs on every shape, or one tab per length of outline so big shapes get more."
        >
          <option value="count">Count</option>
          <option value="spacing">Spacing</option>
        </select>
      </Field>
      {placeBy === 'count' ? <TabCountField layer={layer} /> : <TabSpacingFields layer={layer} />}
      <Field label="Tab power">
        <NumberInput
          name="tabCutPowerPercent"
          value={layer.tabCutPowerPercent ?? 0}
          min={0}
          max={100}
          step={1}
          label="tab power"
          title="Burn the tabs at this share of the cut power so parts snap out cleanly. 0 leaves them uncut."
        />
        <span className="lf-field-unit">%</span>
      </Field>
      <Field label="Holes">
        <input
          name="tabSkipInnerShapes"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={layer.tabSkipInnerShapes}
          aria-label="Cut settings skip inner tabs"
          title="Leave inner contours and holes whole instead of adding tabs to them."
        />
        <span className="lf-field-help">Skip inner shapes</span>
      </Field>
      <PlacedTabControls layer={layer} tabsOn={tabsOn} />
    </fieldset>
  );
}

function TabCountField(props: { readonly layer: Layer }): JSX.Element {
  return (
    <Field label="Count">
      <NumberInput
        name="tabsPerShape"
        value={props.layer.tabsPerShape}
        min={1}
        max={MAX_TABS_PER_SHAPE}
        step={1}
        label="tabs per shape"
        title="Set how many evenly spaced bridge gaps to add to each closed outer contour."
      />
    </Field>
  );
}

function TabSpacingFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <>
      <Field label="Spacing">
        <NumberInput
          name="tabSpacingMm"
          value={within(
            props.layer.tabSpacingMm ?? DEFAULT_TAB_SPACING_MM,
            MIN_TAB_SPACING_MM,
            MAX_TAB_SPACING_MM,
          )}
          min={MIN_TAB_SPACING_MM}
          max={MAX_TAB_SPACING_MM}
          step={0.01}
          label="tab spacing"
          title="Add one tab per this length of outline, spread evenly. Every closed shape gets at least one."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="At most">
        <NumberInput
          name="tabMaxPerShape"
          value={within(props.layer.tabMaxPerShape ?? 0, 0, MAX_TABS_PER_SHAPE)}
          min={0}
          max={MAX_TABS_PER_SHAPE}
          step={1}
          label="most tabs per shape"
          title="Never put more than this many tabs on one shape. 0 means no limit."
        />
        <span className="lf-field-unit">per shape</span>
      </Field>
    </>
  );
}

function PlacedTabControls(props: {
  readonly layer: Layer;
  readonly tabsOn: boolean;
}): JSX.Element {
  const { layer } = props;
  const objects = useStore((state) => state.project.scene.objects);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const selection = selectedTabObject(objects, selectedObjectId, additionalSelectedIds, layer);
  const clearTabs = useStore((state) => state.clearSelectedLaserTabAnchors);
  const fitToSelection = useStore((state) => state.fitToSelection);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const tabColor = tabPathColor(selection.object, layer);
  const placed =
    selection.object?.laserTabAnchors?.filter((anchor) => anchor.layerColor === tabColor).length ??
    0;
  const blocked = !props.tabsOn ? 'Turn on tabs to place them by hand.' : selection.blocked;
  return (
    <div className="lf-field">
      <span className="lf-field-label lf-field-label--md">By hand</span>
      <span style={controlStyle}>
        {/* Applies these settings (the dialog closes) and starts the tab tool,
            which takes canvas clicks until Esc. A plain button, so Enter still
            presses the dialog's Apply. */}
        <button
          type="button"
          className="lf-btn"
          disabled={blocked !== null}
          title={
            blocked ??
            'Apply these settings, then click the selected artwork’s outline to add tabs. Tabs placed by hand replace the automatic ones on their shape.'
          }
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form !== null && !form.reportValidity()) return;
            setToolMode({ kind: 'laser-tabs', layerColor: tabColor, operationId: layer.id });
            fitToSelection();
            form?.requestSubmit();
          }}
        >
          Place tabs
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={placed === 0 || selection.blocked !== null}
          title="Remove the tabs placed by hand on the selected artwork so it gets automatic tabs again."
          onClick={() => clearTabs(tabColor)}
        >
          Clear placed tabs
        </button>
        {placed > 0 ? <span className="lf-field-help">{placed} placed</span> : null}
      </span>
    </div>
  );
}

type TabSelection = { readonly object: SceneObject | null; readonly blocked: string | null };

function selectedTabObject(
  objects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
  layer: Layer,
): TabSelection {
  const object =
    additionalSelectedIds.size > 0
      ? undefined
      : objects.find((item) => item.id === selectedObjectId);
  if (object === undefined || !('paths' in object) || !sceneObjectUsesOperation(object, layer)) {
    return { object: null, blocked: 'Select one artwork that uses this operation to place tabs.' };
  }
  if (object.locked === true) {
    return { object, blocked: 'Unlock the selected artwork to place tabs on it.' };
  }
  return { object, blocked: null };
}

function tabPathColor(object: SceneObject | null, layer: Layer): string {
  if (object === null || !('paths' in object)) return layer.color;
  return object.paths.find((path) => pathUsesOperation(object, path, layer))?.color ?? layer.color;
}

// A value stored outside the field's range (a hand-edited file, an artwork
// override) opens clamped, so it never blocks Apply.
function within(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
