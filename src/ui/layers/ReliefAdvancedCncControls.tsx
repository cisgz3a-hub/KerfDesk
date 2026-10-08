import type { CncLayerSettings, Layer } from '../../core/scene';
import { useStore } from '../state';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';

type Props = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
};
export function ReliefAdvancedCncControls(props: Props): JSX.Element {
  const supportsProjection =
    props.settings.cutType === 'engrave' || props.settings.cutType === 'profile-on-path';
  return (
    <>
      {props.hasReliefObjects ? <RestFinishingControls {...props} /> : null}
      {supportsProjection ? <ProjectionControls {...props} /> : null}
    </>
  );
}
function RestFinishingControls({
  layer,
  settings,
  onCommit,
  onCommitSettings,
}: Props): JSX.Element {
  const config = useStore((s) => s.project.machine);
  const tools = config?.kind === 'cnc' ? config.tools : [];
  return (
    <section className="lf-cnc-settings-card" aria-label="Relief rest finishing">
      <Row label="Rest cutter">
        <select
          title="Choose a fine rest cutter after the named relief finishing cutter"
          aria-label={`Relief rest cutter for ${layer.color}`}
          value={settings.reliefRestFinishToolId ?? ''}
          style={selectStyle}
          onChange={(event) => {
            const id = event.target.value;
            if (id.length > 0) onCommit({ reliefRestFinishToolId: id });
            else {
              const {
                reliefRestFinishToolId: _tool,
                reliefRestResidualMm: _residual,
                reliefRestScallopMm: _scallop,
                ...rest
              } = settings;
              onCommitSettings(rest);
            }
          }}
        >
          <option value="">Off</option>
          {tools.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {tool.name}
            </option>
          ))}
        </select>
      </Row>
      {settings.reliefRestFinishToolId === undefined ? null : (
        <>
          <p className="lf-cnc-settings-note">
            The selected finishing cutter is the predecessor. The rest cutter follows its emitted
            moves and cuts areas that may retain material. Sampled stock and cutter reach remain
            estimates; uncertain areas stay selected.
          </p>
          {settings.reliefFinishToolId === undefined ? (
            <p role="status">
              Select a predecessor finishing cutter above to prepare rest finishing.
            </p>
          ) : null}
          <NumberField
            layer={layer}
            label="Residual threshold"
            unit="mm"
            value={settings.reliefRestResidualMm ?? 0.05}
            min={0}
            max={10}
            step={0.01}
            title="Select remaining stock above this vertical thickness; conservative cell bounds can include extra material."
            onCommit={(reliefRestResidualMm) => onCommit({ reliefRestResidualMm })}
          />
          <NumberField
            layer={layer}
            label="Rest scallop"
            unit="mm"
            value={settings.reliefRestScallopMm ?? settings.reliefScallopMm ?? 0.05}
            positiveOnly
            step={0.01}
            title="Requested scallop for the rest cutter; use the independent rest cutting stage for its feeds and spindle."
            onCommit={(reliefRestScallopMm) => onCommit({ reliefRestScallopMm })}
          />
        </>
      )}
    </section>
  );
}
function ProjectionControls({ layer, settings, onCommit, onCommitSettings }: Props): JSX.Element {
  const targets = useStore((s) => s.project.scene.objects).filter(
    (o) => o.kind === 'relief' && o.reliefSource.kind === 'heightfield-v1',
  );
  const projection = settings.reliefProjection;
  const setTarget = (id: string): void => {
    if (id.length === 0) {
      const { reliefProjection: _projection, ...rest } = settings;
      onCommitSettings(rest);
    } else
      onCommit({
        reliefProjection: {
          reliefObjectId: id,
          depthMm: projection?.depthMm ?? 0.2,
          depthConvention: 'vertical',
          sampleSpacingMm: projection?.sampleSpacingMm ?? 0.2,
        },
      });
  };
  return (
    <section className="lf-cnc-settings-card" aria-label="Project vectors onto relief">
      <Row label="Project onto">
        <select
          title="Choose the canonical scalar relief surface used for vertical vector projection"
          aria-label={`Projection target for ${layer.color}`}
          value={projection?.reliefObjectId ?? ''}
          style={selectStyle}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">Off</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.kind === 'relief' ? target.source : target.id}
            </option>
          ))}
        </select>
      </Row>
      {projection === undefined ? null : (
        <>
          <p className="lf-cnc-settings-note">
            Prepare the named surface before this operation. Depth is measured vertically below that
            scalar surface. Physical cutter contact can lift the path over steep slopes or excluded
            stock; those locations may not reach the nominal depth.
          </p>
          <NumberField
            layer={layer}
            label="Vertical depth"
            unit="mm"
            value={projection.depthMm}
            positiveOnly
            step={0.05}
            title="Vertical offset below the target surface. The operation's vectors follow this relief instead of a flat depth."
            onCommit={(depthMm) => onCommit({ reliefProjection: { ...projection, depthMm } })}
          />
          <NumberField
            layer={layer}
            label="Surface spacing"
            unit="mm"
            value={projection.sampleSpacingMm}
            positiveOnly
            step={0.05}
            title="Requested CAM sampling spacing. Cutter contact can require finer sampling; preview resolution never replaces it."
            onCommit={(sampleSpacingMm) =>
              onCommit({ reliefProjection: { ...projection, sampleSpacingMm } })
            }
          />
        </>
      )}
    </section>
  );
}
