export interface PgQueryResult<R extends Record<string, unknown> = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}

export interface PgClientLike {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResult<R>>;
  release(): void;
}

export interface PgPoolLike {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResult<R>>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}
