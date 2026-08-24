import { useEffect, useMemo, useState } from 'react';
import { combinedBBox } from '../../core/scene';
import { registrationJigArtworkInstances } from '../../core/scene/registration-jig-artwork';
import { Button } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

const DIMENSION_DECIMALS = 3;

export function RegistrationJigArtworkSizeControls(): JSX.Element | null {
  const scene = useStore((state) => state.project.scene);
  const resizeArtwork = useStore((state) => state.resizeRegistrationJigArtwork);
  const pushToast = useToastStore((state) => state.pushToast);
  const instances = useMemo(() => registrationJigArtworkInstances(scene), [scene]);
  const dimensions = dimensionsFor(instances[0]?.objects ?? []);
  const [widthDraft, setWidthDraft] = useState('');
  const [heightDraft, setHeightDraft] = useState('');
  const [drivingDimension, setDrivingDimension] = useState<'width' | 'height'>('width');

  useEffect(() => {
    setWidthDraft(formatDimension(dimensions?.width ?? null));
    setHeightDraft(formatDimension(dimensions?.height ?? null));
  }, [dimensions?.height, dimensions?.width]);

  if (dimensions === null || instances.length < 2) return null;
  const ratio = dimensions.width / dimensions.height;
  const updateWidth = (value: string): void => {
    setDrivingDimension('width');
    setWidthDraft(value);
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) {
      setHeightDraft(formatDimension(width / ratio));
    }
  };
  const updateHeight = (value: string): void => {
    setDrivingDimension('height');
    setHeightDraft(value);
    const height = Number(value);
    if (Number.isFinite(height) && height > 0) {
      setWidthDraft(formatDimension(height * ratio));
    }
  };
  const apply = (): void => {
    const widthMm = Number(widthDraft);
    const heightMm = Number(heightDraft);
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
      pushToast('Enter positive artwork width and height values.', 'warning');
      return;
    }
    const result = resizeArtwork({
      widthMm,
      heightMm,
      drivingDimension,
    });
    if (result.kind === 'ok') return;
    pushToast(messageForResizeError(result.reason), 'warning');
  };

  return (
    <ArtworkSizeFields
      count={instances.length}
      heightDraft={heightDraft}
      widthDraft={widthDraft}
      onApply={apply}
      onHeightChange={updateHeight}
      onWidthChange={updateWidth}
    />
  );
}

function ArtworkSizeFields(props: {
  readonly count: number;
  readonly heightDraft: string;
  readonly widthDraft: string;
  readonly onApply: () => void;
  readonly onHeightChange: (value: string) => void;
  readonly onWidthChange: (value: string) => void;
}): JSX.Element {
  return (
    <fieldset aria-label="Jig artwork size" style={fieldsetStyle}>
      <legend style={legendStyle}>Artwork size — all {props.count} copies</legend>
      <div style={fieldsStyle}>
        <label style={fieldStyle}>
          <span>W</span>
          <input
            className="lf-input"
            aria-label="Jig artwork width"
            title="Set the shared artwork width; height stays proportional"
            type="number"
            min="0.001"
            step="0.1"
            value={props.widthDraft}
            onInput={(event) => props.onWidthChange(event.currentTarget.value)}
          />
          <span>mm</span>
        </label>
        <label style={fieldStyle}>
          <span>H</span>
          <input
            className="lf-input"
            aria-label="Jig artwork height"
            title="Set the shared artwork height; width stays proportional"
            type="number"
            min="0.001"
            step="0.1"
            value={props.heightDraft}
            onInput={(event) => props.onHeightChange(event.currentTarget.value)}
          />
          <span>mm</span>
        </label>
      </div>
      <span style={aspectStyle} title="Width and height stay proportional for every jig copy">
        AR locked — proportions preserved
      </span>
      <Button onClick={props.onApply}>Apply size to all {props.count}</Button>
    </fieldset>
  );
}

function dimensionsFor(objects: Parameters<typeof combinedBBox>[0]): {
  readonly width: number;
  readonly height: number;
} | null {
  const bounds = combinedBBox(objects);
  if (bounds === null) return null;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return width > 0 && height > 0 ? { width, height } : null;
}

function formatDimension(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return Number(value.toFixed(DIMENSION_DECIMALS)).toString();
}

function messageForResizeError(reason: string): string {
  if (reason === 'invalid-dimension' || reason === 'invalid-number') {
    return 'Enter positive artwork width and height values.';
  }
  return 'Create and copy jig artwork before applying a shared size.';
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 8,
};

const legendStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', padding: '0 4px' };
const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const fieldStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'grid',
  gap: 4,
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
};
const aspectStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
