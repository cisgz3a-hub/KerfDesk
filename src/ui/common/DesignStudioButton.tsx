import { Icon } from '../kit';
import { useDesignStudioStore } from '../design-studio';
import { requestProFeature, useEdition } from '../licensing/edition';

/** A workspace destination that stays visible when file commands overflow. */
export function DesignStudioButton(): JSX.Element {
  // Like the other Pro commands, it is labelled Pro only where Pro is locked.
  const locked = !useEdition().pro;
  return (
    <button
      type="button"
      className="lf-btn lf-toolbar-command lf-toolbar-design-studio"
      aria-label="Open Design Studio"
      title={`Design Studio${locked ? ' (Pro)' : ''}: draw parts to size with precision tools, snapping and dimensions.`}
      onClick={() =>
        requestProFeature('design-studio', () => useDesignStudioStore.getState().openStudio())
      }
    >
      <Icon name="shapes" size={18} />
      <span>Design Studio</span>
      {locked ? <span className="lf-toolbar-pro-badge">Pro</span> : null}
    </button>
  );
}
