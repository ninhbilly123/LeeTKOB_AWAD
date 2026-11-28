import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { submissionStore } from './support/submissions.fixtures';

describe('Task D1 End-to-End Acceptance: Auth (email/me), Classes, sort-merge Lab, Durable Tracking & 403', () => {
  let app: INestApplication;

  const evalSortMergeDir = join(__dirname, '..', '..', 'leetkob-eval', 'problems', 'sort-merge');
  const sortMergeStatement = readFileSync(join(evalSortMergeDir, 'statement.md'), 'utf8');
  const sortMergeConstraints = JSON.parse(
    readFileSync(join(evalSortMergeDir, 'constraints.json'), 'utf8'),
  ) as Array<{ id: string; text: string; deduction: number }>;

  async function loginByEmail(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('authenticates demo accounts by email as well as username and serves full profile via GET /auth/me', async () => {
    const ta1Token = await loginByEmail('ta1@leetkob.edu.vn', 'ta123');
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);

    expect(meRes.body).toEqual({
      id: 'usr_ta_01',
      username: 'ta1',
      email: 'ta1@leetkob.edu.vn',
      displayName: 'TA Nguyễn Minh Tuấn',
      role: 'TA',
      classIds: ['class_cs101'],
    });
  });

  it('enforces class visibility, cursor pagination, and ADMIN-only class creation on /classes', async () => {
    const adminToken = await loginByEmail('admin@leetkob.edu.vn', 'admin123');
    const ta1Token = await loginByEmail('ta1@leetkob.edu.vn', 'ta123');

    // Admin sees both demo classes with cursor pagination (limit=1 -> page 1 + page 2)
    const page1 = await request(app.getHttpServer())
      .get('/classes?limit=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(typeof page1.body.nextCursor).toBe('string');

    const page2 = await request(app.getHttpServer())
      .get(`/classes?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    // Invalid cursor returns 400 RFC 9457
    const badCursor = await request(app.getHttpServer())
      .get('/classes?cursor=!!!not-base64!!!')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(badCursor.headers['content-type']).toMatch(/application\/problem\+json/);

    // TA only sees assigned class and cannot create classes (403)
    const taClasses = await request(app.getHttpServer())
      .get('/classes')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(taClasses.body.items.map((c: { id: string }) => c.id)).toEqual(['class_cs101']);

    await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ code: 'CSC999', name: 'Unauthorized', term: 'HK1', taIds: [] })
      .expect(403);

    // Admin creates a new class (201 Created + Location)
    const createdClass = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({
        code: 'CSC10002-24CLC3',
        name: 'Kỹ thuật lập trình — Nhóm 3',
        term: 'HK1 2026-2027',
        taIds: ['usr_ta_01'],
      })
      .expect(201);
    expect(createdClass.headers.location).toMatch(/^\/classes\/class_/);
    expect(createdClass.body.code).toBe('CSC10002-24CLC3');
  });

  it('completes the full D1 acceptance flow with official sort-merge problem, trackable submission ID, idempotent retry, and cross-class TA 403', async () => {
    const ta1Token = await loginByEmail('ta1@leetkob.edu.vn', 'ta123');
    const ta2Token = await loginByEmail('ta2@leetkob.edu.vn', 'ta123');
    const student1Token = await loginByEmail('student1@leetkob.edu.vn', 'student123');

    // 1. TA1 creates the official sort-merge lab via POST /classes/class_cs101/labs
    const createRes = await request(app.getHttpServer())
      .post('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({
        title: 'Sorting with merge sort (sort-merge)',
        statement: sortMergeStatement,
        deadline: '2099-12-31T23:59:59.000Z',
        cpuTimeLimitSec: 2,
        memoryLimitMb: 256,
        testCases: [
          {
            id: 'tc_sample_1',
            input: '6\n5 -2 9 -2 0 7\n',
            expectedOutput: '-2 -2 0 5 7 9\n',
            isHidden: false,
          },
          {
            id: 'tc_hidden_1',
            input: '5\n100 -100 0 50 -50\n',
            expectedOutput: '-100 -50 0 50 100\n',
            isHidden: true,
          },
        ],
        constraints: sortMergeConstraints,
      })
      .expect(201);

    const labId = createRes.body.id as string;
    expect(labId).toMatch(/^lab_/);
    expect(createRes.body.constraints).toHaveLength(2);
    expect(createRes.body.constraints[0].deduction).toBe(3);
    expect(createRes.body.constraints[1].deduction).toBe(4);

    // 2. TA2 (other class) reading the lab or class labs gets 403 RFC 9457 per post-submissions.md
    const ta2LabRes = await request(app.getHttpServer())
      .get(`/labs/${labId}`)
      .set('Authorization', `Bearer ${ta2Token}`)
      .expect(403);
    expect(ta2LabRes.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(ta2LabRes.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');

    const ta2ClassLabsRes = await request(app.getHttpServer())
      .get('/classes/class_cs101/labs')
      .set('Authorization', `Bearer ${ta2Token}`)
      .expect(403);
    expect(ta2ClassLabsRes.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');

    // 3. Student1 reads the lab: sees constraints & sample test, hidden test stripped
    const stuLabRes = await request(app.getHttpServer())
      .get(`/labs/${labId}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(stuLabRes.body.testCases).toHaveLength(1);
    expect(stuLabRes.body.testCases[0].id).toBe('tc_sample_1');
    expect(JSON.stringify(stuLabRes.body)).not.toContain('tc_hidden_1');

    // 4. Student1 submits C++17 solution with Idempotency-Key -> gets trackable ID & Location
    const idemKey = randomUUID();
    const cppCode = '#include <iostream>\nint main() { return 0; }\n';
    const subRes = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Idempotency-Key', idemKey)
      .set('Content-Type', 'application/json')
      .send({ code: cppCode })
      .expect(201);

    const subId = subRes.body.id as string;
    const location = subRes.headers.location as string;
    expect(subId).toMatch(/^sub_/);
    expect(location).toBe(`/labs/${labId}/submissions/${subId}`);

    // Trackable via BOTH Location (/labs/:labId/submissions/:id) AND /submissions/:id
    const trackViaLocation = await request(app.getHttpServer())
      .get(location)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(trackViaLocation.body.id).toBe(subId);
    expect(trackViaLocation.body.status).toBe('QUEUED');

    const trackViaDirect = await request(app.getHttpServer())
      .get(`/submissions/${subId}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(trackViaDirect.body.id).toBe(subId);

    // Job handed off to Ninh's queue with statement, constraints, limits, and studentIdentifiers
    const jobs = submissionStore.getJobsForSubmission(subId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].statement).toBe(sortMergeStatement);
    expect(jobs[0].constraints).toHaveLength(2);
    expect(jobs[0].studentIdentifiers).toContain('student1@leetkob.edu.vn');

    // 5. Idempotent retry with same key returns exact same submission ID and creates NO second job
    const retryRes = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Idempotency-Key', idemKey)
      .set('Content-Type', 'application/json')
      .send({ code: cppCode })
      .expect(201);
    expect(retryRes.body.id).toBe(subId);
    expect(submissionStore.getJobsForSubmission(subId)).toHaveLength(1);
  });
});
