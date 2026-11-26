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

    it('enqueues job payload containing lab testCases and constraints matching worker contract', async () => {
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
          testCases: [
            { id: 'tc1', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n', isHidden: true },
          ],
          constraints: [{ id: 'C1', text: 'Do not call `std::sort`.', deduction: 3 }],
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
        studentId: 'std_23120244',
        code: 'int main() { return 0; }',
        status: 'PENDING',
        limits: {
          cpuTimeSec: 1,
          wallTimeSec: 3,
          memoryMb: 256,
          maxProcesses: 16,
          outputLimitBytes: 1048576,
        },
        testCases: [{ id: 'tc1', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n' }],
        constraints: [{ id: 'C1', text: 'Do not call `std::sort`.', deduction: 3 }],
      });
    });
  });

  describe('PostgresPersistence SQL transaction & offline store parity', () => {
    function createMockPgPool() {
      const queries: Array<{ text: string; values?: unknown[] }> = [];
      let failOnNextInsert = false;

      const client: PgClientLike = {
        query: async <R extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ): Promise<PgQueryResult<R>> => {
          queries.push({ text: text.replace(/\s+/g, ' ').trim(), values });

          if (failOnNextInsert && text.includes('INSERT INTO submissions')) {
            throw new Error('simulated DB failure');
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
                  deadline: '2099-12-31T23:59:59.000Z',
                  max_payload_size: 65536,
                  is_active: true,
                  test_cases: [{ id: 'tc1', input: '1', expectedOutput: '1', isHidden: false }],
                  constraints: [{ id: 'C1', text: 'Do not use `std::sort`.', deduction: 3 }],
                  is_published: false,
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

    it('initializes schema DDL and seeds all 5 demo accounts and default enrollments', async () => {
      const mock = createMockPgPool();
      const pg = new PostgresPersistence(undefined, mock.pool);
      await pg.onModuleInit();

      const allSql = mock.queries.map((q) => q.text).join('\n');
      expect(allSql).toContain('CREATE TABLE IF NOT EXISTS users');
      expect(allSql).toContain('CREATE TABLE IF NOT EXISTS class_memberships');
      expect(allSql).toContain('CREATE TABLE IF NOT EXISTS labs');
      expect(allSql).toContain('CREATE TABLE IF NOT EXISTS submissions');
      expect(allSql).toContain('CREATE TABLE IF NOT EXISTS submission_jobs');
      expect(allSql).toContain('CREATE TABLE IF NOT EXISTS idempotency_records');

      const seedUserInserts = mock.queries.filter((q) => q.text.startsWith('INSERT INTO users'));
      expect(seedUserInserts).toHaveLength(5);
    });

    it('executes atomic transaction flipping is_counting, inserting submission, job outbox, and idempotency record', async () => {
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
      expect(sqlList.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
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
