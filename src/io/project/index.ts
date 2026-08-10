export { serializeProject } from './serialize-project';
export type { DeserializeResult } from './deserialize-project';
export { deserializeProject, deserializeProjectValue } from './deserialize-project';
export {
  prepareProjectForPersistence,
  type PreparedProjectPersistence,
} from './prepare-project-persistence';
export {
  prepareProjectForAutosave,
  type PreparedProjectAutosave,
} from './prepare-project-autosave';
export {
  MAX_PROJECT_COORDINATE_MAGNITUDE_MM,
  MAX_PROJECT_TRANSFORM_SCALE,
} from './project-shape-primitives';
