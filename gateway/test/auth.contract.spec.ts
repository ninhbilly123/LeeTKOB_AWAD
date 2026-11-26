import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app';

describe('POST /auth/login (Contract Suite)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['admin', 'admin123', { id: 'usr_admin_01', username: 'admin', role: 'ADMIN', classIds: [] }],
    ['ta1', 'ta123', { id: 'usr_ta_01', username: 'ta1', role: 'TA', classIds: ['class_cs101'] }],
    ['ta2', 'ta123', { id: 'usr_ta_02', username: 'ta2', role: 'TA', classIds: ['class_cs102'] }],
    [
      'student1',
      'student123',
      { id: 'std_23120244', username: 'student1', role: 'STUDENT', classIds: ['class_cs101'] },
    ],
    [
      'student2',
      'student123',
      {
        id: 'std_second_student',
        username: 'student2',
        role: 'STUDENT',
        classIds: ['class_cs101'],
      },
    ],
  ])(
    'authenticates demo account %s and returns a signed JWT and profile',
    async (username, password, expectedUser) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send({ username, password })
        .expect(200);

      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.accessToken.split('.')).toHaveLength(3);
      expect(response.body.user).toEqual(expectedUser);
      expect(response.body.user).not.toHaveProperty('passwordHash');
    },
  );

  it('issues a JWT that authenticates downstream submission requests', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ username: 'student1', password: 'student123' })
      .expect(200);

    const token = loginRes.body.accessToken as string;
    const submissionRes = await request(app.getHttpServer())
      .post('/labs/lab_018f2d5e-7a91-7f3c-b26a-98124d63e001/submissions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send({ code: 'int main() { return 0; }' })
      .expect(201);

    expect(submissionRes.body.studentId).toBe('std_23120244');
    expect(submissionRes.body.status).toBe('QUEUED');
  });

  it.each([
    ['unknown user', 'unknown_user', 'ta123'],
    ['wrong password', 'student1', 'wrong_password'],
  ])('returns 401 RFC 9457 problem for %s', async (_case, username, password) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ username, password })
      .expect(401);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid username or password.',
      instance: '/auth/login',
    });
  });

  it.each([
    {},
    { username: 'student1' },
    { password: 'student123' },
    { username: '   ', password: 'student123' },
    { username: 123, password: 'student123' },
  ])('returns 400 RFC 9457 problem for invalid credentials payload: %j', async (body) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(400);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
    expect(response.body.status).toBe(400);
    expect(response.body.instance).toBe('/auth/login');
  });

  it('returns 415 RFC 9457 problem when Content-Type is not application/json', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'text/plain')
      .send('username=student1')
      .expect(415);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/unsupported-media-type',
      title: 'Unsupported Media Type',
      status: 415,
      detail: 'Requests must use Content-Type: application/json.',
      instance: '/auth/login',
    });
  });
});
