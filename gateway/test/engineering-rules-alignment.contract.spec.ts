import { HttpException, INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { Rfc9457ExceptionFilter } from '../src/common/filters/rfc9457-exception.filter';
import { configureApplication } from '../src/configure-app';
import { PgClientLike, PgPoolLike, PgQueryResult } from '../src/persistence/pg.types';
import { PostgresPersistence } from '../src/persistence/postgres.store';
import { SubmissionsService } from '../src/submissions/submissions.service';
import { createTestApp } from './support/test-app';
import { classesStore, labsStore, submissionStore } from './support/submissions.fixtures';

describe('API & Contract Alignment with write-api-contract & engineering-rules.md', () => {
  let app: INestApplication;

  async function login(username: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ username, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  const baseLabPayload = {
    classId: 'class_cs101',
    title: 'Keyset & Idempotency Lab',
    statement: 'Implement merge sort.',
    deadline: '2099-12-31T23:59:59.000Z',
    testCases: [{ id: 'tc_1', input: '1\n', expectedOutput: '1\n', isHidden: false }],
    constraints: [{ id: 'C1', text: 'Do not call `std::sort`.', deduction: 3 }],
  };

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('AC1: keyset cursor pagination handles tied timestamps, concurrent inserts without duplication, and cross-scope 400 rejection', async () => {
    const adminToken = await login('admin', 'admin123');
    const ta1Token = await login('ta1', 'ta123');
    const student1Token = await login('student1', 'student123');

    // 1) GET /classes with tied createdAt timestamps + concurrent insert mid-traversal
    const tiedTime = '2026-11-15T12:00:00.000Z';
    await classesStore.createClassAsync({
      id: 'class_tie_a',
      code: 'TIE-A',
      name: 'Tie A',
      term: 'HK1',
      inviteCode: null,
      createdBy: 'usr_admin_01',
      taIds: ['usr_ta_01'],
      studentCount: 0,
      labCount: 0,
      createdAt: tiedTime,
    });
    await classesStore.createClassAsync({
      id: 'class_tie_b',
      code: 'TIE-B',
      name: 'Tie B',
      term: 'HK1',
      inviteCode: null,
      createdBy: 'usr_admin_01',
      taIds: ['usr_ta_01'],
      studentCount: 0,
      labCount: 0,
      createdAt: tiedTime,
    });

    const cPage1 = await request(app.getHttpServer())
      .get('/classes?limit=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(cPage1.body.items).toHaveLength(1);
    expect(cPage1.body.items[0].id).toBe('class_tie_b');
    expect(typeof cPage1.body.nextCursor).toBe('string');

    // Insert a brand-new class with newer timestamp AFTER page 1: keyset cursor MUST NOT duplicate class_tie_b!
    await classesStore.createClassAsync({
      id: 'class_newest_mid_page',
      code: 'NEW-MID',
      name: 'Inserted Mid-Page',
      term: 'HK1',
      inviteCode: null,
      createdBy: 'usr_admin_01',
      taIds: ['usr_ta_01'],
      studentCount: 0,
      labCount: 0,
      createdAt: '2026-11-20T00:00:00.000Z',
    });

    const cPage2 = await request(app.getHttpServer())
      .get(`/classes?limit=1&cursor=${encodeURIComponent(cPage1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(cPage2.body.items).toHaveLength(1);
    expect(cPage2.body.items[0].id).toBe('class_tie_a');

    // Replaying /classes cursor on /classes/class_cs101/labs MUST fail with 400 (cursor scope mismatch)
    const crossEndpointRes = await request(app.getHttpServer())
      .get(`/classes/class_cs101/labs?cursor=${encodeURIComponent(cPage1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(crossEndpointRes.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(crossEndpointRes.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');

    // 2) GET /classes/:classId/labs with tied createdAt timestamps + cross-class cursor rejection
    const labTieTime = '2026-11-16T08:00:00.000Z';
    labsStore.saveLab({
      id: 'lab_tie_1',
      classId: 'class_cs101',
      title: 'Tie Lab 1',
      deadline: '2099-12-31T23:59:59.000Z',
      maxPayloadSize: 65536,
      isActive: true,
      createdAt: labTieTime,
    });
    labsStore.saveLab({
      id: 'lab_tie_2',
      classId: 'class_cs101',
      title: 'Tie Lab 2',
      deadline: '2099-12-31T23:59:59.000Z',
      maxPayloadSize: 65536,
      isActive: true,
      createdAt: labTieTime,
    });

    const lPage1 = await request(app.getHttpServer())
      .get('/classes/class_cs101/labs?limit=1')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(lPage1.body.items[0].id).toBe('lab_tie_2');
    expect(typeof lPage1.body.nextCursor).toBe('string');

    // Insert newer lab ahead of cursor: page 2 still returns lab_tie_1 (no duplicate lab_tie_2)
    labsStore.saveLab({
      id: 'lab_newest_mid',
      classId: 'class_cs101',
      title: 'Inserted Mid-Page',
      deadline: '2099-12-31T23:59:59.000Z',
      maxPayloadSize: 65536,
      isActive: true,
      createdAt: '2026-11-25T00:00:00.000Z',
    });

    const lPage2 = await request(app.getHttpServer())
      .get(`/classes/class_cs101/labs?limit=1&cursor=${encodeURIComponent(lPage1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(lPage2.body.items[0].id).toBe('lab_tie_1');

    // Cross-class cursor replay (class_cs101 cursor used on class_cs102) MUST return 400
    await request(app.getHttpServer())
      .get(`/classes/class_cs102/labs?cursor=${encodeURIComponent(lPage1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    // 3) GET /labs/:labId/submissions & GET /labs/:labId/review-queue keyset pagination with ties
    const labId = 'lab_tie_2';
    const subTieTime = '2026-11-21T10:00:00.000Z';
    for (const [subId, studentId] of [
      ['sub_tie_a', 'std_23120244'],
      ['sub_tie_b', 'std_second_student'],
      ['sub_tie_c', 'std_23120244'],
    ] as const) {
      submissionStore.saveSubmission({
        id: subId,
        labId,
        studentId,
        code: 'int main() { return 0; }',
        status: 'QUEUED',
        isCounting: subId !== 'sub_tie_a',
        submittedAt: subTieTime,
        idempotencyKey: randomUUID(),
      });
      await submissionStore.recordJudgeResultAsync({
        submissionId: subId,
        overallVerdict: 'AC',
        compileOutput: null,
        testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 2048 }],
        maxTimeMs: 10,
        maxMemoryKb: 2048,
        judgedAt: subTieTime,
      });
      await submissionStore.recordCheckerResultAsync({
        submissionId: subId,
        labId,
        findings: [
          {
            constraintCode: 'C1',
            source: 'HARD_RULE',
            verdict: 'violation',
            unsureReason: null,
            evidence: [{ line: 1, text: 'int main() { return 0; }' }],
            reason: 'Violation C1',
          },
          {
            constraintCode: 'C2',
            source: 'LLM',
            verdict: 'unsure',
            unsureReason: 'TIMEOUT',
            evidence: [],
            reason: 'Timeout C2',
          },
        ],
        callLogs: [],
      });
    }

    // Paginate GET /labs/:labId/submissions (TA sees all 3 tied submissions)
    const sPage1 = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions?limit=2`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(sPage1.body.submissions.map((s: { id: string }) => s.id)).toEqual([
      'sub_tie_c',
      'sub_tie_b',
    ]);
    expect(typeof sPage1.body.nextCursor).toBe('string');

    // Student cannot replay TA's cursor (scope mismatch)
    await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions?cursor=${encodeURIComponent(sPage1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(400);

    const sPage2 = await request(app.getHttpServer())
      .get(
        `/labs/${labId}/submissions?limit=2&cursor=${encodeURIComponent(sPage1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(sPage2.body.submissions.map((s: { id: string }) => s.id)).toEqual(['sub_tie_a']);
    expect(sPage2.body.nextCursor).toBeNull();

    // Paginate GET /labs/:labId/review-queue?scope=counted (4 findings across 2 counting AC subs)
    const qPage1 = await request(app.getHttpServer())
      .get(`/labs/${labId}/review-queue?scope=counted&limit=2`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(qPage1.body.pendingReviewCount).toBe(4);
    expect(
      qPage1.body.items.map(
        (i: { submissionId: string; constraintCode: string }) =>
          `${i.submissionId}:${i.constraintCode}`,
      ),
    ).toEqual(['sub_tie_c:C1', 'sub_tie_c:C2']);
    expect(typeof qPage1.body.nextCursor).toBe('string');

    // Replaying scope=counted cursor on scope=all MUST fail with 400
    await request(app.getHttpServer())
      .get(
        `/labs/${labId}/review-queue?scope=all&cursor=${encodeURIComponent(qPage1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(400);

    const qPage2 = await request(app.getHttpServer())
      .get(
        `/labs/${labId}/review-queue?scope=counted&limit=2&cursor=${encodeURIComponent(qPage1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(qPage2.body.pendingReviewCount).toBe(4);
    expect(
      qPage2.body.items.map(
        (i: { submissionId: string; constraintCode: string }) =>
          `${i.submissionId}:${i.constraintCode}`,
      ),
    ).toEqual(['sub_tie_b:C1', 'sub_tie_b:C2']);
    expect(qPage2.body.nextCursor).toBeNull();
  });

  it('AC2: reports all invalid fields in RFC 9457 errors[], preserves 503 health detail, logs 500 with X-Request-Id, and rejects 413', async () => {
    const adminToken = await login('admin', 'admin123');
    const ta1Token = await login('ta1', 'ta123');

    // 1) Multi-field 400 errors[] on POST /auth/login
    const badLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({})
      .expect(400);
    expect(badLogin.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'username',
      'password',
    ]);

    // 2) Multi-field 400 errors[] on POST /classes
    const badClass = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ code: '', name: '', term: '', taIds: [123] })
      .expect(400);
    expect(badClass.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'code',
      'name',
      'term',
      'taIds',
    ]);

    // 3) Multi-field 400 errors[] on POST /labs
    const badLab = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({
        classId: '',
        title: '',
        statement: '',
        deadline: 'not-a-date',
        testCases: [],
        constraints: [],
        cpuTimeLimitSec: 99,
        memoryLimitMb: 1,
      })
      .expect(400);
    const badLabFields = badLab.body.errors.map((e: { field: string }) => e.field);
    expect(badLabFields).toEqual(
      expect.arrayContaining([
        'classId',
        'title',
        'statement',
        'deadline',
        'testCases',
        'constraints',
        'cpuTimeLimitSec',
        'memoryLimitMb',
      ]),
    );

    // 4) Multi-field 400 errors[] on PATCH finding
    const badPatch = await request(app.getHttpServer())
      .patch('/labs/lab_1/submissions/sub_1/findings/fnd_1')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ decision: 'WRONG', deduction: 99, evidence: 'not-array', reason: 42 })
      .expect(400);
    expect(badPatch.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'decision',
      'deduction',
      'evidence',
      'reason',
    ]);

    // 5) 413 Payload Too Large on non-submission POST endpoint
    const hugeRes = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ code: 'HUGE', name: 'x'.repeat(520 * 1024), term: 'HK1' })
      .expect(413);
    expect(hugeRes.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(hugeRes.body.type).toBe('https://leetkob.edu.vn/errors/payload-too-large');

    // 6) 503 Service Unavailable on GET /health preserves safe DB detail (NOT submission 500 detail)
    const unhealthyPg = {
      isEnabled: () => true,
      checkHealth: async () => false,
    } as unknown as PostgresPersistence;
    const healthMod = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PostgresPersistence, useValue: unhealthyPg }],
    }).compile();
    const healthApp = healthMod.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApplication(healthApp);
    healthApp.useGlobalFilters(new Rfc9457ExceptionFilter());
    await healthApp.init();
    try {
      const res503 = await request(healthApp.getHttpServer()).get('/health').expect(503);
      expect(res503.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res503.body).toEqual({
        type: 'https://leetkob.edu.vn/errors/service-unavailable',
        title: 'Service Unavailable',
        status: 503,
        detail: 'Database connectivity check failed.',
        instance: '/health',
      });
    } finally {
      await healthApp.close();
    }

    // 7) 500 Internal Server Error attaches X-Request-Id and logs stack internally without leaking body
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const svc = app.get(SubmissionsService);
    jest.spyOn(svc, 'listSubmissionsForUser').mockRejectedValueOnce(new Error('SECRET_SQL_BOOM'));

    const res500 = await request(app.getHttpServer())
      .get('/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/submissions')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('X-Request-Id', 'req-trace-9457')
      .expect(500);
    expect(res500.headers['x-request-id']).toBe('req-trace-9457');
    expect(res500.body.type).toBe('https://leetkob.edu.vn/errors/internal-server-error');
    expect(JSON.stringify(res500.body)).not.toContain('SECRET_SQL_BOOM');
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('[requestId=req-trace-9457]'),
      expect.any(String),
    );
  });

  it('AC3: /v1/* path versioning alias routes identically and preserves /v1/* in RFC 9457 instance', async () => {
    const healthV1 = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(healthV1.body).toEqual({ status: 'ok', persistence: 'memory' });

    const loginV1 = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'ta1@leetkob.edu.vn', password: 'ta123' })
      .expect(200);
    const ta1Token = loginV1.body.accessToken as string;

    const meV1 = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(meV1.body.username).toBe('ta1');

    const classesV1 = await request(app.getHttpServer())
      .get('/v1/classes')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(classesV1.body.items.map((c: { id: string }) => c.id)).toEqual(['class_cs101']);

    const badV1 = await request(app.getHttpServer())
      .get('/v1/classes?limit=999')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(400);
    expect(badV1.body.instance).toBe('/v1/classes?limit=999');

    const createdLabV1 = await request(app.getHttpServer())
      .post('/v1/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(baseLabPayload)
      .expect(201);
    expect(createdLabV1.body.id).toMatch(/^lab_/);

    const queueV1 = await request(app.getHttpServer())
      .get(`/v1/labs/${createdLabV1.body.id}/review-queue`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(queueV1.body.labId).toBe(createdLabV1.body.id);
    expect(queueV1.body.nextCursor).toBeNull();
  });

  it('AC4: optional Idempotency-Key on POST /classes & POST labs replays 201, rejects 409 conflict & 400 bad key, and Postgres uses SQL keyset + 23505->409', async () => {
    const adminToken = await login('admin', 'admin123');
    const ta1Token = await login('ta1', 'ta123');

    // 1) POST /classes with optional Idempotency-Key
    const classKey = randomUUID();
    const classBody = { code: 'CS301-IDEM', name: 'Idempotent Class', term: 'HK1', taIds: [] };
    const cls1 = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', classKey)
      .send(classBody)
      .expect(201);
    expect(cls1.headers['idempotency-key']).toBe(classKey);
    expect(cls1.headers.location).toBe(`/classes/${cls1.body.id}`);

    const countAfterFirst = (await classesStore.listClassesForUserAsync('usr_admin_01', 'ADMIN'))
      .length;

    // Identical replay returns exact same class ID and creates zero duplicates
    const cls2 = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', classKey)
      .send(classBody)
      .expect(201);
    expect(cls2.body.id).toBe(cls1.body.id);
    expect(cls2.headers['idempotency-key']).toBe(classKey);
    expect((await classesStore.listClassesForUserAsync('usr_admin_01', 'ADMIN')).length).toBe(
      countAfterFirst,
    );

    // Mismatched payload with same key returns 409 idempotency-conflict with zero side effects
    const clsConflict = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', classKey)
      .send({ ...classBody, code: 'CS302-DIFF' })
      .expect(409);
    expect(clsConflict.body.type).toBe('https://leetkob.edu.vn/errors/idempotency-conflict');
    expect((await classesStore.listClassesForUserAsync('usr_admin_01', 'ADMIN')).length).toBe(
      countAfterFirst,
    );

    // Invalid UUID v4 Idempotency-Key returns 400 with zero side effects
    await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ ...classBody, code: 'CS303-BADKEY' })
      .expect(400);
    expect((await classesStore.listClassesForUserAsync('usr_admin_01', 'ADMIN')).length).toBe(
      countAfterFirst,
    );

    // 2) POST /classes/:classId/labs & POST /labs with optional Idempotency-Key
    const labKey = randomUUID();
    const labsBefore = labsStore.getAllLabs().length;
    const lab1 = await request(app.getHttpServer())
      .post('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', labKey)
      .send(baseLabPayload)
      .expect(201);
    expect(lab1.headers['idempotency-key']).toBe(labKey);
    expect(labsStore.getAllLabs().length).toBe(labsBefore + 1);

    const lab2 = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', labKey)
      .send(baseLabPayload)
      .expect(201);
    expect(lab2.body.id).toBe(lab1.body.id);
    expect(labsStore.getAllLabs().length).toBe(labsBefore + 1);

    const labConflict = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', labKey)
      .send({ ...baseLabPayload, title: 'Different Lab Title' })
      .expect(409);
    expect(labConflict.body.type).toBe('https://leetkob.edu.vn/errors/idempotency-conflict');
    expect(labsStore.getAllLabs().length).toBe(labsBefore + 1);

    // 3) PostgreSQL adapter: verify SQL keyset pagination (no OFFSET), atomic idempotency, and 23505 -> 409
    const sqlQueries: string[] = [];
    let simulateUniqueViolation = false;
    const client: PgClientLike = {
      query: async <R extends Record<string, unknown>>(text: string): Promise<PgQueryResult<R>> => {
        sqlQueries.push(text.trim());
        if (simulateUniqueViolation && text.includes('INSERT INTO classes')) {
          const pgErr = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          });
          throw pgErr;
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

    await pg.listClassSummariesPageForUser(
      'usr_admin_01',
      'ADMIN',
      { s: 'classes', t: '2026-11-15T12:00:00.000Z', id: 'class_1' },
      10,
    );
    await pg.listClassLabsPage(
      'class_cs101',
      true,
      { s: 'class-labs:class_cs101', t: '2026-11-15T12:00:00.000Z', id: 'lab_1' },
      10,
    );
    await pg.listSubmissionsPage(
      'lab_1',
      'std_1',
      { s: 'lab-submissions:lab_1:std_1', t: '2026-11-15T12:00:00.000Z', id: 'sub_1' },
      10,
    );

    expect(sqlQueries.some((q) => q.includes('(c.created_at, c.id) <'))).toBe(true);
    expect(sqlQueries.some((q) => q.includes('(created_at, id) <'))).toBe(true);
    expect(sqlQueries.some((q) => q.includes('(submitted_at, id) <'))).toBe(true);
    expect(sqlQueries.some((q) => /\bOFFSET\b/i.test(q))).toBe(false);

    // Atomic createClass with idempotency persists idempotency_records in same transaction
    sqlQueries.length = 0;
    await pg.createClass(
      {
        id: 'class_pg_1',
        code: 'PG-101',
        name: 'PG Class',
        term: 'HK1',
        inviteCode: null,
        createdBy: 'usr_admin_01',
      },
      ['usr_ta_01'],
      {
        actorId: 'usr_admin_01',
        idempotencyKey: randomUUID(),
        payloadHash: 'hash_cls',
        nowMs: Date.now(),
      },
    );
    expect(sqlQueries.some((q) => q.includes('INSERT INTO idempotency_records'))).toBe(true);
    expect(sqlQueries[sqlQueries.length - 1]).toBe('COMMIT');

    // Concurrent Postgres 23505 unique violation translates cleanly to 409 Conflict (never 500)
    simulateUniqueViolation = true;
    const dupErr = await pg
      .createClass({
        id: 'class_pg_dup',
        code: 'PG-101',
        name: 'Dup',
        term: 'HK1',
        inviteCode: null,
        createdBy: 'usr_admin_01',
      })
      .catch((err: unknown) => err);
    expect(dupErr).toBeInstanceOf(HttpException);
    expect((dupErr as HttpException).getStatus()).toBe(409);
  });
});
