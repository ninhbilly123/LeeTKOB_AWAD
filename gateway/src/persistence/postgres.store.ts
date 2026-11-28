import { HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { DbPoolSettings } from '../common/config';
import { problemException } from '../common/http-problems';
import {
  CheckerCompletionInput,
  ClassRecord,
  ConstraintFindingRecord,
  DEFAULT_SUBMISSION_LIMITS,
  JudgeCompletionInput,
  JudgeVerdict,
  Lab,
  LabConstraint,
  LabTestCase,
  StoredUser,
  Submission,
  SubmissionJob,
  SubmissionJobStage,
  SubmissionJobStatus,
  SubmissionResponse,
  SubmissionTestResult,
  TaFindingReviewInput,
  TaReviewQueueEntry,
} from '../submissions/submissions.types';
import { assertMigrationsApplied } from './migrations';
import {
  mapConstraintFindingRow,
  mapConstraintRow,
  mapLabRow,
  mapSubmissionRow,
  mapTestCaseRow,
  mapUserRow,
  parseJsonColumn,
  pointsToCentipoints,
  toIsoString,
  usdToMicros,
} from './mappers';
import type { PgClientLike, PgPoolLike, PgQueryResult } from './pg.types';

export type { PgClientLike, PgPoolLike, PgQueryResult };

export interface AtomicCreateSubmissionParams {
  labId: string;
  studentId: string;
  code: string;
  idempotencyKey: string;
  payloadHash: string;
  receivedAt: number;
}

export function buildSubmissionJob(
  submission: Submission,
  lab: Lab,
  createdAt: string,
  studentIdentifiers?: ReadonlyArray<string>,
): SubmissionJob {
  const cpuTimeSec = lab.cpuTimeLimitSec ?? DEFAULT_SUBMISSION_LIMITS.cpuTimeSec;
  const memoryMb = lab.memoryLimitMb ?? DEFAULT_SUBMISSION_LIMITS.memoryMb;
  const normalizedIdentifiers = [
    ...new Set(
      [submission.studentId, ...(studentIdentifiers ?? [])]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
  return {
    id: `job_${randomUUID()}`,
    submissionId: submission.id,
    labId: submission.labId,
    studentId: submission.studentId,
    studentIdentifiers: normalizedIdentifiers,
    statement: lab.statement ?? '',
    code: submission.code,
    submittedAt: submission.submittedAt,
    limits: {
      ...DEFAULT_SUBMISSION_LIMITS,
      cpuTimeSec,
      wallTimeSec: Math.max(cpuTimeSec + 2, DEFAULT_SUBMISSION_LIMITS.wallTimeSec),
      memoryMb,
    },
    testCases: (lab.testCases ?? []).map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
    })),
    constraints: (lab.constraints ?? []).map((c) => ({ ...c })),
    stage: 'JUDGE',
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt,
  };
}

function inferConstraintCheckType(c: LabConstraint): 'HARD_RULE' | 'LLM' | 'SEMANTIC_LLM' {
  if (c.checkType) {
    return c.checkType;
  }
  if (/^\s*do\s+not\s+(?:use|call)\b/i.test(c.text)) {
    return 'HARD_RULE';
  }
  return 'LLM';
}

@Injectable()
export class PostgresPersistence implements OnModuleInit, OnModuleDestroy {
  private readonly pool: PgPoolLike | undefined;
  private readonly ownsPool: boolean = false;
  private verified = false;

  constructor(databaseUrl?: string, injectedPool?: PgPoolLike, poolSettings?: DbPoolSettings) {
    if (injectedPool) {
      this.pool = injectedPool;
      this.ownsPool = false;
    } else if (databaseUrl && databaseUrl.trim().length > 0) {
      const settings: DbPoolSettings = poolSettings ?? {
        max: 15,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statementTimeoutMs: 10000,
      };
      this.pool = new Pool({
        connectionString: databaseUrl.trim(),
        max: settings.max,
        connectionTimeoutMillis: settings.connectionTimeoutMillis,
        idleTimeoutMillis: settings.idleTimeoutMillis,
        statement_timeout: settings.statementTimeoutMs,
      }) as unknown as PgPoolLike;
      this.ownsPool = true;
    }
  }

  isEnabled(): boolean {
    return Boolean(this.pool);
  }

