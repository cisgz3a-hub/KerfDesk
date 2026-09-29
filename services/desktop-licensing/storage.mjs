// One SQLite-backed Durable Object is the launch-scale authority. No eventually
// consistent cache participates in seat allocation or payment fulfilment.
export class SqliteRecords {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get(key) {
    const rows = this.sql.exec('SELECT value FROM records WHERE key = ?', key).toArray();
    return rows.length ? JSON.parse(rows[0].value) : undefined;
  }

  put(key, value) {
    this.sql.exec(
      'INSERT INTO records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }

  delete(key) {
    this.sql.exec('DELETE FROM records WHERE key = ?', key);
  }

  /** Up to `limit` records after `after`, in key order: one bounded export page. */
  page(after, limit) {
    return this.sql
      .exec('SELECT key, value FROM records WHERE key > ? ORDER BY key LIMIT ?', after, limit)
      .toArray()
      .map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }

  /** Keys starting with `prefix` whose stored value has `field` equal to `value`. */
  keysWhere(prefix, field, value) {
    if (!/^[a-z-]+:$/u.test(prefix) || !/^[A-Za-z]+$/u.test(field)) throw new Error('Bad query');
    // Every key under "name:" sorts before "name;", the next character after ':'.
    const end = `${prefix.slice(0, -1)};`;
    return this.sql
      .exec(
        'SELECT key FROM records WHERE key >= ? AND key < ? AND json_extract(value, ?) = ?',
        prefix,
        end,
        `$.${field}`,
        value,
      )
      .toArray()
      .map((row) => row.key);
  }

  /** A one-row read that proves the object and its SQLite store answer. */
  ping() {
    this.sql.exec('SELECT 1 FROM records LIMIT 1').toArray();
  }

  transaction(callback) {
    return this.storage.transactionSync(() => callback(this));
  }
}
