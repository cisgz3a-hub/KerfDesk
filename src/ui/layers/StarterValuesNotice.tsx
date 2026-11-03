// ADR-500 Amendment 1 decision 5 (UX audit U3-P2-1): an operation still on the
// app's starter power, speed and passes says so where they are set, with the
// "starter values … material test" words Job Review's warning uses, and opens
// Tools → Material Test. A linked material recipe is a choice, so it is quiet.
import { LAYER_DEFAULTS, type Layer } from '../../core/scene';
import { useUiStore } from '../state/ui-store';

export function usesStarterValues(
  layer: Pick<Layer, 'power' | 'speed' | 'passes' | 'materialBinding'>,
): boolean {
  return (
    layer.materialBinding === undefined &&
    layer.power === LAYER_DEFAULTS.power &&
    layer.speed === LAYER_DEFAULTS.speed &&
    layer.passes === LAYER_DEFAULTS.passes
  );
}

export function StarterValuesNotice(): JSX.Element {
  return (
    <p className="lf-laser-help lf-laser-notice">
      <strong>Starter values, not a recipe.</strong> Choose power and speed from your material's
      settings or your laser's manual, or run a{' '}
      <button
        type="button"
        className="lf-laser-link-button"
        title="Open Tools → Material Test: burn a grid of power and speed on scrap"
        onClick={() => useUiStore.getState().openMaterialTestDialog()}
      >
        Material Test
      </button>{' '}
      on scrap first.
    </p>
  );
}
