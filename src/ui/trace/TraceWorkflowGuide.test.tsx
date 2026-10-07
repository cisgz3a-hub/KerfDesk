import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_TRACE_OPTIONS } from '../../core/trace';
import type { RasterImage } from '../../core/scene';
import { TraceWorkflowGuide, traceSourceContext } from './TraceWorkflowGuide';

const source = { imageMaskId: 'mask' } as RasterImage;
const settings = {
  preset: DEFAULT_TRACE_OPTIONS,
  overrides: {},
  onChange: () => undefined,
  sourceHasTransparency: true,
};

describe('image-to-outline guidance', () => {
  it('separates canvas masks from the bitmap alpha selection the tracer actually uses', () => {
    const alpha = traceSourceContext(source, {
      ...settings,
      overrides: { traceTransparency: true },
    });
    expect(alpha).toContain('bitmap alpha mask');
    expect(alpha).toContain('mask or clip applies');
    expect(alpha).toContain('stored bitmap and native clip are kept');
    const brightness = traceSourceContext(source, {
      ...settings,
      overrides: { traceTransparency: false },
    });
    expect(brightness).toContain('colour and brightness');
    expect(
      traceSourceContext(source, {
        ...settings,
        sourceHasTransparency: false,
        overrides: { traceTransparency: true },
      }),
    ).toContain('colour and brightness');
  });
  it('shows output-specific purpose without choosing or enabling a Pro tracer', () => {
    const html = renderToStaticMarkup(
      <TraceWorkflowGuide
        source={{} as RasterImage}
        settings={settings}
        output="raster"
        photoShading={false}
      />,
    );
    expect(html).toContain('Choose Editable vectors for cutting outlines');
    expect(html).toContain('Original, Trace and Overlay');
    expect(html).toContain('Frame the placed job');
    expect(html).not.toContain('<button');
  });
});
