export type SqliteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
};

export type SqliteDatabase = {
  prepare(sql: string): SqliteStatement;
  transaction<T>(fn: () => T): () => T;
};
