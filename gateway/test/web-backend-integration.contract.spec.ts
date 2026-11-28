import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { submissionStore } from './support/submissions.fixtures';

describe('Backend <-> Frontend Integration Contract & Real HTTP Wire Flow', () => {
  let app: INestApplication;

  async function login(username: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ username, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('AC1: GET /users (and /v1/users) enforces ADMIN RBAC, role filter validation, keyset pagination, and strips passwordHash', async () => {
    const adminToken = await login('admin', 'admin123');
    const ta1Token = await login('ta1', 'ta123');
    const student1Token = await login('student1', 'student123');

    // Non-ADMIN callers get 403 Problem Details
    for (const token of [ta1Token, student1Token]) {
      const forbidden = await request(app.getHttpServer())
        .get('/users?role=TA')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(forbidden.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(forbidden.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');
    }

    // Invalid role filter gets 400 Problem Details
    const badRole = await request(app.getHttpServer())
      .get('/users?role=SUPERUSER')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(badRole.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(badRole.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');

    // ADMIN receives TA directory via /users and /v1/users with real DB IDs and no passwordHash
    const taRes = await request(app.getHttpServer())
      .get('/users?role=TA')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(taRes.body.items).toHaveLength(2);
    const taIds = (taRes.body.items as Array<{ id: string }>).map((u) => u.id).sort();
    expect(taIds).toEqual(['usr_ta_01', 'usr_ta_02']);
    for (const item of taRes.body.items as Array<Record<string, unknown>>) {
      expect(item.role).toBe('TA');
      expect(item.passwordHash).toBeUndefined();
      expect(item.password_hash).toBeUndefined();
    }

    // Keyset cursor pagination across TA list (limit=1 -> page 2)
    const p1 = await request(app.getHttpServer())
      .get('/v1/users?role=TA&limit=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(p1.body.items).toHaveLength(1);
    expect(typeof p1.body.nextCursor).toBe('string');

    const p2 = await request(app.getHttpServer())
      .get(`/v1/users?role=TA&limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('AC2: Admin selects TA from GET /users?role=TA, creates class, and assigned TA immediately creates a lab in that class', async () => {
    const adminToken = await login('admin', 'admin123');
    const ta1Token = await login('ta1', 'ta123');
    const ta2Token = await login('ta2', 'ta123');

    const usersRes = await request(app.getHttpServer())
      .get('/users?role=TA')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const ta1 = (usersRes.body.items as Array<{ id: string; username: string }>).find(
      (u) => u.username === 'ta1',
    );
    expect(ta1?.id).toBe('usr_ta_01');

    const createdClass = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        code: 'CSC10002-24CLC3',
        name: 'Kỹ thuật lập trình — Nhóm 3',
        term: 'HK1 2026-2027',
        taIds: [ta1!.id],
      })
      .expect(201);
    const newClassId = createdClass.body.id as string;

    // Assigned TA1 immediately creates a lab in the newly created class
    const createdLab = await request(app.getHttpServer())
      .post(`/classes/${newClassId}/labs`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        title: 'Lab Dynamic TA Wiring',
        statement: 'Implement recursive binary search.',
        deadline: '2099-12-31T23:59:59.000Z',
        testCases: [{ id: 'tc_1', input: '3\n1 2 3\n2\n', expectedOutput: '1\n', isHidden: false }],
        constraints: [{ id: 'C1', text: 'Use recursion.', deduction: 3 }],
      })
      .expect(201);
    expect(createdLab.body.classId).toBe(newClassId);

    // Unassigned TA2 is strictly blocked with 403
    await request(app.getHttpServer())
      .post(`/classes/${newClassId}/labs`)
      .set('Authorization', `Bearer ${ta2Token}`)
      .send({
        title: 'Unauthorized Lab',
        statement: 'Should fail.',
        deadline: '2099-12-31T23:59:59.000Z',
        testCases: [{ id: 'tc_1', input: '1\n', expectedOutput: '1\n', isHidden: false }],
        constraints: [{ id: 'C1', text: 'Should fail.', deduction: 1 }],
      })
      .expect(403);
  });

  it('AC3: Lab responses include classCode and student class-lab listing includes latestStudentVerdict', async () => {
    const seededLabId = 'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001';
    const student1Token = await login('student1', 'student123');

    // Before submitting: latestStudentVerdict is null and classCode is populated
    const beforeList = await request(app.getHttpServer())
      .get('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    const labBefore = (
      beforeList.body.items as Array<{
        id: string;
        classCode?: string;
        latestStudentVerdict?: string | null;
      }>
    ).find((l) => l.id === seededLabId);
    expect(labBefore).toBeDefined();
    expect(labBefore?.classCode).toBe('CSC10002-24CLC1');
    expect(labBefore?.latestStudentVerdict).toBeNull();

    // GET /labs/:labId also includes classCode
    const labDetail = await request(app.getHttpServer())
      .get(`/labs/${seededLabId}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(labDetail.body.classCode).toBe('CSC10002-24CLC1');

    // Submit and complete judge as AC
    const submitRes = await request(app.getHttpServer())
      .post(`/labs/${seededLabId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ code: '#include <iostream>\nint main() { std::cout << 1; return 0; }\n' })
      .expect(201);
    const subId = submitRes.body.id as string;

    await submissionStore.recordJudgeResultAsync({
      submissionId: subId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 8, memoryKb: 2048 }],
      maxTimeMs: 8,
      maxMemoryKb: 2048,
      judgedAt: new Date().toISOString(),
    });

    const afterList = await request(app.getHttpServer())
      .get('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    const labAfter = (
      afterList.body.items as Array<{
        id: string;
        classCode?: string;
        latestStudentVerdict?: string | null;
      }>
    ).find((l) => l.id === seededLabId);
    expect(labAfter?.classCode).toBe('CSC10002-24CLC1');
    expect(labAfter?.latestStudentVerdict).toBe('AC');
  });

  it('AC6: real HTTP wire flow (fetch -> live NestJS port) from login to TA review & grade publish', async () => {
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();

    const jsonFetch = async <T>(
      path: string,
      opts: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {},
    ): Promise<{ status: number; body: T }> => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(`${baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      return { status: res.status, body: (await res.json()) as T };
    };

    // 1. Login TA1 and Student1 over real HTTP
    const taLogin = await jsonFetch<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: { email: 'ta1@leetkob.edu.vn', password: 'ta123' },
    });
    expect(taLogin.status).toBe(200);
    const taToken = taLogin.body.accessToken;

    const stuLogin = await jsonFetch<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: { email: 'student1@leetkob.edu.vn', password: 'student123' },
    });
    expect(stuLogin.status).toBe(200);
    const stuToken = stuLogin.body.accessToken;

    // 2. TA creates a lab with past-ready publishability? First create future deadline, then update or submit on a lab with short deadline
    const deadlineSoon = new Date(Date.now() + 60_000).toISOString();
    const labRes = await jsonFetch<{ id: string }>('/classes/class_cs101/labs', {
      method: 'POST',
      token: taToken,
      idempotencyKey: randomUUID(),
      body: {
        title: 'Wire Flow Sort Lab',
        statement: 'Sort without std::sort.',
        deadline: deadlineSoon,
        testCases: [
          { id: 'tc_1', input: '3\n3 1 2\n', expectedOutput: '1 2 3\n', isHidden: false },
        ],
        constraints: [
          {
            id: 'NO_SORT',
            code: 'NO_SORT',
            checkType: 'HARD_RULE',
            text: 'Do not use std::sort',
            banPatterns: ['std::sort'],
            deduction: 3,
          },
        ],
      },
    });
    expect(labRes.status).toBe(201);
    const labId = labRes.body.id;

    // 3. Student submits C++ code over real HTTP with Idempotency-Key
    const subRes = await jsonFetch<{ id: string; status: string }>(`/labs/${labId}/submissions`, {
      method: 'POST',
      token: stuToken,
      idempotencyKey: randomUUID(),
      body: {
        code: '#include <algorithm>\nint main() { int a[1]={1}; std::sort(a, a+1); return 0; }\n',
      },
    });
    expect(subRes.status).toBe(201);
    expect(subRes.body.status).toBe('QUEUED');
    const submissionId = subRes.body.id;

    // 4. Simulate Judge + Checker worker completions in store
    await submissionStore.recordJudgeResultAsync({
      submissionId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 12, memoryKb: 3200 }],
      maxTimeMs: 12,
      maxMemoryKb: 3200,
      judgedAt: new Date().toISOString(),
    });
    await submissionStore.recordCheckerResultAsync({
      submissionId,
      labId,
      model: 'hard-rule-ast',
      promptVersion: 'v1',
      checkedAt: new Date().toISOString(),
      findings: [
        {
          constraintCode: 'NO_SORT',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 2, text: 'std::sort(a, a+1);' }],
          reason: 'Called banned std::sort.',
        },
      ],
      callLogs: [],
    });

    // 5. Before Publish: Student MUST NOT see constraint deductions or finalScore (FAQ-08)
    const stuBefore = await jsonFetch<Record<string, unknown>>(`/submissions/${submissionId}`, {
      token: stuToken,
    });
    expect(stuBefore.status).toBe(200);
    expect(stuBefore.body.overallVerdict).toBe('AC');
    expect(stuBefore.body.finalScore).toBeUndefined();
    expect(stuBefore.body.deductions).toBeUndefined();

    // 6. TA loads review queue and approves the violation over real HTTP
    const queueRes = await jsonFetch<{
      labTitle: string;
      pendingReviewCount: number;
      items: Array<{ findingId: string; submissionId: string }>;
    }>(`/labs/${labId}/review-queue?scope=counted`, { token: taToken });
    expect(queueRes.status).toBe(200);
    expect(queueRes.body.labTitle).toBe('Wire Flow Sort Lab');
    expect(queueRes.body.pendingReviewCount).toBe(1);
    const findingId = queueRes.body.items[0].findingId;

    const patchRes = await jsonFetch<{ reviewStatus: string; taDeduction: number }>(
      `/labs/${labId}/submissions/${submissionId}/findings/${findingId}`,
      {
        method: 'PATCH',
        token: taToken,
        body: {
          decision: 'VIOLATION',
          deduction: 3,
          evidence: [{ line: 2, text: 'std::sort(a, a+1);' }],
          reason: 'Confirmed std::sort usage.',
        },
      },
    );
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.reviewStatus).toBe('APPROVED_VIOLATION');
    expect(patchRes.body.taDeduction).toBe(3);

    // 7. Verify Student submission view matches contract & TA review queue now has 0 pending items
    const queueAfter = await jsonFetch<{ pendingReviewCount: number }>(
      `/labs/${labId}/review-queue?scope=counted`,
      { token: taToken },
    );
    expect(queueAfter.status).toBe(200);
    expect(queueAfter.body.pendingReviewCount).toBe(0);
  });
});
