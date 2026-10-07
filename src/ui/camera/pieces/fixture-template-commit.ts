import type { Project } from '../../../core/scene';
import type { FixtureTemplate } from '../../../core/camera/fixtures/fixture-template';
import { fixtureTemplateMutation } from '../../state/fixture-template-actions';
import { proOperationMutationSetter } from '../../licensing/pro-operation-mutation';
import { useStore } from '../../state';
import { useToastStore } from '../../state/toast-store';

export function commitFixtureTemplate(
  project: Project,
  epoch: number,
  edit: FixtureTemplate | { readonly deleteId: string },
  onCommitted: () => void,
  isCurrent: () => boolean,
): void {
  const mutate = proOperationMutationSetter(useStore.setState, useStore.getState);
  mutate(
    (state) => {
      const result = fixtureTemplateMutation(state, project, epoch, edit);
      if (result.kind === 'ok') return result.value;
      useToastStore.getState().pushToast(result.error.message, 'warning');
      return {};
    },
    () => {
      if (useStore.getState().project !== project) onCommitted();
    },
    isCurrent,
  );
}
