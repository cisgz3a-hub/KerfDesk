const CHUNK_CHARACTERS = 64 * 1024;

class JsonTextWriter {
  private readonly chunks: string[] = [];
  private readonly indents = [''];
  private current = '';

  append(text: string): void {
    if (this.current.length + text.length < CHUNK_CHARACTERS) {
      this.current += text;
      return;
    }
    this.flush();
    if (text.length >= CHUNK_CHARACTERS) this.chunks.push(text);
    else this.current = text;
  }

  line(depth: number): void {
    while (this.indents.length <= depth) {
      this.indents.push(`${this.indents.at(-1) ?? ''}  `);
    }
    this.append(`\n${this.indents[depth] ?? ''}`);
  }

  finish(): string {
    this.flush();
    return this.chunks.join('');
  }

  private flush(): void {
    if (this.current === '') return;
    this.chunks.push(this.current);
    this.current = '';
  }
}

export function stringifyProjectJson(project: unknown): string {
  const writer = new JsonTextWriter();
  writePreparedValue(writer, prepareValue(project, ''), 0, new Set());
  return writer.finish();
}

function prepareValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  const toJSON = (value as { readonly toJSON?: unknown }).toJSON;
  return typeof toJSON === 'function'
    ? (toJSON as (this: object, key: string) => unknown).call(value, key)
    : value;
}

function writePreparedValue(
  writer: JsonTextWriter,
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): void {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    writer.append(encoded ?? 'null');
    return;
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    writer.append(JSON.stringify(value));
    return;
  }
  if (ancestors.has(value)) throw new TypeError('Converting circular structure to JSON');
  ancestors.add(value);
  try {
    if (value instanceof Float32Array || value instanceof Float64Array) {
      writeFloatArray(writer, value, depth, ancestors);
    } else if (Array.isArray(value)) writeArray(writer, value, depth, ancestors);
    else writeObject(writer, value as Record<string, unknown>, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function writeFloatArray(
  writer: JsonTextWriter,
  values: Float32Array | Float64Array,
  depth: number,
  ancestors: Set<object>,
): void {
  writer.append('[');
  if (values.length === 0) {
    writer.append(']');
    return;
  }
  if (allFinite(values)) {
    writer.line(depth + 1);
    writer.append(values.join(`,\n${'  '.repeat(depth + 1)}`));
    writer.line(depth);
    writer.append(']');
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) writer.append(',');
    writer.line(depth + 1);
    writePreparedValue(writer, values[index], depth + 1, ancestors);
  }
  if (values.length > 0) writer.line(depth);
  writer.append(']');
}

function allFinite(values: Float32Array | Float64Array): boolean {
  return values.every((value) => Number.isFinite(value));
}

function writeArray(
  writer: JsonTextWriter,
  values: unknown[],
  depth: number,
  ancestors: Set<object>,
): void {
  writer.append('[');
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) writer.append(',');
    writer.line(depth + 1);
    const value = prepareValue(values[index], String(index));
    writePreparedValue(writer, isOmitted(value) ? null : value, depth + 1, ancestors);
  }
  if (values.length > 0) writer.line(depth);
  writer.append(']');
}

function writeObject(
  writer: JsonTextWriter,
  value: Record<string, unknown>,
  depth: number,
  ancestors: Set<object>,
): void {
  writer.append('{');
  let written = 0;
  for (const key of Object.keys(value)) {
    const child = prepareValue(value[key], key);
    if (isOmitted(child)) continue;
    if (written > 0) writer.append(',');
    writer.line(depth + 1);
    writer.append(`${JSON.stringify(key)}: `);
    writePreparedValue(writer, child, depth + 1, ancestors);
    written += 1;
  }
  if (written > 0) writer.line(depth);
  writer.append('}');
}

function isOmitted(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}
