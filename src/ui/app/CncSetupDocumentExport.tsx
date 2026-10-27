import { cncSideProgramName } from '../../core/cnc/cnc-two-sided-setup';
import { useMemo, useRef, useState } from 'react';
import {
  buildCncSetupDocument,
  defaultCncSetupExportMode,
  safeProgramFilename,
  type CncSetupExportMode,
} from '../../io/cnc/cnc-setup-document';
import type { SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { Button } from '../kit';
import type { SaveGcodeCtx } from './file-actions';
import type { PrebuiltGcodeSave } from './transactional-gcode-save';
import { advanceExportVariables } from './advance-export-variables';
import {
  cncExportOtherControllersNote,
  cncProjectExportAdvisories,
} from './cnc-export-controller-advisory';
import { suggestedGcodeName } from './file-action-formatters';

type Props = {
  readonly artifact: PrebuiltGcodeSave;
  readonly ctx: SaveGcodeCtx;
  readonly onSaved: () => void;
};
export function CncSetupDocumentExport(props: Props): JSX.Element | null {
  const [filename, setFilename] = useState(() =>
    cncSideProgramName(suggestedGcodeName(props.ctx.savedName), props.artifact.project),
  );
  const prepared = props.artifact.prepared;
  // A multi-bit job opens on one file per bit (ADR-392 Amendment 3, CNC audit v1 F8-P2-1).
  const [chosenMode, setMode] = useState<CncSetupExportMode>(() =>
    defaultCncSetupExportMode(prepared.cncProgramFacts, prepared.cncToolPrograms),
  );
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const separateAvailable = (prepared.cncToolPrograms?.length ?? 0) > 0;
  // A later artifact without tool programs cannot keep a separate-tool choice.
  const mode = separateAvailable ? chosenMode : 'single-file';
  const document = useSetupDocument(props, filename, mode);
  if (document === null) return null;
  const save = (): void => {
    if (writing.current || document === null) return;
    if (!currentDocumentArtifact(props)) return;
    writing.current = true;
    setSaving(true);
    // As Save as states it on each attempt: the programs are GRBL-only (ADR-399 Amendment 1).
    for (const advisory of cncProjectExportAdvisories(props.artifact.project)) {
      props.ctx.pushToast(advisory, 'warning');
    }
    // Select one destination in this user gesture; every included program is already prepared.
    void pickSetupDestination(props, filename)
      .then(async (selected) => {
        if (selected !== null) await writeSetupPackage(props, selected, document.html);
      })
      .catch((error: unknown) => {
        props.ctx.pushToast(
          'Could not save CNC setup sheet: ' +
            (error instanceof Error ? error.message : String(error)),
          'error',
        );
      })
      .finally(() => {
        writing.current = false;
        setSaving(false);
      });
  };
  return (
    <section aria-label="CNC setup documentation">
      <p>
        One printable offline setup package contains the exact programs and matching manifest. Open
        the HTML to download the selected programs or print the setup.
      </p>
      <CncSetupOutputOptions
        filename={filename}
        setFilename={setFilename}
        mode={mode}
        setMode={setMode}
        saving={saving}
        separateAvailable={separateAvailable}
        severalBits={(prepared.cncProgramFacts?.toolPlan.length ?? 0) > 1}
      />
      <Button onClick={save} disabled={saving}>
        Save setup sheet + program…
      </Button>
    </section>
  );
}

function CncSetupOutputOptions(props: {
  readonly filename: string;
  readonly setFilename: (filename: string) => void;
  readonly mode: CncSetupExportMode;
  readonly setMode: (mode: CncSetupExportMode) => void;
  readonly saving: boolean;
  readonly separateAvailable: boolean;
  readonly severalBits: boolean;
}): JSX.Element {
  return (
    <>
      <label>
        Output mode{' '}
        <select
          title="Choose ordered files, one per bit, or one program that stops at an M0 for each bit change"
          aria-label="Setup sheet output mode"
          value={props.mode}
          disabled={props.saving}
          onChange={(event) =>
            props.setMode(
              event.target.value === 'separate-tools' ? 'separate-tools' : 'single-file',
            )
          }
        >
          <option value="separate-tools" disabled={!props.separateAvailable}>
            One file per bit · ordered separate-tool files
          </option>
          <option value="single-file">Single file · M0 bit changes</option>
        </select>
      </label>
      <label>
        Program filename{' '}
        <input
          title="Set the program filename recorded on the CNC setup sheet"
          aria-label="Setup sheet program filename"
          maxLength={160}
          value={props.filename}
          onChange={(event) => props.setFilename(event.target.value)}
          disabled={props.saving}
        />
      </label>
      {props.mode === 'separate-tools' && (
        <p>
          Load files in order. Before each file, load its listed cutter and touch off Z on stock top
          while retaining G54 XY zero. Returning to the same cutter is a separate ordered file. All
          downloads are included in this one HTML save.
        </p>
      )}
      {props.mode === 'single-file' && props.severalBits && (
        <p role="note">
          This one file stops at an M0 for each bit change. A controller held at an M0 takes no jog
          or Zero Z, and the next bit&apos;s spindle start and plunge are already sent, so cycle
          start would cut at the old bit&apos;s Z zero. Change bits at those stops only by starting
          the job from this project, or in a sender that holds at the M0 itself, as gSender does.
          Run G-code file sends the M0: choose one file per bit for it.
        </p>
      )}
    </>
  );
}

function useSetupDocument(props: Props, filename: string, mode: CncSetupExportMode) {
  return useMemo(() => {
    const facts = props.artifact.prepared.cncProgramFacts;
    if (facts === undefined || props.artifact.project.machine?.kind !== 'cnc') return null;
    return buildCncSetupDocument({
      project: props.artifact.project,
      facts,
      gcode: props.artifact.prepared.gcode,
      programFilename: filename,
      exportMode: mode,
      ...(props.artifact.prepared.cncToolPrograms === undefined
        ? {}
        : {
            cncToolPrograms: props.artifact.prepared.cncToolPrograms,
          }),
      ...(props.artifact.prepared.placement === undefined
        ? {}
        : { jobOriginOffset: props.artifact.prepared.placement.jobOriginOffset }),
      placementLabel:
        (props.ctx.jobPlacement?.startFrom ?? props.artifact.project.jobSetup.placement.startFrom) +
        ' · ' +
        (props.ctx.jobPlacement?.anchor ?? props.artifact.project.jobSetup.placement.anchor),
      warnings: [
        ...props.artifact.prepared.advisories.map((issue) => issue.message),
        ...props.artifact.prepared.machineWarnings,
        // The printed sheet goes to the machine with the programs (ADR-399 Amendment 1).
        ...cncProjectExportAdvisories(props.artifact.project),
      ],
      generatedAtIso: new Date().toISOString(),
    });
  }, [filename, mode, props.artifact, props.ctx]);
}
function currentDocumentArtifact(props: Props): boolean {
  if (useStore.getState().project === props.artifact.project) return true;
  props.ctx.pushToast(
    'The project changed. Reopen Save G-code to prepare a current setup sheet.',
    'warning',
  );
  return false;
}

export const SETUP_PACKAGE_SAVED_BEFORE_CHANGE =
  'Saved the setup package from before the project changed. Reopen Save G-code to include the change.';

// The picker has already emptied the chosen file, so a project change while it
// was open no longer cancels the write: the file gets the package the operator
// clicked Save for, and says so (ADR-656 Amendment 1, rolling audit v4 H3-P3-2).
async function writeSetupPackage(props: Props, selected: SaveTarget, html: string): Promise<void> {
  await selected.write(html);
  advanceExportVariables(props.ctx);
  props.ctx.pushToast(
    'Saved CNC setup sheet and exact program package to ' + selected.displayName,
    'success',
  );
  if (useStore.getState().project !== props.artifact.project) {
    props.ctx.pushToast(SETUP_PACKAGE_SAVED_BEFORE_CHANGE, 'warning');
  }
  // As after Save as: no controller confirmed the GRBL profile this session.
  const note = cncExportOtherControllersNote(
    props.artifact.project.device,
    props.ctx.controllerSettings,
  );
  if (note !== null) props.ctx.pushToast(note, 'info');
  props.onSaved();
}
async function pickSetupDestination(props: Props, filename: string): Promise<SaveTarget | null> {
  return props.ctx.platform.pickFileForSave({
    suggestedName: safeProgramFilename(filename).replace(/\.(gcode|nc)$/i, '.setup.html'),
    extensions: ['.html'],
  });
}
