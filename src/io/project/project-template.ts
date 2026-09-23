import type { Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';

export function serializeProjectTemplate(project: Project): string {
  if (
    project.scene.objects.some(
      (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
    )
  ) {
    throw new Error('Template images must be embedded before saving.');
  }
  const prepared = prepareProjectForPersistence(project);
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  return `${JSON.stringify({ format: 'kerfdesk-project-template', version: 1, projectJson: prepared.json }, null, 2)}\n`;
}

export function parseProjectTemplate(contents: string): Project {
  const raw: unknown = JSON.parse(contents);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('format' in raw) ||
    raw.format !== 'kerfdesk-project-template' ||
    !('version' in raw) ||
    raw.version !== 1 ||
    !('projectJson' in raw) ||
    typeof raw.projectJson !== 'string'
  ) {
    throw new Error('This is not a supported KerfDesk project template.');
  }
  const result = deserializeProject(raw.projectJson);
  if (result.kind !== 'ok')
    throw new Error(
      result.kind === 'invalid' ? result.reason : `Unsupported project schema (${result.kind}).`,
    );
  if (
    result.project.scene.objects.some(
      (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
    )
  ) {
    throw new Error('This template has local image references instead of embedded pixels.');
  }
  return result.project;
}
