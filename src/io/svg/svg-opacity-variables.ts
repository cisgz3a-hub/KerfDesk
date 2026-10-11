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
  isTokenNumber,
  NumberType,
  TokenType,
  tokenize,
  type CSSToken,
} from '@csstools/css-tokenizer';
import { validSvgOpacityAttrHeader } from './svg-opacity-attr';

const INVALID_TOKENS = new Set([
  TokenType.BadString,
  TokenType.BadURL,
  TokenType.CloseParen,
  TokenType.CloseSquare,
  TokenType.CloseCurly,
]);

/** Retain syntactically valid substitutions until computed-value time. */
export function hasSvgOpacityVariables(value: string): boolean {
  try {
    return validVariableValue(parseListOfComponentValues(tokenize({ css: value })));
  } catch {
    return false;
  }
}

function validVariableValue(nodes: ComponentValue[]): boolean {
  let found = false;
  // CSS Variables 1 sections 2.1/3 and CSS Environment Variables 1 section 3:
  // var()/env(), and CSS Values 5 attr(), postpone property grammar checking.
  // Its fallback is a declaration-value (possibly empty), not an opacity yet.
  // Substitution needs document/browser context this importer does not keep.
  const valid = (values: ComponentValue[], topLevel: boolean): boolean =>
    values.every((node) => {
      if (isTokenNode(node)) return validToken(node.value, topLevel);
      if (isFunctionNode(node)) {
        const kind = node.getName().toLowerCase();
        if (kind !== 'var' && kind !== 'env' && kind !== 'attr') return valid(node.value, false);
        found = true;
        const args = node.value.filter((part) => !isWhiteSpaceOrCommentNode(part));
        const comma = args.findIndex(
          (part) => isTokenNode(part) && part.value[0] === TokenType.Comma,
        );
        const header = comma < 0 ? args : args.slice(0, comma);
        return validHeader(header, kind) && (comma < 0 || valid(args.slice(comma + 1), true));
      }
      return !isSimpleBlockNode(node) || valid(node.value, false);
    });
  // The component parser deliberately closes open functions at EOF, as CSS
  // does. Unmatched closing brackets remain tokens and are rejected above.
  return valid(nodes, true) && found;
}

function validHeader(header: ComponentValue[], kind: 'var' | 'env' | 'attr'): boolean {
  if (kind === 'attr') return validSvgOpacityAttrHeader(header);
  const [name] = header;
  if (!isTokenNode(name) || !isTokenIdent(name.value)) return false;
  if (kind === 'var')
    return (
      header.length === 1 && name.value[4].value.startsWith('--') && name.value[4].value !== '--'
    );
  // Chrome also accepts keyword names (e.g. initial/default), although the
  // env draft uses custom-ident. Retain these browser-accepted unresolved
  // winners with a warning; interpreting their value remains outside scope.
  return header
    .slice(1)
    .every(
      (index) =>
        isTokenNode(index) &&
        isTokenNumber(index.value) &&
        index.value[4].type === NumberType.Integer &&
        index.value[4].value >= 0,
    );
}

function validToken(token: CSSToken, topLevel: boolean): boolean {
  if (INVALID_TOKENS.has(token[0])) return false;
  return !(
    topLevel &&
    (token[0] === TokenType.Semicolon || (isTokenDelim(token) && token[4].value === '!'))
  );
}
