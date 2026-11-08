// S8-P3-3: a large CNC pocket can prepare for minutes in the worker. The
// banner names the worker's phase and count and offers Leave Preview, which
// cancels the preparation.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { PreviewIssueBanner } from './preview-issue-banner';
import type { PreviewIssue } from './preview-status';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

async function mount(issue: PreviewIssue) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<PreviewIssueBanner issue={issue} />));
  return { host, unmount: () => act(async () => root.unmount()) };
}

describe('PreviewIssueBanner for a job preparing in the background', () => {
  it('reads as before until the worker first reports', async () => {
    const view = await mount({ kind: 'preparing-large-job' });
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe(
      'Large job: preparing the route preview in the background. It will appear here when ready — Start and Save do not wait for it.',
    );
    await view.unmount();
  });

  it("names the worker's phase and how many CNC regions are done", async () => {
    const view = await mount({
      kind: 'preparing-large-job',
      progress: {
        phase: 'planning',
        mode: 'parallel',
        completed: 2,
        active: 1,
        queued: 2,
        total: 5,
      },
    });
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
      'in the background — planning toolpaths 2/5. It will appear',
    );
    await view.unmount();
  });

  it('leaves Preview, which cancels the preparation', async () => {
    useStore.setState({ previewMode: true });
    const view = await mount({ kind: 'preparing-large-job' });
    const button = [...view.host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Leave Preview',
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(useStore.getState().previewMode).toBe(false);
    await view.unmount();
  });
});
