import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { CncLineArtContoursField } from './CncLineArtContoursField';

describe('traced-edge vocabulary', () => {
  it('uses the visible term in the control accessible name', () => {
    const html = renderToStaticMarkup(
      <CncLineArtContoursField
        layer={createLayer({ id: 'line-art', color: '#123456' })}
        settings={{ ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-on-path' }}
        onCommit={() => undefined}
      />,
    );

    expect(html).toContain('Traced edges');
    expect(html).toContain('aria-label="Traced edges for #123456"');
  });
});
