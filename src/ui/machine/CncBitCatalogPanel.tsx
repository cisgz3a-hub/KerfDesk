import { useDeferredValue, useMemo, useState } from 'react';
import { DEFAULT_CNC_TOOLS } from '../../core/scene';
import { useStore } from '../state';
import {
  MODELED_CNC_BIT_CATALOG,
  REFERENCE_CNC_BIT_CATALOG,
  type ModeledCncBitCatalogEntry,
  type ReferenceCncBitCatalogEntry,
} from './cnc-bit-catalog';
import {
  addedStyle,
  catalogListStyle,
  detailsStyle,
  emptyStyle,
  entryNameStyle,
  familyHeadingStyle,
  familyStyle,
  noticeStyle,
  reasonStyle,
  referenceRowStyle,
  rowStyle,
  rowsStyle,
  searchStyle,
  sourceStyle,
  sourceUrlStyle,
  summaryStyle,
} from './CncBitCatalogPanel.styles';

const BUILT_IN_CATALOG_IDS = new Set(
  DEFAULT_CNC_TOOLS.flatMap((tool) => (tool.catalogId === undefined ? [] : [tool.catalogId])),
);

export function CncBitCatalogPanel(): JSX.Element {
  const addCustomCncTool = useStore((state) => state.addCustomCncTool);
  const customTools = useStore((state) => state.cncLibrary.customTools);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const savedCatalogIds = useMemo(
    () =>
      new Set(
        customTools.flatMap((tool) => (tool.catalogId === undefined ? [] : [tool.catalogId])),
      ),
    [customTools],
  );
  const modeled = useMemo(
    () => MODELED_CNC_BIT_CATALOG.filter((entry) => catalogEntryMatches(entry, deferredQuery)),
    [deferredQuery],
  );
  const reference = useMemo(
    () => REFERENCE_CNC_BIT_CATALOG.filter((entry) => catalogEntryMatches(entry, deferredQuery)),
    [deferredQuery],
  );
  const groups = useMemo(() => groupModeledCatalog(modeled), [modeled]);

  return (
    <details style={detailsStyle}>
      <summary
        style={summaryStyle}
        title="Browse researched cutter families and common nominal envelope sizes."
      >
        Add from bit catalog ({MODELED_CNC_BIT_CATALOG.length} modeled envelopes)
      </summary>
      <p style={noticeStyle}>
        Selectable generic entries are operator-matched nominal cutting envelopes that CurveDesk can
        model. A family reference documents the cutter type, not each generated size, shank,
        center-cut or plunge capability, entry strategy, or automatic feed. It supplies flute
        metadata only for an explicitly single/double O-flute family, whose evidenced one/two-flute
        identity is used in feed calculations. Exact-product evidence is labeled separately. Match
        the cutter in hand and verify flute count, feed, and entry strategy before cutting.
        Unsupported families remain reference-only.
      </p>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search size or family"
        aria-label="Search bit catalog"
        title="Filter the bit catalog by size, family, or cutter name."
        style={searchStyle}
      />
      <CatalogResults
        groups={groups}
        reference={reference}
        savedCatalogIds={savedCatalogIds}
        query={query}
        onAdd={(entry) => addCustomCncTool({ ...entry.tool, catalogId: entry.id })}
      />
    </details>
  );
}

type ModeledCatalogGroup = {
  readonly label: string;
  readonly entries: ReadonlyArray<ModeledCncBitCatalogEntry>;
};

