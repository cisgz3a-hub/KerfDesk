// Rolling audit v9 R3-P1-1: the part and sketch reviews said nothing about tabs
// placed by hand. They now say that the tabs follow, and name any they cannot keep.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generatedPart } from '../../core/parts/part-generator.test-fixture';
import type { ConstrainedSketchReview } from '../state/constrained-sketch-actions';
import type { PreparedPartGenerator } from '../state/prepare-part-generator';
import { PartGeneratorReview } from './PartGeneratorReview';
import { RebuiltTabsNote } from './RebuiltTabsNote';
import { SketchSolveReview } from './SketchSolveReview';

const TAB = { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 };
const tabbed = { ...generatedPart(), laserTabAnchors: [TAB] };

function rendered(element: JSX.Element): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe('the reviews show it', () => {
  const REVIEW_TEXT = 'Placed tabs follow the new size';

  it('the part review, for a part with placed tabs', () => {
    const prepared = {
      object: tabbed,
      previousObject: tabbed,
      operationNames: [],
      removedPathKeys: [],
      geometryMismatch: false,
      movedTabs: 0,
      removedTabs: 0,
    } as unknown as PreparedPartGenerator;

    const host = rendered(<PartGeneratorReview prepared={prepared} stale={false} />);

    expect(host.textContent).toContain(REVIEW_TEXT);
  });

  it('the sketch review, for a sketch with placed tabs', () => {
    const review = {
      sourceObject: tabbed,
      object: tabbed,
      affectedOperationIds: [],
      replacesManualGeometry: false,
      movedTabs: 0,
      removedTabs: 0,
    } as unknown as ConstrainedSketchReview;

    const host = rendered(<SketchSolveReview result={null} review={review} stale={false} />);

    expect(host.textContent).toContain(REVIEW_TEXT);
  });
});

describe('RebuiltTabsNote', () => {
  it('says the tabs follow, and warns of nothing, when each keeps its edge', () => {
    const host = rendered(<RebuiltTabsNote previous={tabbed} movedTabs={0} removedTabs={0} />);

    expect(host.textContent).toBe('Placed tabs follow the new size, each on its own edge.');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('names the tabs that move and the tabs that go', () => {
    const host = rendered(<RebuiltTabsNote previous={tabbed} movedTabs={1} removedTabs={2} />);

    const alerts = [...host.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);
    expect(alerts).toEqual([
      '1 placed tab sits on an outline that changes form and moves to the nearest point of it. Undo restores it.',
      '2 placed tabs sit on a path these dimensions remove and are removed. Undo restores them.',
    ]);
  });

  it('says nothing for a part with no placed tabs, or a new one', () => {
    const plain = generatedPart();
    expect(
      rendered(<RebuiltTabsNote previous={plain} movedTabs={0} removedTabs={0} />).innerHTML,
    ).toBe('');
    expect(
      rendered(<RebuiltTabsNote previous={undefined} movedTabs={0} removedTabs={0} />).innerHTML,
    ).toBe('');
  });
});
