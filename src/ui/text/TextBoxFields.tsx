import { useEffect, useState } from 'react';
import type { TextBoxSettings } from '../../core/scene/text-box';
import { evaluateNumericEntry } from '../../core/numeric-expression';
import type { TextRenderResult } from '../../core/text';
import { renderTextGeometry } from './render-text-geometry';
import type { DialogFields, DialogValues } from './use-text-dialog-fields';

export function TextBoxFields({ fields }: { readonly fields: DialogFields }): JSX.Element {
  const box = fields.values.textBox;
  return (
    <section aria-label="Text box" style={{ display: 'grid', gap: 8 }}>
      <label>
        <input
          type="checkbox"
          checked={box !== undefined}
          title="Keep an editable text frame. Enabling a box turns off path text and bend."
          onChange={(event) =>
            fields.setTextBox(
              event.currentTarget.checked
                ? {
                    mode: 'fixed',
                    widthMm: 60,
                    heightMm: 30,
                    wrap: true,
                    fit: 'shrink',
                    minSizeMm: 2,
                  }
                : undefined,
            )
          }
        />{' '}
        Text box
      </label>
      {box === undefined ? null : (
        <>
          <TextBoxOptions box={box} setTextBox={fields.setTextBox} />
          <TextBoxPreview values={fields.values} />
          <p className="lf-muted">
            Text that overflows stays visible and remains in output. Increase the box, reduce the
            minimum size or edit the content.
          </p>
        </>
      )}
    </section>
  );
}

function BoxLength(props: {
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
  readonly setValue: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const evaluated = evaluateNumericEntry(draft, { kind: 'length' });
  const valid = evaluated.kind === 'ok' && evaluated.value > 0;
  const commit = (): void => {
    if (evaluated.kind === 'ok' && valid) props.setValue(evaluated.value);
  };
  return (
    <label style={{ display: 'grid', gap: 4, flex: 1 }}>
      {props.label}
      <input
        type="text"
        className="lf-input"
        value={draft}
        aria-label={`Text box ${props.label}`}
        aria-invalid={!valid}
        disabled={props.disabled}
        title="Positive millimetres; arithmetic and units such as 1/2in are accepted."
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDraft(String(props.value));
          }
        }}
      />
    </label>
  );
}

function TextBoxPreview({ values }: { readonly values: DialogValues }): JSX.Element {
  const [preview, setPreview] = useState<TextRenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void renderTextGeometry(values).then(
        (result) => {
          if (current) {
            setPreview(result);
            setError(null);
          }
        },
        (reason: unknown) => {
          if (current) {
            setPreview(null);
            setError(String(reason));
          }
        },
      );
    }, 80);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [values]);
  const layout = preview?.textBoxLayout;
  if (layout === undefined || preview === null)
    return <p role="status">{error ?? 'Updating text frame…'}</p>;
  const { minX, width, height, paths } = previewGeometry(preview, layout);
  return (
    <>
      <svg
        role="img"
        aria-label="Text frame layout preview"
        viewBox={`${minX - 1} -1 ${width + 2} ${height + 2}`}
        style={{ width: '100%', height: 130, background: 'var(--lf-bg-input)' }}
      >
        <rect
          x={0}
          y={0}
          width={layout.widthMm}
          height={layout.heightMm}
          fill="none"
          stroke={layout.overflow ? 'var(--lf-danger)' : 'var(--lf-text-muted)'}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={paths}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p role="status">
        {layout.overflow ? 'Overflow. ' : ''}
        {layout.lineCount} lines · {layout.sizeMm.toFixed(2)} mm font · {layout.widthMm.toFixed(2)}{' '}
        × {layout.heightMm.toFixed(2)} mm frame
      </p>
    </>
  );
}

function TextBoxOptions({
  box,
  setTextBox,
}: {
  readonly box: TextBoxSettings;
  readonly setTextBox: DialogFields['setTextBox'];
}): JSX.Element {
  const patch = (value: Partial<TextBoxSettings>): void => setTextBox({ ...box, ...value });
  return (
    <>
      <label className="lf-field">
        Sizing{' '}
        <select
          aria-label="Text box sizing"
          title="Auto width grows naturally. Auto height wraps to the width. Fixed keeps both dimensions."
          value={box.mode}
          onChange={(event) =>
            patch({ mode: event.currentTarget.value as TextBoxSettings['mode'] })
          }
        >
          <option value="auto-width">Auto width</option>
          <option value="auto-height">Auto height</option>
          <option value="fixed">Fixed width and height</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <BoxLength
          label="Width (mm)"
          value={box.widthMm}
          disabled={box.mode === 'auto-width'}
          setValue={(widthMm) => patch({ widthMm })}
        />
        <BoxLength
          label="Height (mm)"
          value={box.heightMm}
          disabled={box.mode !== 'fixed'}
          setValue={(heightMm) => patch({ heightMm })}
        />
      </div>
      <label>
        <input
          type="checkbox"
          checked={box.wrap}
          disabled={box.mode === 'auto-width'}
          title="Wrap words to the frame width; long words break at character boundaries."
          onChange={(event) => patch({ wrap: event.currentTarget.checked })}
        />{' '}
        Wrap text
      </label>
      <label>
        <input
          type="checkbox"
          checked={box.fit === 'shrink'}
          disabled={box.mode !== 'fixed'}
          title="Reduce the rendered font size uniformly to fit the frame, without enlarging text or clipping output."
          onChange={(event) => patch({ fit: event.currentTarget.checked ? 'shrink' : 'none' })}
        />{' '}
        Shrink to fit
      </label>
      <BoxLength
        label="Minimum font size (mm)"
        value={box.minSizeMm}
        disabled={box.mode !== 'fixed' || box.fit !== 'shrink'}
        setValue={(minSizeMm) => patch({ minSizeMm })}
      />
    </>
  );
}

function previewGeometry(
  preview: TextRenderResult,
  layout: NonNullable<TextRenderResult['textBoxLayout']>,
) {
  const minX = Math.min(0, preview.bounds.minX);
  const width = Math.max(layout.widthMm, preview.bounds.maxX, 1) - minX;
  const height = Math.max(layout.heightMm, preview.bounds.maxY, 1);
  const paths = preview.paths
    .flatMap((path) => path.polylines)
    .map(
      (line) =>
        line.points
          .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
          .join(' ') + (line.closed ? ' Z' : ''),
    )
    .join(' ');
  return { minX, width, height, paths };
}
