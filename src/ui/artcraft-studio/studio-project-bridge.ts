import type { StudioDocument } from '../../core/scene/studio-document';
import type { Project } from '../../core/scene';
import { projectWithStudioDocument } from '../state/studio-document-actions';
import { registerProjectSaveCheckpoint } from '../app/project-save-checkpoint';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { captureStudioDocument, type StudioSession } from './artcraft-api';

type Binding = {
  readonly session: StudioSession;
  readonly epoch: number;
  saved: StudioDocument | undefined;
};
const bindings = new Map<string, Binding>();
let pending: Promise<void> = Promise.resolve();
let unregister: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let periodicInFlight = false;
let lastPeriodicError: string | undefined;

/** Own a native session from this document. Call with the epoch captured before opening it. */
export function bindStudioSession(
  session: StudioSession,
  expectedEpoch = useStore.getState().projectDocumentEpoch,
): boolean {
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== expectedEpoch) return false;
  const id = session.documentId ?? session.id;
  bindings.set(id, {
    session,
    epoch: expectedEpoch,
    saved: state.project.studioDocuments?.find((document) => document.id === id),
  });
  installSaveCheckpoint();
  return true;
}

export function getStudioBinding(documentId: string): StudioSession | undefined {
  const binding = bindings.get(documentId);
  const state = useStore.getState();
  const saved = state.project.studioDocuments?.find((document) => document.id === documentId);
  return binding?.epoch === state.projectDocumentEpoch &&
    saved?.nativeSha256 === binding.saved?.nativeSha256
    ? binding.session
    : undefined;
}

/** Forget ownership after Undo/replacement; the native document is not deleted or closed. */
export function unbindStudioSession(documentId: string): void {
  bindings.delete(documentId);
}

function installSaveCheckpoint(): void {
  if (unregister !== undefined) return;
  unsubscribe = useStore.subscribe((state, previous) => {
    if (state.projectDocumentEpoch !== previous.projectDocumentEpoch) {
      bindings.clear();
      lastPeriodicError = undefined;
    }
  });
  unregister = registerProjectSaveCheckpoint(async (request) => {
    if (bindings.size === 0) return;
    if (request.projectDocumentEpoch !== useStore.getState().projectDocumentEpoch) return;
    await checkpointStudioSessions(request.isCurrent);
    if (!request.isCurrent()) return;
    const state = useStore.getState();
    return { project: projectWithCurrentJobSetup(state), expectedProject: state.project };
  });
  interval = setInterval(checkpointPeriodically, 5000);
}

function checkpointPeriodically(): void {
  if (periodicInFlight || bindings.size === 0) return;
  periodicInFlight = true;
  const epoch = useStore.getState().projectDocumentEpoch;
  void checkpointStudioSessions()
    .then(
      () => {
        lastPeriodicError = undefined;
      },
      (error: unknown) => {
        if (epoch !== useStore.getState().projectDocumentEpoch || bindings.size === 0) return;
        // The editor may contain unsaved work. A failed checkpoint can never make it look clean.
        useStore.setState({ dirty: true });
        const message = `Studio recovery checkpoint failed: ${error instanceof Error ? error.message : String(error)}`;
        if (message !== lastPeriodicError) useToastStore.getState().pushToast(message, 'error');
        lastPeriodicError = message;
      },
    )
    .finally(() => {
      periodicInFlight = false;
    });
}

/** Serialize saves and panel checkpoints; each caller retains its original document owner. */
export function checkpointStudioSessions(isCurrent: () => boolean = () => true): Promise<void> {
  const epoch = useStore.getState().projectDocumentEpoch;
  return serializeStudioOperation(async () => {
    if (!currentProject(epoch, isCurrent)) return;
    const owned = [...bindings.entries()];
    for (const [id, binding] of owned) {
      if (!currentBinding(id, binding, epoch, isCurrent)) return;
      ensureProjectRevision(id, binding);
      const document = await captureStudioDocument(binding.session.id);
      if (!currentBinding(id, binding, epoch, isCurrent)) return;
      ensureProjectRevision(id, binding);
      if (document.id !== id || document.editor !== binding.session.editor)
        throw new Error('The editor returned a document belonging to another studio session.');
      if (!useStore.getState().upsertStudioDocument(document, epoch)) return;
      binding.saved = useStore.getState().project.studioDocuments?.find((entry) => entry.id === id);
    }
    if (
      currentProject(epoch, isCurrent) &&
      [...bindings].some(
        ([id, binding]) => !owned.some(([ownedId, entry]) => ownedId === id && entry === binding),
      )
    )
      throw new Error('Studio sessions changed during capture. Save the project again.');
  });
}

/** Native operations and their project commit share this queue; do not nest checkpoint calls. */
export function serializeStudioOperation<T>(work: () => Promise<T>): Promise<T> {
  const run = pending.catch(() => undefined).then(work);
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Commit the native bytes frozen alongside an Apply export without invalidating its live binding. */
export function acceptStudioDocument(
  sessionId: string,
  document: StudioDocument,
  epoch: number,
  commitArtwork?: (project: Project) => void,
): boolean {
  const binding = bindings.get(document.id);
  if (useStore.getState().projectDocumentEpoch !== epoch) return false;
  if (
    binding?.epoch !== epoch ||
    binding.session.id !== sessionId ||
    binding.session.editor !== document.editor
  )
    throw new Error('The native document no longer belongs to this project editor session.');
  ensureProjectRevision(document.id, binding);
  if (commitArtwork !== undefined)
    commitArtwork(projectWithStudioDocument(useStore.getState().project, document));
  else if (!useStore.getState().upsertStudioDocument(document, epoch)) return false;
  binding.saved = useStore
    .getState()
    .project.studioDocuments?.find((entry) => entry.id === document.id);
  return true;
}

function currentBinding(
  id: string,
  binding: Binding,
  epoch: number,
  current: () => boolean,
): boolean {
  if (!current() || useStore.getState().projectDocumentEpoch !== epoch) return false;
  if (bindings.get(id) !== binding)
    throw new Error('Studio sessions changed during capture. Save the project again.');
  return true;
}

function ensureProjectRevision(id: string, binding: Binding): void {
  const saved = useStore.getState().project.studioDocuments?.find((document) => document.id === id);
  if (saved?.nativeSha256 !== binding.saved?.nativeSha256)
    throw new Error(
      'This studio document changed in the project. Reopen it before saving editor changes.',
    );
}

/** Dispose only when the application host itself is disposed, never when its panel closes. */
export function disposeStudioProjectBridge(): void {
  unregister?.();
  unsubscribe?.();
  unregister = undefined;
  unsubscribe = undefined;
  bindings.clear();
  clearInterval(interval);
  interval = undefined;
  lastPeriodicError = undefined;
}

function currentProject(epoch: number, isCurrent: () => boolean): boolean {
  return isCurrent() && useStore.getState().projectDocumentEpoch === epoch;
}
