// CncLineArtContoursField — which edge of a traced double-line ring this
// operation machines (ADR-218). A boundary trace (Line Art preset) turns every
// drawn stroke into TWO nested contours one stroke-width apart; cutting both
// re-cuts the same kerf and reads as a phantom second job. Shown for the
// outline cut types + engrave; band-based types (pocket, v-carve, inlay,
// drill) always keep both edges. Only nested pairs tighter than the bit
// diameter are affected, so real ring parts (washers) machine unchanged.

import type { CncLayerSettings, Layer } from '../../core/scene';
import { Row, selectStyle } from './CncLayerPrimitives';

type LineArtContourSide = NonNullable<CncLayerSettings['lineArtContours']>;

const SIDE_OPTIONS: ReadonlyArray<{
  readonly value: LineArtContourSide;
  readonly label: string;
}> = [
  { value: 'inner', label: 'Inner path (traced shape)' },
  { value: 'outer', label: 'Outer path' },
  { value: 'both', label: 'Both paths (double cut)' },
];

export function CncLineArtContoursField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const { cutType } = props.settings;
  const applies =
    cutType === 'profile-outside' ||
    cutType === 'profile-inside' ||
    cutType === 'profile-on-path' ||
    cutType === 'engrave';
  if (!applies) return null;
  return (
    <Row label="Line art">
      <select
        value={props.settings.lineArtContours ?? 'inner'}
        onChange={(e) => props.onCommit({ lineArtContours: e.target.value as LineArtContourSide })}
        aria-label={`Line art contours for ${props.layer.color}`}
        title="Traced line drawings arrive as two nested outlines one stroke-width apart. Cut only the inner one (the drawn shape), only the outer, or both. Applies to nested pairs closer than the bit diameter; anything wider always cuts."
        style={selectStyle}
      >
        {SIDE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Row>
  );
}
