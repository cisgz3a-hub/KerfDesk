import { cncSideProgramName } from '../../core/cnc/cnc-two-sided-setup';
import { useMemo, useRef, useState } from 'react';
import {
  buildCncSetupDocument,
  safeProgramFilename,
  type CncSetupExportMode,
} from '../../io/cnc/cnc-setup-document';
import type { SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { Button } from '../kit';
import type { SaveGcodeCtx } from './file-actions';
import type { PrebuiltGcodeSave } from './transactional-gcode-save';
import { advanceExportVariables } from './advance-export-variables';
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
  const [mode, setMode] = useState<CncSetupExportMode>('single-file');
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const document = useSetupDocument(props, filename, mode);
  if (document === null) return null;
  const save = (): void => {
    if (writing.current || document === null) return;
    if (!currentDocumentArtifact(props)) return;
    writing.current = true;
    setSaving(true);
    // Select one destination in this user gesture; every included program is already prepared.
    void pickSetupDestination(props, filename)
      .then(async (selected) => {
        if (selected === null) return;
        if (!currentDocumentArtifact(props)) return;
        await selected.write(document.html);
        advanceExportVariables(props.ctx);
        props.ctx.pushToast(
          'Saved CNC setup sheet and exact program package to ' + selected.displayName,
          'success',
        );
        props.onSaved();
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
        separateAvailable={(props.artifact.prepared.cncToolPrograms?.length ?? 0) > 0}
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
}): JSX.Element {
  return (
    <>
      <label>
        Output mode{' '}
        <select
          title="Choose one program with manual tool changes or ordered separate-tool files"
          aria-label="Setup sheet output mode"
          value={props.mode}
          disabled={props.saving}
          onChange={(event) =>
            props.setMode(
              event.target.value === 'separate-tools' ? 'separate-tools' : 'single-file',
            )
          }
        >
          <option value="single-file">Single file · manual M0 tool changes</option>
          <option value="separate-tools" disabled={!props.separateAvailable}>
            Ordered separate-tool files
          </option>
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
async function pickSetupDestination(props: Props, filename: string): Promise<SaveTarget | null> {
  return props.ctx.platform.pickFileForSave({
    suggestedName: safeProgramFilename(filename).replace(/\.(gcode|nc)$/i, '.setup.html'),
    extensions: ['.html'],
  });
}
