import { net, type Session } from 'electron';

type SmokeNetworkEvidence =
  | { readonly mode: 'not-requested' }
  | {
      readonly mode: 'offline-enforced';
      readonly chromiumProbeBlocked: true;
      readonly nodeProbeBlocked: true;
    };

let evidence: SmokeNetworkEvidence = { mode: 'not-requested' };
export const nativeSmokeNetworkEvidence = (): SmokeNetworkEvidence => evidence;

/** Qualification only: installed before licensing startup, never in an ordinary launch. */
export async function prepareNativeSmokeNetwork(
  session: Pick<Session, 'webRequest'>,
  config: { readonly licenceQualification?: { readonly phase: string } } | null,
  chromiumFetch: typeof net.fetch = net.fetch,
): Promise<void> {
  if (config?.licenceQualification?.phase !== 'offline') return;
  let chromiumBlocked = 0;
  let nodeBlocked = 0;
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => {
      chromiumBlocked += 1;
      callback({ cancel: true });
    },
  );
  // The licence transport currently uses Electron net.fetch. Also deny Node's
  // fetch so a future transport change cannot silently weaken this evidence.
  globalThis.fetch = () => {
    nodeBlocked += 1;
    return Promise.reject(new Error('Native qualification network is offline'));
  };
  const probe = 'https://kerfdesk.invalid/native-qualification-network-probe';
  await globalThis.fetch(probe).catch(() => undefined);
  await chromiumFetch(probe, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  if (nodeBlocked !== 1 || chromiumBlocked < 1)
    throw new Error('Native qualification could not prove network isolation');
  evidence = { mode: 'offline-enforced', chromiumProbeBlocked: true, nodeProbeBlocked: true };
}
