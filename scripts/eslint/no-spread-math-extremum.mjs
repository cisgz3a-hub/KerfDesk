// Performance audit S7-P2-3: `Math.min(...values)` and `Math.max(...values)`
// put every element on the call stack, so an array past about 120,000 numbers
// throws "Maximum call stack size exceeded". Text on a path and bent text failed
// that way from about 75 characters in Special Elite. The array is rarely
// bounded by the code that spreads it (points of a design, lines of a job), so
// shipped code folds with minOf / maxOf from src/core/util instead, which give
// the same result for every input. Two or three plain arguments stay allowed.

const MESSAGE =
  'Math.{{name}}(...values) overflows the call stack on large arrays (audit S7-P2-3). Use {{helper}}(values) from src/core/util.';

/** @type {import('eslint').Rule.RuleModule} */
export const noSpreadMathExtremum = {
  meta: {
    type: 'problem',
    docs: { description: 'No array spread into Math.min / Math.max (audit S7-P2-3).' },
    messages: { spread: MESSAGE },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = mathExtremumName(node.callee);
        if (name === null) return;
        if (!node.arguments.some((argument) => argument.type === 'SpreadElement')) return;
        const helper = name === 'min' ? 'minOf' : 'maxOf';
        context.report({ node, messageId: 'spread', data: { name, helper } });
      },
    };
  },
};

function mathExtremumName(callee) {
  if (callee.type !== 'MemberExpression' || callee.computed) return null;
  if (callee.object.type !== 'Identifier' || callee.object.name !== 'Math') return null;
  if (callee.property.type !== 'Identifier') return null;
  const name = callee.property.name;
  return name === 'min' || name === 'max' ? name : null;
}

export default { rules: { 'no-spread-math-extremum': noSpreadMathExtremum } };
