// The in-app confirm, alert and prompt questions waiting for an answer
// (ADR-707). app-dialogs.ts puts a request here and awaits it; AppDialogHost
// renders the first one and hands the answer back through its `resolve`.
//
// A queue, not a single slot: an error notice raised while a question is open
// waits its turn instead of replacing what the operator is reading.

import { create } from 'zustand';

/** 'surface' focuses the dialog itself, so a key already on its way cannot
 *  press a button: use it for a question whose yes moves the machine. */
export type AppDialogFocus = 'first-control' | 'surface';

type CommonOptions = {
  readonly title: string;
  /** Plain text. A blank line starts a new paragraph. */
  readonly message: string;
  readonly initialFocus?: AppDialogFocus;
};

type JobRule = {
  /** Fail closed while a job is active: this text is shown as a toast and the
   *  question is answered no. For a yes that replaces or discards the open
   *  project, or sends the machine a command. */
  readonly refuseDuringJob?: string;
};

export type AppConfirmOptions = CommonOptions &
  JobRule & {
    /** Names what yes does ("Delete", "Home now"), never "OK". */
    readonly confirmLabel: string;
    readonly cancelLabel?: string;
    readonly tone?: 'default' | 'danger';
    /** Opts in to a "Don't ask again" box, remembered under this stable key. */
    readonly dontAskAgainKey?: string;
  };

export type AppAlertOptions = CommonOptions & { readonly closeLabel?: string };

export type AppPromptOptions = CommonOptions &
  JobRule & {
    /** The text field's label. */
    readonly label: string;
    readonly confirmLabel: string;
    readonly cancelLabel?: string;
    readonly initialValue?: string;
    readonly maxLength?: number;
    /** A problem with the typed text, shown under the field; null accepts it. */
    readonly validate?: (value: string) => string | null;
  };

export type AppConfirmAnswer = { readonly confirmed: boolean; readonly dontAskAgain: boolean };

export type AppDialogRequest =
  | {
      readonly kind: 'confirm';
      readonly id: number;
      readonly options: AppConfirmOptions;
      readonly resolve: (answer: AppConfirmAnswer) => void;
    }
  | {
      readonly kind: 'alert';
      readonly id: number;
      readonly options: AppAlertOptions;
      readonly resolve: () => void;
    }
  | {
      readonly kind: 'prompt';
      readonly id: number;
      readonly options: AppPromptOptions;
      readonly resolve: (value: string | null) => void;
    };

type AppDialogState = {
  readonly queue: ReadonlyArray<AppDialogRequest>;
  readonly nextId: number;
  /** Adds the request `build` makes for the id it is given. */
  readonly enqueue: (build: (id: number) => AppDialogRequest) => void;
  readonly remove: (id: number) => void;
};

export const useAppDialogStore = create<AppDialogState>((set, get) => ({
  queue: [],
  nextId: 1,
  enqueue: (build) => {
    const id = get().nextId;
    set((state) => ({ queue: [...state.queue, build(id)], nextId: id + 1 }));
  },
  remove: (id) => set((state) => ({ queue: state.queue.filter((request) => request.id !== id) })),
}));
