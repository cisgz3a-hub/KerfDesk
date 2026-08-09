import type { ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';
import { NumberField } from '../common/NumberField';
import { useStore } from '../state';
import { ReliefInputLevelsControl } from './ReliefInputLevelsControl';
import { ReliefMaskOutsideMeaningControl } from './ReliefMaskOutsideMeaningControl';
import { ReliefMaskThresholdControl } from './ReliefMaskThresholdControl';
import { useDebouncedCommit } from './use-debounced-commit';

/** Renders mesh or heightfield controls using parent-resolved machine-space width and scale. */
export function ReliefPropertyControls(props: {
  readonly relief: ReliefObject;
  readonly widthMm: number;
  readonly targetScaleX: number;
}): JSX.Element {
  const projectDocumentEpoch = useStore((state) => state.projectDocumentEpoch);
  const fieldKey = (field: string): string => `${projectDocumentEpoch}:${props.relief.id}:${field}`;
  return (
    <>
      <ReliefNumberField
        key={fieldKey('width')}
        relief={props.relief}
        label="Width"
        value={props.widthMm}
        step={1}
        title="Carved width on the stock after object scale. Editing preserves the current scale."
        commitKey="targetWidthMm"
        toStoredValue={(value) => value / props.targetScaleX}
      />
      <ReliefNumberField
        key={fieldKey('depth')}
        relief={props.relief}
        label="Depth"
        value={props.relief.reliefDepthMm}
        step={0.5}
        title="Total relief depth: the source's numeric range maps to [-depth, 0] below the stock top."
        commitKey="reliefDepthMm"
      />
      {isMeshRelief(props.relief) ? (
        <BackgroundSelect relief={props.relief} />
      ) : (
        <>
          <PolaritySelect relief={props.relief} />
          <ReliefInputLevelsControl key={fieldKey('input-levels')} relief={props.relief} />
          <GammaField key={fieldKey('gamma')} relief={props.relief} />
          <ReliefMaskThresholdControl key={fieldKey('mask-threshold')} relief={props.relief} />
          <ReliefMaskOutsideMeaningControl relief={props.relief} />
        </>
      )}
    </>
  );
}

function isMeshRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}

function ReliefNumberField(props: {
  readonly relief: ReliefObject;
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly title: string;
  readonly commitKey: 'targetWidthMm' | 'reliefDepthMm';
  readonly toStoredValue?: (value: number) => number;
}): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: (value) =>
      setReliefParams(props.relief.id, {
        [props.commitKey]: props.toStoredValue?.(value) ?? value,
      }),
    parse: (input) => {
      const parsed = Number.parseFloat(input);
      return positiveFinite(parsed) ? parsed : props.value;
    },
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>
        <input
          type="number"
          step={props.step}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label={`Relief ${props.label.toLowerCase()} (mm)`}
          title={props.title}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
      </span>
    </label>
  );
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function BackgroundSelect(props: { readonly relief: MeshReliefObject }): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Background</span>
      <span style={controlStyle}>
        <select
          value={props.relief.reliefSource.emptyCells}
          onChange={(e) =>
            setReliefParams(props.relief.id, {
              emptyCells: e.target.value === 'top' ? 'top' : 'floor',
            })
          }
          aria-label="Relief background"
          title="Where mesh-free cells sit: carved to the floor (model stands proud) or kept at the stock top."
          style={selectStyle}
        >
          <option value="floor">Carve away (floor)</option>
          <option value="top">Keep at stock top</option>
        </select>
      </span>
    </label>
  );
}

function PolaritySelect(props: { readonly relief: HeightfieldReliefObject }): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Polarity</span>
      <span style={controlStyle}>
        <select
          value={props.relief.reliefSource.mapping.polarity}
          onChange={(event) =>
            setReliefParams(props.relief.id, {
              polarity: event.target.value === 'light-is-deep' ? 'light-is-deep' : 'light-is-high',
            })
          }
          aria-label="Relief height-map polarity"
          title="Declares whether lighter samples are nearer the stock top or deeper into the stock."
          style={selectStyle}
        >
          <option value="light-is-high">Light is high</option>
          <option value="light-is-deep">Light is deep</option>
        </select>
      </span>
    </label>
  );
}

function GammaField(props: { readonly relief: HeightfieldReliefObject }): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Gamma</span>
      <span style={controlStyle}>
        <NumberField
          ariaLabel="Relief height-map gamma"
          value={props.relief.reliefSource.mapping.curve.gamma}
          positiveOnly
          step={0.05}
          title="Power exponent applied to normalized source samples. 1 keeps the mapping linear; source samples are not rewritten."
          onCommit={(gamma) => setReliefParams(props.relief.id, { gamma })}
          style={inputStyle}
        />
      </span>
    </label>
  );
}

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
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
