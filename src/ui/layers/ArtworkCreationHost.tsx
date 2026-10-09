import { useEffect, useState } from 'react';
import { machineKindOf } from '../../core/scene';
import { Button, Dialog, DialogActions, Icon, type IconName } from '../kit';
import { useStore } from '../state';
import { ConstrainedSketchDialog } from './ConstrainedSketchDialog';
import { PartGeneratorDialog } from './PartGeneratorDialog';
import { CreateEditableReliefWorkflow } from './CreateEditableReliefButton';
import {
  openArtworkCreation,
  useArtworkCreationStore,
  type ArtworkCreationKind,
} from './artwork-creation-store';
import './design-authoring-dialog.css';

export function ArtworkCreationHost(): JSX.Element | null {
  const kind = useArtworkCreationStore((state) => state.kind);
  return kind === null ? null : <CreationSession kind={kind} />;
}
function CreationSession({ kind }: { readonly kind: ArtworkCreationKind }): JSX.Element | null {
  const close = useArtworkCreationStore((state) => state.close);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const [openedEpoch] = useState(epoch);
  useEffect(() => {
    if (epoch !== openedEpoch) close();
  }, [close, epoch, openedEpoch]);
  if (epoch !== openedEpoch) return null;
  if (kind === 'sketch') return <ConstrainedSketchDialog object={undefined} onClose={close} />;
  if (kind === 'part') return <PartGeneratorDialog onClose={close} />;
  if (kind === 'relief') return <CreateEditableReliefWorkflow onClose={close} />;
  return <CreationChooser onClose={close} />;
}
function CreationChooser({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const cnc = useStore((state) => machineKindOf(state.project.machine) === 'cnc');
  const choices: readonly {
    kind: 'sketch' | 'part' | 'relief';
    icon: IconName;
    title: string;
    description: string;
  }[] = [
    {
      kind: 'sketch',
      icon: 'nodes',
      title: 'Constrained sketch',
      description: 'Create an outline with named dimensions and geometric relations.',
    },
    {
      kind: 'part',
      icon: 'square',
      title: 'Parametric part',
      description:
        'Size a panel, bracket, hole grid or fixture and retain its editable dimensions.',
    },
    {
      kind: 'relief',
      icon: 'layers',
      title: 'Editable relief',
      description: 'Build and sculpt a heightfield for CNC carving.',
    },
  ];
  return (
    <Dialog
      title="Create artwork"
      size="md"
      panelClassName="lf-authoring-dialog lf-creation-dialog"
      onClose={onClose}
    >
      <p className="lf-authoring-intro">Choose what to create on the active sheet.</p>
      <div className="lf-creation-choices">
        {choices.map((choice) => (
          <button
            key={choice.kind}
            type="button"
            disabled={choice.kind === 'relief' && !cnc}
            title={
              choice.kind === 'relief' && !cnc
                ? 'Switch to CNC mode to create a relief'
                : choice.description
            }
            onClick={() => openArtworkCreation(choice.kind)}
          >
            <Icon name={choice.icon} size={24} />
            <span>
              <strong>{choice.title}</strong>
              <small>{choice.description}</small>
              {choice.kind === 'relief' && !cnc ? <small>CNC mode required</small> : null}
            </span>
          </button>
        ))}
      </div>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
