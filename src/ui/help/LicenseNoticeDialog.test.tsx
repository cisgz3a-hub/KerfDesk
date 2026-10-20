import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAppCommands, commandById, runCommand } from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';
import { useUiStore } from '../state/ui-store';
import { LICENSE_NOTICE_TEXT, LICENSE_NOTICE_TITLE } from './license-notice';
import { LicenseNoticeHost } from './LicenseNoticeDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<LicenseNoticeHost />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useUiStore.setState({ modalDepth: 0 });
});

describe('Help > License & Safety Notice (ADR-613 Amendment 1)', () => {
  // The Windows installer's licence page is public/eula.txt (prepare-installer-terms.mjs,
  // release-desktop-unsigned.yml and build-commercial-platform.sh all copy it), so the
  // app must show exactly that file, not a summary of it.
  it('shows the exact text the Windows installer shows', () => {
    const installerTerms = readFileSync(resolve(process.cwd(), 'public/eula.txt'), 'utf8');
    expect(LICENSE_NOTICE_TEXT).toBe(installerTerms);
  });

  it('is named after the document', () => {
    expect(LICENSE_NOTICE_TEXT.split('\n')[0]).toBe(`KerfDesk ${LICENSE_NOTICE_TITLE}`);
    const command = commandById(buildAppCommands(baseCtx()), 'help.license-notice');
    expect(command).toMatchObject({ family: 'help', label: LICENSE_NOTICE_TITLE, enabled: true });
  });

  it('opens from the Help command and closes again', async () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const command = commandById(buildAppCommands(baseCtx()), 'help.license-notice');
    await act(async () => {
      runCommand(command);
    });
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe(LICENSE_NOTICE_TITLE);
    expect(dialog?.querySelector('pre')?.textContent).toBe(LICENSE_NOTICE_TEXT);
    const close = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Close');
    await act(async () => close?.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
