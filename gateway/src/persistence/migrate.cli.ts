import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { rollbackLastMigration, runMigrationsUp } from './migrations';
import type { PgPoolLike } from './pg.types';

function loadLocalEnv(): void {
  for (const envPath of ['.env', 'gateway/.env']) {
    if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      break;
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations.');
  }

  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });

  try {
    if (direction === 'down') {
      const rolledBack = await rollbackLastMigration(pool as unknown as PgPoolLike);
      console.log(
        rolledBack
          ? `[db:migrate] Rolled back migration: ${rolledBack}`
          : '[db:migrate] No migrations to roll back.',
      );
    } else {
      const applied = await runMigrationsUp(pool as unknown as PgPoolLike);
      console.log(
        applied.length > 0
          ? `[db:migrate] Applied migrations: ${applied.join(', ')}`
          : '[db:migrate] Database schema is already up to date.',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[db:migrate] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
