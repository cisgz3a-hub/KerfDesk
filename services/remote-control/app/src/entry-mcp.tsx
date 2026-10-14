import { App } from '@modelcontextprotocol/ext-apps';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { controller } from './core/controller';
import { McpTransport } from './core/mcp-transport';
import { store } from './core/store';
import { publishModelContext, registerViewTools } from './mcp/app-tools';
import { McpRoot } from './mcp/McpRoot';
import './ui/app.css';

type HostContext = ReturnType<App['getHostContext']>;

const app = new App(
  { name: 'KerfDesk', version: '6.0.0' },
  { tools: { listChanged: false }, availableDisplayModes: ['inline', 'fullscreen', 'pip'] },
  { autoResize: true },
);
let tornDown = false;
let stopContext: (() => void) | undefined;

function applyContext(context: Partial<NonNullable<HostContext>> | undefined): void {
  if (context === undefined) return;
  store.set({
    ...(context.displayMode === undefined ? {} : { displayMode: context.displayMode }),
    ...(context.availableDisplayModes === undefined
      ? {}
      : { availableModes: context.availableDisplayModes }),
    ...(context.theme === undefined ? {} : { hostTheme: context.theme }),
  });
}

/** Respects the mode the host actually grants; inline stays usable when fullscreen is refused. */
export async function requestMode(mode: 'inline' | 'fullscreen' | 'pip'): Promise<void> {
  const available = store.get().availableModes;
  if (available.length > 0 && !available.includes(mode)) {
    if (mode === 'fullscreen') store.set({ displayMode: 'fullscreen' });
    return;
  }
  try {
    const result = await app.requestDisplayMode({ mode });
    store.set({ displayMode: result.mode });
  } catch {
    if (mode === 'fullscreen') store.set({ displayMode: 'fullscreen' });
  }
}

registerViewTools(app, () => requestMode('fullscreen'));
app.ontoolresult = (result) => {
  if (tornDown) return;
  // The model ran a KerfDesk tool: show its effect live and refresh from the PC.
  const changed = (result.structuredContent as { changedArtworkIds?: unknown } | undefined)
    ?.changedArtworkIds;
  if (Array.isArray(changed))
    controller.flash(changed.filter((id): id is string => typeof id === 'string').slice(0, 200));
  void controller.refreshAll();
};
app.onhostcontextchanged = (context) => applyContext(context);
app.onteardown = async () => {
  tornDown = true;
  stopContext?.();
  controller.stop();
  return {};
};

store.reset({ host: 'mcp', displayMode: 'inline', scopes: ['read', 'edit', 'control'] });
const element = document.getElementById('root');
if (element !== null)
  createRoot(element).render(
    <StrictMode>
      <McpRoot requestMode={requestMode} />
    </StrictMode>,
  );

void app.connect().then(
  () => {
    if (tornDown) return;
    applyContext(app.getHostContext());
    stopContext = publishModelContext(app);
    controller.start(new McpTransport(app));
  },
  () => store.toast('This chat app couldn’t open the KerfDesk panel.', 'error'),
);
