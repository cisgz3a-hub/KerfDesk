// LightBurn text options: Bold, Italic, Upper case, right-to-left, Max width
// (squeeze) and an undistorted bend. Unset options are left out of the saved
// text, so plain text stays as it was.

import type { TextStyle } from '../../core/scene/text-settings';

type Flag = 'bold' | 'italic' | 'uppercase' | 'forceRtl' | 'bendUndistorted';

const FLAGS: ReadonlyArray<readonly [Flag, string, string]> = [
  ['bold', 'Bold', 'Thicken every letter outline (outline fonts).'],
  ['italic', 'Italic', 'Slant the letters 12 degrees.'],
  ['uppercase', 'Upper case', 'Engrave the text in capitals; the typed text is kept.'],
  ['forceRtl', 'Right-to-left', 'Lay every line out right to left.'],
  [
    'bendUndistorted',
    "Don't distort when bent",
    'Bend moves whole letters onto the arc instead of bending them.',
  ],
];

export function TextStyleFields(props: {
  readonly style: TextStyle | undefined;
  readonly setStyle: (style: TextStyle | undefined) => void;
}): JSX.Element {
  const style = props.style ?? {};
  const update = (patch: Partial<TextStyle>): void => {
    const next: Record<string, boolean | number> = {};
    for (const [key, value] of Object.entries({ ...style, ...patch })) {
      if (value === true || (typeof value === 'number' && value > 0)) next[key] = value;
    }
    props.setStyle(Object.keys(next).length === 0 ? undefined : (next as TextStyle));
  };
  return (
    <fieldset style={{ display: 'flex', flexWrap: 'wrap', gap: 10, border: 0, padding: 0 }}>
      <legend className="lf-field-label lf-field-label--sm">Style</legend>
      {FLAGS.map(([key, label, title]) => (
        <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            title={title}
            checked={style[key] === true}
            onChange={(event) => update({ [key]: event.currentTarget.checked })}
          />
          {label}
        </label>
      ))}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Max width
        <input
          className="lf-input"
          type="number"
          min="0"
          step="0.5"
          style={{ width: 72 }}
          title="Squeeze wider text to this width, keeping its height. 0 for no limit."
          aria-label="Maximum text width in millimetres"
          value={style.maxWidthMm ?? 0}
          onChange={(event) => update({ maxWidthMm: Number(event.currentTarget.value) || 0 })}
        />
        mm
      </label>
    </fieldset>
  );
}
