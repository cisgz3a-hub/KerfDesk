// Bake Variable Text (LightBurn Variable Text "Bake"). The selected variable
// text and variable barcodes take the value they would engrave now (current
// record, serial, date and cut settings) as fixed content, exactly as output
// evaluates them, and stop advancing. All or nothing: one failed field leaves
// every object as it was.

import type { SceneObject } from '../../core/scene';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
import type { VariableTextRenderer } from '../../io/gcode';
import { materializeVariableObject } from '../../io/gcode/prepare-output-snapshot';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { renderVariableText } from '../text/render-variable-text';

export async function bakeSelectedVariableText(
  options: {
    readonly render?: VariableTextRenderer;
    readonly now?: () => Date;
  } = {},
): Promise<void> {
  const toast = useToastStore.getState().pushToast;
  const state = useStore.getState();
  const ids = new Set(selectedObjectIds(state));
  const targets = state.project.scene.objects.filter(
    (object) =>
      ids.has(object.id) && object.locked !== true && objectVariableTemplate(object) !== undefined,
  );
  if (targets.length === 0) {
    toast('Select variable text or a variable barcode to bake.', 'warning');
    return;
  }
  const context = { now: (options.now ?? (() => new Date()))() };
  const baked: SceneObject[] = [];
  for (const object of targets) {
    const result = await materializeVariableObject(
      object,
      state.project,
      context,
      options.render ?? renderVariableText,
    );
    if (!result.ok) {
      toast(`Nothing was baked. ${result.message}`, 'error');
      return;
    }
    baked.push(result.object);
  }
  if (!useStore.getState().commitBakedVariableObjects(state.project, baked)) {
    toast(
      'Nothing was baked because the project changed while it was evaluated. Try again.',
      'warning',
    );
    return;
  }
  toast(
    `Baked ${baked.length === 1 ? '1 object' : `${baked.length} objects`}: the value is now fixed and no longer advances. Undo restores the fields.`,
    'success',
  );
}
