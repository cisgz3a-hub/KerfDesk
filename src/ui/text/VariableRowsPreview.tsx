import { useEffect, useMemo, useState } from 'react';
import { IDENTITY_TRANSFORM, type ProjectVariableData, type TextObject } from '../../core/scene';
import {
  advanceVariableSequenceBy,
  evaluateVariableTemplate,
  parseVariableTemplateSource,
} from '../../core/variables';
import { Button } from '../kit';
import { useStore } from '../state';
import { DEFAULT_TEXT_COLOR } from '../../core/text';
import { renderTextGeometry } from './render-text-geometry';
import type { DialogValues } from './use-text-dialog-fields';

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
  const layouts = useRowLayout(rows, opened ? props.textValues : undefined);
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
                  <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.value}</td>
                  <td>{row.valid ? (layouts[row.index] ?? 'Updating…') : 'Invalid field'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function useRowLayout(
  rows: ReadonlyArray<Row>,
  values: DialogValues | undefined,
): Readonly<Record<number, string>> {
  const [layouts, setLayouts] = useState<Readonly<Record<number, string>>>({});
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
    const render = async (): Promise<void> => {
      const result: Record<number, string> = {};
      for (const row of rows) {
        if (!current) return;
        if (!row.valid) continue;
        try {
          const rendered = await renderTextGeometry({ ...values, content: row.value });
          const layout = rendered.textBoxLayout;
          result[row.index] =
            layout === undefined
              ? 'Natural text size'
              : `${layout.overflow ? 'Overflow' : 'Fits'} · ${layout.sizeMm.toFixed(2)} mm · ${layout.lineCount} lines`;
        } catch (error) {
          result[row.index] = error instanceof Error ? error.message : String(error);
        }
      }
      if (current) setLayouts(result);
    };
    const timer = window.setTimeout(() => {
      void render();
    }, 100);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [rows, values]);
  return layouts;
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
