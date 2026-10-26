// File System Access pickers modelled on Chromium, for save-ordering tests
// (ADR-656, audit 19-P2-1):
// - showSaveFilePicker creates the chosen file, or empties an existing one,
//   before it resolves (WICG File System Access "set entry's binary data to an
//   empty byte sequence"; Chromium CreateAndTruncateFile);
// - getFileHandle({ create: true }) creates an empty entry at once;
// - createWritable stages writes in a swap file that replaces the contents only
//   on close; abort discards it.

/** File name → contents. */
export type FakeDisk = Map<string, string>;

type PickerOptions = { readonly suggestedName?: string };

export type ChromiumSavePicker = {
  /** How many times the save dialog opened. */
  readonly picks: () => number;
  readonly restore: () => void;
};

export function installChromiumSavePicker(
  disk: FakeDisk,
  options: {
    /** The name the operator picks; defaults to the suggested name. */
    readonly chooseName?: string;
    /** Runs while the dialog is open, before the chosen file is emptied. The
     * dialog stays open until a returned promise settles. */
    readonly whilePicking?: () => void | Promise<void>;
    readonly writeError?: Error;
  } = {},
): ChromiumSavePicker {
  const original = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
  let picks = 0;
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: async (pickerOptions?: PickerOptions) => {
      picks += 1;
      const name = options.chooseName ?? pickerOptions?.suggestedName ?? 'untitled';
      const stillOpen = options.whilePicking?.();
      if (stillOpen !== undefined) await stillOpen;
      disk.set(name, '');
      return chromiumFileHandle(disk, name, options.writeError);
    },
  });
  return {
    picks: () => picks,
    restore: () => {
      if (original === undefined) Reflect.deleteProperty(window, 'showSaveFilePicker');
      else Object.defineProperty(window, 'showSaveFilePicker', original);
    },
  };
}

export function chromiumDirectory(
  disk: FakeDisk,
  options: { readonly writeError?: Error } = {},
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'chosen-folder',
    entries: async function* () {
      for (const name of disk.keys())
        yield [name, chromiumFileHandle(disk, name, options.writeError)];
    },
    getFileHandle: async (name: string, handleOptions?: { readonly create?: boolean }) => {
      if (!disk.has(name)) {
        if (handleOptions?.create !== true) throw notFound();
        disk.set(name, '');
      }
      return chromiumFileHandle(disk, name, options.writeError);
    },
    removeEntry: async (name: string) => {
      if (!disk.delete(name)) throw notFound();
    },
  } as unknown as FileSystemDirectoryHandle;
}

function chromiumFileHandle(
  disk: FakeDisk,
  name: string,
  writeError: Error | undefined,
): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => new File([disk.get(name) ?? ''], name),
    createWritable: async () => {
      let swap = '';
      return {
        write: async (data: string | Blob | BufferSource) => {
          if (writeError !== undefined) throw writeError;
          swap += await textOf(data);
        },
        close: async () => {
          disk.set(name, swap);
        },
        abort: async () => {
          swap = '';
        },
      };
    },
  } as unknown as FileSystemFileHandle;
}

async function textOf(data: string | Blob | BufferSource): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return blobText(data);
  return new TextDecoder().decode(data);
}

/** jsdom's Blob has no text(); FileReader reads it there and in a browser. */
export function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the blob.'));
    reader.readAsText(blob);
  });
}

/** Make the click's transient activation lapse, as a slow preparation does. */
export function lapseUserActivation(): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, 'userActivation');
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { isActive: false, hasBeenActive: true },
  });
  return () => {
    if (original === undefined) Reflect.deleteProperty(navigator, 'userActivation');
    else Object.defineProperty(navigator, 'userActivation', original);
  };
}

// jsdom's DOMException is not an Error, unlike the browser's, and the adapter
// recognises file-system errors as Errors by name.
function notFound(): Error {
  const error = new Error('The requested file does not exist.');
  error.name = 'NotFoundError';
  return error;
}
