import { createProject, type Project } from '../../core/scene';
import { browserLocalStorage } from './browser-local-storage';
import { loadLastMachineSelection } from './last-machine-persistence';
import { resolveProjectMachineCapability } from './project-machine-capability';

// Restore only application machine identity/limits, never prior job settings.
// Open and autosave recovery pass their own project and bypass this initializer.
export function createStartupProject(): Project {
  const storage = browserLocalStorage();
  const saved = storage === null ? null : loadLastMachineSelection(storage);
  if (saved === null) return createProject();
  return resolveProjectMachineCapability(createProject(saved.profile), [], saved.machineKind)
    .project;
}
