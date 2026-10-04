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
