import test from 'node:test';
import { RuleTester } from 'eslint';
import { noRawProjectSetState } from './no-raw-project-set-state.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const raw = [{ messageId: 'raw' }];

test('project edits outside the store cannot skip its Pro guard (ADR-592, audit 02-P2-1)', () => {
  tester.run('no-raw-project-set-state', noRawProjectSetState, {
    valid: [
      'useStore.setState({ dirty: true });',
      'useStore.setState({ savedLibraries: reconciled, savedLibrariesReady: true });',
      'useStore.setState({ savedLibraries, ...(open ? { materialLibrary: open } : {}) });',
      'useStore.getState().commitProjectEdit((state) => insertPersonalArtwork(state, entry));',
      // A guarded wrapper may receive the setter itself.
      'proOperationMutationSetter(useStore.setState, useStore.getState)(update);',
      'useLaserStore.setState((state) => ({ project: state.project }));',
      'store.setState(patch);',
    ],
    invalid: [
      // My artwork Insert before the fix.
      { code: 'useStore.setState((state) => insertPersonalArtwork(state, entry));', errors: raw },
      // The barcode edit before the fix: a prepared patch.
      { code: 'useStore.setState(replaced);', errors: raw },
      { code: 'useStore.setState({ project: upgraded.project, dirty: true });', errors: raw },
      { code: "useStore.setState({ 'project': next });", errors: raw },
      { code: 'useStore.setState({ ...change, dirty: true });', errors: raw },
      { code: 'useStore.setState({ ...(edit ? { project: next } : {}) });', errors: raw },
      { code: 'useStore.setState({ [key]: value });', errors: raw },
    ],
  });
});
