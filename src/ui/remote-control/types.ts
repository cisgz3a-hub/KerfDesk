import type { AppState } from '../state/store';

export type RemoteReadCommand =
  | 'get_workspace'
  | 'get_workspace_preview'
  | 'list_fonts'
  | 'get_text'
  | 'get_machine'
  | 'get_app_status'
  | 'list_material_recipes'
  | 'review_job';
export type RemoteWriteCommand =
  | 'set_selection'
  | 'add_text'
  | 'add_rectangle'
  | 'transform_artwork'
  | 'update_operation'
  | 'update_text'
  | 'arrange_artwork'
  | 'undo'
  | 'redo';
export type RemoteCommand = RemoteReadCommand | RemoteWriteCommand;
export type WriteAdmission = { readonly expectedRevision: string; readonly requestId: string };
export type RemoteTransform =
  | { readonly type: 'move'; readonly dxMm: number; readonly dyMm: number }
  | { readonly type: 'resize'; readonly widthMm: number; readonly heightMm: number }
  | { readonly type: 'rotate'; readonly angleDeg: number };
export type RemoteOperationPatch = {
  readonly powerPercent?: number;
  readonly speedMmPerMin?: number;
  readonly passes?: number;
  readonly enabled?: boolean;
};
export type RemoteTextPatch = {
  readonly text?: string;
  readonly fontId?: string;
  readonly fontSizeMm?: number;
  readonly alignment?: 'left' | 'center' | 'right';
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
};
export type RemoteArrangeAction =
  | 'align_left'
  | 'align_center'
  | 'align_right'
  | 'align_top'
  | 'align_middle'
  | 'align_bottom'
  | 'distribute_horizontal'
  | 'distribute_vertical'
  | 'mirror_horizontal'
  | 'mirror_vertical'
  | 'group'
  | 'ungroup'
  | 'duplicate'
  | 'delete';
export type RemoteWrite =
  | {
      readonly command: 'set_selection';
      readonly args: WriteAdmission & { readonly artworkIds: readonly string[] };
    }
  | {
      readonly command: 'add_text';
      readonly args: WriteAdmission & {
        readonly xMm: number;
        readonly yMm: number;
        readonly widthMm: number;
        readonly text: string;
        readonly fontSizeMm: number;
        readonly fontId?: string;
      };
    }
  | {
      readonly command: 'update_text';
      readonly args: WriteAdmission & {
        readonly artworkId: string;
        readonly patch: RemoteTextPatch;
      };
    }
  | {
      readonly command: 'arrange_artwork';
      readonly args: WriteAdmission & {
        readonly artworkIds: readonly string[];
        readonly action: RemoteArrangeAction;
      };
    }
  | {
      readonly command: 'undo' | 'redo';
      readonly args: WriteAdmission;
    }
  | {
      readonly command: 'add_rectangle';
      readonly args: WriteAdmission & {
        readonly xMm: number;
        readonly yMm: number;
        readonly widthMm: number;
        readonly heightMm: number;
      };
    }
  | {
      readonly command: 'transform_artwork';
      readonly args: WriteAdmission & {
        readonly artworkIds: readonly string[];
        readonly transform: RemoteTransform;
      };
    }
  | {
      readonly command: 'update_operation';
      readonly args: WriteAdmission & {
        readonly operationId: string;
        readonly patch: RemoteOperationPatch;
      };
    };

export type RemoteAppStore = {
  readonly getState: () => AppState;
  readonly subscribe: (listener: (state: AppState, previous: AppState) => void) => () => void;
};
export type SafeRemoteAppStatus = {
  readonly app: { readonly name: string; readonly version: string; readonly platform: 'desktop' };
  readonly edition: {
    readonly mode: 'free' | 'pro' | 'trial' | 'preview';
    readonly trialEndsAt?: string | number;
    readonly updateEligible?: boolean;
  };
  readonly updates: {
    readonly available: boolean;
    readonly version?: string;
    readonly highlights?: readonly string[];
  };
};
export type RemoteBounds = {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
};
/** Only the existing prepared-job owner may provide this; revision fences stale evidence. */
export type SafeRemoteJobReview = {
  readonly revision: string;
  readonly status: 'ready' | 'unavailable' | 'preparing';
  readonly mode: 'laser' | 'cnc';
  readonly message?: string;
  readonly summary?: {
    readonly artworkCount: number;
    readonly operationCount: number;
    readonly estimatedSeconds?: number;
    readonly bounds?: RemoteBounds;
  };
  readonly warnings: readonly {
    readonly code: string;
    readonly message: string;
    readonly severity?: 'info' | 'warning' | 'error';
    readonly operationId?: string;
  }[];
  readonly frame: { readonly required: true; readonly complete: boolean };
};
export type RemoteErrorCode =
  | 'invalid_arguments'
  | 'unsupported_command'
  | 'unsupported_operation'
  | 'stale_revision'
  | 'request_conflict'
  | 'request_limit'
  | 'read_only'
  | 'busy'
  | 'cancelled'
  | 'unavailable'
  | 'not_found'
  | 'not_editable'
  | 'needs_pro'
  | 'failed';
export type RemoteCommandResult =
  | {
      readonly ok: true;
      readonly revision: string;
      readonly data: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly revision: string;
      readonly error: { readonly code: RemoteErrorCode; readonly message: string };
    };
export type RemoteControlOptions = {
  readonly getAppStatus: () => SafeRemoteAppStatus;
  /** Pairing permission and normal editing availability; neither performs machine actions. */
  readonly canWrite: () => boolean;
  readonly canEdit?: () => boolean;
  /** Separate desktop opt-in for sending text content or artwork pixels to remote clients. */
  readonly canShareArtwork?: () => boolean;
  readonly getReview?: (
    currentRevision: string,
    signal?: AbortSignal,
  ) => SafeRemoteJobReview | null | Promise<SafeRemoteJobReview | null>;
  readonly store?: RemoteAppStore;
};
export type RemoteControlAdapter = {
  readonly execute: (
    command: string,
    args: unknown,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<RemoteCommandResult>;
  readonly getRevision: () => string;
  readonly dispose: () => void;
};
