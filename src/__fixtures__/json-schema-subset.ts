/**
 * Validator for the JSON Schema subset the checked-in contracts actually use:
 * `$ref`, `oneOf`, `type`, `const`, `enum`, `required`, `properties`,
 * `additionalProperties: false`, `items`, `minItems`, `minimum` and `pattern`.
 *
 * Test scaffolding, not production validation. It exists so a versioned schema
 * can be pinned against real instances without taking on a runtime dependency.
 */

/** One place an instance failed to match its schema. */
export type SchemaViolation = {
  readonly path: string;
  readonly message: string;
};

type SchemaNode = Readonly<Record<string, unknown>>;

const ROOT_PATH = '$';

/** Returns every violation found; an empty array means the instance matches. */
export function validateAgainstSchema(value: unknown, schema: SchemaNode): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  check(value, schema, ROOT_PATH, schema, violations);
  return violations;
}

function check(
  value: unknown,
  node: SchemaNode,
  path: string,
  root: SchemaNode,
  out: SchemaViolation[],
): void {
  const ref = stringAt(node, '$ref');
  if (ref !== null) {
    const resolved = resolveRef(ref, root);
    if (resolved === null) out.push({ path, message: `unresolvable $ref ${ref}` });
    else check(value, resolved, path, root, out);
    return;
  }
  const branches = arrayAt(node, 'oneOf');
  if (branches !== null) {
    checkOneOf(value, branches, path, root, out);
    return;
  }
  if (!checkType(value, node, path, out)) return;
  checkScalar(value, node, path, out);
  if (Array.isArray(value)) checkArray(value, node, path, root, out);
  else if (isPlainObject(value)) checkObject(value, node, path, root, out);
}

function checkOneOf(
  value: unknown,
  branches: ReadonlyArray<unknown>,
  path: string,
  root: SchemaNode,
  out: SchemaViolation[],
): void {
  const matched = branches.filter((branch) => {
    if (!isPlainObject(branch)) return false;
    const probe: SchemaViolation[] = [];
    check(value, branch, path, root, probe);
    return probe.length === 0;
  });
  if (matched.length !== 1) {
    out.push({ path, message: `matched ${matched.length} oneOf branches, expected exactly 1` });
  }
}

function checkType(
  value: unknown,
  node: SchemaNode,
  path: string,
  out: SchemaViolation[],
): boolean {
  const declared = node['type'];
  if (declared === undefined) return true;
  const allowed = typeof declared === 'string' ? [declared] : declared;
  if (!Array.isArray(allowed)) return true;
  if (allowed.some((name) => matchesType(value, name))) return true;
  out.push({ path, message: `expected type ${allowed.join('|')}, got ${describe(value)}` });
  return false;
}

function matchesType(value: unknown, name: unknown): boolean {
  if (name === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (name === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (name === 'string') return typeof value === 'string';
  if (name === 'boolean') return typeof value === 'boolean';
  if (name === 'null') return value === null;
  if (name === 'array') return Array.isArray(value);
  if (name === 'object') return isPlainObject(value);
  return false;
}

function checkScalar(value: unknown, node: SchemaNode, path: string, out: SchemaViolation[]): void {
  if ('const' in node && value !== node['const']) {
    out.push({ path, message: `expected const ${JSON.stringify(node['const'])}` });
  }
  const allowed = arrayAt(node, 'enum');
  if (allowed !== null && !allowed.includes(value)) {
    out.push({ path, message: `${JSON.stringify(value)} is not in ${JSON.stringify(allowed)}` });
  }
  const minimum = node['minimum'];
  if (typeof minimum === 'number' && typeof value === 'number' && value < minimum) {
    out.push({ path, message: `${value} is below minimum ${minimum}` });
  }
  const pattern = stringAt(node, 'pattern');
  if (pattern !== null && typeof value === 'string' && !new RegExp(pattern, 'u').test(value)) {
    out.push({ path, message: `${JSON.stringify(value)} does not match /${pattern}/` });
  }
}

function checkArray(
  value: ReadonlyArray<unknown>,
  node: SchemaNode,
  path: string,
  root: SchemaNode,
  out: SchemaViolation[],
): void {
  const minItems = node['minItems'];
  if (typeof minItems === 'number' && value.length < minItems) {
    out.push({ path, message: `${value.length} items is below minItems ${minItems}` });
  }
  const items = node['items'];
  if (!isPlainObject(items)) return;
  value.forEach((entry, index) => {
    check(entry, items, `${path}[${index}]`, root, out);
  });
}

function checkObject(
  value: Readonly<Record<string, unknown>>,
  node: SchemaNode,
  path: string,
  root: SchemaNode,
  out: SchemaViolation[],
): void {
  const properties = isPlainObject(node['properties']) ? node['properties'] : {};
  for (const name of arrayAt(node, 'required') ?? []) {
    if (typeof name === 'string' && !(name in value)) {
      out.push({ path, message: `missing required property ${name}` });
    }
  }
  if (node['additionalProperties'] === false) {
    for (const name of Object.keys(value)) {
      if (!(name in properties)) out.push({ path, message: `unexpected property ${name}` });
    }
  }
  for (const [name, child] of Object.entries(properties)) {
    if (!(name in value) || !isPlainObject(child)) continue;
    check(value[name], child, `${path}.${name}`, root, out);
  }
}

function resolveRef(ref: string, root: SchemaNode): SchemaNode | null {
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) return null;
  const defs = root['$defs'];
  if (!isPlainObject(defs)) return null;
  const target = defs[ref.slice(prefix.length)];
  return isPlainObject(target) ? target : null;
}

function arrayAt(node: SchemaNode, key: string): ReadonlyArray<unknown> | null {
  const value = node[key];
  return Array.isArray(value) ? value : null;
}

function stringAt(node: SchemaNode, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' ? value : null;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
