// ADR-592 decision 5: the store's Pro guard wraps only the setter its own
// actions receive, so a project edit through zustand's public
// `useStore.setState` skips it (rolling audit v2, 02-P2-1: My artwork Insert
// created V-carve work in Free without asking). Outside the store, project
// edits commit through a store action or `commitProjectEdit`.
//
// Reported: any `useStore.setState(...)` whose patch is not an object literal
// (an updater or a prepared patch can carry `project`), and object literals
// that set `project` or spread a patch that may. Literal patches of other state
// (`{ dirty: true }`, libraries) stay allowed. A write that authors nothing,
// such as selection or a format upgrade, takes a justified eslint-disable.

const MESSAGE =
  'useStore.setState skips the Pro guard on project edits (ADR-592). Use a store action or useStore.getState().commitProjectEdit.';

/** @type {import('eslint').Rule.RuleModule} */
export const noRawProjectSetState = {
  meta: {
    type: 'problem',
    docs: { description: 'Project edits outside the store must pass its Pro guard (ADR-592).' },
    messages: { raw: MESSAGE },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isUseStoreSetState(node.callee)) return;
        const patch = node.arguments[0];
        if (patch === undefined) return;
        if (patch.type !== 'ObjectExpression' || patch.properties.some(mayWriteProject)) {
          context.report({ node, messageId: 'raw' });
        }
      },
    };
  },
};

function isUseStoreSetState(callee) {
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'useStore' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'setState'
  );
}

function mayWriteProject(property) {
  if (property.type === 'SpreadElement') return spreadMayWriteProject(property.argument);
  if (property.computed) return true;
  const key = property.key;
  return (
    (key.type === 'Identifier' && key.name === 'project') ||
    (key.type === 'Literal' && key.value === 'project')
  );
}

// `...(open ? { materialLibrary } : {})` spreads literals that can be read;
// any other spread could carry `project`.
function spreadMayWriteProject(argument) {
  if (argument.type === 'ObjectExpression') return argument.properties.some(mayWriteProject);
  if (argument.type === 'ConditionalExpression')
    return spreadMayWriteProject(argument.consequent) || spreadMayWriteProject(argument.alternate);
  return true;
}

export default { rules: { 'no-raw-project-set-state': noRawProjectSetState } };
