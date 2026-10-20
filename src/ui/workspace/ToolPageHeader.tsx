// ToolPageHeader — the header of a full page (ADR-641, ADR-636). The
// Registration jig and Place Board pages replace the whole workspace except the
// docked machine panel, so this header stands in for the bars that are gone:
// Done (back to the workspace as it was), the page's title and tutorial, its
// steps, Undo/Redo for the project, and the machine connection, which otherwise
// lives on the workspace's top bar.
import { usePlatformOptional } from '../app/platform-context';
import { Button, Icon } from '../kit';
import { shortcutLabel } from '../common/shortcut-label';
import { MachineConnectionToolbar } from '../laser/MachineConnectionToolbar';
import { useStore } from '../state';
import { TutorialButton } from '../tutorials/TutorialButton';

export type ToolPageStep<Id extends string> = {
  readonly id: Id;
  readonly label: string;
  readonly title: string;
};

export function ToolPageHeader<Id extends string>(props: {
  readonly title: string;
  readonly tutorialId: string;
  readonly steps: ReadonlyArray<ToolPageStep<Id>>;
  readonly stepsLabel: string;
  readonly step: Id;
  readonly onStep: (step: Id) => void;
  readonly doneDisabled?: boolean;
  readonly doneTitle: string;
  readonly onDone: () => void;
}): JSX.Element {
  return (
    <header className="lf-jig-header lf-tool-page-header">
      <div className="lf-tool-page-lead">
        <Button
          variant="primary"
          disabled={props.doneDisabled}
          title={props.doneTitle}
          onClick={props.onDone}
        >
          <Icon name="arrow-left" size={16} />
          Done
        </Button>
        <h1 className="lf-tool-page-title">{props.title}</h1>
        <TutorialButton tutorialId={props.tutorialId} compact label={props.title} />
      </div>
      <ToolPageSteps
        label={props.stepsLabel}
        steps={props.steps}
        step={props.step}
        onStep={props.onStep}
      />
      <div className="lf-tool-page-tools">
        <ToolPageHistory />
        <PageMachineConnection />
      </div>
    </header>
  );
}

// The workspace's own Connect, machine picker and safety notice. Connecting
// needs the app's platform, so a page rendered on its own (a test, the
// registration audit fixture) has no connection to show.
function PageMachineConnection(): JSX.Element | null {
  return usePlatformOptional() === null ? null : <MachineConnectionToolbar />;
}

function ToolPageSteps<Id extends string>(props: {
  readonly label: string;
  readonly steps: ReadonlyArray<ToolPageStep<Id>>;
  readonly step: Id;
  readonly onStep: (step: Id) => void;
}): JSX.Element {
  return (
    <div className="lf-jig-tabs lf-tool-page-steps" role="group" aria-label={props.label}>
      {props.steps.map((entry) => (
        <Button
          key={entry.id}
          pressed={props.step === entry.id}
          aria-current={props.step === entry.id ? 'step' : undefined}
          title={entry.title}
          onClick={() => props.onStep(entry.id)}
        >
          {entry.label}
        </Button>
      ))}
    </div>
  );
}

// The project's own Undo and Redo, as on the menu bar (ADR-348): every page
// edit is one ordinary undoable project edit.
function ToolPageHistory(): JSX.Element {
  const canUndo = useStore((state) => state.undoStack.length > 0);
  const canRedo = useStore((state) => state.redoStack.length > 0);
  return (
    <div role="group" aria-label="Edit history" className="lf-menu-history">
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-menu-history-button"
        aria-label="Undo"
        title={canUndo ? `Undo last edit (${shortcutLabel('Ctrl+Z')})` : 'Nothing to undo.'}
        disabled={!canUndo}
        onClick={() => useStore.getState().undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-menu-history-button"
        aria-label="Redo"
        title={
          canRedo ? `Redo last undone edit (${shortcutLabel('Ctrl+Shift+Z')})` : 'Nothing to redo.'
        }
        disabled={!canRedo}
        onClick={() => useStore.getState().redo()}
      >
        <Icon name="redo" />
      </button>
    </div>
  );
}
