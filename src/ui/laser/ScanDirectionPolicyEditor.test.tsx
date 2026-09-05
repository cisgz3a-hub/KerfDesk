import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { ScanDirectionPolicyEditor } from './ScanDirectionPolicyEditor';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ host: HTMLDivElement; root: Root }> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop();
    if (view === undefined) continue;
    await act(async () => view.root.unmount());
    view.host.remove();
  }
});

describe('ScanDirectionPolicyEditor', () => {
  it('shows effective legacy policy and persists an explicit choice', async () => {
    const onChange = vi.fn();
    const view = await render(
      <ScanDirectionPolicyEditor
        profile={NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE}
        onChange={onChange}
      />,
    );
    const select = policySelect(view.host);
    expect(select.value).toBe('require-verified-offsets');

    await act(async () => {
      select.value = 'allow-requested';
      Simulate.change(select);
    });

    expect(onChange).toHaveBeenCalledWith('allow-requested');
  });

  it('shows the generic profile default as allow requested', async () => {
    const view = await render(
      <ScanDirectionPolicyEditor profile={DEFAULT_DEVICE_PROFILE} onChange={() => undefined} />,
    );
    expect(policySelect(view.host).value).toBe('allow-requested');
  });
});

async function render(element: JSX.Element): Promise<{ readonly host: HTMLDivElement }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  await act(async () => root.render(element));
  return { host };
}

function policySelect(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Bidirectional scan policy"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Scan direction policy not rendered');
  return select;
}
