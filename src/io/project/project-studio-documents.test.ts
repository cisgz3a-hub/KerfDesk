import { describe, expect, it } from 'vitest';
import { createProject, PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { prepareAutosaveRecord, readAutosaveRecord } from '../../ui/state/autosave-record';
import { studioDocument } from './studio-document.test-fixture';
import {
  MAX_STUDIO_DOCUMENT_BYTES,
  validateStudioDocuments,
  validateProjectStudioDocuments,
} from './project-studio-document-validator';

describe('native studio documents in portable projects', () => {
  it('retains exact native bytes, identity, editor version and revision in manual and autosave roundtrips', () => {
    const studioDocuments = [
      studioDocument(),
      studioDocument({
        id: '22222222-2222-4222-8222-222222222222',
        editor: 'photo',
        nativeFormat: 'pcraft',
        editorVersion: '0.7.0',
      }),
    ];
    const project = { ...createProject(), studioDocuments };
    const prepared = prepareProjectForPersistence(project);
    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(deserializeProject(prepared.json)).toMatchObject({
      kind: 'ok',
      project: { studioDocuments },
    });
    const autosave = prepareAutosaveRecord(project, 123, 'editor-session', 'test-key');
    expect(autosave.kind).toBe('ok');
    if (autosave.kind !== 'ok') throw new Error('Autosave failed');
    expect(readAutosaveRecord(autosave.record, 'test-key')).toMatchObject({
      kind: 'ok',
      snapshot: { project: { studioDocuments } },
    });
  });

  it('promotes v15 projects without inventing editor documents', () => {
    const raw = { ...createProject(), schemaVersion: 15 };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result).toMatchObject({
      kind: 'ok',
      migratedFrom: 15,
      project: { schemaVersion: PROJECT_SCHEMA_VERSION },
    });
    if (result.kind === 'ok') expect(result.project.studioDocuments).toBeUndefined();
  });

  it.each([
    { nativeBase64: 'YR==' },
    { nativeBase64: 'YWJ=' },
    { nativeBase64: 'YW Jj' },
    { nativeBase64: '' },
    { nativeBase64: '====' },
    { nativeSha256: 'bad-hash' },
    { nativeFormat: 'pcraft' },
    { id: '../foreign-file' },
    { revision: '' },
  ])('rejects malformed native metadata %j instead of dropping it', (patch) => {
    const raw = { ...createProject(), studioDocuments: [{ ...studioDocument(), ...patch }] };
    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
  });

  it('rejects duplicate durable identities and too many documents', () => {
    expect(validateStudioDocuments([studioDocument(), studioDocument()])).toContain('duplicate');
    expect(
      validateStudioDocuments(
        Array.from({ length: 65 }, (_, n) => studioDocument({ id: `doc-${n}` })),
      ),
    ).toContain('64');
  });

  it('bounds native allocation before decoding and aggregates the project budget', () => {
    const oversized = 'A'.repeat(4 * Math.ceil((MAX_STUDIO_DOCUMENT_BYTES + 1) / 3));
    expect(validateStudioDocuments([studioDocument({ nativeBase64: oversized })])).toContain(
      '32 MiB',
    );
    const large = 'A'.repeat(4 * Math.floor(MAX_STUDIO_DOCUMENT_BYTES / 3));
    const documents = [1, 2, 3].map((id) =>
      studioDocument({
        id: `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`,
        nativeBase64: large,
      }),
    );
    expect(validateStudioDocuments(documents)).toContain('64 MiB');
  });

  it('validates native documents stored inside workflow project archives too', () => {
    const nested = serializeProject({
      ...createProject(),
      studioDocuments: [studioDocument({ nativeSha256: 'invalid' })],
    });
    expect(
      validateProjectStudioDocuments({ sheetBook: { inactive: [{ projectJson: nested }] } }),
    ).toContain('SHA-256');
  });
});
