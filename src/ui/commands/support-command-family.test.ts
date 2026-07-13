import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISCUSSIONS_URL,
  REPORT_BUG_URL,
  discussionsCommand,
  openExternalUrl,
  reportBugCommand,
} from './support-command-family';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('support commands', () => {
  it('points the bug report at the GitHub issue-template chooser', () => {
    expect(REPORT_BUG_URL).toBe('https://github.com/cisgz3a-hub/KerfDesk/issues/new/choose');
  });

  it('points feedback at GitHub Discussions', () => {
    expect(DISCUSSIONS_URL).toBe('https://github.com/cisgz3a-hub/KerfDesk/discussions');
  });

  it('registers enabled Help-family commands with stable ids', () => {
    const bug = reportBugCommand();
    const discussions = discussionsCommand();
    expect(bug.id).toBe('help.report-bug');
    expect(discussions.id).toBe('help.discussions');
    for (const command of [bug, discussions]) {
      expect(command.family).toBe('help');
      expect(command.enabled).toBe(true);
    }
  });

  it('opens external urls in a new tab without leaking window.opener', () => {
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockReturnValue(undefined);
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);

    openExternalUrl('https://example.com/x');

    expect(anchor.href).toBe('https://example.com/x');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('invoking a command opens its destination url', () => {
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockReturnValue(undefined);
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);

    reportBugCommand().invoke();

    expect(anchor.href).toBe(REPORT_BUG_URL);
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});
