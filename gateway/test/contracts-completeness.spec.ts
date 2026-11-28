import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { Rfc9457ExceptionFilter } from '../src/common/filters/rfc9457-exception.filter';
import { configureApplication } from '../src/configure-app';
import { PostgresPersistence } from '../src/persistence/postgres.store';
import { bearerFor, createTestApp } from './support/test-app';
import { classesStore, labsStore, submissionStore } from './support/submissions.fixtures';

describe('Contract Completeness Suite (100% Coverage of Auth, Health, Classes, Labs & D2 Edge Cases)', () => {
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
    title: 'Contract Lab — Merge Sort',
    statement: 'Implement merge sort in C++17.',
    deadline: '2099-12-31T23:59:59.000Z',
    testCases: [
      { id: 'tc_pub', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n', isHidden: false },
      { id: 'tc_hid', input: 'SECRET_IN', expectedOutput: 'SECRET_OUT', isHidden: true },
    ],
    constraints: [
      { id: 'C1', text: 'Do not call `std::sort`.', deduction: 3 },
      { id: 'C2', text: 'Sort with merge sort.', deduction: 4 },
    ],
  };

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns 503 RFC 9457 service-unavailable when PostgreSQL health check fails', async () => {
    const failingPg = {
      isEnabled: () => true,
      checkHealth: jest.fn().mockResolvedValue(false),
    } as unknown as PostgresPersistence;

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PostgresPersistence, useValue: failingPg }],
    }).compile();

    const healthApp = moduleRef.createNestApplication<NestExpressApplication>();
    configureApplication(healthApp);
    healthApp.useGlobalFilters(new Rfc9457ExceptionFilter());
    await healthApp.init();

    try {
      const res = await request(healthApp.getHttpServer()).get('/health').expect(503);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({
        type: 'https://leetkob.edu.vn/errors/service-unavailable',
        title: 'Service Unavailable',
        status: 503,
        instance: '/health',
      });
    } finally {
      await healthApp.close();
    }
  });

  it('GET /auth/me rejects missing or invalid Bearer tokens with 401 RFC 9457', async () => {
    const missing = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(missing.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(missing.body.type).toBe('https://leetkob.edu.vn/errors/unauthorized');

    const invalid = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    expect(invalid.body.type).toBe('https://leetkob.edu.vn/errors/unauthorized');
  });

  it('GET /classes covers STUDENT scoping, empty page for unenrolled student, and 400 on invalid limit', async () => {
    const student1Token = await login('student1', 'student123');
    const studentClasses = await request(app.getHttpServer())
      .get('/classes')
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(studentClasses.body.items.map((c: { id: string }) => c.id)).toEqual(['class_cs101']);
    expect(studentClasses.body.nextCursor).toBeNull();

    const unenrolledRes = await request(app.getHttpServer())
      .get('/classes')
      .set('Authorization', bearerFor('std_other_class', 'STUDENT'))
      .expect(200);
    expect(unenrolledRes.body).toEqual({ items: [], nextCursor: null });

    for (const badLimit of ['0', '101', 'abc']) {
      const res = await request(app.getHttpServer())
        .get(`/classes?limit=${badLimit}`)
        .set('Authorization', `Bearer ${student1Token}`)
        .expect(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
    }
  });

  it('POST /classes enforces 409 duplicate code, 400 invalid payload, 403 STUDENT, and 415 with zero side effects', async () => {
    const adminToken = await login('admin', 'admin123');
    const student1Token = await login('student1', 'student123');
    const existingClasses = await classesStore.listClassesForUserAsync('usr_admin_01', 'ADMIN');
    const initialCount = existingClasses.length;
    const duplicateCodeLower = existingClasses[0].code.toLowerCase();

    // 409 duplicate code (case-insensitive against seeded class code)
    const dupRes = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ code: duplicateCodeLower, name: 'Duplicate', term: 'HK1', taIds: [] })
      .expect(409);
    expect(dupRes.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(dupRes.body.type).toBe('https://leetkob.edu.vn/errors/conflict');

    // 400 invalid fields
    for (const invalidBody of [
      { code: '', name: 'A', term: 'HK1' },
      { code: 'CS999', name: 'A', term: 'HK1', taIds: [123] },
    ]) {
      const badRes = await request(app.getHttpServer())
        .post('/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send(invalidBody)
        .expect(400);
      expect(badRes.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
    }

    // 403 STUDENT
    await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Content-Type', 'application/json')
      .send({ code: 'CS998', name: 'Denied', term: 'HK1', taIds: [] })
      .expect(403);

    // 415 non-JSON
    const wrongType = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'text/plain')
      .send('code=CS997')
      .expect(415);
    expect(wrongType.body.type).toBe('https://leetkob.edu.vn/errors/unsupported-media-type');

    // Zero side effects after all refusals
    expect((await classesStore.listClassesForUserAsync('usr_admin_01', 'ADMIN')).length).toBe(
      initialCount,
    );
  });

  it('GET /classes/:classId/labs & POST /classes/:classId/labs cover pagination, redaction, counts, 400/403/404/415', async () => {
    const adminToken = await login('admin', 'admin123');
    const ta1Token = await login('ta1', 'ta123');
    const ta2Token = await login('ta2', 'ta123');
    const student1Token = await login('student1', 'student123');

    const labsBefore = labsStore.getAllLabs().length;

    // POST /classes/:classId/labs refusals: 403 STUDENT/ADMIN/TA2, 415, 400 FAQ-05 bounds & openedAt>=deadline
    for (const deniedToken of [student1Token, adminToken, ta2Token]) {
      await request(app.getHttpServer())
        .post('/classes/class_cs101/labs')
        .set('Authorization', `Bearer ${deniedToken}`)
        .set('Content-Type', 'application/json')
        .send(baseLabPayload)
        .expect(403);
    }

    await request(app.getHttpServer())
      .post('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'text/plain')
      .send('title=bad')
      .expect(415);

    for (const badPatch of [
      { cpuTimeLimitSec: 0 },
      { cpuTimeLimitSec: 6 },
      { memoryLimitMb: 32 },
      { memoryLimitMb: 1024 },
      { openedAt: '2099-12-31T23:59:59.000Z', deadline: '2099-12-31T23:59:59.000Z' },
    ]) {
      const bad = await request(app.getHttpServer())
        .post('/classes/class_cs101/labs')
        .set('Authorization', `Bearer ${ta1Token}`)
        .set('Content-Type', 'application/json')
        .send({ ...baseLabPayload, ...badPatch })
        .expect(400);
      expect(bad.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
    }

    expect(labsStore.getAllLabs().length).toBe(labsBefore);

    // Create a lab so class_cs101 has >= 2 labs for pagination
    const created = await request(app.getHttpServer())
      .post('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(baseLabPayload)
      .expect(201);
    const createdLabId = created.body.id as string;

    // GET /classes/:classId/labs for STUDENT strips hidden test cases
    const stuPage = await request(app.getHttpServer())
      .get('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(JSON.stringify(stuPage.body)).not.toContain('SECRET_IN');
    expect(JSON.stringify(stuPage.body)).not.toContain('SECRET_OUT');

    // GET /classes/:classId/labs for TA includes submissionCount/pendingReviewCount and cursor pagination
    const taPage1 = await request(app.getHttpServer())
      .get('/classes/class_cs101/labs?limit=1')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(taPage1.body.items).toHaveLength(1);
    expect(typeof taPage1.body.items[0].submissionCount).toBe('number');
    expect(typeof taPage1.body.items[0].pendingReviewCount).toBe('number');
    expect(typeof taPage1.body.nextCursor).toBe('string');

    const taPage2 = await request(app.getHttpServer())
      .get(
        `/classes/class_cs101/labs?limit=1&cursor=${encodeURIComponent(taPage1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(taPage2.body.items).toHaveLength(1);
    expect(taPage2.body.items[0].id).not.toBe(taPage1.body.items[0].id);

    // 404 unknown class, 403 unenrolled student, 400 invalid cursor/limit
    await request(app.getHttpServer())
      .get('/classes/class_missing/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/classes/class_cs101/labs')
      .set('Authorization', bearerFor('std_other_class', 'STUDENT'))
      .expect(403);
    await request(app.getHttpServer())
      .get('/classes/class_cs101/labs?cursor=bad')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(400);

    // GET /labs flat endpoint scoped by role (ADMIN/TA/STUDENT) + 401/415 checks
    await request(app.getHttpServer()).get('/labs').expect(401);
    await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'text/plain')
      .send('bad')
      .expect(415);

    const stuFlat = await request(app.getHttpServer())
      .get('/labs')
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(stuFlat.body.labs.some((l: { id: string }) => l.id === createdLabId)).toBe(true);
    expect(JSON.stringify(stuFlat.body)).not.toContain('SECRET_IN');

    const ta2Flat = await request(app.getHttpServer())
      .get('/labs')
      .set('Authorization', `Bearer ${ta2Token}`)
      .expect(200);
    expect(ta2Flat.body.labs.some((l: { id: string }) => l.id === createdLabId)).toBe(false);
  });

  it('covers GET /labs/:labId/submissions, GET /submissions/:id (TA/IDOR/404), review-queue scope=all/400/404, PATCH 415/404/400, and publish 404', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const ta2Token = await login('ta2', 'ta123');
    const student1Token = await login('student1', 'student123');
    const student2Token = await login('student2', 'student123');

    const labRes = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(baseLabPayload)
      .expect(201);
    const labId = labRes.body.id as string;

    const sub1Res = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send({ code: 'int main() { return 0; }' })
      .expect(201);
    const sub1 = sub1Res.body.id as string;

    const sub2Res = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student2Token}`)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send({ code: 'int main() { return 1; }' })
      .expect(201);
    const sub2 = sub2Res.body.id as string;

    await submissionStore.recordJudgeResultAsync({
      submissionId: sub1,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 11, memoryKb: 2048 }],
      maxTimeMs: 11,
      maxMemoryKb: 2048,
      judgedAt: new Date().toISOString(),
    });
    await submissionStore.recordCheckerResultAsync({
      submissionId: sub1,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'pass',
          unsureReason: null,
          evidence: [],
          reason: null,
        },
        {
          constraintCode: 'C2',
          source: 'LLM',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 1, text: 'int main() { return 0; }' }],
          reason: 'Not merge sort.',
        },
      ],
      callLogs: [],
    });

    // 1. GET /labs/:labId/submissions scoped cleanly for STUDENT vs TA + 403/404
    const stuSubs = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(stuSubs.body.submissions).toHaveLength(1);
    expect(stuSubs.body.submissions[0].id).toBe(sub1);
    expect(stuSubs.body.submissions[0].maxTimeMs).toBe(11);
    expect(stuSubs.body.submissions[0].code).toBeUndefined();

    const taSubs = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(taSubs.body.submissions).toHaveLength(2);
    expect(typeof taSubs.body.submissions[0].studentName).toBe('string');

    await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${ta2Token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions`)
      .set('Authorization', bearerFor('std_other_class', 'STUDENT'))
      .expect(403);
    await request(app.getHttpServer())
      .get('/labs/lab_missing/submissions')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);

    // 2. GET /submissions/:submissionId for TA (full review), cross-class TA (403), IDOR student (403), 404, 401
    const taDirect = await request(app.getHttpServer())
      .get(`/submissions/${sub1}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(taDirect.body.labTitle).toBe(baseLabPayload.title);
    expect(taDirect.body.submission.code).toBe('int main() { return 0; }');
    expect(taDirect.body.findings).toHaveLength(2);

    await request(app.getHttpServer())
      .get(`/submissions/${sub1}`)
      .set('Authorization', `Bearer ${ta2Token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/submissions/${sub1}`)
      .set('Authorization', `Bearer ${student2Token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/submissions/sub_does_not_exist')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);
    await request(app.getHttpServer()).get(`/submissions/${sub1}`).expect(401);

    // 3. GET /labs/:labId/submissions/:submissionId & /review 404 + 401
    await request(app.getHttpServer()).get(`/labs/${labId}/submissions/${sub1}`).expect(401);
    await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/sub_missing`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/sub_missing/review`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);

    // 4. GET /labs/:labId/review-queue scope=all, scope=invalid (400), and unknown lab (404)
    const allQueue = await request(app.getHttpServer())
      .get(`/labs/${labId}/review-queue?scope=all`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(allQueue.body.scope).toBe('all');
    expect(allQueue.body.items).toHaveLength(2);

    const badScope = await request(app.getHttpServer())
      .get(`/labs/${labId}/review-queue?scope=invalid`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(400);
    expect(badScope.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');

    await request(app.getHttpServer())
      .get('/labs/lab_missing/review-queue')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);

    // 5. PATCH .../findings/:findingId 415, 404, 400 (invalid decision / deduction) with zero side effects
    const findingId = taDirect.body.findings[1].findingId as string;
    await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${sub1}/findings/${findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'text/plain')
      .send('decision=PASS')
      .expect(415);

    await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${sub1}/findings/fnd_missing`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ decision: 'PASS' })
      .expect(404);

    for (const invalidDecision of [
      { decision: 'MAYBE' },
      { decision: 'VIOLATION', deduction: -1, evidence: [{ line: 1, text: 'x' }] },
      { decision: 'VIOLATION', deduction: 11, evidence: [{ line: 1, text: 'x' }] },
    ]) {
      const badPatch = await request(app.getHttpServer())
        .patch(`/labs/${labId}/submissions/${sub1}/findings/${findingId}`)
        .set('Authorization', `Bearer ${ta1Token}`)
        .set('Content-Type', 'application/json')
        .send(invalidDecision)
        .expect(400);
      expect(badPatch.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
    }

    expect(submissionStore.getAuditLogs()).toHaveLength(0);
    expect(sub2).toMatch(/^sub_/);

    // 6. POST /labs/:labId/publish 404 for unknown lab
    const missingPub = await request(app.getHttpServer())
      .post('/labs/lab_missing/publish')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);
    expect(missingPub.body.type).toBe('https://leetkob.edu.vn/errors/not-found');
  });
});
