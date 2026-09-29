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

  transaction(callback) {
    return this.storage.transactionSync(() => callback(this));
  }
}
