import type { Project, Scene, SceneObject } from '../../core/scene';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
import { evaluateVariableTemplate } from '../../core/variables';

/** Keep rendered owned copies fixed while preserving the editable source archive. */
export function fixedArrayScene(
  project: Project,
  scene: Scene,
  owned: ReadonlySet<string>,
  evaluationTime: string | undefined,
): Scene | null {
  const objects: SceneObject[] = [];
  for (const object of scene.objects) {
    if (!owned.has(object.id) || objectVariableTemplate(object) === undefined) {
      objects.push(object);
      continue;
    }
    if (evaluationTime === undefined) return null;
    if (object.kind === 'text') {
      const { variableTemplate: _template, ...fixed } = object;
      objects.push(fixed);
    } else if (object.kind === 'shape' && object.spec.kind === 'barcode') {
      const template = object.spec.variableTemplate;
      if (template === undefined) {
        objects.push(object);
        continue;
      }
      const evaluated = evaluateVariableTemplate(template, object, project, {
        now: new Date(evaluationTime),
      });
      if (!evaluated.ok) return null;
      const { variableTemplate: _template, ...fixed } = object.spec;
      objects.push({ ...object, spec: { ...fixed, data: evaluated.value } });
    }
  }
  return { ...scene, objects };
}
