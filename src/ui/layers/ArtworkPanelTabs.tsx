import { Icon, type IconName } from '../kit';
import type { CutsLayersView } from '../state/ui-store';

const VIEWS: ReadonlyArray<{
  readonly id: CutsLayersView;
  readonly label: string;
  readonly icon: IconName;
}> = [
  { id: 'layers', label: 'Settings', icon: 'sliders' },
  { id: 'run-order', label: 'Run order', icon: 'layers' },
  { id: 'materials', label: 'Materials', icon: 'square' },
];

export function ArtworkPanelTabs(props: {
  readonly active: CutsLayersView;
  readonly showMaterials: boolean;
  readonly materialsLabel?: string;
  readonly onSelect: (view: CutsLayersView) => void;
}): JSX.Element {
  const views = VIEWS.filter((view) => props.showMaterials || view.id !== 'materials').map(
    (view) =>
      view.id === 'materials' ? { ...view, label: props.materialsLabel ?? view.label } : view,
  );
  return (
    <div role="tablist" aria-label="Artwork panel view" className="lf-artwork-view-tabs">
      {views.map((view, index) => (
        <button
          key={view.id}
          id={`cuts-layers-${view.id}-tab`}
          type="button"
          role="tab"
          aria-controls={`cuts-layers-${view.id}-panel`}
          aria-selected={props.active === view.id}
          tabIndex={props.active === view.id ? 0 : -1}
          title={`Show ${view.label.toLowerCase()}`}
          className="lf-btn lf-btn--ghost lf-artwork-view-tab"
          onClick={() => props.onSelect(view.id)}
          onKeyDown={(event) => {
            const next = nextTabIndex(event.key, index, views.length);
            if (next === null) return;
            event.preventDefault();
            const target = views[next];
            if (target === undefined) return;
            props.onSelect(target.id);
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
            buttons?.[next]?.focus();
          }}
        >
          <Icon name={view.icon} size={15} />
          <span>{view.label}</span>
        </button>
      ))}
    </div>
  );
}

function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current + count - 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
