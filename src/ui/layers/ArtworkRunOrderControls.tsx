import { canonicalArtworkOrder } from '../../core/artwork-order';
import type { SceneObject } from '../../core/scene';
import { useStore } from '../state';

export function ArtworkRunOrderControls(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly machineKind: 'laser' | 'cnc';
  readonly sharedOperation?: boolean;
}): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const moveSelectedArtwork = useStore((state) => state.moveSelectedArtwork);
  const order = canonicalArtworkOrder(scene);
  const selected = new Set(props.objects.map((object) => object.id));
  const positions = order.flatMap((id, index) => (selected.has(id) ? [index] : []));
  const canMoveEarlier = positions.some(
    (index) => index > 0 && !selected.has(order[index - 1] ?? ''),
  );
  const canMoveLater = positions.some(
    (index) => index < order.length - 1 && !selected.has(order[index + 1] ?? ''),
  );
  return (
    <div style={runOrderStyle}>
      <div style={runOrderHeadingStyle}>
        <strong>Artwork run priority</strong>
        <span>{artworkPositionText(positions, order.length)}</span>
      </div>
      <div style={runOrderButtonsStyle}>
        <OrderButton
          label="First"
          title="Run the selected artwork before all other artwork"
          disabled={!canMoveEarlier}
          onClick={() => moveSelectedArtwork('first')}
        />
        <OrderButton
          label="Earlier"
          title="Move the selected artwork one position earlier"
          disabled={!canMoveEarlier}
          onClick={() => moveSelectedArtwork('earlier')}
        />
        <OrderButton
          label="Later"
          title="Move the selected artwork one position later"
          disabled={!canMoveLater}
          onClick={() => moveSelectedArtwork('later')}
        />
        <OrderButton
          label="Last"
          title="Run the selected artwork after all other artwork"
          disabled={!canMoveLater}
          onClick={() => moveSelectedArtwork('last')}
        />
      </div>
      <p style={runOrderNoteStyle}>
        {props.sharedOperation === true
          ? 'Artwork sharing this operation runs as one machining unit. Make one artwork unique to order it independently.'
          : props.machineKind === 'cnc'
            ? 'CNC keeps clearing before profiles and groups tool changes; this priority is honored inside those safety sections.'
            : 'Laser runs artwork in this order; operations inside each artwork follow operation order.'}
      </p>
    </div>
  );
}

function OrderButton(props: {
  readonly label: string;
  readonly title: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" title={props.title} disabled={props.disabled} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function artworkPositionText(positions: ReadonlyArray<number>, total: number): string {
  if (positions.length === 1) return `Position ${(positions[0] ?? 0) + 1} of ${total}`;
  const display = positions.map((position) => position + 1).join(', ');
  return `${positions.length} selected; positions ${display} of ${total}`;
}

const runOrderStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--lf-border)',
  paddingBottom: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const runOrderHeadingStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12,
};
const runOrderButtonsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 4,
};
const runOrderNoteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
