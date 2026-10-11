import {
  isCommentNode,
  isFunctionNode,
  isTokenNode,
  isWhiteSpaceOrCommentNode,
  type ComponentValue,
} from '@csstools/css-parser-algorithms';
import { isTokenDelim, isTokenIdent } from '@csstools/css-tokenizer';

const RESERVED = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer', 'default']);
const SYNTAX_TYPES = new Set([
  'angle',
  'color',
  'custom-ident',
  'image',
  'integer',
  'length',
  'length-percentage',
  'number',
  'percentage',
  'resolution',
  'string',
  'time',
  'transform-function',
  'transform-list',
]);

/** Only validate substitution syntax; attribute lookup/evaluation stays unresolved. */
export function validSvgOpacityAttrHeader(header: ComponentValue[]): boolean {
  const [name, type] = header;
  if (!isTokenNode(name) || !isTokenIdent(name.value)) return false;
  if (header.length === 1) return true;
  if (header.length !== 2) return false;
  // Follow the browser-supported unqualified name grammar. Draft-only namespace
  // names and substitutions in headers are not yet accepted by Chrome.
  if (isTokenNode(type)) return customIdent(type) || delim(type, '%');
  return isFunctionNode(type) && type.getName().toLowerCase() === 'type' && validSyntax(type.value);
}

function customIdent(node: ComponentValue | undefined): boolean {
  return (
    isTokenNode(node) &&
    isTokenIdent(node.value) &&
    !RESERVED.has(node.value[4].value.toLowerCase())
  );
}

// CSS Values 5 <syntax>: a universal *, or | separated type/keyword components.
// Whitespace is forbidden inside <type> and before #/+, but comments are not
// whitespace. Type names are case-sensitive. attr() explicitly excludes <url>.
function validSyntax(values: ComponentValue[]): boolean {
  const nodes = values.filter((node) => !isCommentNode(node));
  const skipSpace = (start: number) => {
    let at = start;
    while (at < nodes.length && isWhiteSpaceOrCommentNode(nodes[at])) at += 1;
    return at;
  };
  let at = skipSpace(0);
  if (delim(nodes[at], '*')) return skipSpace(at + 1) === nodes.length;
  while (at < nodes.length) {
    const end = componentEnd(nodes, at);
    if (end === null) return false;
    at = end;
    at = skipSpace(at);
    if (at === nodes.length) return true;
    if (!delim(nodes[at], '|')) return false;
    at = skipSpace(at + 1);
  }
  return false;
}

function componentEnd(nodes: ComponentValue[], start: number): number | null {
  let at = start;
  let transformList = false;
  if (delim(nodes[at], '<')) {
    const type = nodes[at + 1];
    if (
      !isTokenNode(type) ||
      !isTokenIdent(type.value) ||
      !SYNTAX_TYPES.has(type.value[4].value) ||
      !delim(nodes[at + 2], '>')
    )
      return null;
    transformList = type.value[4].value === 'transform-list';
    at += 3;
  } else if (customIdent(nodes[at])) at += 1;
  else return null;
  if (delim(nodes[at], '#') || delim(nodes[at], '+')) return transformList ? null : at + 1;
  return at;
}

function delim(node: ComponentValue | undefined, value: string): boolean {
  return isTokenNode(node) && isTokenDelim(node.value) && node.value[4].value === value;
}
