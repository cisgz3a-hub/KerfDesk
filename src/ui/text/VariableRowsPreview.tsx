import { useEffect, useMemo, useState } from 'react';
import { IDENTITY_TRANSFORM, type ProjectVariableData, type TextObject } from '../../core/scene';
import {
  advanceVariableSequenceBy,
  evaluateVariableTemplate,
  parseVariableTemplateSource,
} from '../../core/variables';
import { Button } from '../kit';
import { useStore } from '../state';
import { DEFAULT_TEXT_COLOR, findFontEntry, type TextRenderResult } from '../../core/text';
import {
  onTextBoxBaseline,
  textBoxBaseline,
  type TextBoxBaseline,
} from '../../core/text/text-box-render';
import { TextWorkerError } from './text-worker-session';
import { useTextWorkerSession } from './use-text-worker-session';
import type { DialogValues } from './use-text-dialog-fields';
import {
  missingCharacterLabel,
  missingCharacterOutcome,
} from '../../core/text/missing-glyph-words';
import {
  burnsWithoutGlyph,
  recordMissingCharacters,
  useRowMissingCharacters,
} from './use-row-missing-characters';

type Row = {
  readonly index: number;
  readonly serial: number;
  readonly value: string;
  readonly valid: boolean;
};
const PAGE_SIZE = 25;

/** Every record remains reachable; paging bounds font work and DOM size. */
export function VariableRowsPreview(props: {
  readonly source: string;
  readonly variables: ProjectVariableData;
  readonly textValues?: DialogValues;
}): JSX.Element {
  const [opened, setOpened] = useState(false);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const { rows, total, lastPage, activePage, parsed } = useRows(props, page, now);
  return (
    <details
      aria-label="All variable rows preview"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary title="Inspect evaluated text and layout for every data row using the current template, sequence ranges and frozen preview time.">
        Preview all rows ({total})
      </summary>
      <p className="lf-muted">
        Input row and serial are explicit. Template copy offsets and sequence ranges still apply.
        Date/time is frozen at {now.toLocaleString()}.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button
          disabled={activePage === 0}
          title="Previous page of rows."
          onClick={() => setPage(activePage - 1)}
        >
          Previous rows
        </Button>
        <span>
          {activePage * PAGE_SIZE + 1}–{Math.min(total, (activePage + 1) * PAGE_SIZE)} of {total}
        </span>
        <Button
          disabled={activePage === lastPage}
          title="Next page of rows."
          onClick={() => setPage(activePage + 1)}
        >
          Next rows
        </Button>
        <Button
          title="Refresh the frozen date and time for every preview row."
          onClick={() => setNow(new Date())}
        >
          Refresh time
        </Button>
      </div>
      {!parsed.ok ? (
        <p role="alert">{parsed.message}</p>
      ) : (
        <RowsTable rows={rows} text={opened ? props.textValues : undefined} />
      )}
    </details>
  );
}

