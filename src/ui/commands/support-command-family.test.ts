import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPORT_PROBLEM_URL,
  SUPPORT_URL,
  discussionsCommand,
  openExternalUrl,
  reportBugCommand,
  supportReportCommand,
} from './support-command-family';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('support commands', () => {
  it('sends customers to the kerfdesk.com support page, never the private repository', () => {
    expect(SUPPORT_URL).toBe('https://kerfdesk.com/support.html');
    expect(REPORT_PROBLEM_URL).toBe('https://kerfdesk.com/support.html#report');
    for (const command of [reportBugCommand(), discussionsCommand()])
      expect(`${command.label} ${command.title}`).not.toMatch(/github/i);
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

    expect(anchor.href).toBe(REPORT_PROBLEM_URL);
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('asks the app to save a support report, without leaving it', () => {
    const command = supportReportCommand();
    const requested = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    window.addEventListener('kerfdesk:support-report', requested, { once: true });

    command.invoke();

    expect(command).toMatchObject({ id: 'help.support-report', family: 'help', enabled: true });
    expect(requested).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
  });
});
