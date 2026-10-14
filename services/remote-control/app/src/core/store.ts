import type {
  ControlOperation,
  Font,
  MachineStatus,
  PhoneSession,
  Recipe,
  Scene,
  Scope,
  Workspace,
} from './types';

export type Tab = 'design' | 'layers' | 'machine' | 'more';
export type Tool = 'select' | 'pan' | 'text' | 'rect' | 'ellipse' | 'pen';
export type Sheet =
  | { kind: 'properties' }
  | { kind: 'text'; at?: { x: number; y: number } }
  | { kind: 'shape'; shape: 'rect' | 'ellipse' }
  | { kind: 'arrange' }
  | { kind: 'import' }
  | { kind: 'operation'; id: string }
  | { kind: 'new-operation' }
  | { kind: 'review' }
  | null;
export type Toast = { id: number; message: string; tone: 'info' | 'success' | 'warning' | 'error' };
export type View = { x: number; y: number; scale: number };
/** Local, uncommitted canvas change. Only Apply (or gesture end for transforms) writes to the PC. */
export type Draft =
  | { kind: 'rect' | 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'pen'; points: { x: number; y: number }[] };
export type Preview =
  | { kind: 'move'; ids: string[]; dx: number; dy: number }
  | { kind: 'scale'; ids: string[]; ox: number; oy: number; sx: number; sy: number }
  | { kind: 'rotate'; ids: string[]; cx: number; cy: number; angle: number };

export type AppState = {
  host: 'phone' | 'mcp';
  displayMode: 'inline' | 'fullscreen' | 'pip';
  availableModes: string[];
  theme: 'system' | 'light' | 'dark';
  hostTheme: 'light' | 'dark' | null;
  session: PhoneSession | null;
  scopes: Scope[];
  pcOnline: boolean;
  socket: boolean;
  liveUpdates: boolean;
  workspace: Workspace | null;
  scene: Scene | null;
  sceneRevision: string | null;
  machine: MachineStatus | null;
  operation: ControlOperation | null;
  fonts: Font[];
  recipes: Recipe[];
  tab: Tab;
  tool: Tool;
  selectionMode: 'replace' | 'toggle';
  selectionSync: 'desktop' | 'pending' | 'local';
  connectionGeneration: number;
  selection: string[];
  view: View | null;
  sheet: Sheet;
  draft: Draft | null;
  preview: Preview | null;
  highlight: { ids: string[]; until: number } | null;
  pending: number;
  toasts: Toast[];
  camera: { data: string; width: number; height: number; at: number } | null;
};

const initial: AppState = {
  host: 'phone',
  displayMode: 'fullscreen',
  availableModes: [],
  theme: 'system',
  hostTheme: null,
  session: null,
  scopes: ['read'],
  pcOnline: true,
  socket: false,
  liveUpdates: false,
  workspace: null,
  scene: null,
  sceneRevision: null,
  machine: null,
  operation: null,
  fonts: [],
  recipes: [],
  tab: 'design',
  tool: 'select',
  selectionMode: 'replace',
  selectionSync: 'desktop',
  connectionGeneration: 0,
  selection: [],
  view: null,
  sheet: null,
  draft: null,
  preview: null,
  highlight: null,
  pending: 0,
  toasts: [],
  camera: null,
};

type Listener = () => void;
let state = initial;
const listeners = new Set<Listener>();
let toastId = 0;

export const store = {
  get: (): AppState => state,
  set(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (
      Object.keys(next).every((key) => state[key as keyof AppState] === next[key as keyof AppState])
    )
      return;
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  toast(message: string, tone: Toast['tone'] = 'info'): void {
    const id = ++toastId;
    store.set((current) => ({ toasts: [...current.toasts.slice(-2), { id, message, tone }] }));
    setTimeout(
      () => store.set((current) => ({ toasts: current.toasts.filter((toast) => toast.id !== id) })),
      tone === 'error' ? 6000 : 3500,
    );
  },
  reset(patch: Partial<AppState> = {}): void {
    state = { ...initial, ...patch };
    for (const listener of [...listeners]) listener();
  },
};

export const canEdit = (current: AppState): boolean =>
  current.scopes.includes('edit') &&
  current.workspace?.permissions?.canEdit !== false &&
  current.workspace !== null;
export const canControl = (current: AppState): boolean =>
  current.scopes.includes('control') && current.machine?.permissions.canControl === true;

/** Native selections can exceed the remote projection. Never treat a prefix as the whole set. */
export const selectionComplete = (current: AppState): boolean =>
  current.selectionSync === 'local' ||
  current.workspace?.selectionTruncated !== true ||
  current.selection.length !== current.workspace.selection.length ||
  current.selection.some((id, index) => id !== current.workspace?.selection[index]);
