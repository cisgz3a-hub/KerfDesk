import type { CncLayerSettings, Layer } from '../../core/scene';
import type { CncPocketRestStockSettings } from '../../core/scene/cnc-pocket-rest-stock';
import { RailSection } from '../kit';
import { useStore } from '../state';
import { NumberField } from './CncLayerPrimitives';

type Props = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
};

export function CncPocketStockRestFields(props: Props): JSX.Element | null {
  const { rough, source, canBind, stale, bind } = useStockBinding(props);
  if (props.settings.cutType !== 'pocket' || (rough === undefined && source === undefined))
    return null;
  return (
    <RailSection
      label="Previous-stock rest"
      badge={
        source === undefined
          ? 'Legacy reach model'
          : stale
            ? 'Review source cutter'
            : 'Planned-route stock'
      }
      hint="Finish only residual material predicted from the named larger cutter's generated final-depth routes."
    >
      <label>
        <input
          type="checkbox"
          checked={source !== undefined}
          disabled={source === undefined && !canBind}
          aria-label={`Use planned-route stock for ${props.layer.color}`}
          title="Predict remaining stock from this operation’s roughing routes and finish its residual areas; actual stock is unmeasured."
          onChange={(event) =>
            event.target.checked ? bind() : props.onCommit({ pocketRestStock: undefined })
          }
        />
        Use planned rough-stage stock
      </label>
      {source === undefined ? (
        <p className="lf-cnc-settings-hint">
          Enable to replace ideal cutter reach with conservative sweeps of the selected roughing
          routes.
        </p>
      ) : (
        <BoundStockRows {...props} source={source} stale={stale} canBind={canBind} bind={bind} />
      )}
    </RailSection>
  );
}

function useStockBinding(props: Props) {
  const machine = useStore((state) => state.project.machine);
  const source = props.settings.pocketRestStock;
  const rough =
    machine?.kind === 'cnc'
      ? machine.tools.find((tool) => tool.id === props.settings.pocketRoughToolId)
      : undefined;
  const canBind = rough?.kind === 'end-mill' && rough.diameterMm > 0.004;
  const stale =
    source !== undefined &&
    (source.previousToolId !== rough?.id || source.previousToolDiameterMm !== rough?.diameterMm);
  const bind = (): void => {
    if (!canBind || rough === undefined) return;
    const tolerance = source?.toleranceMm;
    props.onCommit({
      pocketRestStock: {
        kind: 'rough-stage-stock',
        previousToolId: rough.id,
        previousToolDiameterMm: rough.diameterMm,
        toleranceMm:
          tolerance !== undefined && tolerance < rough.diameterMm / 2
            ? tolerance
            : Math.max(0.002, Math.min(0.01, rough.diameterMm / 4)),
      },
    });
  };
  return { rough, source, canBind, stale, bind };
}

function BoundStockRows(
  props: Props & {
    readonly source: CncPocketRestStockSettings;
    readonly stale: boolean;
    readonly canBind: boolean;
    readonly bind: () => void;
  },
): JSX.Element {
  const source = props.source;
  return (
    <>
      <p className="lf-cnc-settings-hint">
        Previous cutter: {source.previousToolId}, Ø{source.previousToolDiameterMm} mm. Source and
        route edits regenerate stock.
      </p>
      {props.stale ? (
        <p role="note">
          The source cutter changed. Output uses a full finishing pocket until you review and rebind
          it.
        </p>
      ) : null}
      <button
        type="button"
        title="Bind the selected roughing cutter’s current ID and diameter, then regenerate predicted stock from its routes."
        disabled={!props.canBind}
        onClick={props.bind}
      >
        Review and bind current roughing cutter
      </button>
      <NumberField
        layer={props.layer}
        label="Stock tolerance"
        unit="mm"
        value={source.toleranceMm}
        min={0.002}
        max={Math.max(0.002, source.previousToolDiameterMm / 2 - 0.001)}
        step={0.002}
        title="Reduce the predicted removed radius by this tolerance, so uncertain stock remains in the finish target. Polygon calculations use a 0.001 mm grid."
        onCommit={(toleranceMm) => props.onCommit({ pocketRestStock: { ...source, toleranceMm } })}
      />
      <p className="lf-cnc-settings-hint">
        2D flat-end-mill stock at the final roughing depth. Entry and link extra clearance is
        excluded. Actual stock is unmeasured. Unsupported entry or adaptive combinations use a
        disclosed full offset-pocket fallback.
      </p>
    </>
  );
}
