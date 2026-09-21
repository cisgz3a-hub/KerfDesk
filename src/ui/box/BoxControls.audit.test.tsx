import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { button, click, mount } from '../layers/control-audit-test-support';
import { BoxFitTestDialog } from './BoxFitTestDialog';
import { BoxGeneratorPreview, type BoxPreviewView } from './BoxGeneratorPreview';

describe('artwork control audit: box secondary controls', () => {
  it('cancels the fit-test dialog without generating a coupon', async () => {
    const onCancel = vi.fn();
    const onGenerate = vi.fn();
    const host = await mount(
      <BoxFitTestDialog machine={{ kind: 'laser' }} onCancel={onCancel} onGenerate={onGenerate} />,
    );
    await click(button(host, 'Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onGenerate).not.toHaveBeenCalled();
  });
  it('changes from Flat to Assembled and back with truthful pressed states', async () => {
    function Preview() {
      const [view, setView] = useState<BoxPreviewView>('flat');
      return (
        <BoxGeneratorPreview snapshot={null} view={view} isPending={false} onSelectView={setView} />
      );
    }
    const host = await mount(<Preview />);
    expect(button(host, 'Flat').getAttribute('aria-pressed')).toBe('true');
    await click(button(host, 'Assembled'));
    expect(button(host, 'Assembled').getAttribute('aria-pressed')).toBe('true');
    expect(button(host, 'Flat').getAttribute('aria-pressed')).toBe('false');
    await click(button(host, 'Flat'));
    expect(button(host, 'Flat').getAttribute('aria-pressed')).toBe('true');
    expect(button(host, 'Assembled').getAttribute('aria-pressed')).toBe('false');
  });
});
