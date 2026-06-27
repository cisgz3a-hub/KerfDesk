import { useMemo } from 'react';
import type { SceneObject } from '../../core/scene';
import { useStore } from '../state';
import { SelectedImageAdjustments } from './SelectedImageAdjustments';
import { SelectedObjectOperationSettings } from './SelectedObjectOperationSettings';
import { useDebouncedCommit } from './use-debounced-commit';

const DEFAULT_POWER_SCALE_PERCENT = 100;
const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;

export function SelectedObjectProperties(): JSX.Element | null {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const objects = useStore((s) => s.project.scene.objects);
  const selectedObjects = useMemo(
    () => selectedSceneObjects(objects, selectedObjectId, additionalSelectedIds),
    [objects, selectedObjectId, additionalSelectedIds],
  );
  if (selectedObjects.length === 0) return null;
  return (
    <section aria-label="Selected object properties" style={sectionStyle}>
      <h3 style={headingStyle}>Shape Properties</h3>
      <PowerScaleInput objects={selectedObjects} />
      <SelectedObjectOperationSettings objects={selectedObjects} />
      <SelectedImageAdjustments />
    </section>
  );
}

function PowerScaleInput(props: { readonly objects: ReadonlyArray<SceneObject> }): JSX.Element {
  const setSelectedObjectsPowerScale = useStore((s) => s.setSelectedObjectsPowerScale);
  const value = commonPowerScale(props.objects);
  const debounced = useDebouncedCommit<number>({
    value,
    commit: setSelectedObjectsPowerScale,
    parse: (input) => clampPowerScale(Number(input)),
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Power Scale</span>
      <span style={controlStyle}>
        <input
          type="number"
          min={MIN_POWER_SCALE_PERCENT}
          max={MAX_POWER_SCALE_PERCENT}
          step={1}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label="Power scale for selected objects"
          title="Scale laser power for the selected object or objects without changing the layer setting."
          style={inputStyle}
        />
        <span style={unitStyle}>%</span>
      </span>
    </label>
  );
}

function selectedSceneObjects(
  objects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  return objects.filter((object) => ids.has(object.id));
}

function commonPowerScale(objects: ReadonlyArray<SceneObject>): number {
  const first = objects[0]?.powerScale ?? DEFAULT_POWER_SCALE_PERCENT;
  return objects.every((object) => (object.powerScale ?? DEFAULT_POWER_SCALE_PERCENT) === first)
    ? first
    : DEFAULT_POWER_SCALE_PERCENT;
}

function clampPowerScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POWER_SCALE_PERCENT;
  return Math.max(MIN_POWER_SCALE_PERCENT, Math.min(MAX_POWER_SCALE_PERCENT, value));
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  marginTop: 12,
  paddingTop: 10,
};
const headingStyle: React.CSSProperties = { fontSize: 13, margin: '0 0 8px 0' };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
