import { HttpException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app';
import { submissionStore } from './support/submissions.fixtures';
import {
  PostgresPersistence,
  PgClientLike,
  PgPoolLike,
  PgQueryResult,
} from '../src/persistence/postgres.store';
import { REQUIRED_MIGRATION_VERSION } from '../src/persistence/migrations';
import { SubmissionStore } from '../src/submissions/submissions.store';
import { LabsStore } from '../src/labs/labs.store';

describe('Part 3: Persistence, isCounting & Queue Job Handoff', () => {
  describe('In-memory HTTP integration (isCounting & Job Outbox)', () => {
    let app: INestApplication;
    const validLabId = 'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001';

    async function loginStudent(username: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send({ username, password: 'student123' })
        .expect(200);
      return res.body.accessToken as string;
    }

    beforeEach(async () => {
      app = await createTestApp();
    });

    afterEach(async () => {
      await app.close();
    });

    it('marks only the latest submission per student per lab as isCounting and enqueues one job per unique submission', async () => {
      const student1Token = await loginStudent('student1');
      const student2Token = await loginStudent('student2');

      const key1 = randomUUID();
      const first = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', `Bearer ${student1Token}`)
        .set('Idempotency-Key', key1)
        .set('Content-Type', 'application/json')
        .send({ code: '#include <iostream>\nint main() { return 0; }' })
        .expect(201);

      expect(submissionStore.getSubmission(first.body.id)?.isCounting).toBe(true);
      expect(submissionStore.getJobsForSubmission(first.body.id)).toHaveLength(1);

      // Idempotent retry must NOT enqueue a second job
      await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', `Bearer ${student1Token}`)
        .set('Idempotency-Key', key1)
        .set('Content-Type', 'application/json')
        .send({ code: '#include <iostream>\nint main() { return 0; }' })
        .expect(201);

      expect(submissionStore.getJobsForSubmission(first.body.id)).toHaveLength(1);

      // Resubmission from student1 flips previous submission's isCounting to false
      const second = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', `Bearer ${student1Token}`)
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'application/json')
        .send({ code: '#include <iostream>\nint main() { return 42; }' })
        .expect(201);

      expect(submissionStore.getSubmission(first.body.id)?.isCounting).toBe(false);
      expect(submissionStore.getSubmission(second.body.id)?.isCounting).toBe(true);

      // Student2 submission does not unset student1's counting submission
      const student2Sub = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', `Bearer ${student2Token}`)
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'application/json')
        .send({ code: '#include <iostream>\nint main() { return 1; }' })
        .expect(201);

      expect(submissionStore.getSubmission(second.body.id)?.isCounting).toBe(true);
      expect(submissionStore.getSubmission(student2Sub.body.id)?.isCounting).toBe(true);
      expect(submissionStore.getAllJobs()).toHaveLength(3);
    });

    it('enqueues job payload containing lab testCases, constraints, and FAQ-05 runtime limits', async () => {
      const taRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send({ username: 'ta1', password: 'ta123' })
        .expect(200);
      const taToken = taRes.body.accessToken as string;

      const labRes = await request(app.getHttpServer())
        .post('/labs')
        .set('Authorization', `Bearer ${taToken}`)
        .set('Content-Type', 'application/json')
        .send({
          classId: 'class_cs101',
          title: 'Sort Merge',
          statement: 'Sort N integers using merge sort.',
          deadline: '2099-12-31T23:59:59.000Z',
          cpuTimeLimitSec: 2,
          memoryLimitMb: 512,
          testCases: [
            { id: 'tc1', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n', isHidden: true },
          ],
          constraints: [{ id: 'C1', text: 'Do not call `std::sort`.', deduction: 3.5 }],
        })
        .expect(201);

      const studentToken = await loginStudent('student1');
      const subRes = await request(app.getHttpServer())
        .post(`/labs/${labRes.body.id}/submissions`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'application/json')
        .send({ code: 'int main() { return 0; }' })
        .expect(201);

      const jobs = submissionStore.getJobsForSubmission(subRes.body.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        submissionId: subRes.body.id,
        labId: labRes.body.id,
        limits: {
          cpuTimeSec: 2,
          memoryMb: 512,
        },
        testCases: [{ id: 'tc1', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n' }],
        constraints: [{ id: 'C1', text: 'Do not call `std::sort`.', deduction: 3.5 }],
        status: 'PENDING',
      });
    });
  });

  describe('PostgreSQL Persistence Adapter (Normalized Schema & Transactions)', () => {
    function createMockPgPool(options: { migrated?: boolean } = {}) {
      const queries: Array<{ text: string; values?: unknown[] }> = [];
      let failOnNextInsert = false;
      const migrated = options.migrated ?? true;

      const client: PgClientLike = {
        query: async <R extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ): Promise<PgQueryResult<R>> => {
          queries.push({ text: text.trim(), values });

          if (failOnNextInsert && text.includes('INSERT INTO submissions')) {
            failOnNextInsert = false;
            throw new Error('simulated DB failure');
          }

          if (text.includes('FROM schema_migrations')) {
            return {
              rows: migrated ? ([{ version: REQUIRED_MIGRATION_VERSION }] as unknown as R[]) : [],
              rowCount: migrated ? 1 : 0,
            };
          }

          if (text.includes('FROM idempotency_records')) {
            return { rows: [], rowCount: 0 };
          }
          if (text.includes('FROM labs WHERE id =')) {
            return {
              rows: [
                {
                  id: 'lab_pg_1',
                  class_id: 'class_cs101',
                  title: 'PG Lab',
                  statement: 'Merge Sort',
                  opened_at: '2026-01-01T00:00:00.000Z',
                  deadline: '2099-12-31T23:59:59.000Z',
                  cpu_time_limit_sec: 2,
                  memory_limit_mb: 512,
                  max_payload_bytes: 65536,
                  is_active: true,
                  published_at: null,
                } as unknown as R,
              ],
              rowCount: 1,
            };
          }
          if (text.includes('FROM lab_test_cases')) {
            const rows = text.includes('is_hidden = FALSE')
              ? [{ id: 'tc1', ordinal: 1, is_hidden: false, input: '1', expected_output: '1' }]
              : [
                  { id: 'tc1', ordinal: 1, is_hidden: false, input: '1', expected_output: '1' },
                  {
                    id: 'tc2',
                    ordinal: 2,
                    is_hidden: true,
                    input: 'SECRET',
                    expected_output: 'SECRET_OUT',
                  },
                ];
            return { rows: rows as unknown as R[], rowCount: rows.length };
          }
          if (text.includes('FROM lab_constraints')) {
            return {
              rows: [
                {
                  id: 'con_lab_pg_1_C1',
                  constraint_code: 'C1',
                  check_type: 'HARD_RULE',
                  constraint_text: 'Do not use `std::sort`.',
                  ban_patterns: ['std::sort'],
                  deduction_centipoints: 350,
                  ordinal: 1,
                } as unknown as R,
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
        release: jest.fn(),
      };

      const pool: PgPoolLike = {
        query: client.query,
        connect: async () => client,
        end: async () => undefined,
      };

      return {
        pool,
        queries,
        setFailOnInsert(flag: boolean) {
          failOnNextInsert = flag;
        },
      };
    }

    it('verifies connectivity and applied migrations on startup without running DDL or seeding demo users', async () => {
      const mock = createMockPgPool({ migrated: true });
      const pg = new PostgresPersistence(undefined, mock.pool);
      await pg.onModuleInit();

      const allSql = mock.queries.map((q) => q.text).join('\n');
      expect(allSql).toContain('SELECT 1');
      expect(allSql).toContain('FROM schema_migrations');
      expect(allSql).not.toContain('CREATE TABLE');
      expect(allSql).not.toContain('INSERT INTO users');
    });

    it('fails loudly on startup if required schema migration has not been applied', async () => {
      const mock = createMockPgPool({ migrated: false });
      const pg = new PostgresPersistence(undefined, mock.pool);
      await expect(pg.onModuleInit()).rejects.toThrow(/0001_init_pa3_schema/);
    });

    it('filters hidden test cases at the SQL layer in getStudentLab()', async () => {
      const mock = createMockPgPool();
      const pg = new PostgresPersistence(undefined, mock.pool);
      const studentLab = await pg.getStudentLab('lab_pg_1');

      expect(studentLab?.testCases).toHaveLength(1);
      expect(studentLab?.testCases?.[0].isHidden).toBe(false);
      expect(studentLab?.constraints?.[0].deduction).toBe(3.5);
      expect(mock.queries.some((q) => q.text.includes('is_hidden = FALSE'))).toBe(true);
    });

    it('executes atomic transaction locking per student, flipping is_counting, inserting submission, job outbox, and idempotency record', async () => {
      const mock = createMockPgPool();
      const pg = new PostgresPersistence(undefined, mock.pool);
      const labsStore = new LabsStore(pg);
      const store = new SubmissionStore(labsStore, pg);

      const res = await store.createSubmissionAtomicAsync({
        labId: 'lab_pg_1',
        studentId: 'std_23120244',
        code: 'int main() { return 0; }',
        idempotencyKey: randomUUID(),
        payloadHash: 'abc123hash',
        receivedAt: Date.now(),
      });

      expect(res.id).toMatch(/^sub_/);
      expect(res.status).toBe('QUEUED');

      const sqlList = mock.queries.map((q) => q.text);
      expect(sqlList[0]).toBe('BEGIN');
      expect(
        mock.queries.some(
          (q) =>
            q.text.includes('pg_advisory_xact_lock(hashtext($1))') &&
            q.values?.[0] === 'std_23120244',
        ),
      ).toBe(true);
      expect(sqlList.some((s) => s.includes('UPDATE submissions SET is_counting = FALSE'))).toBe(
        true,
      );
      expect(sqlList.some((s) => s.includes('INSERT INTO submissions'))).toBe(true);
      expect(sqlList.some((s) => s.includes('INSERT INTO submission_jobs'))).toBe(true);
      expect(sqlList.some((s) => s.includes('INSERT INTO idempotency_records'))).toBe(true);
      expect(sqlList[sqlList.length - 1]).toBe('COMMIT');
    });

    it('rolls back cleanly when a database error occurs mid-transaction', async () => {
      const mock = createMockPgPool();
      const pg = new PostgresPersistence(undefined, mock.pool);
      mock.setFailOnInsert(true);

      await expect(
        pg.createSubmissionAtomic({
          labId: 'lab_pg_1',
          studentId: 'std_23120244',
          code: 'int main() { return 0; }',
          idempotencyKey: randomUUID(),
          payloadHash: 'abc123hash',
          receivedAt: Date.now(),
        }),
      ).rejects.toThrow('simulated DB failure');

      expect(mock.queries.some((q) => q.text === 'ROLLBACK')).toBe(true);
    });

    it('throws 404 Not Found without creating submission when Postgres lab is missing', async () => {
      const mock = createMockPgPool();
      mock.pool.connect = async () => ({
        query: async <R extends Record<string, unknown>>(): Promise<PgQueryResult<R>> => ({
          rows: [],
          rowCount: 0,
        }),
        release: jest.fn(),
      });
      const pg = new PostgresPersistence(undefined, mock.pool);

      await expect(
        pg.createSubmissionAtomic({
          labId: 'missing_lab',
          studentId: 'std_23120244',
          code: 'int main(){}',
          idempotencyKey: randomUUID(),
          payloadHash: 'hash',
          receivedAt: Date.now(),
        }),
      ).rejects.toThrow(HttpException);
    });
  });
});
