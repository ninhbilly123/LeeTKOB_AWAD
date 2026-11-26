import { HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DEMO_USERS } from '../auth/password.util';
import { problemException } from '../common/http-problems';
import {
  DEFAULT_SUBMISSION_LIMITS,
  Lab,
  StoredUser,
  Submission,
  SubmissionJob,
  SubmissionResponse,
  SubmissionStatus,
} from '../submissions/submissions.types';
import { SCHEMA_STATEMENTS } from './schema';
import { mapLabRow, mapUserRow, parseJsonColumn, toIsoString } from './mappers';

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
): SubmissionJob {
  return {
    id: `job_${randomUUID()}`,
    submissionId: submission.id,
    labId: submission.labId,
    studentId: submission.studentId,
    code: submission.code,
    submittedAt: submission.submittedAt,
    limits: { ...DEFAULT_SUBMISSION_LIMITS },
    testCases: (lab.testCases ?? []).map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
    })),
    constraints: (lab.constraints ?? []).map((c) => ({ ...c })),
    status: 'PENDING',
    createdAt,
  };
}

@Injectable()
export class PostgresPersistence implements OnModuleInit, OnModuleDestroy {
  private readonly pool: PgPoolLike | undefined;
  private readonly ownsPool: boolean = false;
  private initialized = false;

  constructor(databaseUrl?: string, injectedPool?: PgPoolLike) {
    if (injectedPool) {
      this.pool = injectedPool;
      this.ownsPool = false;
    } else if (databaseUrl && databaseUrl.trim().length > 0) {
      this.pool = new Pool({ connectionString: databaseUrl.trim() }) as unknown as PgPoolLike;
      this.ownsPool = true;
    }
  }

