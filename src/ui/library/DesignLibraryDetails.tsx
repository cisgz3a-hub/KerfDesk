import { Button } from '../kit';
import { usePlatformOptional } from '../app/platform-context';
import type { LibraryEntry, LibraryOperation } from './design-library-types';
import { LibraryPreview } from './LibraryPreview';

const OPERATION_LABELS: Readonly<Record<LibraryOperation, string>> = {
  line: 'Line',
  fill: 'Fill',
  image: 'Image',
  profile: 'Profile',
  pocket: 'Pocket',
  drill: 'Drill',
  'v-carve': 'V-carve',
  calibration: 'Calibration',
};

export function DesignLibraryDetails(props: {
  readonly entry: LibraryEntry | undefined;
  readonly errorMessage: string | undefined;
  readonly addingId: string | undefined;
  readonly onAdd: (entry: LibraryEntry) => void;
  readonly onReturnToResults: (entry: LibraryEntry) => void;
}): JSX.Element {
  const platform = usePlatformOptional();
  const entry = props.entry;
  if (entry === undefined) {
    return (
      <aside className="lf-library-detail" id="library-detail-panel" aria-label="Design details">
        <div className="lf-library-detail__empty">
          <h3>Choose a design</h3>
          <p>Select a card to inspect its source, license, and suggested uses.</p>
        </div>
      </aside>
    );
  }
  return (
    <aside
      className="lf-library-detail"
      id="library-detail-panel"
      aria-label={`${entry.title} details`}
      tabIndex={-1}
    >
      <ReturnToResultsButton entry={entry} onReturn={props.onReturnToResults} />
      <LibraryPreview key={entry.id} entry={entry} detail />
      <div className="lf-library-detail__content">
        <div>
          <span className="lf-library-detail__eyebrow">{entry.category}</span>
          <h3>{entry.title}</h3>
          <p className="lf-library-detail__subcategory">{entry.subcategory}</p>
        </div>

        <div className="lf-library-detail__badges">
          <span>{entry.kind === 'owned-template' ? 'Editable template' : 'Editable artwork'}</span>
          <span>{machineLabel(entry)}</span>
        </div>

        {props.errorMessage === undefined ? null : (
          <div className="lf-banner lf-banner--danger" role="alert">
            {props.errorMessage}
          </div>
        )}

        <section className="lf-library-detail__section">
          <h4>Suggested uses</h4>
          <div className="lf-library-detail__uses">
            {entry.operations.map((operation) => (
              <span key={operation}>{OPERATION_LABELS[operation]}</span>
            ))}
          </div>
          <p>
            These are browsing suggestions only. Adding a design does not apply power, speed,
            material, tool, depth, or operation settings.
          </p>
        </section>

        <ProvenanceSection entry={entry} linksEnabled={platform?.id !== 'electron'} />
      </div>
      <div className="lf-library-detail__actions">
        <Button
          variant="primary"
          disabled={props.addingId !== undefined}
          aria-busy={props.addingId === entry.id ? 'true' : undefined}
          onClick={() => props.onAdd(entry)}
        >
          {props.addingId === entry.id ? 'Adding to canvas...' : 'Add to canvas'}
        </Button>
      </div>
    </aside>
  );
}

function ProvenanceSection(props: {
  readonly entry: LibraryEntry;
  readonly linksEnabled: boolean;
}): JSX.Element {
  const provenance = props.entry.provenance;
  return (
    <section className="lf-library-detail__section">
      <h4>Source &amp; license</h4>
      <dl className="lf-library-provenance">
        <DetailFact label="Source" value={provenance.sourceName} />
        <DetailFact label="Creator" value={provenance.creator} />
        <DetailFact label="License" value={licenseLabel(props.entry)} />
        <DetailFact label="Version" value={provenance.sourceVersion} />
        <DetailFact label="Source URL" value={provenance.sourceUrl} code />
        <DetailFact label="License URL" value={provenance.licenseUrl} code />
        <DetailFact label="Asset hash" value={provenance.assetHash} code />
      </dl>
      <ProvenanceLinks entry={props.entry} enabled={props.linksEnabled} />
      {provenance.notice === undefined ? null : (
        <p className="lf-library-detail__notice">{provenance.notice}</p>
      )}
    </section>
  );
}

function ReturnToResultsButton(props: {
  readonly entry: LibraryEntry;
  readonly onReturn: (entry: LibraryEntry) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-library-detail__back"
      title="Return focus to the selected design card."
      onClick={() => props.onReturn(props.entry)}
    >
      <span aria-hidden="true">←</span>
      Back to designs
    </button>
  );
}

function DetailFact(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly code?: boolean;
}): JSX.Element | null {
  if (props.value === undefined || props.value.trim() === '') return null;
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.code ? <code>{props.value}</code> : props.value}</dd>
    </>
  );
}

function ProvenanceLinks(props: {
  readonly entry: LibraryEntry;
  readonly enabled: boolean;
}): JSX.Element | null {
  const provenance = props.entry.provenance;
  if (!props.enabled) return null;
  if (provenance.sourceUrl === undefined && provenance.licenseUrl === undefined) return null;
  return (
    <div className="lf-library-detail__links">
      {provenance.sourceUrl === undefined ? null : (
        <a href={provenance.sourceUrl} target="_blank" rel="noreferrer">
          View source
        </a>
      )}
      {provenance.licenseUrl === undefined ? null : (
        <a href={provenance.licenseUrl} target="_blank" rel="noreferrer">
          License terms
        </a>
      )}
    </div>
  );
}

function machineLabel(entry: LibraryEntry): string {
  if (entry.machineModes.length === 2) return 'Laser + CNC';
  return entry.machineModes[0] === 'cnc' ? 'CNC' : 'Laser';
}

function licenseLabel(entry: LibraryEntry): string {
  const provenance = entry.provenance;
  return provenance.license === provenance.licenseId
    ? provenance.license
    : `${provenance.license} (${provenance.licenseId})`;
}
