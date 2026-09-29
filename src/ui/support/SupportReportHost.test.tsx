import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useToastStore } from '../state/toast-store';
import { clearRendererProblems, recentRendererProblems } from './renderer-problems';
import { SUPPORT_REPORT_EVENT } from './support-report-event';
import { SupportReportHost } from './SupportReportHost';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearRendererProblems();
  useToastStore.setState({ toasts: [] });
  vi.unstubAllGlobals();
});

describe('support report host', () => {
  it('starts the save from Help > Save Support Report, inside the click', async () => {
    const pickFileForSave = vi.fn(async () => null);
    const platform = { id: 'web', pickFileForSave } as unknown as PlatformAdapter;
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <SupportReportHost />
        </PlatformProvider>,
      ),
    );

    window.dispatchEvent(new Event(SUPPORT_REPORT_EVENT));

    // Called synchronously from the event, so the file picker keeps the gesture.
    expect(pickFileForSave).toHaveBeenCalledOnce();
  });

  it("records the window's uncaught errors while mounted", async () => {
    await act(async () => root.render(<SupportReportHost />));
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('Port lost') }),
    );
    expect(recentRendererProblems().map((problem) => problem.kind)).toEqual([
      'unhandled rejection',
    ]);

    await act(async () => root.unmount());
    root = createRoot(host);
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'after' }));
    expect(recentRendererProblems()).toHaveLength(1);
  });

  it('explains when there is no platform to save with', async () => {
    await act(async () => root.render(<SupportReportHost />));
    act(() => {
      window.dispatchEvent(new Event(SUPPORT_REPORT_EVENT));
    });
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'A support report cannot be saved here.',
    ]);
  });
});