  isEnabled(): boolean {
    return Boolean(this.pool);
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool || this.initialized) {
      return;
    }
    for (const ddl of SCHEMA_STATEMENTS) {
      await this.pool.query(ddl);
    }
    for (const user of DEMO_USERS) {
      await this.pool.query(
        `INSERT INTO users (id, username, password_hash, role, class_ids)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.username, user.passwordHash, user.role, JSON.stringify(user.classIds)],
      );
    }
    const defaultMemberships = [
      { id: 'mem_001', studentId: 'std_23120244', classId: 'class_cs101', status: 'ACTIVE' },
      { id: 'mem_003', studentId: 'std_second_student', classId: 'class_cs101', status: 'ACTIVE' },
    ];
    for (const mem of defaultMemberships) {
      await this.pool.query(
        `INSERT INTO class_memberships (id, student_id, class_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [mem.id, mem.studentId, mem.classId, mem.status],
      );
    }
    this.initialized = true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownsPool && this.pool) {
      await this.pool.end();
    }
  }

  private requirePool(): PgPoolLike {
    if (!this.pool) {
      throw new Error('PostgresPersistence is not configured.');
    }
    return this.pool;
  }

  // --- Users & Memberships ---

  async findUserByUsername(username: string): Promise<StoredUser | undefined> {
    const res = await this.requirePool().query('SELECT * FROM users WHERE username = $1', [
      username,
    ]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : undefined;
  }

  async findUserById(id: string): Promise<StoredUser | undefined> {
    const res = await this.requirePool().query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : undefined;
  }

  async activeClasses(studentId: string): Promise<string[]> {
    const res = await this.requirePool().query<{ class_id: string }>(
      "SELECT class_id FROM class_memberships WHERE student_id = $1 AND status = 'ACTIVE'",
      [studentId],
    );
    return res.rows.map((row) => String(row.class_id));
  }

  // --- Labs ---

  async saveLab(lab: Lab): Promise<void> {
    await this.requirePool().query(
      `INSERT INTO labs (
         id, class_id, title, statement, deadline, max_payload_size,
         is_active, test_cases, constraints, is_published
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         statement = EXCLUDED.statement,
         deadline = EXCLUDED.deadline,
         test_cases = EXCLUDED.test_cases,
         constraints = EXCLUDED.constraints,
         is_published = EXCLUDED.is_published`,
      [
        lab.id,
        lab.classId,
        lab.title,
        lab.statement ?? '',
        lab.deadline,
        lab.maxPayloadSize,
        lab.isActive,
        JSON.stringify(lab.testCases ?? []),
        JSON.stringify(lab.constraints ?? []),
        lab.isPublished ?? false,
      ],
    );
  }

  async getLab(id: string): Promise<Lab | undefined> {
    const res = await this.requirePool().query('SELECT * FROM labs WHERE id = $1', [id]);
    return res.rows[0] ? mapLabRow(res.rows[0]) : undefined;
  }

  async getAllLabs(): Promise<Lab[]> {
    const res = await this.requirePool().query('SELECT * FROM labs ORDER BY created_at DESC');
    return res.rows.map(mapLabRow);
  }

  // --- Submissions & Outbox ---

  async getSubmission(id: string): Promise<Submission | undefined> {
    const res = await this.requirePool().query('SELECT * FROM submissions WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      labId: String(row.lab_id),
      studentId: String(row.student_id),
      code: String(row.code),
      status: String(row.status) as SubmissionStatus,
      isCounting: Boolean(row.is_counting),
      submittedAt: toIsoString(row.submitted_at),
      idempotencyKey: String(row.idempotency_key),
    };
  }

  async getJobsForSubmission(submissionId: string): Promise<SubmissionJob[]> {
    const res = await this.requirePool().query(
      'SELECT payload FROM submission_jobs WHERE submission_id = $1',
      [submissionId],
    );
    return res.rows.map((row) => parseJsonColumn<SubmissionJob>(row.payload, {} as SubmissionJob));
  }

  async createSubmissionAtomic(params: AtomicCreateSubmissionParams): Promise<SubmissionResponse> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${params.studentId}:${params.idempotencyKey}`,
      ]);

      const cachedRes = await client.query(
        'SELECT payload_hash, response_body, expires_at FROM idempotency_records WHERE student_id = $1 AND key = $2',
        [params.studentId, params.idempotencyKey],
      );
      const cached = cachedRes.rows[0];
      if (cached) {
        if (Date.parse(toIsoString(cached.expires_at)) > params.receivedAt) {
          if (String(cached.payload_hash) !== params.payloadHash) {
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
        await client.query('DELETE FROM idempotency_records WHERE student_id = $1 AND key = $2', [
          params.studentId,
          params.idempotencyKey,
        ]);
      }

      const labRes = await client.query('SELECT * FROM labs WHERE id = $1', [params.labId]);
      const labRow = labRes.rows[0];
      if (!labRow) {
        throw problemException(
          HttpStatus.NOT_FOUND,
          `The requested lab with ID '${params.labId}' does not exist.`,
        );
      }
      const lab = mapLabRow(labRow);
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

      const submittedAt = new Date(params.receivedAt).toISOString();
      const submission: Submission = {
        id: `sub_${randomUUID()}`,
        labId: params.labId,
        studentId: params.studentId,
        code: params.code,
        status: 'QUEUED',
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
      const job = buildSubmissionJob(submission, lab, nowIso);

      await client.query(
        `INSERT INTO submissions (id, lab_id, student_id, code, status, is_counting, submitted_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          submission.id,
          submission.labId,
          submission.studentId,
          submission.code,
          submission.status,
          true,
          submission.submittedAt,
          submission.idempotencyKey,
        ],
      );

      await client.query(
        `INSERT INTO submission_jobs (id, submission_id, lab_id, payload, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)`,
        [job.id, job.submissionId, job.labId, JSON.stringify(job), job.status, nowIso],
      );

      await client.query(
        `INSERT INTO idempotency_records (
           student_id, key, lab_id, payload_hash, status_code, response_headers, response_body, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT (student_id, key) DO UPDATE SET
           lab_id = EXCLUDED.lab_id,
           payload_hash = EXCLUDED.payload_hash,
           status_code = EXCLUDED.status_code,
           response_headers = EXCLUDED.response_headers,
           response_body = EXCLUDED.response_body,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at`,
        [
          params.studentId,
          params.idempotencyKey,
          params.labId,
          params.payloadHash,
          201,
          JSON.stringify(responseHeaders),
          JSON.stringify(responseBody),
          nowIso,
          expiresAt,
        ],
      );

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
}
