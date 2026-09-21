import { Icon } from '../kit';

export type ArtworkEditorView = 'operation' | 'artwork';

export function ArtworkEditorTabs(props: {
  readonly id: string;
  readonly active: ArtworkEditorView;
  readonly onSelect: (view: ArtworkEditorView) => void;
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Edit artwork or operation" className="lf-artwork-editor-tabs">
      {(['operation', 'artwork'] as const).map((view) => (
        <button
          key={view}
          id={`${props.id}-${view}-tab`}
          type="button"
          role="tab"
          className="lf-btn lf-btn--ghost"
          aria-selected={view === props.active}
          aria-controls={`${props.id}-${view}-panel`}
          tabIndex={view === props.active ? 0 : -1}
          title={
            view === 'operation'
              ? 'Edit cutting and engraving settings'
              : 'Edit size, shape and artwork adjustments'
          }
          onClick={() => props.onSelect(view)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'operation'
                : event.key === 'End'
                  ? 'artwork'
                  : view === 'operation'
                    ? 'artwork'
                    : 'operation';
            props.onSelect(next);
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
            buttons?.[next === 'operation' ? 0 : 1]?.focus();
          }}
        >
          <Icon name={view === 'operation' ? 'sliders' : 'ruler'} size={14} />
          {view === 'operation' ? 'Operation' : 'Artwork'}
        </button>
      ))}
    </div>
  );
}
