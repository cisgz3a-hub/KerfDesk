// How to read the grid and stay safe while it burns, under the Material Test
// preview (UX audit U8-P3-2, after LightBurn's "First material test"). A Cut
// test still on the engraving ranges is offered cut starting ranges.

import { Button } from '../kit';
import { materialTestMode, type MaterialTestDraft } from './material-test-draft';
import { offersCutStartRanges, withCutStartRanges } from './material-test-cut-start';

export const MATERIAL_TEST_READING: Readonly<Record<'fill' | 'line', string>> = {
  fill: 'Engrave: pick the cell you like best and use its speed and power.',
  line: 'Cut: pick the fastest cell that cut cleanly right through. If none did, raise power or add passes and test again.',
};

export const MATERIAL_TEST_SAFETY =
  'Test on scrap with something non-flammable under it, and stay with the laser: the slow, strong cells can catch fire.';

export function MaterialTestGuidance(props: {
  readonly draft: MaterialTestDraft;
  readonly apply: (draft: MaterialTestDraft) => void;
}): JSX.Element {
  return (
    <div style={guidanceStyle}>
      {offersCutStartRanges(props.draft) ? (
        <p style={lineStyle}>
          These are engraving ranges, too fast and weak to cut through.{' '}
          <Button
            onClick={() => props.apply(withCutStartRanges(props.draft))}
            title="Set 100 % power, speeds 60 to 600 mm/min down the rows and 1 to 5 passes across the columns."
          >
            Use cut starting ranges
          </Button>
        </p>
      ) : null}
      <p style={lineStyle}>{MATERIAL_TEST_READING[materialTestMode(props.draft)]}</p>
      <p style={lineStyle}>{MATERIAL_TEST_SAFETY}</p>
    </div>
  );
}

const guidanceStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12 };
const lineStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };
