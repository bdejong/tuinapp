export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ASSETS?: Fetcher;
  TUINAPP_PASSWORD_HASH: string;
  TUINAPP_SESSION_SECRET: string;
  TUINAPP_PUBLIC_ORIGIN?: string;
}

export interface D1Row<T> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}
