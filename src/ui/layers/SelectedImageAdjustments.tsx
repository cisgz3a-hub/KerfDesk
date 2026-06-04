import type { RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

type AdjustmentField = 'brightness' | 'contrast' | 'gamma';

export function SelectedImageAdjustments(): JSX.Element | null {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const objects = useStore((s) => s.project.scene.objects);
  const image =
    selectedObjectId === null
      ? undefined
      : objects.find(
          (obj): obj is RasterImage => obj.id === selectedObjectId && obj.kind === 'raster-image',
        );
  if (image === undefined) return null;
  return (
    <section aria-label="Selected image adjustments" style={sectionStyle}>
      <h3 style={headingStyle}>Image Adjust</h3>
      <AdjustmentInput
        image={image}
        field="brightness"
        label="Brightness"
        min={-100}
        max={100}
        step={1}
        fallback={0}
      />
      <AdjustmentInput
        image={image}
        field="contrast"
        label="Contrast"
        min={-100}
        max={100}
        step={1}
        fallback={0}
      />
      <AdjustmentInput
        image={image}
        field="gamma"
        label="Gamma"
        min={0.1}
        max={5}
        step={0.05}
        fallback={1}
      />
    </section>
  );
}

function AdjustmentInput(props: {
  readonly image: RasterImage;
  readonly field: AdjustmentField;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly fallback: number;
}): JSX.Element {
  const setRasterImageAdjustments = useStore((s) => s.setRasterImageAdjustments);
  const debounced = useDebouncedCommit<number>({
    value: props.image[props.field] ?? props.fallback,
    commit: (value) => setRasterImageAdjustments(props.image.id, { [props.field]: value }),
    parse: (s) => clamp(Number(s), props.min, props.max, props.fallback),
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`${props.label} for ${props.image.source}`}
      />
    </label>
  );
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid #ddd',
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
const labelStyle: React.CSSProperties = { color: '#333' };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid #ccc',
  borderRadius: 4,
};
