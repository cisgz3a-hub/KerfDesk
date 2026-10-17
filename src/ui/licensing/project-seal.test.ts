import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { splitProjectSeal, withProjectSeal } from '../../io/project/project-device-seal';
import {
  isTrustedProject,
  projectTextSealedHere,
  resetProjectSealForTests,
  sealProjectText,
  sealProjectTextAsync,
  trustIfSealedHere,
} from './project-seal';

const KEY = 'a'.repeat(43);
const OTHER_KEY = 'b'.repeat(43);

afterEach(() => resetProjectSealForTests());

describe('project device seals (ADR-592)', () => {
  it.each([false, true])('round-trips pretty and compact text (compact %s)', (compact) => {
    const text = serializeProject(createProject(), { compact });
    const sealed = withProjectSeal(text, 'S'.repeat(43));
    expect(sealed).not.toBe(text);
    expect(splitProjectSeal(sealed)).toEqual({ body: text, seal: 'S'.repeat(43) });
    expect(splitProjectSeal(text)).toEqual({ body: text, seal: null });
    expect(withProjectSeal(sealed, 'T'.repeat(43))).toBe(sealed);
  });

  it('drops the seal when the project is read, so a re-save never carries a stale one', () => {
    resetProjectSealForTests(KEY);
    const text = serializeProject(createProject());
    const result = deserializeProject(sealProjectText(text));
    if (result.kind !== 'ok') throw new Error(result.kind);
    expect(result.project).not.toHaveProperty('kerfdeskDeviceSeal');
    expect(serializeProject(result.project)).toBe(text);
  });

  it('accepts only text sealed by this computer and left unchanged', () => {
    resetProjectSealForTests(KEY);
    const text = serializeProject(createProject());
    const sealed = sealProjectText(text);
    expect(projectTextSealedHere(sealed)).toBe(true);
    expect(projectTextSealedHere(text)).toBe(false);
    expect(projectTextSealedHere(sealed.replace('"schemaVersion"', '"schemaVersion" '))).toBe(
      false,
    );
    resetProjectSealForTests(OTHER_KEY);
    expect(projectTextSealedHere(sealed)).toBe(false);
  });

  it('seals byte-identically through native WebCrypto and the synchronous HMAC', async () => {
    expect(globalThis.crypto?.subtle).toBeDefined();
    resetProjectSealForTests(KEY);
    const texts = [
      serializeProject(createProject()),
      serializeProject({ ...createProject(), notes: 'é ✓ '.repeat(20_000) }, { compact: true }),
    ];
    for (const text of texts) {
      const sealed = await sealProjectTextAsync(text);
      expect(sealed).toBe(sealProjectText(text));
      expect(projectTextSealedHere(sealed)).toBe(true);
      // An independent RFC 2104 HMAC-SHA256 over the domain-tagged text.
      const expected = createHmac('sha256', Buffer.from(KEY, 'base64url'))
        .update(`kerfdesk-project-seal:v1:${text}`, 'utf8')
        .digest('base64url');
      expect(splitProjectSeal(sealed).seal).toBe(expected);
      expect(await sealProjectTextAsync(sealed)).toBe(sealed);
    }
    resetProjectSealForTests();
    expect(await sealProjectTextAsync(texts[0]!)).toBe(texts[0]);
  });

  it('never seals or trusts without a key', () => {
    const text = serializeProject(createProject());
    expect(sealProjectText(text)).toBe(text);
    const project = createProject();
    expect(trustIfSealedHere(project, withProjectSeal(text, KEY))).toBe(false);
    expect(isTrustedProject(project)).toBe(false);
  });
});
