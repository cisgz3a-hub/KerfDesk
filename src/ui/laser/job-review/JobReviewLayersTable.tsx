// The Artwork settings table of the Job Review dialog (ADR-224 v2): one row
// per output-enabled operation (plus enabled laser sub-operations) with the
// core numbers editable in place, and a muted detail line per row carrying
// the mode-specific settings and the bound material. Reads the layers live
// from the store; edits commit through the same store actions the layer
// panels use, and the gate's debounced re-prepare keeps the stats truthful.

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
import type { MaterialLibraryDocument } from '../../../io/material-library';
import { useStore } from '../../state';
import {
  boundMaterialLabel,
  cncOperationDetail,
  laserOperationDetail,
} from './job-review-detail-facts';
import { formatLayerMode } from './job-review-format';
import {
  subOperationNameTextStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  tableWrapStyle,
} from './job-review-table.styles';
import {
  bannerStyle,
  sectionHeadingStyle,
  sectionHintStyle,
  sectionStyle,
} from './job-review.styles';
import {
  CncRowCells,
  LaserRowCells,
  ModeChipCell,
  OperationDetailRow,
  OperationNameCell,
} from './JobReviewLayerCells';

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
    <section aria-label="Artwork settings" style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>
        Artwork settings
        <span style={sectionHintStyle}>
          core numbers editable — full editors stay in the panels
        </span>
      </h3>
      {outputLayers.length === 0 ? (
        <div className="lf-banner lf-banner--info" style={bannerStyle}>
          No operations have Output enabled, so there is nothing to run. Cancel this review and
          enable Output on at least one operation.
        </div>
      ) : (
        <div style={tableWrapStyle}>
          {props.machineKind === 'cnc' ? (
            <CncLayersTable layers={outputLayers} />
          ) : (
            <LaserLayersTable layers={outputLayers} />
          )}
        </div>
      )}
    </section>
  );
}

function LaserLayersTable(props: { readonly layers: ReadonlyArray<Layer> }): JSX.Element {
  const objects = useStore((s) => s.project.scene.objects);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const materialLibrary = useStore((s) => s.materialLibrary);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const updateLayerSubLayer = useStore((s) => s.updateLayerSubLayer);
  return (
    <table style={tableStyle}>
      <TableHeader columns={LASER_COLUMNS} />
      <tbody>
        {props.layers.map((layer) => (
          <Fragment key={layer.id}>
            <tr>
              <OperationNameCell color={layer.color} name={layer.name} />
              <ModeChipCell label={formatLayerMode(layer.mode)} />
              <LaserRowCells
                ariaContext={layer.name}
                settings={layer}
                maxFeedMmPerMin={maxFeed}
                onCommit={(patch) => setLayerParam(layer.id, patch)}
              />
              <td style={tableCellStyle}>{operationArtworkCount(objects, layer)}</td>
            </tr>
            <OperationDetailRow
              colSpan={LASER_COLUMNS.length}
              chip={materialChip(layer, materialLibrary)}
              text={laserOperationDetail(layer)}
            />
            {layer.subLayers
              .filter((subLayer) => subLayer.enabled)
              .map((subLayer) => (
                <Fragment key={subLayer.id}>
                  <tr>
                    <td style={tableCellStyle}>
                      <span style={subOperationNameTextStyle}>{subLayer.label}</span>
                    </td>
                    <ModeChipCell label={formatLayerMode(subLayer.settings.mode)} />
                    <LaserRowCells
                      ariaContext={`${layer.name} ${subLayer.label}`}
                      settings={subLayer.settings}
                      maxFeedMmPerMin={maxFeed}
                      onCommit={(patch) => updateLayerSubLayer(layer.id, subLayer.id, patch)}
                    />
                    <td style={tableCellStyle}>·</td>
                  </tr>
                  <OperationDetailRow
                    colSpan={LASER_COLUMNS.length}
                    chip={null}
                    text={laserOperationDetail(subLayer.settings)}
                  />
                </Fragment>
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
            <Fragment key={layer.id}>
              <tr>
                <OperationNameCell color={layer.color} name={layer.name} />
                <ModeChipCell label={cutTypeLabel(settings.cutType)} />
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
              <OperationDetailRow
                colSpan={CNC_COLUMNS.length}
                chip={null}
                text={cncOperationDetail(settings)}
              />
            </Fragment>
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

function materialChip(
  layer: Layer,
  library: MaterialLibraryDocument | null,
): { readonly label: string; readonly color: string } | null {
  const label = boundMaterialLabel(layer.materialBinding, library);
  return label === null ? null : { label, color: layer.color };
}

function layerToolName(toolId: string | undefined, machine: CncMachineConfig): string {
  const tool = toolId === undefined ? undefined : machine.tools.find((t) => t.id === toolId);
  return (tool ?? activeCncTool(machine)).name;
}
