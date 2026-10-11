/** Editable native source owned by the project, independent of a running editor session. */
export type StudioDocument = {
  readonly id: string;
  readonly editor: 'photo' | 'vector';
  readonly title: string;
  readonly editorVersion: string;
  readonly nativeFormat: 'pcraft' | 'vectorcraft';
  readonly nativeBase64: string;
  /** Lowercase digest, verified against bytes by the native import/export boundary. */
  readonly nativeSha256: string;
  readonly revision: string;
};
