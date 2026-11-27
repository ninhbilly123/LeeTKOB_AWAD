export type PersistenceMode = 'postgres' | 'memory';

export interface DbPoolSettings {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statementTimeoutMs: number;
}

export interface GatewayConfig {
  nodeEnv: string;
  port: number;
  isTest: boolean;
  persistenceMode: PersistenceMode;
  databaseUrl?: string;
  dbPool: DbPoolSettings;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}='${raw}'. Expected an integer between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Validates runtime configuration once at startup (docs/engineering-rules.md Session 03).
 * Outside test runs, refuses to silently fall back to in-memory storage unless explicitly opted in.
 */
export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isTest = Boolean(env.JEST_WORKER_ID) || nodeEnv === 'test';
  const port = parsePositiveInt(env.PORT, 3000, 1, 65535, 'PORT');
  const rawMode = env.PERSISTENCE_MODE?.trim().toLowerCase();
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;

  let persistenceMode: PersistenceMode;
  if (isTest) {
    persistenceMode = 'memory';
  } else if (rawMode === 'memory') {
    if (nodeEnv === 'production') {
      throw new Error('PERSISTENCE_MODE=memory is forbidden when NODE_ENV=production.');
    }
    persistenceMode = 'memory';
  } else if (rawMode && rawMode !== 'postgres') {
    throw new Error(`Invalid PERSISTENCE_MODE='${rawMode}'. Expected 'postgres' or 'memory'.`);
  } else {
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is required to start Gateway. Configure PostgreSQL or set PERSISTENCE_MODE=memory for non-production local prototyping.',
      );
    }
    if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must start with postgres:// or postgresql://.');
    }
    persistenceMode = 'postgres';
  }

  return {
    nodeEnv,
    port,
    isTest,
    persistenceMode,
    databaseUrl: persistenceMode === 'postgres' ? databaseUrl : undefined,
    dbPool: {
      max: parsePositiveInt(env.DB_POOL_MAX, 15, 1, 100, 'DB_POOL_MAX'),
      connectionTimeoutMillis: parsePositiveInt(
        env.DB_CONNECT_TIMEOUT_MS,
        5000,
        500,
        60000,
        'DB_CONNECT_TIMEOUT_MS',
      ),
      idleTimeoutMillis: parsePositiveInt(
        env.DB_IDLE_TIMEOUT_MS,
        30000,
        1000,
        300000,
        'DB_IDLE_TIMEOUT_MS',
      ),
      statementTimeoutMs: parsePositiveInt(
        env.DB_STATEMENT_TIMEOUT_MS,
        10000,
        1000,
        120000,
        'DB_STATEMENT_TIMEOUT_MS',
      ),
    },
  };
}
