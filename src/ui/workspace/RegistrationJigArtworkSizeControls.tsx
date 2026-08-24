import { useEffect, useMemo, useState } from 'react';
import { combinedBBox } from '../../core/scene';
import { registrationJigArtworkInstances } from '../../core/scene/registration-jig-artwork';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { RegistrationJigArtworkSizeFields } from './RegistrationJigArtworkSizeFields';

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
  const [isAspectLocked, setIsAspectLocked] = useState(true);

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
    if (isAspectLocked && Number.isFinite(width) && width > 0) {
      setHeightDraft(formatDimension(width / ratio));
    }
  };
  const updateHeight = (value: string): void => {
    setDrivingDimension('height');
    setHeightDraft(value);
    const height = Number(value);
    if (isAspectLocked && Number.isFinite(height) && height > 0) {
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
      preserveAspect: isAspectLocked,
    });
    if (result.kind === 'ok') return;
    pushToast(messageForResizeError(result.reason), 'warning');
  };

  return (
    <RegistrationJigArtworkSizeFields
      count={instances.length}
      heightDraft={heightDraft}
      isAspectLocked={isAspectLocked}
      widthDraft={widthDraft}
      onApply={apply}
      onHeightChange={updateHeight}
      onToggleAspect={() => setIsAspectLocked((current) => !current)}
      onWidthChange={updateWidth}
    />
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
  if (reason === 'non-uniform-rotated-selection') {
    return 'Lock AR before resizing rotated jig artwork.';
  }
  return 'Create and copy jig artwork before applying a shared size.';
}