  /**
   * Verifies connectivity and confirms explicit migrations were applied.
   * Never runs DDL or seeds weak demo accounts automatically on startup (Session 04 & 08).
   */
  async onModuleInit(): Promise<void> {
    if (!this.pool || this.verified) {
      return;
    }
    await this.pool.query('SELECT 1');
    await assertMigrationsApplied(this.pool);
    this.verified = true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownsPool && this.pool) {
      await this.pool.end();
    }
  }

  async checkHealth(): Promise<boolean> {
    if (!this.pool) {
      return true;
    }
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private requirePool(): PgPoolLike {
    if (!this.pool) {
      throw new Error('PostgresPersistence is not configured.');
    }
    return this.pool;
  }

  // --- Users, Classes & Memberships (Normalized tables) ---

  private async resolveUserClasses(userId: string, role: string): Promise<string[]> {
    if (role === 'TA') {
      return this.taClasses(userId);
    }
    if (role === 'STUDENT') {
      return this.activeClasses(userId);
    }
    return [];
  }

  async findUserByUsername(username: string): Promise<StoredUser | undefined> {
    const res = await this.requirePool().query(
      'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
      [username],
    );
    const row = res.rows[0];
    if (!row) {
      return undefined;
    }
    const classIds = await this.resolveUserClasses(String(row.id), String(row.role));
    return mapUserRow(row, classIds);
  }

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    const res = await this.requirePool().query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE',
      [email],
    );
    const row = res.rows[0];
    if (!row) {
      return undefined;
    }
    const classIds = await this.resolveUserClasses(String(row.id), String(row.role));
    return mapUserRow(row, classIds);
  }

  async findUserById(id: string): Promise<StoredUser | undefined> {
    const res = await this.requirePool().query(
      'SELECT * FROM users WHERE id = $1 AND is_active = TRUE',
      [id],
    );
    const row = res.rows[0];
    if (!row) {
      return undefined;
    }
    const classIds = await this.resolveUserClasses(String(row.id), String(row.role));
    return mapUserRow(row, classIds);
  }

  async taClasses(taId: string): Promise<string[]> {
    const res = await this.requirePool().query<{ class_id: string }>(
      'SELECT class_id FROM class_staff WHERE ta_id = $1 ORDER BY class_id ASC',
      [taId],
    );
    return res.rows.map((row) => String(row.class_id));
  }

  async activeClasses(studentId: string): Promise<string[]> {
    const res = await this.requirePool().query<{ class_id: string }>(
      "SELECT class_id FROM class_enrollments WHERE student_id = $1 AND status = 'ACTIVE' ORDER BY class_id ASC",
      [studentId],
    );
    return res.rows.map((row) => String(row.class_id));
  }

  async listClassesForUser(userId: string, role: string): Promise<ClassRecord[]> {
    let res: PgQueryResult;
    if (role === 'ADMIN') {
      res = await this.requirePool().query(
        'SELECT id, code, name, term, invite_code, created_by FROM classes ORDER BY created_at DESC, id DESC',
      );
    } else if (role === 'TA') {
      res = await this.requirePool().query(
        `SELECT c.id, c.code, c.name, c.term, c.invite_code, c.created_by
         FROM classes c
         INNER JOIN class_staff cs ON cs.class_id = c.id
         WHERE cs.ta_id = $1
         ORDER BY c.created_at DESC, c.id DESC`,
        [userId],
      );
    } else {
      res = await this.requirePool().query(
        `SELECT c.id, c.code, c.name, c.term, c.invite_code, c.created_by
         FROM classes c
         INNER JOIN class_enrollments ce ON ce.class_id = c.id
         WHERE ce.student_id = $1 AND ce.status = 'ACTIVE'
         ORDER BY c.created_at DESC, c.id DESC`,
        [userId],
      );
    }
    return res.rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      term: String(row.term),
      inviteCode: row.invite_code ? String(row.invite_code) : null,
      createdBy: row.created_by ? String(row.created_by) : null,
    }));
  }

  async listClassSummariesForUser(
    userId: string,
    role: string,
  ): Promise<
    Array<
      ClassRecord & {
        taIds: string[];
        studentCount: number;
        labCount: number;
        createdAt: string;
      }
    >
  > {
    const baseSelect = `
      SELECT
        c.id,
        c.code,
        c.name,
        c.term,
        c.invite_code,
        c.created_by,
        c.created_at,
        COALESCE(
          (SELECT array_agg(cs2.ta_id ORDER BY cs2.ta_id ASC)
           FROM class_staff cs2
           WHERE cs2.class_id = c.id),
          ARRAY[]::text[]
        ) AS ta_ids,
        (SELECT COUNT(*)::int
         FROM class_enrollments ce2
         WHERE ce2.class_id = c.id AND ce2.status = 'ACTIVE') AS student_count,
        (SELECT COUNT(*)::int
         FROM labs l2
         WHERE l2.class_id = c.id) AS lab_count
      FROM classes c
    `;
    let res: PgQueryResult;
    if (role === 'ADMIN') {
      res = await this.requirePool().query(`${baseSelect} ORDER BY c.created_at DESC, c.id DESC`);
    } else if (role === 'TA') {
      res = await this.requirePool().query(
        `${baseSelect}
         INNER JOIN class_staff cs ON cs.class_id = c.id
         WHERE cs.ta_id = $1
         ORDER BY c.created_at DESC, c.id DESC`,
        [userId],
      );
    } else {
      res = await this.requirePool().query(
        `${baseSelect}
         INNER JOIN class_enrollments ce ON ce.class_id = c.id
         WHERE ce.student_id = $1 AND ce.status = 'ACTIVE'
         ORDER BY c.created_at DESC, c.id DESC`,
        [userId],
      );
    }
    return res.rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      term: String(row.term),
      inviteCode: row.invite_code ? String(row.invite_code) : null,
      createdBy: row.created_by ? String(row.created_by) : null,
      taIds: Array.isArray(row.ta_ids) ? row.ta_ids.map((id) => String(id)) : [],
      studentCount: Number(row.student_count ?? 0),
      labCount: Number(row.lab_count ?? 0),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at ?? new Date().toISOString()),
    }));
  }

  async createClass(cls: ClassRecord, taIds: ReadonlyArray<string> = []): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO classes (id, code, name, term, invite_code, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cls.id, cls.code, cls.name, cls.term, cls.inviteCode ?? null, cls.createdBy],
      );
      for (const taId of taIds) {
        await client.query(
          `INSERT INTO class_staff (class_id, ta_id)
           VALUES ($1, $2)
           ON CONFLICT (class_id, ta_id) DO NOTHING`,
          [cls.id, taId],
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

  // --- Labs (Normalized lab_test_cases & lab_constraints) ---

  async saveLab(lab: Lab): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const openedAt =
        lab.openedAt ??
        new Date(Math.min(Date.now(), Date.parse(lab.deadline) - 1000)).toISOString();
      const publishedAt =
        lab.publishedAt !== undefined
          ? lab.publishedAt
          : lab.isPublished
            ? new Date().toISOString()
            : null;

      await client.query(
        `INSERT INTO labs (
           id, class_id, title, statement, opened_at, deadline,
           cpu_time_limit_sec, memory_limit_mb, max_payload_bytes,
           is_active, published_at, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           statement = EXCLUDED.statement,
           opened_at = EXCLUDED.opened_at,
           deadline = EXCLUDED.deadline,
           cpu_time_limit_sec = EXCLUDED.cpu_time_limit_sec,
           memory_limit_mb = EXCLUDED.memory_limit_mb,
           is_active = EXCLUDED.is_active,
           published_at = EXCLUDED.published_at`,
        [
          lab.id,
          lab.classId,
          lab.title,
          lab.statement ?? '',
          openedAt,
          lab.deadline,
          lab.cpuTimeLimitSec ?? 1,
          lab.memoryLimitMb ?? 256,
          65536,
          lab.isActive,
          publishedAt,
          lab.createdBy ?? null,
        ],
      );

      if (lab.testCases) {
        const retainedTcIds: string[] = [];
        for (let idx = 0; idx < lab.testCases.length; idx += 1) {
          const tc = lab.testCases[idx];
          const tcId = tc.id || `tc_${lab.id}_${idx + 1}`;
          retainedTcIds.push(tcId);
          await client.query(
            `INSERT INTO lab_test_cases (id, lab_id, ordinal, is_hidden, input, expected_output)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
               ordinal = EXCLUDED.ordinal,
               is_hidden = EXCLUDED.is_hidden,
               input = EXCLUDED.input,
               expected_output = EXCLUDED.expected_output`,
            [
              tcId,
              lab.id,
              tc.ordinal ?? idx + 1,
              Boolean(tc.isHidden),
              tc.input,
              tc.expectedOutput,
            ],
          );
        }
        if (retainedTcIds.length > 0) {
          await client.query(
            'DELETE FROM lab_test_cases WHERE lab_id = $1 AND NOT (id = ANY($2::text[]))',
            [lab.id, retainedTcIds],
          );
        } else {
          await client.query('DELETE FROM lab_test_cases WHERE lab_id = $1', [lab.id]);
        }
      }

      if (lab.constraints) {
        const retainedConIds: string[] = [];
        for (let idx = 0; idx < lab.constraints.length; idx += 1) {
          const c = lab.constraints[idx];
          const code = (c.code ?? c.id).trim();
          const rowId = `con_${lab.id}_${code}`;
          retainedConIds.push(rowId);
          await client.query(
            `INSERT INTO lab_constraints (
               id, lab_id, constraint_code, check_type, constraint_text,
               ban_patterns, deduction_centipoints, ordinal
             ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               constraint_code = EXCLUDED.constraint_code,
               check_type = EXCLUDED.check_type,
               constraint_text = EXCLUDED.constraint_text,
               ban_patterns = EXCLUDED.ban_patterns,
               deduction_centipoints = EXCLUDED.deduction_centipoints,
               ordinal = EXCLUDED.ordinal`,
            [
              rowId,
              lab.id,
              code,
              inferConstraintCheckType(c),
              c.text,
              JSON.stringify(c.banPatterns ?? []),
              pointsToCentipoints(c.deduction),
              idx + 1,
            ],
          );
        }
        if (retainedConIds.length > 0) {
          await client.query(
            'DELETE FROM lab_constraints WHERE lab_id = $1 AND NOT (id = ANY($2::text[]))',
            [lab.id, retainedConIds],
          );
        } else {
          await client.query('DELETE FROM lab_constraints WHERE lab_id = $1', [lab.id]);
        }
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

  private async loadLabChildren(
    labId: string,
    includeHiddenTests: boolean,
    executor: Pick<PgPoolLike, 'query'> = this.requirePool(),
  ): Promise<{ testCases: LabTestCase[]; constraints: LabConstraint[] }> {
    const tcQuery = includeHiddenTests
      ? 'SELECT id, ordinal, is_hidden, input, expected_output FROM lab_test_cases WHERE lab_id = $1 ORDER BY ordinal ASC'
      : 'SELECT id, ordinal, is_hidden, input, expected_output FROM lab_test_cases WHERE lab_id = $1 AND is_hidden = FALSE ORDER BY ordinal ASC';

    const [tcRes, conRes] = await Promise.all([
      executor.query(tcQuery, [labId]),
      executor.query(
        'SELECT id, constraint_code, check_type, constraint_text, ban_patterns, deduction_centipoints, ordinal FROM lab_constraints WHERE lab_id = $1 ORDER BY ordinal ASC',
        [labId],
      ),
    ]);

    return {
      testCases: tcRes.rows.map(mapTestCaseRow),
      constraints: conRes.rows.map(mapConstraintRow),
    };
  }

  async getLab(id: string): Promise<Lab | undefined> {
    const res = await this.requirePool().query('SELECT * FROM labs WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) {
      return undefined;
    }
    const { testCases, constraints } = await this.loadLabChildren(id, true);
    return mapLabRow(row, testCases, constraints);
  }

  /**
   * Student-safe SQL query (FAQ-02 & Session 06):
   * Hidden test cases are filtered inside PostgreSQL (`is_hidden = FALSE`) and never loaded into Node memory.
   */
  async getStudentLab(id: string): Promise<Lab | undefined> {
    const res = await this.requirePool().query('SELECT * FROM labs WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) {
      return undefined;
    }
    const { testCases, constraints } = await this.loadLabChildren(id, false);
    return mapLabRow(row, testCases, constraints);
  }

  async getAllLabs(allowedClassIds?: string[] | null, studentOnly = false): Promise<Lab[]> {
    const res =
      allowedClassIds && allowedClassIds.length > 0
        ? await this.requirePool().query(
            'SELECT * FROM labs WHERE class_id = ANY($1::text[]) ORDER BY created_at DESC, id DESC',
            [allowedClassIds],
          )
        : allowedClassIds && allowedClassIds.length === 0
          ? { rows: [] as Record<string, unknown>[], rowCount: 0 }
          : await this.requirePool().query('SELECT * FROM labs ORDER BY created_at DESC, id DESC');

    if (res.rows.length === 0) {
      return [];
    }

    const labIds = res.rows.map((row) => String(row.id));
    const tcBatchQuery = studentOnly
      ? 'SELECT id, lab_id, ordinal, is_hidden, input, expected_output FROM lab_test_cases WHERE lab_id = ANY($1::text[]) AND is_hidden = FALSE ORDER BY lab_id ASC, ordinal ASC'
      : 'SELECT id, lab_id, ordinal, is_hidden, input, expected_output FROM lab_test_cases WHERE lab_id = ANY($1::text[]) ORDER BY lab_id ASC, ordinal ASC';

    const [tcRes, conRes] = await Promise.all([
      this.requirePool().query(tcBatchQuery, [labIds]),
      this.requirePool().query(
        'SELECT id, lab_id, constraint_code, check_type, constraint_text, ban_patterns, deduction_centipoints, ordinal FROM lab_constraints WHERE lab_id = ANY($1::text[]) ORDER BY lab_id ASC, ordinal ASC',
        [labIds],
      ),
    ]);

    const tcByLab = new Map<string, LabTestCase[]>();
    for (const tcRow of tcRes.rows) {
      const lid = String(tcRow.lab_id ?? '');
      const list = tcByLab.get(lid) ?? [];
      list.push(mapTestCaseRow(tcRow));
      tcByLab.set(lid, list);
    }

    const conByLab = new Map<string, LabConstraint[]>();
    for (const conRow of conRes.rows) {
      const lid = String(conRow.lab_id ?? '');
      const list = conByLab.get(lid) ?? [];
      list.push(mapConstraintRow(conRow));
      conByLab.set(lid, list);
    }

    return res.rows.map((row) => {
      const lid = String(row.id);
      return mapLabRow(row, tcByLab.get(lid) ?? [], conByLab.get(lid) ?? []);
    });
  }

  // --- Submissions & Atomic Transactional Outbox ---

  async getSubmission(id: string): Promise<Submission | undefined> {
    const res = await this.requirePool().query('SELECT * FROM submissions WHERE id = $1', [id]);
    return res.rows[0] ? mapSubmissionRow(res.rows[0]) : undefined;
  }

  async getSubmissionTestResults(submissionId: string): Promise<SubmissionTestResult[]> {
    const res = await this.requirePool().query(
      'SELECT ordinal, verdict, time_ms, memory_kb FROM submission_test_results WHERE submission_id = $1 ORDER BY ordinal ASC',
      [submissionId],
    );
    return res.rows.map((row) => ({
      ordinal: Number(row.ordinal),
      verdict: String(row.verdict) as JudgeVerdict,
      timeMs: row.time_ms !== null && row.time_ms !== undefined ? Number(row.time_ms) : null,
      memoryKb:
        row.memory_kb !== null && row.memory_kb !== undefined ? Number(row.memory_kb) : null,
    }));
  }

  async listStudentSubmissions(labId: string, studentId: string): Promise<Submission[]> {
    const res = await this.requirePool().query(
      'SELECT * FROM submissions WHERE lab_id = $1 AND student_id = $2 ORDER BY submitted_at DESC, id DESC',
      [labId, studentId],
    );
    return res.rows.map(mapSubmissionRow);
  }

  async listLabSubmissions(labId: string): Promise<Submission[]> {
    const res = await this.requirePool().query(
      'SELECT * FROM submissions WHERE lab_id = $1 ORDER BY submitted_at DESC, id DESC',
      [labId],
    );
    return res.rows.map(mapSubmissionRow);
  }

  async getJobsForSubmission(submissionId: string): Promise<SubmissionJob[]> {
    const res = await this.requirePool().query(
      'SELECT id, stage, status, attempts, last_error, payload FROM submission_jobs WHERE submission_id = $1',
      [submissionId],
    );
    return res.rows.map((row) => {
      const base = parseJsonColumn<SubmissionJob>(row.payload, {} as SubmissionJob);
      return {
        ...base,
        id: row.id ? String(row.id) : base.id,
        stage: row.stage ? (String(row.stage) as SubmissionJobStage) : base.stage,
        status: row.status ? (String(row.status) as SubmissionJobStatus) : base.status,
        attempts: row.attempts !== undefined ? Number(row.attempts) : base.attempts,
        lastError:
          row.last_error !== null && row.last_error !== undefined
            ? String(row.last_error)
            : (base.lastError ?? null),
      };
    });
  }

  async createSubmissionAtomic(params: AtomicCreateSubmissionParams): Promise<SubmissionResponse> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      // Serialize concurrent submissions per student to prevent both dual is_counting rows (FAQ-04)
      // and cross-lab Idempotency-Key races (AGENTS.md §4.2) with a single deadlock-free lock.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [params.studentId]);

      const cachedRes = await client.query(
        `SELECT lab_id, payload_hash, response_body, expires_at
         FROM idempotency_records
         WHERE student_id = $1 AND idempotency_key = $2`,
        [params.studentId, params.idempotencyKey],
      );
      const cached = cachedRes.rows[0];
      if (cached) {
        if (Date.parse(toIsoString(cached.expires_at)) > params.receivedAt) {
          if (
            String(cached.lab_id) !== params.labId ||
            String(cached.payload_hash) !== params.payloadHash
          ) {
            throw problemException(
              HttpStatus.CONFLICT,
              'The provided Idempotency-Key has already been used with different request parameters.',
              'idempotency-conflict',
            );
          }
          await client.query('COMMIT');
          return parseJsonColumn<SubmissionResponse>(
            cached.response_body,
            {} as SubmissionResponse,
          );
        }
        await client.query(
          'DELETE FROM idempotency_records WHERE student_id = $1 AND idempotency_key = $2',
          [params.studentId, params.idempotencyKey],
        );
      }

      const labRes = await client.query('SELECT * FROM labs WHERE id = $1', [params.labId]);
      const labRow = labRes.rows[0];
      if (!labRow) {
        throw problemException(
          HttpStatus.NOT_FOUND,
          `The requested lab with ID '${params.labId}' does not exist.`,
        );
      }
      const { testCases, constraints } = await this.loadLabChildren(params.labId, true, client);
      const lab = mapLabRow(labRow, testCases, constraints);

      if (Date.parse(lab.deadline) <= params.receivedAt) {
        throw problemException(
          HttpStatus.CONFLICT,
          'The submission deadline for this lab has passed. Late submissions are not accepted.',
          'deadline-passed',
        );
      }

      await client.query(
        'UPDATE submissions SET is_counting = FALSE WHERE lab_id = $1 AND student_id = $2 AND is_counting = TRUE',
        [params.labId, params.studentId],
      );

      const userRes = await client.query<{
        id: string;
        username: string;
        email: string;
        display_name: string;
      }>('SELECT id, username, email, display_name FROM users WHERE id = $1', [params.studentId]);
      const userRow = userRes.rows[0];
      const studentIdentifiers = userRow
        ? [
            String(userRow.id ?? ''),
            String(userRow.username ?? ''),
            String(userRow.email ?? ''),
            String(userRow.display_name ?? ''),
          ]
        : [params.studentId];

      const submittedAt = new Date(params.receivedAt).toISOString();
      const submission: Submission = {
        id: `sub_${randomUUID()}`,
        labId: params.labId,
        studentId: params.studentId,
        code: params.code,
        status: 'QUEUED',
        checkerStatus: 'NOT_APPLICABLE',
        isCounting: true,
        submittedAt,
        idempotencyKey: params.idempotencyKey,
      };
      const responseBody: SubmissionResponse = {
        id: submission.id,
        labId: submission.labId,
        studentId: submission.studentId,
        status: submission.status,
        submittedAt: submission.submittedAt,
        idempotencyKey: submission.idempotencyKey,
      };
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(params.receivedAt + 24 * 60 * 60 * 1000).toISOString();
      const responseHeaders = {
        Location: `/labs/${params.labId}/submissions/${submission.id}`,
        'Content-Type': 'application/json',
      };
      const job = buildSubmissionJob(submission, lab, nowIso, studentIdentifiers);

      await client.query(
        `INSERT INTO submissions (
           id, lab_id, student_id, code, pipeline_status, total_tests,
           is_counting, idempotency_key, checker_status, submitted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          submission.id,
          submission.labId,
          submission.studentId,
          submission.code,
          submission.status,
          testCases.length,
          true,
          submission.idempotencyKey,
          'NOT_APPLICABLE',
          submission.submittedAt,
        ],
      );

      await client.query(
        `INSERT INTO submission_jobs (
           id, submission_id, lab_id, stage, status, attempts, max_attempts,
           available_at, payload, created_at, updated_at
         ) VALUES ($1, $2, $3, 'JUDGE', 'PENDING', 0, 3, $4, $5::jsonb, $4, $4)`,
        [job.id, job.submissionId, job.labId, nowIso, JSON.stringify(job)],
      );

      await client.query(
        `INSERT INTO idempotency_records (
           student_id, lab_id, idempotency_key, payload_hash, status_code,
           response_headers, response_body, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT (student_id, idempotency_key) DO UPDATE SET
           lab_id = EXCLUDED.lab_id,
           payload_hash = EXCLUDED.payload_hash,
           status_code = EXCLUDED.status_code,
           response_headers = EXCLUDED.response_headers,
           response_body = EXCLUDED.response_body,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at`,
        [
          params.studentId,
          params.labId,
          params.idempotencyKey,
          params.payloadHash,
          201,
          JSON.stringify(responseHeaders),
          JSON.stringify(responseBody),
          nowIso,
          expiresAt,
        ],
      );

      await client.query("SELECT pg_notify('submission_jobs_ready', $1)", [job.id]);

      await client.query('COMMIT');
      return responseBody;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure after failed statement
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Worker Outbox Coordination (3-phase short transactions; never held across sandbox/LLM calls) ---

  async claimNextJob(
    workerId: string,
    stage: SubmissionJobStage = 'JUDGE',
  ): Promise<SubmissionJob | null> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `SELECT id, payload
         FROM submission_jobs
         WHERE stage = $1 AND status = 'PENDING' AND available_at <= NOW()
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [stage],
      );
      const row = res.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      const jobId = String(row.id);
      await client.query(
        `UPDATE submission_jobs
         SET status = 'PROCESSING', attempts = attempts + 1,
             locked_by = $2, locked_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [jobId, workerId],
      );

      const job = parseJsonColumn<SubmissionJob>(row.payload, {} as SubmissionJob);
      if (stage === 'JUDGE' && job.submissionId) {
        await client.query(
          "UPDATE submissions SET pipeline_status = 'JUDGING' WHERE id = $1 AND pipeline_status = 'QUEUED'",
          [job.submissionId],
        );
      }

      await client.query('COMMIT');
      return { ...job, id: jobId, stage, status: 'PROCESSING' };
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

  async requeueStaleJobs(staleAfterSeconds = 120): Promise<number> {
    const res = await this.requirePool().query(
      `UPDATE submission_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
           locked_by = NULL,
           locked_at = NULL,
           last_error = COALESCE(last_error, 'Worker lease expired before completion'),
           updated_at = NOW()
       WHERE status = 'PROCESSING'
         AND locked_at < NOW() - ($1 * INTERVAL '1 second')`,
      [staleAfterSeconds],
    );
    return res.rowCount ?? 0;
  }

  async recordJobFailure(
    jobId: string,
    submissionId: string,
    errorMessage: string,
    backoffSeconds = 5,
  ): Promise<'RETRYING' | 'FAILED'> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ status: string }>(
        `UPDATE submission_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
             available_at = CASE
               WHEN attempts >= max_attempts THEN available_at
               ELSE NOW() + ($3 * INTERVAL '1 second')
             END,
             locked_by = NULL,
             locked_at = NULL,
             last_error = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING status`,
        [jobId, errorMessage, backoffSeconds],
      );
      const nextStatus = res.rows[0]?.status === 'FAILED' ? 'FAILED' : 'RETRYING';
      if (nextStatus === 'FAILED') {
        await client.query(
          "UPDATE submissions SET pipeline_status = 'JUDGE_ERROR' WHERE id = $1 AND pipeline_status <> 'COMPLETED'",
          [submissionId],
        );
      }
      await client.query('COMMIT');
      return nextStatus;
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

  /**
   * Rebalances the FAQ-10 10% pass sampling queue across all counting AC submissions in a lab.
   * Called after recordCheckerResult(), after a non-AC submission supersedes a prior AC one,
   * and immediately before checking PENDING_REVIEW in publishLabAtomic().
   */
  private async rebalanceLabPassSample(client: PgClientLike, labId: string): Promise<void> {
    await client.query(
      `WITH pass_stats AS (
         SELECT
           COUNT(*) AS total_pass,
           COUNT(*) FILTER (WHERE cf.is_sampled_pass = TRUE) AS sampled_pass
         FROM constraint_findings cf
         INNER JOIN submissions s ON s.id = cf.submission_id
         WHERE s.lab_id = $1
           AND s.is_counting = TRUE
           AND s.overall_verdict = 'AC'
           AND cf.verdict = 'pass'
       ),
       needed AS (
         SELECT GREATEST(0, CEIL(0.10 * total_pass)::int - sampled_pass::int) AS deficit
         FROM pass_stats
       ),
       candidates AS (
         SELECT cf.id
         FROM constraint_findings cf
         INNER JOIN submissions s ON s.id = cf.submission_id
         WHERE s.lab_id = $1
           AND s.is_counting = TRUE
           AND s.overall_verdict = 'AC'
           AND cf.verdict = 'pass'
           AND cf.is_sampled_pass = FALSE
         ORDER BY RANDOM()
         LIMIT (SELECT deficit FROM needed)
       )
       UPDATE constraint_findings
       SET is_sampled_pass = TRUE,
           review_status = CASE WHEN review_status = 'NOT_QUEUED' THEN 'PENDING_REVIEW' ELSE review_status END
       WHERE id IN (SELECT id FROM candidates)`,
      [labId],
    );
  }

  async recordJudgeResult(input: JudgeCompletionInput): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const passedTests = input.testResults.filter((t) => t.verdict === 'AC').length;
      const totalTests = input.testResults.length;
      const nextCheckerStatus = input.overallVerdict === 'AC' ? 'PENDING' : 'NOT_APPLICABLE';

      const subRes = await client.query<{ lab_id: string }>(
        `UPDATE submissions
         SET pipeline_status = 'COMPLETED',
             overall_verdict = $2,
             compile_output = $3,
             passed_tests = $4,
             total_tests = $5,
             max_time_ms = $6,
             max_memory_kb = $7,
             checker_status = $8,
             judged_at = $9
         WHERE id = $1
         RETURNING lab_id`,
        [
          input.submissionId,
          input.overallVerdict,
          input.compileOutput,
          passedTests,
          totalTests,
          input.maxTimeMs,
          input.maxMemoryKb,
          nextCheckerStatus,
          input.judgedAt,
        ],
      );

      for (const tr of input.testResults) {
        await client.query(
          `INSERT INTO submission_test_results (submission_id, ordinal, verdict, time_ms, memory_kb)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (submission_id, ordinal) DO UPDATE SET
             verdict = EXCLUDED.verdict,
             time_ms = EXCLUDED.time_ms,
             memory_kb = EXCLUDED.memory_kb`,
          [input.submissionId, tr.ordinal, tr.verdict, tr.timeMs ?? null, tr.memoryKb ?? null],
        );
      }
      await client.query(
        'DELETE FROM submission_test_results WHERE submission_id = $1 AND ordinal > $2',
        [input.submissionId, totalTests],
      );

      if (input.overallVerdict === 'AC') {
        await client.query(
          `UPDATE submission_jobs
           SET stage = 'CHECK', status = 'PENDING', locked_by = NULL, locked_at = NULL,
               available_at = NOW(), updated_at = NOW()
           WHERE submission_id = $1`,
          [input.submissionId],
        );
        await client.query("SELECT pg_notify('submission_jobs_ready', $1)", [input.submissionId]);
      } else {
        await client.query(
          `UPDATE submission_jobs
           SET status = 'DONE', locked_by = NULL, locked_at = NULL, updated_at = NOW()
           WHERE submission_id = $1`,
          [input.submissionId],
        );
        const labId = subRes.rows[0]?.lab_id ? String(subRes.rows[0].lab_id) : null;
        if (labId) {
          await this.rebalanceLabPassSample(client, labId);
        }
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

  async recordCheckerResult(input: CheckerCompletionInput): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const conRes = await client.query<{ id: string; constraint_code: string }>(
        'SELECT id, constraint_code FROM lab_constraints WHERE lab_id = $1',
        [input.labId],
      );
      const codeToId = new Map(
        conRes.rows.map((row) => [String(row.constraint_code), String(row.id)]),
      );

      for (const finding of input.findings) {
        const constraintId =
          codeToId.get(finding.constraintCode) ?? `con_${input.labId}_${finding.constraintCode}`;
        const isQueued =
          finding.verdict === 'violation' ||
          finding.verdict === 'unsure' ||
          Boolean(finding.isSampledPass);
        const reviewStatus = isQueued ? 'PENDING_REVIEW' : 'NOT_QUEUED';

        await client.query(
          `INSERT INTO constraint_findings (
             id, submission_id, lab_id, constraint_id, constraint_code, source, verdict,
             unsure_reason, evidence, reason, is_sampled_pass, review_status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
           ON CONFLICT (submission_id, constraint_id) DO UPDATE SET
             lab_id = EXCLUDED.lab_id,
             constraint_code = EXCLUDED.constraint_code,
             source = EXCLUDED.source,
             verdict = EXCLUDED.verdict,
             unsure_reason = EXCLUDED.unsure_reason,
             evidence = EXCLUDED.evidence,
             reason = EXCLUDED.reason,
             is_sampled_pass = EXCLUDED.is_sampled_pass,
             review_status = EXCLUDED.review_status`,
          [
            `fnd_${randomUUID()}`,
            input.submissionId,
            input.labId,
            constraintId,
            finding.constraintCode,
            finding.source,
            finding.verdict,
            finding.unsureReason,
            JSON.stringify(finding.evidence),
            finding.reason,
            Boolean(finding.isSampledPass),
            reviewStatus,
          ],
        );
      }

      for (let idx = 0; idx < input.callLogs.length; idx += 1) {
        const log = input.callLogs[idx];
        const callOrdinal = log.callOrdinal ?? idx + 1;
        const promptVersion = log.promptVersion ?? input.promptVersion ?? 'v1';
        await client.query(
          `INSERT INTO model_call_logs (
             id, submission_id, lab_id, call_ordinal, request_id, model, prompt_version,
             constraints, sanitized_prompt, raw_response, input_tokens, output_tokens,
             latency_ms, estimated_cost_micros, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (submission_id, call_ordinal) DO UPDATE SET
             request_id = EXCLUDED.request_id,
             model = EXCLUDED.model,
             prompt_version = EXCLUDED.prompt_version,
             constraints = EXCLUDED.constraints,
             sanitized_prompt = EXCLUDED.sanitized_prompt,
             raw_response = EXCLUDED.raw_response,
             input_tokens = EXCLUDED.input_tokens,
             output_tokens = EXCLUDED.output_tokens,
             latency_ms = EXCLUDED.latency_ms,
             estimated_cost_micros = EXCLUDED.estimated_cost_micros,
             status = EXCLUDED.status`,
          [
            `mcl_${randomUUID()}`,
            input.submissionId,
            input.labId,
            callOrdinal,
            log.requestId ?? '',
            log.model,
            promptVersion,
            JSON.stringify(log.constraints),
            log.sanitizedPrompt,
            log.rawResponse ?? null,
            log.inputTokens,
            log.outputTokens,
            log.latencyMs,
            usdToMicros(log.estimatedCostUsd),
            log.status,
          ],
        );
      }

      await this.rebalanceLabPassSample(client, input.labId);

      await client.query(
        `UPDATE submissions
         SET checker_status = 'COMPLETED',
             checker_model = $2,
             prompt_version = $3,
             checked_at = $4
         WHERE id = $1`,
        [
          input.submissionId,
          input.model ?? null,
          input.promptVersion ?? null,
          input.checkedAt ?? new Date().toISOString(),
        ],
      );
      await client.query(
        "UPDATE submission_jobs SET status = 'DONE', locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE submission_id = $1",
        [input.submissionId],
      );

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

  async getSubmissionFindings(submissionId: string): Promise<ConstraintFindingRecord[]> {
    const res = await this.requirePool().query(
      'SELECT * FROM constraint_findings WHERE submission_id = $1 ORDER BY constraint_code ASC',
      [submissionId],
    );
    return res.rows.map(mapConstraintFindingRow);
  }

  async countLabModelCalls(labId: string): Promise<number> {
    const res = await this.requirePool().query<{ total: string | number }>(
      'SELECT COUNT(*)::int AS total FROM model_call_logs WHERE lab_id = $1',
      [labId],
    );
    return Number(res.rows[0]?.total ?? 0);
  }

  async listLabReviewQueue(
    labId: string,
    scope: 'counted' | 'all' = 'counted',
  ): Promise<TaReviewQueueEntry[]> {
    const subQuery =
      scope === 'counted'
        ? "SELECT * FROM submissions WHERE lab_id = $1 AND is_counting = TRUE AND overall_verdict = 'AC' ORDER BY submitted_at DESC, id DESC"
        : "SELECT * FROM submissions WHERE lab_id = $1 AND overall_verdict = 'AC' ORDER BY submitted_at DESC, id DESC";
    const subRes = await this.requirePool().query(subQuery, [labId]);
    if (subRes.rows.length === 0) {
      return [];
    }
    const subIds = subRes.rows.map((r) => String(r.id));
    const findRes = await this.requirePool().query(
      'SELECT * FROM constraint_findings WHERE submission_id = ANY($1::text[]) ORDER BY submission_id ASC, constraint_code ASC',
      [subIds],
    );
    const bySub = new Map<string, ConstraintFindingRecord[]>();
    for (const fRow of findRes.rows) {
      const sid = String(fRow.submission_id);
      const list = bySub.get(sid) ?? [];
      list.push(mapConstraintFindingRow(fRow));
      bySub.set(sid, list);
    }
    return subRes.rows.map((row) => {
      const sub = mapSubmissionRow(row);
      return {
        submission: sub,
        findings: bySub.get(sub.id) ?? [],
      };
    });
  }

  async reviewConstraintFinding(input: TaFindingReviewInput): Promise<ConstraintFindingRecord> {
    if (input.decision === 'VIOLATION' && (!input.evidence || input.evidence.length === 0)) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Selecting VIOLATION requires at least one evidence line (FAQ-09).',
      );
    }
    const deductionCp = input.decision === 'VIOLATION' ? pointsToCentipoints(input.deduction) : 0;
    const reviewStatus = input.decision === 'VIOLATION' ? 'APPROVED_VIOLATION' : 'DISMISSED_PASS';

    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const beforeRes = await client.query(
        `SELECT review_status, ta_decision, ta_deduction_centipoints, ta_evidence, ta_reason
         FROM constraint_findings
         WHERE id = $1 AND submission_id = $2
         FOR UPDATE`,
        [input.findingId, input.submissionId],
      );
      const beforeRow = beforeRes.rows[0];
      const beforeState = beforeRow
        ? {
            reviewStatus: String(beforeRow.review_status),
            taDecision: beforeRow.ta_decision ? String(beforeRow.ta_decision) : null,
            taDeduction:
              beforeRow.ta_deduction_centipoints != null
                ? Number(beforeRow.ta_deduction_centipoints) / 100
                : null,
            taReason: beforeRow.ta_reason ? String(beforeRow.ta_reason) : null,
          }
        : null;

      const res = await client.query(
        `UPDATE constraint_findings
         SET review_status = $2,
             ta_decision = $3,
             ta_deduction_centipoints = $4,
             ta_evidence = $5::jsonb,
             ta_reason = $6,
             reviewed_by = $7,
             reviewed_at = NOW()
         WHERE id = $1 AND submission_id = $8
         RETURNING *`,
        [
          input.findingId,
          reviewStatus,
          input.decision,
          deductionCp,
          input.evidence ? JSON.stringify(input.evidence) : null,
          input.reason ?? null,
          input.actorId,
          input.submissionId,
        ],
      );
      const updatedRow = res.rows[0];
      if (!updatedRow) {
        throw problemException(
          HttpStatus.NOT_FOUND,
          `Constraint finding '${input.findingId}' was not found.`,
        );
      }

      await client.query(
        `INSERT INTO audit_logs (id, lab_id, submission_id, actor_id, action, before_state, after_state, reason)
         VALUES ($1, $2, $3, $4, 'TA_REVIEW_FINDING', $5::jsonb, $6::jsonb, $7)`,
        [
          `aud_${randomUUID()}`,
          input.labId,
          input.submissionId,
          input.actorId,
          beforeState ? JSON.stringify(beforeState) : null,
          JSON.stringify({
            findingId: input.findingId,
            reviewStatus,
            decision: input.decision,
            deduction: input.decision === 'VIOLATION' ? input.deduction : 0,
          }),
          input.reason ?? null,
        ],
      );

      await client.query('COMMIT');
      return mapConstraintFindingRow(updatedRow);
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

  async publishLabAtomic(
    labId: string,
    actorId: string,
    nowMs: number = Date.now(),
  ): Promise<string> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const labRes = await client.query(
        'SELECT deadline, published_at FROM labs WHERE id = $1 FOR UPDATE',
        [labId],
      );
      const labRow = labRes.rows[0];
      if (!labRow) {
        throw problemException(
          HttpStatus.NOT_FOUND,
          `The requested lab '${labId}' does not exist.`,
        );
      }
      if (labRow.published_at) {
        await client.query('COMMIT');
        return toIsoString(labRow.published_at);
      }
      if (nowMs < Date.parse(toIsoString(labRow.deadline))) {
        throw problemException(
          HttpStatus.CONFLICT,
          'Cannot publish grades before the lab deadline has passed (FAQ-12).',
        );
      }

      // Ensure all counted submissions have finished judging (FAQ-03, FAQ-12)
      const unjudgedRes = await client.query<{ unjudged_count: string }>(
        `SELECT COUNT(*)::int AS unjudged_count
         FROM submissions
         WHERE lab_id = $1 AND is_counting = TRUE AND pipeline_status <> 'COMPLETED'`,
        [labId],
      );
      const unjudgedCount = Number(unjudgedRes.rows[0]?.unjudged_count ?? 0);
      if (unjudgedCount > 0) {
        throw problemException(
          HttpStatus.CONFLICT,
          `Cannot publish grades while ${unjudgedCount} counted submission(s) have not finished judging (FAQ-03, FAQ-12).`,
        );
      }

      // Ensure all counted AC submissions have finished constraint checking (Syllabus Rule, FAQ-12)
      const uncheckedRes = await client.query<{ unchecked_count: string }>(
        `SELECT COUNT(*)::int AS unchecked_count
         FROM submissions
         WHERE lab_id = $1
           AND is_counting = TRUE
           AND overall_verdict = 'AC'
           AND checker_status <> 'COMPLETED'`,
        [labId],
      );
      const uncheckedCount = Number(uncheckedRes.rows[0]?.unchecked_count ?? 0);
      if (uncheckedCount > 0) {
        throw problemException(
          HttpStatus.CONFLICT,
          `Cannot publish grades while ${uncheckedCount} counted AC submission(s) have not finished constraint checking.`,
        );
      }

      // Ensure FAQ-10 10% pass sampling is balanced across counting AC submissions before publish
      await this.rebalanceLabPassSample(client, labId);

      const pendingRes = await client.query<{ pending_count: string }>(
        `SELECT COUNT(*) AS pending_count
         FROM constraint_findings cf
         INNER JOIN submissions s ON s.id = cf.submission_id
         WHERE s.lab_id = $1 AND s.is_counting = TRUE AND cf.review_status = 'PENDING_REVIEW'`,
        [labId],
      );
      const pendingCount = Number(pendingRes.rows[0]?.pending_count ?? 0);
      if (pendingCount > 0) {
        throw problemException(
          HttpStatus.CONFLICT,
          `Cannot publish grades while ${pendingCount} review item(s) remain PENDING_REVIEW (FAQ-12).`,
        );
      }

      const publishedAt = new Date(nowMs).toISOString();
      await client.query('UPDATE labs SET published_at = $2 WHERE id = $1', [labId, publishedAt]);
      await client.query(
        `INSERT INTO audit_logs (id, lab_id, actor_id, action, after_state)
         VALUES ($1, $2, $3, 'PUBLISH_LAB_GRADES', $4::jsonb)`,
        [`aud_${randomUUID()}`, labId, actorId, JSON.stringify({ publishedAt })],
      );
      await client.query('COMMIT');
      return publishedAt;
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
}
