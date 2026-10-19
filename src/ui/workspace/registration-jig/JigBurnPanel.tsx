import { Button } from '../../kit';
import { WorkspaceJobActions } from '../../laser/WorkspaceJobActions';
import { useStore } from '../../state';
import type { JigEditorController } from './use-jig-editor';

type JigRun = 'outlines' | 'artwork';

/**
 * Frame and Start for one of the two jig runs (ADR-638). They are the
 * workspace's own job actions, mounted here instead of under the machine panel
 * while jig mode is open, so there is still one Frame and one Start. They only
 * appear in the step whose run is next, so a step can never burn the other
 * run by mistake.
 */
export function JigBurnPanel(props: {
  readonly editor: JigEditorController;
  readonly run: JigRun;
}): JSX.Element {
  const { editor, run } = props;
  const phase = editor.runPhase;
  const label = run === 'outlines' ? 'Burn the outlines' : 'Burn the artwork';
  return (
    <section className="lf-jig-burn" aria-label={label}>
      <strong>{label}</strong>
      {phase === run ? <JigReadyToBurn editor={editor} run={run} /> : <JigRunSwitch {...props} />}
    </section>
  );
}

function JigReadyToBurn(props: {
  readonly editor: JigEditorController;
  readonly run: JigRun;
}): JSX.Element {
  if (props.run === 'outlines' && props.editor.pendingLayout) {
    return (
      <p className="lf-jig-muted" role="status">
        Apply layout first, so Frame and Start burn the outlines you see.
      </p>
    );
  }
  return (
    <>
      <p className="lf-jig-muted">
        {props.run === 'outlines'
          ? 'Leave the base empty. Frame, then Start. When the run finishes cleanly, the jig moves on to placing the pieces.'
          : 'Pieces in place and focused on their top surface. Keep the base and work origin where the outlines were burned. Frame, then Start.'}
      </p>
      <WorkspaceJobActions />
    </>
  );
}

// The step's run is not the next one: say which run is, and offer the one
// explicit switch that makes this step's run next.
function JigRunSwitch(props: {
  readonly editor: JigEditorController;
  readonly run: JigRun;
}): JSX.Element {
  const { editor, run } = props;
  const setOutput = useStore((state) => state.setRegistrationOutput);
  const phase = editor.runPhase;
  if (phase === 'none') return <p className="lf-jig-muted">Add an outline in step 1 first.</p>;
  const switchTo = (): void => setOutput(run === 'outlines' ? 'box' : 'artwork');
  if (phase === 'both') {
    return (
      <>
        <p className="lf-jig-muted" role="status">
          The outlines and the artwork are both set to burn in one run, which would burn the
          outlines over the pieces.
        </p>
        <Button
          disabled={editor.readOnly}
          title={`Set the next run to ${run === 'outlines' ? 'the outlines' : 'the artwork'} only`}
          onClick={switchTo}
        >
          {run === 'outlines' ? 'Burn only the outlines' : 'Burn only the artwork'}
        </Button>
      </>
    );
  }
  if (run === 'outlines') {
    return (
      <>
        <p className="lf-jig-muted">
          The outlines are marked as burned, so Frame and Start now burn the artwork in step 3.
        </p>
        <Button
          disabled={editor.readOnly}
          title="Make the outlines the next run again, for example to burn them on a new base"
          onClick={switchTo}
        >
          Burn outlines again
        </Button>
      </>
    );
  }
  return (
    <>
      <p className="lf-jig-muted">
        Burn the outlines in step 1 first. When that run finishes cleanly, the artwork becomes the
        next run.
      </p>
      <Button title="Go to step 1 to burn the outlines" onClick={() => editor.setStep('outlines')}>
        Go to step 1
      </Button>
      <Button
        variant="ghost"
        disabled={editor.readOnly}
        title="The outlines on the base are already burned: make the artwork the next run"
        onClick={switchTo}
      >
        Outlines are already burned
      </Button>
    </>
  );
}
