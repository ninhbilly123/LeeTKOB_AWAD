import { HttpException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { loadGatewayConfig } from '../src/common/config';
import { centipointsToPoints, pointsToCentipoints } from '../src/persistence/mappers';
import {
  listMigrationPairs,
  REQUIRED_MIGRATION_VERSION,
  rollbackLastMigration,
  runMigrationsUp,
} from '../src/persistence/migrations';
import type { PgClientLike, PgPoolLike, PgQueryResult } from '../src/persistence/pg.types';
import { buildSubmissionJob, PostgresPersistence } from '../src/persistence/postgres.store';
import { seedDemoDatabase } from '../src/persistence/seed-demo.cli';

describe('Database Hardening: Migrations, Config, Centipoints & Worker Outbox', () => {
  describe('SQL Migration Integrity (Session 04 & PA#3 Contract Alignment)', () => {
    it('defines paired .up.sql and .down.sql files with lock_timeout, 16 normalized tables, FKs, CHECKs, and all 12 indexes', () => {
      const pairs = listMigrationPairs();
      expect(pairs.some((p) => p.version === REQUIRED_MIGRATION_VERSION)).toBe(true);

      const initial = pairs.find((p) => p.version === REQUIRED_MIGRATION_VERSION)!;
      const upSql = readFileSync(initial.upPath, 'utf8');
      const downSql = readFileSync(initial.downPath, 'utf8');

      // PostgreSQL lock safety (Session 04)
      expect(upSql).toContain("SET lock_timeout = '2s';");
      expect(downSql).toContain("SET lock_timeout = '2s';");

      // All 16 normalized tables (proposal-detail.md §4.2 + FAQ-01..14 + checker-output.md)
      for (const table of [
        'users',
        'classes',
        'class_staff',
        'class_enrollments',
        'labs',
        'lab_test_cases',
        'lab_constraints',
        'lab_constraint_revisions',
        'submissions',
        'submission_test_results',
        'submission_jobs',
        'idempotency_records',
        'constraint_findings',
        'model_call_logs',
        'grade_appeals',
        'audit_logs',
      ]) {
        expect(upSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
        expect(downSql).toContain(`DROP TABLE IF EXISTS ${table};`);
      }

      // Verify strict reverse FK drop order for newly added child tables
      expect(downSql.indexOf('DROP TABLE IF EXISTS grade_appeals;')).toBeLessThan(
        downSql.indexOf('DROP TABLE IF EXISTS constraint_findings;'),
      );
      expect(downSql.indexOf('DROP TABLE IF EXISTS lab_constraint_revisions;')).toBeLessThan(
        downSql.indexOf('DROP TABLE IF EXISTS lab_constraints;'),
      );

      // Critical invariants: centipoints, FAQ-01/04/05/07/09/12/13/14, checker-output.md
      expect(upSql).toContain('invite_code TEXT NULL UNIQUE');
      expect(upSql).toContain('constraints_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
      expect(upSql).toContain(
        "check_type TEXT NOT NULL DEFAULT 'LLM' CHECK (check_type IN ('HARD_RULE', 'LLM', 'SEMANTIC_LLM'))",
      );
      expect(upSql).toContain(
        'deduction_centipoints INTEGER NOT NULL CHECK (deduction_centipoints BETWEEN 0 AND 1000)',
      );
      expect(upSql).toContain(
        'CHECK (new_deduction_centipoints <= previous_deduction_centipoints)',
      );
      expect(upSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_submissions_counting');
      expect(upSql).toContain('UNIQUE (student_id, lab_id, idempotency_key)');
      expect(upSql).toContain('checker_model TEXT NULL');
      expect(upSql).toContain('prompt_version TEXT NULL');
      expect(upSql).toContain('checked_at TIMESTAMPTZ NULL');
      expect(upSql).toContain('manual_score_centipoints INTEGER NULL');
      expect(upSql).toContain(
        'cpu_time_limit_sec INTEGER NOT NULL DEFAULT 1 CHECK (cpu_time_limit_sec BETWEEN 1 AND 5)',
      );
      expect(upSql).toContain(
        'memory_limit_mb INTEGER NOT NULL DEFAULT 256 CHECK (memory_limit_mb BETWEEN 64 AND 512)',
      );
      expect(upSql).toContain('FOREIGN KEY (lab_id, constraint_code)');
      expect(upSql).toContain("CHECK ((verdict = 'unsure') = (unsure_reason IS NOT NULL))");
      expect(upSql).toContain("verdict <> 'violation'");
      expect(upSql).toContain(
        "CHECK ((review_status IN ('NOT_QUEUED', 'PENDING_REVIEW')) = (ta_decision IS NULL))",
      );
      expect(upSql).toContain("ta_decision IS DISTINCT FROM 'VIOLATION'");
      // model_call_logs allows empty request_id on TIMEOUT/PROVIDER_ERROR, enforces non-empty on OK
      expect(upSql).toContain('UNIQUE (submission_id, call_ordinal)');
      expect(upSql).toContain("CHECK (status <> 'OK' OR btrim(request_id) <> '')");
      expect(upSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_model_call_logs_req_id');
      expect(upSql).toContain('finding_id TEXT NOT NULL UNIQUE REFERENCES constraint_findings(id)');
      for (const reason of [
        'MODEL_UNSURE',
        'SCHEMA_INVALID',
        'EVIDENCE_MISMATCH',
        'TIMEOUT',
        'COST_CAP_EXCEEDED',
        'MODEL_OFF',
        'PROVIDER_ERROR',
      ]) {
        expect(upSql).toContain(`'${reason}'`);
      }
      // Every required query index exists
      for (const idx of [
        'idx_class_staff_ta',
        'idx_enrollments_student_active',
        'idx_labs_class_cursor',
        'uniq_submissions_counting',
        'idx_submissions_student_history',
        'idx_submissions_lab_ac',
        'idx_jobs_claimable',
        'idx_findings_pending_by_sub',
        'idx_findings_lab_review',
        'uniq_model_call_logs_req_id',
        'idx_appeals_lab_status',
        'idx_idempotency_expires',
      ]) {
        expect(upSql).toContain(idx);
      }
    });

    it('runs migrations up idempotently and rolls back cleanly', async () => {
      const appliedVersions: string[] = [];
      const executedSql: string[] = [];

      const client: PgClientLike = {
        query: async <R extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ): Promise<PgQueryResult<R>> => {
          executedSql.push(text.trim());
          if (text.includes('SELECT version FROM schema_migrations ORDER BY version ASC')) {
            return {
              rows: appliedVersions.map((v) => ({ version: v })) as unknown as R[],
              rowCount: appliedVersions.length,
            };
          }
          if (text.includes('SELECT version FROM schema_migrations ORDER BY applied_at DESC')) {
            const latest = appliedVersions[appliedVersions.length - 1];
            return {
              rows: latest ? ([{ version: latest }] as unknown as R[]) : [],
              rowCount: latest ? 1 : 0,
            };
          }
          if (text.startsWith('INSERT INTO schema_migrations') && values?.[0]) {
            appliedVersions.push(String(values[0]));
          }
          if (text.startsWith('DELETE FROM schema_migrations') && values?.[0]) {
            const idx = appliedVersions.indexOf(String(values[0]));
            if (idx >= 0) appliedVersions.splice(idx, 1);
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

      const firstRun = await runMigrationsUp(pool);
      expect(firstRun).toEqual([REQUIRED_MIGRATION_VERSION]);

      const secondRun = await runMigrationsUp(pool);
      expect(secondRun).toEqual([]);

      const rolledBack = await rollbackLastMigration(pool);
      expect(rolledBack).toBe(REQUIRED_MIGRATION_VERSION);
      expect(appliedVersions).toEqual([]);
    });

    it('seeds 5 PA#3 demo users, 2 classes, staff, and enrollments via explicit seed script', async () => {
      const queries: Array<{ text: string; values?: unknown[] }> = [];
      const client: PgClientLike = {
        query: async <R extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ): Promise<PgQueryResult<R>> => {
          queries.push({ text: text.trim(), values });
          if (text.includes('FROM schema_migrations')) {
            return {
              rows: [{ version: REQUIRED_MIGRATION_VERSION }] as unknown as R[],
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

      await seedDemoDatabase(pool);
      expect(queries.filter((q) => q.text.startsWith('INSERT INTO users'))).toHaveLength(5);
      expect(queries.filter((q) => q.text.startsWith('INSERT INTO classes'))).toHaveLength(2);
      expect(queries.filter((q) => q.text.startsWith('INSERT INTO class_staff'))).toHaveLength(2);
      expect(
        queries.filter((q) => q.text.startsWith('INSERT INTO class_enrollments')),
      ).toHaveLength(2);
    });
  });

  describe('Startup Configuration Validation (Session 03)', () => {
    it('fails loudly outside tests when DATABASE_URL is missing', () => {
      expect(() => loadGatewayConfig({ NODE_ENV: 'production' })).toThrow(
        /DATABASE_URL is required/,
      );
    });

    it('forbids PERSISTENCE_MODE=memory when NODE_ENV=production', () => {
      expect(() =>
        loadGatewayConfig({ NODE_ENV: 'production', PERSISTENCE_MODE: 'memory' }),
      ).toThrow(/forbidden when NODE_ENV=production/);
    });

    it('accepts valid postgres config with custom pool settings', () => {
      const cfg = loadGatewayConfig({
        NODE_ENV: 'production',
        PORT: '3000',
        DATABASE_URL: 'postgresql://leetkob:secret@postgres:5432/leetkob',
        DB_POOL_MAX: '20',
      });
      expect(cfg.persistenceMode).toBe('postgres');
      expect(cfg.dbPool.max).toBe(20);
    });
  });

  describe('Integer Centipoints Conversion (Session 04)', () => {
    it('converts decimal deductions accurately without floating-point drift', () => {
      expect(pointsToCentipoints(0)).toBe(0);
      expect(pointsToCentipoints(2.5)).toBe(250);
      expect(pointsToCentipoints(3.75)).toBe(375);
      expect(pointsToCentipoints(10)).toBe(1000);
      expect(centipointsToPoints(250)).toBe(2.5);
      expect(() => pointsToCentipoints(-0.5)).toThrow();
      expect(() => pointsToCentipoints(10.5)).toThrow();
    });
  });

  describe('Batch Queries, Non-Destructive Upserts, Worker Outbox & TA Review (N1 & D2)', () => {
    it('loads getAllLabs() in 3 batch queries (no N+1) and upserts saveLab() without blanket DELETE on lab_constraints', async () => {
      const queries: Array<{ text: string; values?: unknown[] }> = [];
      const client: PgClientLike = {
        query: async <R extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ): Promise<PgQueryResult<R>> => {
          queries.push({ text: text.trim(), values });
          if (text.startsWith('SELECT * FROM labs')) {
            return {
              rows: [
                {
                  id: 'lab_1',
                  class_id: 'class_cs101',
                  title: 'Lab 1',
                  statement: 'S1',
                  deadline: '2099-01-01T00:00:00.000Z',
                  is_active: true,
                },
                {
                  id: 'lab_2',
                  class_id: 'class_cs101',
                  title: 'Lab 2',
                  statement: 'S2',
                  deadline: '2099-01-02T00:00:00.000Z',
                  is_active: true,
                },
              ] as unknown as R[],
              rowCount: 2,
            };
          }
          if (text.includes('FROM lab_test_cases WHERE lab_id = ANY')) {
            return {
              rows: [
                {
                  id: 'tc_1',
                  lab_id: 'lab_1',
                  ordinal: 1,
                  is_hidden: false,
                  input: '1',
                  expected_output: '1',
                },
              ] as unknown as R[],
              rowCount: 1,
            };
          }
          if (text.includes('FROM lab_constraints WHERE lab_id = ANY')) {
            return {
              rows: [
                {
                  id: 'con_lab_1_C1',
                  lab_id: 'lab_1',
                  constraint_code: 'C1',
                  check_type: 'HARD_RULE',
                  constraint_text: 'Do not use `std::sort`.',
                  ban_patterns: ['std::sort'],
                  deduction_centipoints: 300,
                  ordinal: 1,
                },
              ] as unknown as R[],
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

      const pg = new PostgresPersistence(undefined, pool);
      const labs = await pg.getAllLabs(['class_cs101'], true);
      expect(labs).toHaveLength(2);
      expect(labs[0].testCases).toHaveLength(1);
      // Exactly 3 queries for 2 labs (1 labs + 1 batch test_cases + 1 batch constraints)
      expect(queries).toHaveLength(3);

      queries.length = 0;
      await pg.saveLab({
        id: 'lab_1',
        classId: 'class_cs101',
        title: 'Lab 1 Updated',
        statement: '# Merge Sort Statement',
        deadline: '2099-01-01T00:00:00.000Z',
        maxPayloadSize: 65536,
        isActive: true,
        testCases: [{ id: 'tc_1', input: '1', expectedOutput: '1', isHidden: false }],
        constraints: [{ id: 'C1', text: 'Do not use `std::sort`.', deduction: 3 }],
      });

      const sqls = queries.map((q) => q.text);
      expect(sqls.some((s) => s.includes('ON CONFLICT (id) DO UPDATE'))).toBe(true);
      expect(sqls.some((s) => s.includes('NOT (id = ANY($2::text[]))'))).toBe(true);
      expect(sqls.includes('DELETE FROM lab_constraints WHERE lab_id = $1')).toBe(false);
    });

    it('includes statement in SubmissionJob and handles claim, retry/JUDGE_ERROR, idempotent judge/checker results, and TA review/publish', async () => {
      const job = buildSubmissionJob(
        {
          id: 'sub_1',
          labId: 'lab_1',
          studentId: 'std_1',
          code: 'int main(){}',
          status: 'QUEUED',
          submittedAt: '2026-11-27T00:00:00.000Z',
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
        },
        {
          id: 'lab_1',
          classId: 'class_cs101',
          title: 'Merge Sort',
          statement: '# Full Markdown Statement for Checker',
          deadline: '2099-12-31T00:00:00.000Z',
          maxPayloadSize: 65536,
          isActive: true,
        },
        '2026-11-27T00:00:00.000Z',
        ['std_1', 'student1', 'student1@leetkob.edu.vn', 'Student One'],
      );
      expect(job.statement).toBe('# Full Markdown Statement for Checker');
      expect(job.studentIdentifiers).toEqual([
        'std_1',
        'student1',
        'student1@leetkob.edu.vn',
        'Student One',
      ]);

      const queries: Array<{ text: string; values?: unknown[] }> = [];
      let simulateFailedAttempts = false;

      const client: PgClientLike = {
        query: async <R extends Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ): Promise<PgQueryResult<R>> => {
          queries.push({ text: text.trim(), values });
          if (text.includes('FOR UPDATE SKIP LOCKED')) {
            return {
              rows: [{ id: 'job_1', payload: job }] as unknown as R[],
              rowCount: 1,
            };
          }
          if (text.includes('RETURNING status')) {
            return {
              rows: [{ status: simulateFailedAttempts ? 'FAILED' : 'PENDING' }] as unknown as R[],
              rowCount: 1,
            };
          }
          if (text.includes('RETURNING lab_id')) {
            return {
              rows: [{ lab_id: 'lab_1' }] as unknown as R[],
              rowCount: 1,
            };
          }
          if (text.includes('SELECT id, constraint_code FROM lab_constraints')) {
            return {
              rows: [
                { id: 'con_lab_1_C1', constraint_code: 'C1' },
                { id: 'con_lab_1_C2', constraint_code: 'C2' },
              ] as unknown as R[],
              rowCount: 2,
            };
          }
          if (text.includes('SELECT deadline, published_at FROM labs')) {
            return {
              rows: [
                { deadline: '2026-01-01T00:00:00.000Z', published_at: null },
              ] as unknown as R[],
              rowCount: 1,
            };
          }
          if (text.includes('AS pending_count')) {
            return {
              rows: [{ pending_count: '0' }] as unknown as R[],
              rowCount: 1,
            };
          }
          if (text.includes('UPDATE constraint_findings') && text.includes('RETURNING *')) {
            return {
              rows: [
                {
                  id: 'fnd_1',
                  submission_id: 'sub_1',
                  lab_id: 'lab_1',
                  constraint_id: 'con_lab_1_C1',
                  constraint_code: 'C1',
                  source: 'HARD_RULE',
                  verdict: 'violation',
                  unsure_reason: null,
                  evidence: [{ line: 2, text: '#include <algorithm>' }],
                  reason: 'Banned header',
                  is_sampled_pass: false,
                  review_status: 'APPROVED_VIOLATION',
                  ta_decision: 'VIOLATION',
                  ta_deduction_centipoints: 300,
                  ta_evidence: [{ line: 2, text: '#include <algorithm>' }],
                  ta_reason: 'Confirmed by TA',
                  reviewed_by: 'usr_ta_01',
                  reviewed_at: '2026-11-27T01:00:00.000Z',
                },
              ] as unknown as R[],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 1 };
        },
        release: jest.fn(),
      };
      const pool: PgPoolLike = {
        query: client.query,
        connect: async () => client,
        end: async () => undefined,
      };

      const pg = new PostgresPersistence(undefined, pool);
      const claimed = await pg.claimNextJob('worker-01', 'JUDGE');
      expect(claimed?.id).toBe('job_1');
      expect(claimed?.status).toBe('PROCESSING');

      // Retryable failure vs terminal JUDGE_ERROR
      await expect(pg.recordJobFailure('job_1', 'sub_1', 'Docker timeout')).resolves.toBe(
        'RETRYING',
      );
      simulateFailedAttempts = true;
      await expect(pg.recordJobFailure('job_1', 'sub_1', 'Max retries exceeded')).resolves.toBe(
        'FAILED',
      );
      expect(queries.some((q) => q.text.includes("pipeline_status = 'JUDGE_ERROR'"))).toBe(true);

      // Idempotent judge & checker result recording + FAQ-10 10% pass sampling CTE
      await pg.recordJudgeResult({
        submissionId: 'sub_1',
        overallVerdict: 'AC',
        compileOutput: null,
        testResults: [
          { ordinal: 1, verdict: 'AC', timeMs: 12, memoryKb: 3200 },
          { ordinal: 2, verdict: 'AC', timeMs: 15, memoryKb: 3400 },
        ],
        maxTimeMs: 15,
        maxMemoryKb: 3400,
        judgedAt: '2026-11-27T00:00:02.000Z',
      });
      expect(
        queries.some((q) => q.text.includes('ON CONFLICT (submission_id, ordinal) DO UPDATE')),
      ).toBe(true);

      // Non-AC superseding submission rebalances FAQ-10 10% pass sample across lab
      const beforeWaCount = queries.filter((q) =>
        q.text.includes('CEIL(0.10 * total_pass)'),
      ).length;
      await pg.recordJudgeResult({
        submissionId: 'sub_wa_2',
        overallVerdict: 'WA',
        compileOutput: null,
        testResults: [{ ordinal: 1, verdict: 'WA', timeMs: 10, memoryKb: 2048 }],
        maxTimeMs: 10,
        maxMemoryKb: 2048,
        judgedAt: '2026-11-27T00:05:00.000Z',
      });
      const afterWaCount = queries.filter((q) => q.text.includes('CEIL(0.10 * total_pass)')).length;
      expect(afterWaCount).toBe(beforeWaCount + 1);

      await pg.recordCheckerResult({
        submissionId: 'sub_1',
        labId: 'lab_1',
        model: 'gemini-3.1-flash-lite-preview',
        promptVersion: 'v1',
        checkedAt: '2026-11-27T00:01:00.000Z',
        findings: [
          {
            constraintCode: 'C1',
            source: 'HARD_RULE',
            verdict: 'violation',
            unsureReason: null,
            evidence: [{ line: 2, text: '#include <algorithm>' }],
            reason: 'Banned header detected.',
          },
          {
            constraintCode: 'C2',
            source: 'LLM',
            verdict: 'unsure',
            unsureReason: 'TIMEOUT',
            evidence: [],
            reason: 'LLM request timed out.',
          },
        ],
        callLogs: [
          {
            requestId: 'req_real_123',
            model: 'gemini-3.1-flash-lite-preview',
            promptVersion: 'v1',
            constraints: ['C2'],
            sanitizedPrompt: '...',
            rawResponse: '{"results":[]}',
            inputTokens: 120,
            outputTokens: 45,
            latencyMs: 420,
            estimatedCostUsd: 0.00012,
            status: 'OK',
          },
          {
            // TIMEOUT / PROVIDER_ERROR calls emit empty requestId in checker/src/semantic_checker.py
            requestId: '',
            model: 'gemini-3.1-flash-lite-preview',
            promptVersion: 'v1',
            constraints: ['C2'],
            sanitizedPrompt: '...',
            rawResponse: null,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 30000,
            estimatedCostUsd: 0,
            status: 'TIMEOUT',
          },
        ],
      });
      const mclInserts = queries.filter((q) => q.text.includes('INSERT INTO model_call_logs'));
      expect(mclInserts).toHaveLength(2);
      expect(mclInserts[0].text).toContain('ON CONFLICT (submission_id, call_ordinal) DO UPDATE');
      expect(mclInserts[1].values?.[3]).toBe(2); // call_ordinal = 2
      expect(mclInserts[1].values?.[4]).toBe(''); // empty request_id permitted for TIMEOUT
      expect(mclInserts[1].values?.[14]).toBe('TIMEOUT');
      const subCheckerUpdate = queries.find(
        (q) => q.text.includes('UPDATE submissions') && q.text.includes('checker_model = $2'),
      );
      expect(subCheckerUpdate?.values).toEqual([
        'sub_1',
        'gemini-3.1-flash-lite-preview',
        'v1',
        '2026-11-27T00:01:00.000Z',
      ]);
      const findingInserts = queries.filter((q) =>
        q.text.includes('INSERT INTO constraint_findings'),
      );
      expect(findingInserts).toHaveLength(2);
      expect(findingInserts[0].values?.[2]).toBe('lab_1'); // lab_id stored directly on finding
      expect(queries.some((q) => q.text.includes('CEIL(0.10 * total_pass)'))).toBe(true);

      // TA review enforces FAQ-09 evidence requirement on VIOLATION
      await expect(
        pg.reviewConstraintFinding({
          findingId: 'fnd_1',
          labId: 'lab_1',
          submissionId: 'sub_1',
          actorId: 'usr_ta_01',
          decision: 'VIOLATION',
          deduction: 3,
          evidence: [],
        }),
      ).rejects.toThrow(HttpException);

      const reviewed = await pg.reviewConstraintFinding({
        findingId: 'fnd_1',
        labId: 'lab_1',
        submissionId: 'sub_1',
        actorId: 'usr_ta_01',
        decision: 'VIOLATION',
        deduction: 3,
        evidence: [{ line: 2, text: '#include <algorithm>' }],
        reason: 'Confirmed by TA',
      });
      expect(reviewed.reviewStatus).toBe('APPROVED_VIOLATION');
      expect(reviewed.labId).toBe('lab_1');
      expect(reviewed.taDeduction).toBe(3);
      expect(queries.some((q) => q.text.includes('INSERT INTO audit_logs'))).toBe(true);

      // publishLabAtomic rebalances FAQ-10 10% pass sample before checking PENDING_REVIEW
      const beforePublishRebalance = queries.filter((q) =>
        q.text.includes('CEIL(0.10 * total_pass)'),
      ).length;
      const publishedAt = await pg.publishLabAtomic(
        'lab_1',
        'usr_ta_01',
        Date.parse('2026-11-28T00:00:00.000Z'),
      );
      expect(publishedAt).toBe('2026-11-28T00:00:00.000Z');
      const afterPublishRebalance = queries.filter((q) =>
        q.text.includes('CEIL(0.10 * total_pass)'),
      ).length;
      expect(afterPublishRebalance).toBe(beforePublishRebalance + 1);
    });
  });
});
