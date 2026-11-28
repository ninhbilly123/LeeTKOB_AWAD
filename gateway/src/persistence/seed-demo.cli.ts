import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { DEMO_CLASSES, DEMO_ENROLLMENTS, DEMO_STAFF, DEMO_USERS } from '../auth/password.util';
import { assertMigrationsApplied } from './migrations';
import type { PgPoolLike } from './pg.types';

function loadLocalEnv(): void {
  for (const envPath of ['.env', 'gateway/.env']) {
    if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      break;
    }
  }
}

export async function seedDemoDatabase(pool: PgPoolLike): Promise<void> {
  await assertMigrationsApplied(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const user of DEMO_USERS) {
      await client.query(
        `INSERT INTO users (id, username, email, display_name, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.username, user.email, user.displayName, user.passwordHash, user.role],
      );
    }

    for (const cls of DEMO_CLASSES) {
      await client.query(
        `INSERT INTO classes (id, code, name, term, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [cls.id, cls.code, cls.name, cls.term, cls.createdBy],
      );
    }

    for (const staff of DEMO_STAFF) {
      await client.query(
        `INSERT INTO class_staff (class_id, ta_id)
         VALUES ($1, $2)
         ON CONFLICT (class_id, ta_id) DO NOTHING`,
        [staff.classId, staff.taId],
      );
    }

    for (const mem of DEMO_ENROLLMENTS) {
      await client.query(
        `INSERT INTO class_enrollments (id, class_id, student_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (class_id, student_id) DO NOTHING`,
        [mem.id, mem.classId, mem.studentId, mem.status],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const isProd = process.env.NODE_ENV === 'production';
  const allowDemoSeed = process.env.ALLOW_DEMO_SEED === 'true';
  if (isProd && !allowDemoSeed) {
    throw new Error(
      'Refusing to seed weak demo accounts in production. Set ALLOW_DEMO_SEED=true explicitly for PA#3 demo environments.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed demo data.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });

  try {
    await seedDemoDatabase(pool as unknown as PgPoolLike);
    console.log('[db:seed:demo] Seeded 5 PA#3 demo accounts, 2 classes, staff, and enrollments.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[db:seed:demo] Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
