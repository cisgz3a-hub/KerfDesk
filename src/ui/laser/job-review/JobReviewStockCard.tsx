// CNC "Material & stock" card for the Job Review dialog (ADR-224 v2): the
// project material the feeds were seeded from, the stock footprint, its
// origin offset, and the safe-Z clearance — the physical setup the shown
// toolpaths assume. Live store reads; renders nothing on a laser profile.

import { CHIPLOAD_MATERIALS } from '../../../core/cnc';
import { useStore } from '../../state';
import { formatMm } from './job-review-format';
import {
  stockCardStyle,
  stockItemStyle,
  stockLabelStyle,
  stockValueStyle,
} from './job-review-table.styles';
import { sectionHeadingStyle, sectionStyle } from './job-review.styles';

const NO_PROJECT_MATERIAL = 'Custom (manual feeds)';

export function JobReviewStockCard(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  if (machine?.kind !== 'cnc') return null;
  const { stock, params } = machine;
  const material =
    CHIPLOAD_MATERIALS.find((entry) => entry.value === stock.materialKey)?.label ??
    NO_PROJECT_MATERIAL;
  const items = [
    { label: 'Material', value: material },
    {
      label: 'Stock',
      value: `${formatMm(stock.widthMm)} × ${formatMm(stock.heightMm)} × ${formatMm(stock.thicknessMm)} mm`,
    },
    {
      label: 'Stock origin',
      value: `X ${formatMm(stock.originOffset.x)} · Y ${formatMm(stock.originOffset.y)}`,
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
