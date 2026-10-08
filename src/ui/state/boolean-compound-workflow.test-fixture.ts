import { createLayer, createProject, type ImportedSvg } from '../../core/scene';
import { compoundRectangle } from '../../core/geometry/boolean-compound.test-fixture';
import {
  isBooleanCompoundObject,
  type BooleanCompoundOperation,
} from '../../core/scene/boolean-compound';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
export function loadCompound(
  operation: BooleanCompoundOperation = 'subtract',
): ImportedSvg & { readonly booleanCompound: NonNullable<ImportedSvg['booleanCompound']> } {
  const sources = [compoundRectangle('subject'), compoundRectangle('clip', 5)];
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: sources,
        // Scene artwork colour, not application chrome.
        // eslint-disable-next-line no-restricted-syntax
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
        artworkOrder: ['clip', 'subject'],
      },
    },
    selectedObjectId: 'subject',
    additionalSelectedIds: new Set(['clip']),
  });
  if (operation === 'weld') useStore.getState().weldSelection({ retainCompound: true });
  else useStore.getState().booleanSelection(operation, { retainCompound: true });
  const result = useStore.getState().project.scene.objects[0];
  if (result === undefined || !isBooleanCompoundObject(result))
    throw new Error('Expected live compound');
  return result;
}
export function reopenCompoundProject(): void {
  const result = deserializeProject(serializeProject(useStore.getState().project));
  if (result.kind !== 'ok') throw new Error('Expected compound project to reopen');
  useStore.getState().setProject(result.project);
}
