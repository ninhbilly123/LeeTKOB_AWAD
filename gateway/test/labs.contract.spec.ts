import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app';

describe('Labs API: POST /labs & GET /labs/:labId (Contract Suite)', () => {
  let app: INestApplication;

  async function loginAs(username: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ username, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  const sortMergePayload = {
    classId: 'class_cs101',
    title: 'Sorting Lab — Merge Sort',
    statement: 'Implement merge sort in C++17 to sort N integers in non-decreasing order.',
    deadline: '2099-12-31T23:59:59.000Z',
    testCases: [
      { id: 'tc_1', input: '5\n4 2 1 5 3\n', expectedOutput: '1 2 3 4 5\n', isHidden: false },
      { id: 'tc_2', input: '4\n9 7 5 3\n', expectedOutput: '3 5 7 9\n', isHidden: true },
    ],
    constraints: [
      {
        id: 'C1',
        text: 'Do not call a library sort function: `std::sort`, `std::stable_sort`.',
        deduction: 3,
      },
      {
        id: 'C2',
        text: 'Sort with a merge sort you wrote yourself.',
        deduction: 4,
      },
    ],
  };

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows an assigned TA to create a sort-merge lab with constraints and test cases', async () => {
    const ta1Token = await loginAs('ta1', 'ta123');

    const res = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(sortMergePayload)
      .expect(201);

    expect(res.headers.location).toMatch(/^\/labs\/lab_/);
    expect(res.body.id).toMatch(/^lab_/);
    expect(res.body.classId).toBe('class_cs101');
    expect(res.body.title).toBe(sortMergePayload.title);
    expect(res.body.statement).toBe(sortMergePayload.statement);
    expect(res.body.constraints).toEqual(sortMergePayload.constraints);
    expect(res.body.testCases).toEqual(sortMergePayload.testCases);
    expect(res.body.isPublished).toBe(false);
  });

  it('allows enrolled students to read the lab with constraints while hiding hidden test cases', async () => {
    const ta1Token = await loginAs('ta1', 'ta123');
    const student1Token = await loginAs('student1', 'student123');

    const created = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(sortMergePayload)
      .expect(201);

    const labId = created.body.id as string;

    const studentView = await request(app.getHttpServer())
      .get(`/labs/${labId}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);

    expect(studentView.body.constraints).toEqual(sortMergePayload.constraints);
    expect(studentView.body.reviewNotice).toEqual(expect.any(String));
    expect(studentView.body.testCases).toEqual([sortMergePayload.testCases[0]]);
  });

  it('allows a student to submit a solution to a newly created lab and retry idempotently', async () => {
    const ta1Token = await loginAs('ta1', 'ta123');
    const student1Token = await loginAs('student1', 'student123');

    const created = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(sortMergePayload)
      .expect(201);

    const labId = created.body.id as string;
    const key = randomUUID();
    const code = '#include <iostream>\nint main() { return 0; }';

    const firstSub = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Idempotency-Key', key)
      .set('Content-Type', 'application/json')
      .send({ code })
      .expect(201);

    const retrySub = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Idempotency-Key', key)
      .set('Content-Type', 'application/json')
      .send({ code })
      .expect(201);

    expect(firstSub.body.id).toMatch(/^sub_/);
    expect(retrySub.body.id).toBe(firstSub.body.id);
  });

  it('rejects a TA from another class reading or creating a lab in class_cs101 with 403 RFC 9457', async () => {
    const ta1Token = await loginAs('ta1', 'ta123');
    const ta2Token = await loginAs('ta2', 'ta123');

    const created = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(sortMergePayload)
      .expect(201);

    const labId = created.body.id as string;

    const readDenied = await request(app.getHttpServer())
      .get(`/labs/${labId}`)
      .set('Authorization', `Bearer ${ta2Token}`)
      .expect(403);

    expect(readDenied.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(readDenied.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'You are not authorized to access labs in this class.',
      instance: `/labs/${labId}`,
    });

    const createDenied = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta2Token}`)
      .set('Content-Type', 'application/json')
      .send(sortMergePayload)
      .expect(403);

    expect(createDenied.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(createDenied.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');
  });

  it('rejects a student attempting to create a lab with 403 Forbidden', async () => {
    const student1Token = await loginAs('student1', 'student123');

    const res = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${student1Token}`)
      .set('Content-Type', 'application/json')
      .send(sortMergePayload)
      .expect(403);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');
  });

  it.each([
    ['missing title', { ...sortMergePayload, title: '  ' }],
    ['missing statement', { ...sortMergePayload, statement: '' }],
    ['invalid deadline', { ...sortMergePayload, deadline: 'not-a-date' }],
    ['empty testCases', { ...sortMergePayload, testCases: [] }],
    ['empty constraints', { ...sortMergePayload, constraints: [] }],
    [
      'deduction out of range',
      {
        ...sortMergePayload,
        constraints: [{ id: 'C1', text: 'Rule', deduction: 15 }],
      },
    ],
  ])('returns 400 Bad Request for invalid lab payload: %s', async (_label, invalidBody) => {
    const ta1Token = await loginAs('ta1', 'ta123');

    const res = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send(invalidBody)
      .expect(400);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
  });

  it('returns 404 Not Found when reading a non-existent lab', async () => {
    const ta1Token = await loginAs('ta1', 'ta123');

    const res = await request(app.getHttpServer())
      .get('/labs/lab_does_not_exist')
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(404);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.type).toBe('https://leetkob.edu.vn/errors/not-found');
  });
});
