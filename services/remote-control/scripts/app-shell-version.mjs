import { createHash } from 'node:crypto';

// Include fixed-URL shell assets so an icon-only update replaces the offline
// cache just as a new JavaScript or stylesheet bundle does.
export function appShellVersion(phone, files) {
  const hash = createHash('sha256');
  const assets = new Map([['app.js', phone.js], ['app.css', phone.css], ...files]);
  for (const [name, content] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = Buffer.from(content);
    hash.update(`${name.length}:${name}:${bytes.length}:`).update(bytes);
  }
  return hash.digest('hex').slice(0, 12);
}
