export type SqliteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
};

export type SqliteDatabase = {
  prepare(sql: string): SqliteStatement;
  transaction: (fn: (...args: any[]) => any) => any;
  exec?(sql: string): void;
};

export type OwnerContext = {
  ownerUserId: string | null;
  isAdmin: boolean;
};

export type SqliteStoreContext = {
  db: SqliteDatabase;
  owner: OwnerContext;
  nowIso?: () => string;
};
