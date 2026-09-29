// Every administration call leaves an `audit:<time>:<id>` record: which route, which
// licence, order or grant it targeted, what happened, when, and which administrator
// token was used. Mutations write it inside their own transaction, so a change and its
// record commit or roll back together. Records never hold keys, tokens or bodies
// (ADR-523 Amendment 3).

const SEQUENCE = 'audit-sequence';
const digits = (value) => String(value).padStart(10, '0');

export function writeAudit(tx, authority, admin, entry) {
  const at = authority.now();
  // The ID is a durable sequence number, so records of one second keep their order.
  const sequence = tx.get(SEQUENCE)?.next ?? 1;
  tx.put(SEQUENCE, { next: sequence + 1 });
  tx.put(`audit:${digits(at)}:${digits(sequence)}`, {
    ...entry,
    credential: admin?.credential ?? null,
    at,
  });
}

const TARGET_FIELDS = ['licenseId', 'orderId', 'transactionId', 'grantId'];

/**
 * Records an authenticated administration call the service refused. Best effort: the
 * refusal stands even if the record cannot be written.
 */
export function auditRefusal(authority, admin, route, body, code) {
  const target =
    TARGET_FIELDS.map((field) => body?.[field]).find(
      (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value),
    ) ?? null;
  try {
    authority.records.transaction((tx) =>
      writeAudit(tx, authority, admin, { route, target, outcome: code }),
    );
  } catch {
    /* The refusal is already the answer; a lost audit line must not replace it. */
  }
}
