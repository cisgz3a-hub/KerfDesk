import {
  isFunctionNode,
  isSimpleBlockNode,
  isTokenNode,
  isWhiteSpaceOrCommentNode,
  parseListOfComponentValues,
  type ComponentValue,
} from '@csstools/css-parser-algorithms';
import {
  isTokenDelim,
  isTokenIdent,
  TokenType,
  tokenize,
  type CSSToken,
} from '@csstools/css-tokenizer';

const INVALID_TOKENS = new Set([
  TokenType.BadString,
  TokenType.BadURL,
  TokenType.CloseParen,
  TokenType.CloseSquare,
  TokenType.CloseCurly,
]);

/** Retain syntactically valid variable declarations until computed-value time. */
export function hasSvgOpacityVariables(value: string): boolean {
  try {
    return validVariableValue(parseListOfComponentValues(tokenize({ css: value })));
  } catch {
    return false;
  }
}

function validVariableValue(nodes: ComponentValue[]): boolean {
  let found = false;
  // CSS Variables 1 sections 2.1/3: var() postpones property grammar checking.
  // Its fallback is a declaration-value (possibly empty), not an opacity yet.
  // Full custom-property substitution needs context this importer does not keep.
  const valid = (values: ComponentValue[], topLevel: boolean): boolean =>
    values.every((node) => {
      if (isTokenNode(node)) return validToken(node.value, topLevel);
      if (isFunctionNode(node)) {
        if (node.getName().toLowerCase() !== 'var') return valid(node.value, false);
        found = true;
        const args = node.value.filter((part) => !isWhiteSpaceOrCommentNode(part));
        const [name, comma] = args;
        if (
          !isTokenNode(name) ||
          !isTokenIdent(name.value) ||
          !name.value[4].value.startsWith('--') ||
          name.value[4].value === '--'
        )
          return false;
        if (comma === undefined) return true;
        return (
          isTokenNode(comma) && comma.value[0] === TokenType.Comma && valid(args.slice(2), true)
        );
      }
      return !isSimpleBlockNode(node) || valid(node.value, false);
    });
  // The component parser deliberately closes open functions at EOF, as CSS
  // does. Unmatched closing brackets remain tokens and are rejected above.
  return valid(nodes, true) && found;
}

function validToken(token: CSSToken, topLevel: boolean): boolean {
  if (INVALID_TOKENS.has(token[0])) return false;
  return !(
    topLevel &&
    (token[0] === TokenType.Semicolon || (isTokenDelim(token) && token[4].value === '!'))
  );
}
