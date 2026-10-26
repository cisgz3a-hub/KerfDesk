import { readFileSync } from 'node:fs';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionProvider } from '../licensing/EditionProvider';

// These tests specify the licence window with it turned on (ADR-623). ADR-623
// Amendment 3 holds it off in releases; EditionProvider.licence-window-off.test.tsx
// covers that.
vi.mock('../../../public/desktop-licence-window.mjs', () => ({ DESKTOP_LICENCE_WINDOW: true }));

const calls = vi.hoisted(() => {
  const stop = vi.fn();
  return { reconcile: vi.fn(), watch: vi.fn(() => stop), stop };
});
vi.mock('../import/paged-asset-startup', () => ({
  startPagedAssetReconciliation: calls.reconcile,
}));
vi.mock('../import/paged-raster-ownership-watch', () => ({
  watchPagedRasterOwnership: calls.watch,
}));

const free: LicenceStatus = {
  channel: 'commercial',
  edition: 'free',
  state: 'activation-required',
  tier: null,
  accessExpiresAt: null,
  updatesUntil: null,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
};
const pro: LicenceStatus = {
  ...free,
  edition: 'pro',
  state: 'ready',
  tier: 'paid',
  perpetualUpdates: true,
};
function client(): LicenceAdapter {
  const updates = {
    state: 'unavailable' as const,
    currentVersion: '1.0.0',
    version: null,
    checkedAt: null,
  };
  return {
    status: vi.fn(async () => free),
    activate: vi.fn(async () => pro),
    startTrial: vi.fn(async () => pro),
    refresh: vi.fn(async () => free),
    deactivate: vi.fn(async () => free),
    resetStore: vi.fn(async () => free),
    checkout: vi.fn(async () => free),
    claimPayment: vi.fn(async () => free),
    discardPayment: vi.fn(async () => free),
    earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    setEarlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    updateStatus: vi.fn(async () => updates),
    checkForUpdates: vi.fn(async () => updates),
  };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('does not touch project assets at entry-module scope before admission', () => {
  const source = ts.createSourceFile(
    'main.tsx',
    readFileSync('src/ui/app/main.tsx', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callsBeforeMount = source.statements.flatMap((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
      return [];
    const callee = statement.expression.expression;
    return ts.isIdentifier(callee) ? [callee.text] : [];
  });
  expect(callsBeforeMount).not.toContain('startPagedAssetReconciliation');
  expect(callsBeforeMount).not.toContain('watchPagedRasterOwnership');
  const admittedChildren: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'EditionProvider')
      admittedChildren.push(
        node.children
          .filter(ts.isJsxSelfClosingElement)
          .map((child) => child.tagName.getText(source)),
      );
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(admittedChildren).toContainEqual(['WorkspaceAssetLifecycle', 'App']);
});

it('starts project-asset work only when the commercial workspace is admitted', async () => {
  const { WorkspaceAssetLifecycle } = await import('./WorkspaceAssetLifecycle');
  const api = client();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <WorkspaceAssetLifecycle />
      </EditionProvider>,
    ),
  );
  expect(calls.reconcile).not.toHaveBeenCalled();
  expect(calls.watch).not.toHaveBeenCalled();
  const start = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Start free 30-day trial'),
  );
  if (start === undefined) throw new Error('Trial action missing');
  await act(async () => start.click());
  expect(calls.reconcile).toHaveBeenCalledOnce();
  expect(calls.watch).toHaveBeenCalledOnce();
  // A later loss of rights retains the admitted workspace and its asset owner.
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(calls.stop).not.toHaveBeenCalled();
  expect(calls.reconcile).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(calls.stop).toHaveBeenCalledOnce();
  root = createRoot(host);
});

it('reconciles once while StrictMode reinstalls the ownership subscription', async () => {
  const { WorkspaceAssetLifecycle } = await import('./WorkspaceAssetLifecycle');
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkspaceAssetLifecycle />
      </StrictMode>,
    ),
  );
  expect(calls.reconcile).toHaveBeenCalledOnce();
  expect(calls.watch).toHaveBeenCalledTimes(2);
  expect(calls.stop).toHaveBeenCalledOnce();
});
