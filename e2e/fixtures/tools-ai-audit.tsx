// Test-only rendered workspace. No provider request, account, key or licence is used.
import { createRoot } from 'react-dom/client';
import type { AiAssistant, AiDraft } from '../../src/core/ai/assistant';
import { webAdapter } from '../../src/platform/web';
import { App } from '../../src/ui/app/App';
import { PlatformProvider } from '../../src/ui/app/platform-context';
import { EditionProvider } from '../../src/ui/licensing/EditionProvider';
import { useStore } from '../../src/ui/state';
import '../../src/ui/theme/tokens.css';
import '../../src/ui/kit/icons.css';
import { auditFiles, AuditFileControls } from './tools-file-audit';

const status = { configured: true, secureStorage: true, model: 'local-audit-fixture' };
const draft: AiDraft = {
  title: 'Audit triangle',
  explanation: 'Synthetic local response. Inspect before adding.',
  matches: [],
  paths: [
    {
      closed: true,
      points: [
        { x: 5, y: 5 },
        { x: 25, y: 5 },
        { x: 5, y: 25 },
      ],
    },
  ],
};
const assistant: AiAssistant = {
  status: async () => status,
  configure: async () => {
    throw new Error('Fixture connection cannot be changed.');
  },
  forget: async () => {
    throw new Error('Fixture connection cannot be changed.');
  },
  generate: async (request, signal) => {
    if (request.prompt.toLowerCase().includes('delay')) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 30_000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    return request.prompt.toLowerCase().includes('invalid')
      ? { ...draft, paths: [{ closed: true, points: [{ x: NaN, y: 0 }] }] }
      : draft;
  },
};

function AuditWorkspace() {
  const objects = useStore((state) => state.project.scene.objects.length);
  return (
    <>
      <aside aria-label="Audit fixture status">
        Local mock provider · no network request · {objects} artwork objects. Prompt “delay” tests
        Cancel; “invalid” tests rejection.
      </aside>
      <AuditFileControls />
      <App />
    </>
  );
}

const root = document.getElementById('app-root');
if (root === null) throw new Error('Missing audit fixture root');
createRoot(root).render(
  <PlatformProvider adapter={{ ...webAdapter, ...auditFiles, aiAssistant: assistant }}>
    <EditionProvider unlicensedRunsFree={false}>
      <AuditWorkspace />
    </EditionProvider>
  </PlatformProvider>,
);
