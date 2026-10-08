// Bounded operator diagnostics: fixed labels and numeric codes, never provider text or source.
const identifiers = [
  'LicenseAuthority',
  'SandboxLicenseAuthority',
  'ASSETS',
  'LICENSE_AUTHORITY',
  'REQUEST_RATE_LIMITER',
  'WEBHOOK_RATE_LIMITER',
  'TRIAL_RATE_LIMITER',
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_CLIENT_TOKEN',
  'SIGNING_PRIVATE_JWK',
  'SIGNING_KEY_ID',
  'PAYMENTS_ENABLED',
  'LICENSING_ENABLED',
];
const exceptionTypes = [
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'EvalError',
  'URIError',
  'AggregateError',
];
const categoryRules = [
  ['binding-inheritance', /\b(?:inherit|inherits|inherited|inheriting|inheritance|bindings?)\b/u],
  ['assets', /\bassets?\b/u],
  ['durable-object', /\b(?:migrations?|namespaces?|durable[ _-]?objects?|sqlite)\b/u],
  [
    'upload-metadata',
    /\b(?:metadata|multipart|main_module|compatibility|compatibility_date|compatibility_flags|tail_consumers|placement|usage_model|observability)\b/u,
  ],
  [
    'script-validation',
    /\b(?:syntaxerror|referenceerror|typeerror|rangeerror|evalerror|urierror|aggregateerror|compile|compiled|compilation|compiler|compiling|startup|exports?)\b/u,
  ],
  [
    'authorization',
    /\b(?:authenticate|authenticated|authentication|authorization|authorisation|unauthorized|unauthorised|permissions?|forbidden)\b/u,
  ],
  ['quota', /\b(?:quota|rate[ _-]?limit|rate[ _-]?limits|rate[ _-]?limited|too many)\b/u],
];
const metadataKeys = [
  'bindings',
  'main_module',
  'compatibility_date',
  'compatibility_flags',
  'usage_model',
  'logpush',
  'tail_consumers',
  'observability',
  'limits',
  'placement',
  'cache_options',
  'tags',
  'keep_assets',
  'assets',
  'migrations',
  'annotations',
  'exports',
];
const hasIdentifier = (text, name) =>
  new RegExp('(?:^|[^A-Za-z0-9_$])' + name + '(?:$|[^A-Za-z0-9_$])', 'u').test(text);

function metadataShape(uploadBody) {
  try {
    const encoded = uploadBody?.get('metadata');
    if (typeof encoded !== 'string' || encoded.length > 32768) return null;
    const metadata = JSON.parse(encoded);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const types = Object.fromEntries(
      metadataKeys
        .filter((key) => Object.hasOwn(metadata, key))
        .map((key) => [
          key,
          metadata[key] === null
            ? 'null'
            : Array.isArray(metadata[key])
              ? 'array'
              : typeof metadata[key],
        ]),
    );
    return { types, nullKeys: metadataKeys.filter((key) => types[key] === 'null') };
  } catch {
    return null;
  }
}

function errorSummary(bytes) {
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!body || body.success !== false || !Array.isArray(body.errors) || !body.errors.length)
    return null;
  const errors = body.errors
    .slice(0, 8)
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (!errors.length) return null;
  const text = errors
    .map(({ message }) => (typeof message === 'string' ? message.slice(0, 4096) : ''))
    .join('\n');
  const codes = [
    ...new Set(
      errors
        .map(({ code }) => code)
        .filter((code) => Number.isSafeInteger(code) && code >= 1000 && code <= 999999),
    ),
  ].sort((a, b) => a - b);
  const categories = categoryRules
    .filter(([, pattern]) => pattern.test(text.toLowerCase()))
    .map(([name]) => name);
  return {
    codes,
    categories: categories.length ? categories : ['unclassified'],
    exceptionTypes: exceptionTypes.filter((name) => hasIdentifier(text, name)),
    identifiers: identifiers.filter((name) => hasIdentifier(text, name)),
    truncated:
      body.errors.length > 8 ||
      errors.some(({ message }) => typeof message === 'string' && message.length > 4096),
  };
}

export async function readCloudflareFailure(response, uploadBody) {
  const diagnostic = { errors: null, metadataShape: metadataShape(uploadBody) };
  let reader;
  let timer;
  let expired = false;
  try {
    reader = response.body?.getReader();
    if (!reader) return diagnostic;
    const read = async () => {
      const chunks = [];
      let size = 0;
      while (!expired) {
        const { done, value } = await reader.read();
        if (expired) return null;
        if (done) return errorSummary(Buffer.concat(chunks, size));
        if (
          !(value instanceof Uint8Array) ||
          value.byteLength === 0 ||
          (size += value.byteLength) > 32768
        )
          return null;
        chunks.push(Buffer.from(value));
      }
      return null;
    };
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        resolve(null);
      }, 2000);
    });
    diagnostic.errors = await Promise.race([read(), deadline]);
  } catch {
    // Unavailable diagnostics must never replace the original HTTP failure.
  } finally {
    clearTimeout(timer);
    try {
      void reader?.cancel().catch(() => undefined);
    } catch {
      /* Reader unavailable. */
    }
  }
  return diagnostic;
}
