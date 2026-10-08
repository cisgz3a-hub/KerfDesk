import type { CncMachineConfig, Project } from '../../../core/scene';
// CNC "Material & stock" card for the Job Review dialog (ADR-224 v2): the
// project material the feeds were seeded from, the stock footprint, its
// origin offset, and the safe-Z clearance — the physical setup the shown
// toolpaths assume. Live store reads; renders nothing on a laser profile.

import { CHIPLOAD_MATERIALS } from '../../../core/cnc';
import { MANUAL_FEEDS_LABEL } from '../../common/cnc-material-vocabulary';
import { useStore } from '../../state';
import { formatMm } from './job-review-format';
import {
  stockCardStyle,
  stockItemStyle,
  stockLabelStyle,
  stockValueStyle,
} from './job-review-table.styles';
import { sectionHeadingStyle, sectionStyle } from './job-review.styles';

const NO_PROJECT_MATERIAL = MANUAL_FEEDS_LABEL;

export function JobReviewStockCard(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const setup = useStore((s) => s.project.cncSetup);
  if (machine?.kind !== 'cnc') return null;
  const { stock, params } = machine;
  const stockOrigin = activeStockOrigin(machine, setup);
  const material =
    CHIPLOAD_MATERIALS.find((entry) => entry.value === stock.materialKey)?.label ??
    NO_PROJECT_MATERIAL;
  const items = [
    { label: 'Setup', value: setup?.name ?? 'Setup 1' },
    { label: 'Datum', value: 'G54 · stock top Z0' },
    { label: 'Fixtures', value: String(setup?.fixtures.length ?? 0) },
    ...(setup?.twoSided === undefined
      ? []
      : [
          {
            label: 'Side',
            value:
              setup.twoSided.activeSide + ' · flip around ' + setup.twoSided.flipAxis.toUpperCase(),
          },
        ]),
    { label: 'Material', value: material },
    {
      label: 'Stock',
      value: `${formatMm(stock.widthMm)} × ${formatMm(stock.heightMm)} × ${formatMm(stock.thicknessMm)} mm`,
    },
    {
      label: 'Stock origin',
      value: `X ${formatMm(stockOrigin.x)} · Y ${formatMm(stockOrigin.y)}`,
    },
    { label: 'Safe Z', value: `${formatMm(params.safeZMm)} mm above stock` },
  ];
  return (
    <section aria-label="Material and stock" style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>Material &amp; stock</h3>
      <div style={stockCardStyle}>
        {items.map((item) => (
          <div key={item.label} style={stockItemStyle}>
            <span style={stockLabelStyle}>{item.label}</span>
            <span style={stockValueStyle}>{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function activeStockOrigin(machine: CncMachineConfig, setup: Project['cncSetup']) {
  return setup?.twoSided?.activeSide === 'B'
    ? setup.twoSided.sideBStockOriginMm
    : machine.stock.originOffset;
}
