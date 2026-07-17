// The Operations table of the Job Review dialog (ADR-224): one row per
// output-enabled operation (plus enabled laser sub-operations), with the
// core numbers editable in place. Reads the layers live from the store so a
// keystroke shows immediately; edits commit through the same store actions
// the layer panels use, and the gate's debounced re-prepare keeps the stat
// tiles and G-code truthful.

import { Fragment } from 'react';
import {
  activeCncTool,
  DEFAULT_CNC_LAYER_SETTINGS,
  cutTypeLabel,
  operationArtworkCount,
  type CncMachineConfig,
  type Layer,
  type MachineKind,
} from '../../../core/scene';
import { PanelHeading } from '../../kit';
import { useStore } from '../../state';
import { formatLayerMode } from './job-review-format';
import {
  operationNameCellStyle,
  operationNameTextStyle,
  sectionStyle,
  subOperationNameTextStyle,
  swatchStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  bannerStyle,
} from './job-review.styles';
import { CncRowCells, LaserRowCells } from './JobReviewLayerCells';

const LASER_COLUMNS = ['Operation', 'Mode', 'Power %', 'Speed mm/min', 'Passes', 'Air', 'Artworks'];
const CNC_COLUMNS = [
  'Operation',
  'Cut',
  'Tool',
  'Depth mm',
  'Depth/pass mm',
  'Feed mm/min',
  'Plunge mm/min',
  'RPM',
  'Artworks',
];

export function JobReviewLayersTable(props: { readonly machineKind: MachineKind }): JSX.Element {
  const layers = useStore((s) => s.project.scene.layers);
  const outputLayers = layers.filter((layer) => layer.output);
  return (
    <section aria-label="Operations" style={sectionStyle}>
      <PanelHeading level={3}>Operations</PanelHeading>
      {outputLayers.length === 0 ? (
        <div className="lf-banner lf-banner--info" style={bannerStyle}>
          No operations have Output enabled, so there is nothing to run. Cancel this review and
          enable Output on at least one operation.
        </div>
      ) : props.machineKind === 'cnc' ? (
        <CncLayersTable layers={outputLayers} />
      ) : (
        <LaserLayersTable layers={outputLayers} />
      )}
    </section>
  );
}

function LaserLayersTable(props: { readonly layers: ReadonlyArray<Layer> }): JSX.Element {
  const objects = useStore((s) => s.project.scene.objects);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const updateLayerSubLayer = useStore((s) => s.updateLayerSubLayer);
  return (
    <table style={tableStyle}>
      <TableHeader columns={LASER_COLUMNS} />
      <tbody>
        {props.layers.map((layer) => (
          <Fragment key={layer.id}>
            <tr>
              <OperationNameCell layer={layer} />
              <td style={tableCellStyle}>{formatLayerMode(layer.mode)}</td>
              <LaserRowCells
                ariaContext={layer.name}
                settings={layer}
                maxFeedMmPerMin={maxFeed}
                onCommit={(patch) => setLayerParam(layer.id, patch)}
              />
              <td style={tableCellStyle}>{operationArtworkCount(objects, layer)}</td>
            </tr>
            {layer.subLayers
              .filter((subLayer) => subLayer.enabled)
              .map((subLayer) => (
                <tr key={subLayer.id}>
                  <td style={tableCellStyle}>
                    <span style={subOperationNameTextStyle}>{subLayer.label}</span>
                  </td>
                  <td style={tableCellStyle}>{formatLayerMode(subLayer.settings.mode)}</td>
                  <LaserRowCells
                    ariaContext={`${layer.name} ${subLayer.label}`}
                    settings={subLayer.settings}
                    maxFeedMmPerMin={maxFeed}
                    onCommit={(patch) => updateLayerSubLayer(layer.id, subLayer.id, patch)}
                  />
                  <td style={tableCellStyle}>·</td>
                </tr>
              ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function CncLayersTable(props: { readonly layers: ReadonlyArray<Layer> }): JSX.Element {
  const objects = useStore((s) => s.project.scene.objects);
  const machine = useStore((s) => s.project.machine);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const setLayerParam = useStore((s) => s.setLayerParam);
  if (machine?.kind !== 'cnc') return <p style={{ margin: 0 }}>Machine is not in CNC mode.</p>;
  return (
    <table style={tableStyle}>
      <TableHeader columns={CNC_COLUMNS} />
      <tbody>
        {props.layers.map((layer) => {
          const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
          return (
            <tr key={layer.id}>
              <OperationNameCell layer={layer} />
              <td style={tableCellStyle}>{cutTypeLabel(settings.cutType)}</td>
              <td style={tableCellStyle}>{layerToolName(settings.toolId, machine)}</td>
              <CncRowCells
                ariaContext={layer.name}
                settings={settings}
                maxFeedMmPerMin={maxFeed}
                spindleMaxRpm={machine.params.spindleMaxRpm}
                onCommit={(next) => setLayerParam(layer.id, { cnc: next })}
              />
              <td style={tableCellStyle}>{operationArtworkCount(objects, layer)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TableHeader(props: { readonly columns: ReadonlyArray<string> }): JSX.Element {
  return (
    <thead>
      <tr>
        {props.columns.map((column) => (
          <th key={column} scope="col" style={tableHeaderCellStyle}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function OperationNameCell(props: { readonly layer: Layer }): JSX.Element {
  return (
    <td style={operationNameCellStyle}>
      <span
        aria-hidden="true"
        title={`Operation color ${props.layer.color}`}
        style={{ ...swatchStyle, background: props.layer.color }}
      />
      <span style={operationNameTextStyle}>{props.layer.name}</span>
    </td>
  );
}

function layerToolName(toolId: string | undefined, machine: CncMachineConfig): string {
  const tool = toolId === undefined ? undefined : machine.tools.find((t) => t.id === toolId);
  return (tool ?? activeCncTool(machine)).name;
}
