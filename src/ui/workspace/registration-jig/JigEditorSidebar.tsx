import { Button } from '../../kit';
import { JigSelectionFields } from './JigSelectionFields';
import { JigArtworkSettings } from './JigArtworkSettings';
import { JigArtworkStep } from './JigArtworkStep';
import { JigBurnPanel } from './JigBurnPanel';
import { JigOutlinesStep } from './JigOutlinesStep';
import { changeJigDraft } from './jig-editor-session';
import type { JigEditorController, JigStep } from './use-jig-editor';

const STEPS: ReadonlyArray<{
  readonly id: JigStep;
  readonly label: string;
  readonly title: string;
}> = [
  {
    id: 'outlines',
    label: '1 Burn outlines',
    title: 'Lay out the outlines and burn them on the empty base',
  },
  {
    id: 'artwork',
    label: '2 Place pieces & artwork',
    title: 'Put the pieces in the burned outlines and add the artwork for them',
  },
  {
    id: 'burn-artwork',
    label: '3 Burn artwork',
    title: 'Check the artwork laser settings and burn the artwork on the pieces',
  },
];

/**
 * The three steps of a jig job (ADR-634). Each step stays mounted while hidden,
 * so half-typed layout fields or a loaded trace survive a look at another step.
 * Editing pauses while the machine runs; Frame and Start stay in reach.
 */
export function JigEditorSidebar({
  editor,
}: {
  readonly editor: JigEditorController;
}): JSX.Element {
  const project = editor.session.draft.project;
  const step = editor.step;
  return (
    <aside className="lf-jig-sidebar">
      <JigStepTabs editor={editor} />
      {editor.readOnly && (
        <p className="lf-jig-notice" role="status">
          Editing is paused while the machine runs.
        </p>
      )}
      <section className="lf-jig-fields" aria-label="Burn outlines" hidden={step !== 'outlines'}>
        <fieldset className="lf-jig-edit" disabled={editor.readOnly}>
          <JigOutlinesStep editor={editor} />
        </fieldset>
        <JigBurnPanel editor={editor} run="outlines" />
      </section>
      <section
        className="lf-jig-fields"
        aria-label="Place pieces and artwork"
        hidden={step !== 'artwork'}
      >
        <fieldset className="lf-jig-edit" disabled={editor.readOnly}>
          <JigArtworkStep editor={editor} />
        </fieldset>
      </section>
      <section className="lf-jig-fields" aria-label="Burn artwork" hidden={step !== 'burn-artwork'}>
        <fieldset className="lf-jig-edit" disabled={editor.readOnly}>
          <JigArtworkSettings
            draft={editor.session.draft}
            onChange={(draft) => editor.setSession((current) => changeJigDraft(current, draft))}
          />
        </fieldset>
        <JigBurnPanel editor={editor} run="artwork" />
      </section>
      {step !== 'burn-artwork' && (
        <fieldset className="lf-jig-edit" disabled={editor.readOnly}>
          <JigSelectionFields
            project={project}
            selectedIds={editor.ids}
            onCommit={editor.onCommit}
          />
        </fieldset>
      )}
    </aside>
  );
}

function JigStepTabs({ editor }: { readonly editor: JigEditorController }): JSX.Element {
  return (
    <div className="lf-jig-tabs" role="group" aria-label="Jig steps">
      {STEPS.map((step) => {
        const pending = step.id === 'outlines' && editor.pendingLayout;
        return (
          <Button
            key={step.id}
            pressed={editor.step === step.id}
            title={pending ? 'The layout has field changes that are not applied yet' : step.title}
            onClick={() => editor.setStep(step.id)}
          >
            {pending ? `${step.label} •` : step.label}
          </Button>
        );
      })}
    </div>
  );
}
