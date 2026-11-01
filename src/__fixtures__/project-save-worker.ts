import { vi } from 'vitest';
import type {
  ProjectSavePreparation,
  ProjectSavePreparationMessage,
} from '../ui/app/project-save-preparation-client';

export class ProjectSaveTestWorker {
  static instances: ProjectSaveTestWorker[] = [];
  onmessage: ((event: MessageEvent<ProjectSavePreparation>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly postMessage = vi.fn<(_message: ProjectSavePreparationMessage) => void>();
  readonly terminate = vi.fn<() => void>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    ProjectSaveTestWorker.instances.push(this);
  }

  respond(result: ProjectSavePreparation): void {
    this.onmessage?.({ data: result } as MessageEvent<ProjectSavePreparation>);
  }
}

export function currentProjectSaveWorker(): ProjectSaveTestWorker {
  const worker = ProjectSaveTestWorker.instances.at(-1);
  if (worker === undefined) throw new Error('Project save worker is missing.');
  return worker;
}

/** Save text, or the raw recovery copy's Blob read back (jsdom's Blob has no `text()`). */
export async function savedContentsText(contents: string | Blob): Promise<string> {
  if (typeof contents === 'string') return contents;
  if (typeof FileReader === 'undefined') return contents.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The Blob could not be read.'));
    reader.readAsText(contents);
  });
}
