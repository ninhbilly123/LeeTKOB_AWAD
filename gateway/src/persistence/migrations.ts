import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PgPoolLike } from './pg.types';

export const REQUIRED_MIGRATION_VERSION = '0001_init_pa3_schema';

export interface MigrationPair {
  version: string;
  upPath: string;
  downPath: string;
}

export function resolveMigrationsDir(): string {
  const candidates = [
    resolve(__dirname, '../../migrations'),
    resolve(__dirname, '../../../migrations'),
    resolve(process.cwd(), 'gateway/migrations'),
    resolve(process.cwd(), 'migrations'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  throw new Error(
    `Could not locate gateway/migrations directory. Checked: ${candidates.join(', ')}`,
  );
}

export function listMigrationPairs(
  migrationsDir: string = resolveMigrationsDir(),
): MigrationPair[] {
  const files = readdirSync(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith('.up.sql')).sort();
  return upFiles.map((upFile) => {
    const version = upFile.slice(0, -'.up.sql'.length);
    const downFile = `${version}.down.sql`;
    const downPath = join(migrationsDir, downFile);
    if (!existsSync(downPath)) {
      throw new Error(`Missing rollback file '${downFile}' for migration '${version}'.`);
    }
    return {
      version,
      upPath: join(migrationsDir, upFile),
      downPath,
    };
  });
}

async function ensureMigrationsTable(pool: PgPoolLike): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrationsUp(
  pool: PgPoolLike,
  migrationsDir: string = resolveMigrationsDir(),
): Promise<string[]> {
  await ensureMigrationsTable(pool);
  const appliedRes = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  const applied = new Set(appliedRes.rows.map((row) => String(row.version)));
  const pairs = listMigrationPairs(migrationsDir);
  const executed: string[] = [];

  for (const pair of pairs) {
    if (applied.has(pair.version)) {
      continue;
    }
    const sql = readFileSync(pair.upPath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [pair.version]);
      await client.query('COMMIT');
      executed.push(pair.version);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore secondary rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return executed;
}

export async function rollbackLastMigration(
  pool: PgPoolLike,
  migrationsDir: string = resolveMigrationsDir(),
): Promise<string | null> {
  await ensureMigrationsTable(pool);
  const latestRes = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1',
  );
  const latest = latestRes.rows[0]?.version ? String(latestRes.rows[0].version) : null;
  if (!latest) {
    return null;
  }

  const pair = listMigrationPairs(migrationsDir).find((item) => item.version === latest);
  if (!pair) {
    throw new Error(`Migration rollback file not found for version '${latest}'.`);
  }

  const sql = readFileSync(pair.downPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [pair.version]);
    await client.query('COMMIT');
    return pair.version;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore secondary rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function assertMigrationsApplied(
  pool: PgPoolLike,
  requiredVersion: string = REQUIRED_MIGRATION_VERSION,
): Promise<void> {
  try {
    const res = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [requiredVersion],
    );
    if (res.rows.length === 0) {
      throw new Error(
        `Database schema migration '${requiredVersion}' has not been applied. Run 'npm run db:migrate --workspace=gateway' before starting Gateway.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('schema_migrations')) {
      throw err;
    }
    throw new Error(
      `Database migration verification failed for '${requiredVersion}'. Ensure Postgres is reachable and run 'npm run db:migrate --workspace=gateway'. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