function RowsTable(props: {
  readonly rows: ReadonlyArray<Row>;
  // The open preview's text, which its rows are laid out and checked against.
  readonly text: DialogValues | undefined;
}): JSX.Element {
  const { rows, text } = props;
  const layouts = useRowLayout(rows, text);
  const missing = useRowMissingCharacters(
    rows.flatMap((row) => (row.valid ? [row.value] : [])),
    text,
  );
  return (
    <div style={{ maxHeight: 240, overflow: 'auto' }}>
      <table aria-label="Evaluated variable rows" style={{ width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th>Input row</th>
            <th>Serial</th>
            <th>Evaluated text</th>
            <th>Layout</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index}>
              <td>{row.index + 1}</td>
              <td>{row.serial}</td>
              <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {row.valid && missing !== null && text !== undefined ? (
                  <BurnedText value={row.value} missing={missing} text={text} />
                ) : (
                  row.value
                )}
              </td>
              <td>
                {row.valid
                  ? rowLayoutText(layouts[row.index], row.value, missing, text?.textStyle)
                  : 'Invalid field'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useRowLayout(
  rows: ReadonlyArray<Row>,
  values: DialogValues | undefined,
): Readonly<Record<number, string>> {
  const [layouts, setLayouts] = useState<Readonly<Record<number, string>>>({});
  const textWorker = useTextWorkerSession();
  useEffect(() => {
    let current = true;
    setLayouts({});
    if (values?.textBox === undefined) {
      setLayouts(
        Object.fromEntries(
          rows.map((row) => [row.index, row.valid ? 'Natural text size' : 'Invalid field']),
        ),
      );
      return () => {
        current = false;
      };
    }
    // Set while a row is being laid out. Only busy work is released when the
    // rows change or the preview closes; an idle worker keeps its parsed font
    // for the next edit (ADR-643, decision 5).
    let busy = false;
    const render = async (): Promise<void> => {
      busy = true;
      const result: Record<number, string> = {};
      const layOut = onTemplateBaseline((input) => textWorker.render(input), values);
      for (const row of rows) {
        if (!current) return;
        if (!row.valid) continue;
        try {
          result[row.index] = rowLayoutLabel((await layOut(row.value)).textBoxLayout);
        } catch (error) {
          result[row.index] = error instanceof Error ? error.message : String(error);
          // A worker that cannot start fails the same way for every later row,
          // and each attempt would start and retire another one.
          if (error instanceof TextWorkerError && error.outcome === 'unavailable') {
            for (const rest of rows) if (rest.valid) result[rest.index] ??= error.message;
            break;
          }
        }
      }
      busy = false;
      if (current) setLayouts(result);
    };
    const timer = window.setTimeout(() => {
      void render();
    }, 100);
    return () => {
      current = false;
      window.clearTimeout(timer);
      if (busy) textWorker.release();
    };
  }, [rows, values, textWorker]);
  return layouts;
}

/** The record as it burns (ADR-591 Amendment 1): a character the font lacks is marked, as ? for a
 *  single-line font and as a box otherwise. */
function BurnedText(props: {
  readonly value: string;
  readonly missing: ReadonlySet<string>;
  readonly text: DialogValues;
}): JSX.Element {
  const singleLine = findFontEntry(props.text.fontKey)?.geometry === 'single-line';
  const title = `Not in this font; ${missingCharacterOutcome(props.text.fontKey)}.`;
  return (
    <>
      {[...props.value].map((character, index) =>
        burnsWithoutGlyph(character, props.missing, props.text.textStyle) ? (
          <span
            key={index}
            role="img"
            aria-label={`${missingCharacterLabel(character)} is not in this font`}
            title={title}
            style={missingGlyphStyle}
          >
            {singleLine ? '?' : '□'}
          </span>
        ) : (
          character
        ),
      )}
    </>
  );
}

function rowLayoutText(
  layout: string | undefined,
  value: string,
  missing: ReadonlySet<string> | null,
  style: DialogValues['textStyle'],
): string {
  const label = layout ?? 'Updating…';
  const lacking = missing === null ? [] : recordMissingCharacters(value, missing, style);
  if (lacking.length === 0) return label;
  return `No ${lacking.map(missingCharacterLabel).join(' ')} in this font · ${label}`;
}

const missingGlyphStyle: React.CSSProperties = { color: 'var(--lf-warning-fg)' };

/**
 * Lays rows out as output burns them: on the template's first baseline, which
 * can carry a tall record over the frame top (ADR-682 Amendment 1). The
 * template is laid out once, before the first row.
 */
function onTemplateBaseline(
  render: (input: DialogValues) => Promise<TextRenderResult>,
  values: DialogValues,
): (content: string) => Promise<TextRenderResult> {
  let template: Promise<TextBoxBaseline | undefined> | undefined;
  return async (content) => {
    template ??= render(values).then(textBoxBaseline, unlessUnavailable);
    const baseline = await template;
    return onTextBoxBaseline(await render({ ...values, content }), baseline, values.textBox);
  };
}

// A template that cannot be laid out leaves each row on the frame's own rule,
// as output does; a worker that cannot start fails every row.
function unlessUnavailable(error: unknown): undefined {
  if (error instanceof TextWorkerError && error.outcome === 'unavailable') throw error;
  return undefined;
}

function rowLayoutLabel(layout: TextRenderResult['textBoxLayout']): string {
  if (layout === undefined) return 'Natural text size';
  const fit = layout.overflow ? 'Overflow' : 'Fits';
  return `${fit} · ${layout.sizeMm.toFixed(2)} mm · ${layout.lineCount} lines`;
}

function previewTextObject(content: string, values: DialogValues | undefined): TextObject {
  const source = values ?? {
    fontKey: 'roboto',
    sizeMm: 10,
    alignment: 'left' as const,
    lineHeight: 1.4,
    letterSpacing: 0,
    color: DEFAULT_TEXT_COLOR,
  };
  return {
    kind: 'text',
    id: 'variable-preview',
    content,
    fontKey: source.fontKey,
    sizeMm: source.sizeMm,
    alignment: source.alignment,
    lineHeight: source.lineHeight,
    letterSpacing: source.letterSpacing,
    color: source.color,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    paths: [],
  };
}

function useRows(
  props: {
    readonly source: string;
    readonly variables: ProjectVariableData;
    readonly textValues?: DialogValues;
  },
  page: number,
  now: Date,
) {
  const project = useStore((state) => state.project);
  const selectedId = useStore((state) => state.selectedObjectId);
  const total = Math.max(1, props.variables.csv?.records.length ?? 1);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const activePage = Math.min(page, lastPage);
  const parsed = useMemo(() => parseVariableTemplateSource(props.source), [props.source]);
  const rows = useMemo(() => {
    if (!parsed.ok) return [];
    const template = {
      ...parsed.template,
      ...(props.textValues?.variableTemplate?.sequenceOffset === undefined
        ? {}
        : { sequenceOffset: props.textValues.variableTemplate.sequenceOffset }),
      ...(props.textValues?.variableTemplate?.ignoreEmptyLines === true
        ? { ignoreEmptyLines: true }
        : {}),
    };
    const object =
      project.scene.objects.find((candidate) => candidate.id === selectedId) ??
      previewTextObject(props.source, props.textValues);
    const staged = { ...project, variables: props.variables };
    return Array.from(
      { length: Math.min(PAGE_SIZE, total - activePage * PAGE_SIZE) },
      (_, offset): Row => {
        const index = activePage * PAGE_SIZE + offset;
        const serial = advanceVariableSequenceBy(props.variables, index).serialValue;
        const evaluated = evaluateVariableTemplate(template, object, staged, {
          now,
          recordIndex: index,
          serialValue: serial,
        });
        return {
          index,
          serial,
          valid: evaluated.ok,
          value: evaluated.ok ? evaluated.value : evaluated.message,
        };
      },
    );
  }, [
    parsed,
    props.source,
    props.variables,
    props.textValues,
    project,
    selectedId,
    total,
    activePage,
    now,
  ]);
  return { rows, total, lastPage, activePage, parsed };
}
