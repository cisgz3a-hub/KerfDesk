/** Client-side views of the bounded MCP projections (electron/mcp/*-schemas.ts). */
export type Scope = 'read' | 'edit' | 'control';
export type Bounds = { xMm: number; yMm: number; widthMm: number; heightMm: number };

export type Artwork = {
  id: string;
  type: string;
  name?: string;
  bounds?: Bounds;
  transformBounds?: Bounds;
  operationId?: string;
  visible?: boolean;
  editable?: boolean;
};
export type CncSettings = {
  cutType: string;
  toolId?: string;
  depthMm?: number;
  depthPerPassMm?: number;
  feedMmPerMin?: number;
  plungeMmPerMin?: number;
  spindleRpm?: number;
  stepoverPercent?: number;
  pocketStrategy?: string;
};
export type Operation = {
  id: string;
  type: string;
  name?: string;
  enabled: boolean;
  color?: string;
  powerPercent?: number;
  minPowerPercent?: number;
  speedMmPerMin?: number;
  passes?: number;
  airAssist?: boolean;
  fillIntervalMm?: number;
  fillAngleDeg?: number;
  fillBidirectional?: boolean;
  fillCrossHatch?: boolean;
  linesPerMm?: number;
  negativeImage?: boolean;
  artworkCount?: number;
  cnc?: CncSettings;
};
export type Workspace = {
  revision: string;
  mode: 'laser' | 'cnc';
  name: string;
  dirty: boolean;
  selection: string[];
  artwork: Artwork[];
  operations: Operation[];
  totalArtwork: number;
  totalOperations: number;
  truncated: boolean;
  history?: { canUndo: boolean; canRedo: boolean };
  permissions?: { canEdit: boolean; artworkSharingEnabled: boolean };
  capabilities?: {
    touchEditing: boolean;
    groupTransformBounds?: boolean;
    scene?: boolean;
    designControl?: boolean;
  };
  saved?: { hasFile: boolean };
};
export type ScenePath = {
  color: string;
  fill: boolean;
  output: boolean;
  polylines: { closed: boolean; points: string }[];
};
export type SceneObject = {
  id: string;
  kind: string;
  unitId: string;
  operationId?: string;
  editable: boolean;
  bounds: Bounds;
  paths: ScenePath[];
};
export type SceneImage = { id: string; unitId: string; editable: boolean; corners: number[] };
export type Scene = {
  revision: string;
  status: 'ready' | 'disabled' | 'unavailable';
  message?: string;
  bed?: { widthMm: number; heightMm: number };
  extent?: Bounds;
  toleranceMm?: number;
  objects?: SceneObject[];
  images?: SceneImage[];
};
export type Availability = { available: boolean; reason?: string };
export type MachineStatus = {
  revision: string;
  permissions: { canControl: boolean };
  mode: 'laser' | 'cnc';
  connection: 'connected' | 'disconnected' | 'connecting';
  controllerState: string | null;
  position?: { space: 'work'; wcs?: string; xMm: number; yMm: number; zMm?: number };
  availability: Record<'jog' | 'frame' | 'review' | 'start' | 'abort', Availability> &
    Partial<
      Record<
        'connect' | 'disconnect' | 'home' | 'origin' | 'pause' | 'resume' | 'hold',
        Availability
      >
    >;
  jog: {
    xySupported: boolean;
    zSupported: boolean;
    maxFeedMmPerMin: number;
    holdSupported?: boolean;
  };
  frame: { required: true; complete: boolean };
  job: {
    active: boolean;
    state: 'idle' | 'starting' | 'running' | 'paused' | 'tool_change' | 'unknown';
    progressPercent?: number;
    elapsedSeconds?: number;
    remainingSeconds?: number;
  };
  homing?: 'confirmed' | 'required' | 'not_supported' | 'unknown';
  camera?: { available: boolean };
  motion: { kind: 'idle' | 'jog' | 'frame' | 'unknown' };
  operation?: ControlOperation;
};
export type Review = {
  reviewId: string;
  revision: string;
  mode: 'laser' | 'cnc';
  artworkShared?: boolean;
  stats: { label: string; value: string; detail: string; emphasis?: 'text' }[];
  warnings: { code: string; message: string }[];
  operations: { operationId: string; summaries: string[] }[];
  pagination?: {
    offset: number;
    nextOffset: number | null;
    totalWarnings: number;
    totalOperations: number;
  };
  acknowledgement: { kind: 'laser-verified' | 'laser-unverified' | 'cnc'; prompt?: string };
  frame: { required: true; complete: boolean };
};
export type ControlOperation = {
  operationId: string;
  kind: string;
  state:
    | 'accepted'
    | 'preparing'
    | 'awaiting_review'
    | 'starting'
    | 'running'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'unknown';
  revision: string;
  committed: boolean | null;
  message?: string;
  review?: Review;
};
export type Font = { id: string; name: string; geometry: 'outline' | 'single-line'; style: string };
export type Recipe = {
  id: string;
  name: string;
  materialName?: string;
  powerPercent?: number;
  speedMmPerMin?: number;
  passes?: number;
};
export type TextDetails = {
  artworkId: string;
  text: string;
  fontId: string;
  fontSizeMm: number;
  alignment: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
};
export type PhoneSession = {
  deviceLabel: string;
  online: boolean;
  client: { id: string; label: string; scopes: Scope[] };
  csrf: string;
};
export const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed', 'unknown']);