function CatalogResults(props: {
  readonly groups: ReadonlyArray<ModeledCatalogGroup>;
  readonly reference: ReadonlyArray<ReferenceCncBitCatalogEntry>;
  readonly savedCatalogIds: ReadonlySet<string>;
  readonly query: string;
  readonly onAdd: (entry: ModeledCncBitCatalogEntry) => void;
}): JSX.Element {
  return (
    <div style={catalogListStyle} aria-label="CNC bit catalog">
      {props.groups.map((group) => (
        <section key={group.label} aria-label={group.label} style={familyStyle}>
          <h4 style={familyHeadingStyle}>{group.label}</h4>
          <ul style={rowsStyle}>
            {group.entries.map((entry) => (
              <ModeledCatalogRow
                key={entry.id}
                entry={entry}
                availability={catalogAvailability(entry.id, props.savedCatalogIds)}
                onAdd={() => props.onAdd(entry)}
              />
            ))}
          </ul>
        </section>
      ))}
      {props.reference.length > 0 ? (
        <section aria-label="Reference-only cutter families" style={familyStyle}>
          <h4 style={familyHeadingStyle}>Reference-only cutter families</h4>
          <ul style={rowsStyle}>
            {props.reference.map((entry) => (
              <ReferenceCatalogRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ) : null}
      {props.groups.length === 0 && props.reference.length === 0 ? (
        <p style={emptyStyle}>No catalog bits match “{props.query.trim()}”.</p>
      ) : null}
    </div>
  );
}

function catalogAvailability(
  catalogId: string,
  savedCatalogIds: ReadonlySet<string>,
): 'available' | 'built-in' | 'saved' {
  if (BUILT_IN_CATALOG_IDS.has(catalogId)) return 'built-in';
  return savedCatalogIds.has(catalogId) ? 'saved' : 'available';
}

function ModeledCatalogRow(props: {
  readonly entry: ModeledCncBitCatalogEntry;
  readonly availability: 'available' | 'built-in' | 'saved';
  readonly onAdd: () => void;
}): JSX.Element {
  const { entry } = props;
  return (
    <li style={rowStyle}>
      <span style={entryNameStyle}>{entry.tool.name}</span>
      {props.availability === 'built-in' ? (
        <span style={addedStyle}>Built in</span>
      ) : props.availability === 'saved' ? (
        <span style={addedStyle}>Saved</span>
      ) : (
        <button
          type="button"
          onClick={props.onAdd}
          aria-label={`Add ${entry.tool.name} from catalog`}
          title="Copy this modeled cutter into the saved custom-bit library."
        >
          Add
        </button>
      )}
      <SourceReference href={entry.sourceUrl} scope={entry.sourceScope} />
    </li>
  );
}

function ReferenceCatalogRow(props: { readonly entry: ReferenceCncBitCatalogEntry }): JSX.Element {
  const { entry } = props;
  return (
    <li style={referenceRowStyle}>
      <span style={entryNameStyle}>{entry.label}</span>
      <span style={reasonStyle}>{entry.reason}</span>
      <SourceReference href={entry.sourceUrl} scope={entry.sourceScope} />
    </li>
  );
}

function SourceReference(props: {
  readonly href: string;
  readonly scope: ModeledCncBitCatalogEntry['sourceScope'];
}): JSX.Element {
  const label =
    props.scope === 'exact-product'
      ? 'Exact product'
      : props.scope === 'representative-product'
        ? 'Example product'
        : 'Family reference';
  return (
    <details style={sourceStyle}>
      <summary title="Show the primary manufacturer source URL.">{label}</summary>
      <code style={sourceUrlStyle}>{props.href}</code>
    </details>
  );
}

function catalogEntryMatches(
  entry: ModeledCncBitCatalogEntry | ReferenceCncBitCatalogEntry,
  query: string,
): boolean {
  if (query === '') return true;
  const text =
    entry.status === 'modeled'
      ? `${entry.familyLabel} ${entry.tool.name}`
      : `${entry.familyLabel} ${entry.label} ${entry.reason}`;
  return text.toLocaleLowerCase().includes(query);
}

function groupModeledCatalog(
  entries: ReadonlyArray<ModeledCncBitCatalogEntry>,
): ReadonlyArray<ModeledCatalogGroup> {
  const groups = new Map<string, ModeledCncBitCatalogEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.familyLabel);
    if (group === undefined) groups.set(entry.familyLabel, [entry]);
    else group.push(entry);
  }
  return [...groups].map(([label, groupedEntries]) => ({ label, entries: groupedEntries }));
}
