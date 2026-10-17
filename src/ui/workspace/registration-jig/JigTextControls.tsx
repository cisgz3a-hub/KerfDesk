import { useLayoutEffect, useRef, useState } from 'react';
import type { Project, TextObject } from '../../../core/scene';
import { DEFAULT_FONT_KEY, DEFAULT_TEXT_SIZE_MM, FONT_REGISTRY } from '../../../core/text';
import { FontPicker } from '../../text/FontPicker';
import { isAdvancedJigText, renderJigText } from './jig-text-object';

type Props = {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly onUpsert: (object: TextObject) => void;
  readonly onBusyChange: (busy: boolean) => void;
};

export function JigTextControls(props: Props): JSX.Element {
  const selected =
    props.selectedIds.size === 1
      ? props.project.scene.objects.find((object) => props.selectedIds.has(object.id))
      : undefined;
  const text = selected?.kind === 'text' ? selected : undefined;
  const selectionKey = [...props.selectedIds].sort().join('\u0000');
  const key = JSON.stringify([selectionKey, text?.content, text?.fontKey, text?.sizeMm]);
  if (text && isAdvancedJigText(text)) {
    return (
      <section aria-label="Jig text">
        <h3>Text</h3>
        <p>
          Use the main text editor to change curved, path, variable or advanced text. You can still
          position it here.
        </p>
      </section>
    );
  }
  return <JigTextForm key={key} {...props} existing={text} />;
}

function useJigTextForm(props: Props & { readonly existing: TextObject | undefined }) {
  const [content, setContent] = useState(props.existing?.content ?? '');
  const [fontKey, setFontKey] = useState(props.existing?.fontKey ?? DEFAULT_FONT_KEY);
  const [size, setSize] = useState(String(props.existing?.sizeMm ?? DEFAULT_TEXT_SIZE_MM));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const live = useRef(false);
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      request.current += 1;
      callbacks.current.onBusyChange(false);
    };
  }, []);
  useLayoutEffect(() => {
    request.current += 1;
    setBusy(false);
    callbacks.current.onBusyChange(false);
  }, [props.project]);
  const sizeMm = Number(size);
  const fontAvailable = hasFont(props.project, fontKey);
  const valid = validText(content, sizeMm, fontAvailable);
  const submit = async (): Promise<void> => {
    if (!valid || busy) return;
    const id = ++request.current;
    setBusy(true);
    setError('');
    props.onBusyChange(true);
    try {
      const object = await renderJigText({
        project: props.project,
        existing: props.existing,
        content,
        fontKey,
        sizeMm,
      });
      if (live.current && id === request.current) callbacks.current.onUpsert(object);
    } catch (cause) {
      if (live.current && id === request.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (live.current && id === request.current) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  };
  return {
    content,
    setContent,
    fontKey,
    setFontKey,
    size,
    setSize,
    busy,
    error,
    fontAvailable,
    valid,
    submit,
  };
}

function hasFont(project: Project, key: string): boolean {
  return (
    FONT_REGISTRY.some((font) => font.key === key) ||
    project.embeddedFonts?.some((font) => font.key === key) === true
  );
}

function validText(content: string, size: number, fontAvailable: boolean): boolean {
  return (
    content.trim() !== '' && Number.isFinite(size) && size >= 1 && size <= 300 && fontAvailable
  );
}

function JigTextForm(props: Props & { readonly existing: TextObject | undefined }): JSX.Element {
  const {
    content,
    setContent,
    fontKey,
    setFontKey,
    size,
    setSize,
    busy,
    error,
    fontAvailable,
    valid,
    submit,
  } = useJigTextForm(props);
  return (
    <section aria-label="Jig text">
      <h3>Text</h3>
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}
      >
        <label>
          Writing
          <textarea
            title="Text to add to the jig"
            className="lf-input"
            aria-label="Jig text content"
            rows={3}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </label>
        <div>
          <span>Writing style</span>
          <FontPicker
            value={fontKey}
            embeddedFonts={props.project.embeddedFonts ?? []}
            onChange={setFontKey}
          />
        </div>
        <label>
          Size (mm)
          <input
            title="Text height in millimetres"
            className="lf-input"
            aria-label="Jig text size"
            type="number"
            min={1}
            max={300}
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </label>
        <button
          title="Add or update this text on the jig canvas"
          type="button"
          className="lf-btn"
          disabled={!valid || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Rendering text…' : props.existing ? 'Update text' : 'Add text'}
        </button>
      </fieldset>
      {!fontAvailable && <p role="status">Choose an available font to replace the missing font.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
