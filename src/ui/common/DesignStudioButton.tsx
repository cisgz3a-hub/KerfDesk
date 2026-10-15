import { Icon } from '../kit';
import { useDesignStudioStore } from '../design-studio';
import { requestProFeature } from '../licensing/edition';

/** A workspace destination that stays visible when file commands overflow. */
export function DesignStudioButton(): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn lf-toolbar-command lf-toolbar-design-studio"
      aria-label="Open Design Studio"
      title="Design Studio (Pro): draw parts to size with precision tools, snapping and dimensions."
      onClick={() =>
        requestProFeature('design-studio', () => useDesignStudioStore.getState().openStudio())
      }
    >
      <Icon name="shapes" size={18} />
      <span>Design Studio</span>
      <span className="lf-toolbar-pro-badge">Pro</span>
    </button>
  );
}
