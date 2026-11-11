import { INestApplication, HttpException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { SubmissionsService } from '../src/submissions/submissions.service';
import { createTestApp, bearerFor } from './support/test-app';
import { submissionStore } from './support/submissions.fixtures';

describe('Submission contract security and boundary regressions', () => {
  let app: INestApplication;
  const lab = 'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001';
  const code = 'int main() { return 0; }';
  const endpoint = `/labs/${lab}/submissions`;

  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  function post(key = randomUUID(), token = bearerFor(), labId = lab) {
    return request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', token)
      .set('Idempotency-Key', key)
      .set('Content-Type', 'application/json');
  }

  it.each([
    ['raw student ID', () => 'Bearer std_23120244'],
    ['old mock token', () => 'Bearer valid_student_token'],
    ['expired signed JWT', () => bearerFor(undefined, undefined, { expiresIn: -1 })],
    [
      'wrong signature',
      () => bearerFor(undefined, undefined, { secret: randomBytes(32).toString('hex') }),
    ],
    ['different algorithm', () => bearerFor(undefined, undefined, { algorithm: 'HS512' })],
  ])('rejects %s with the contracted 401 problem', async (_name, token) => {
    const response = await post(randomUUID(), token()).send({ code }).expect(401);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Authentication token is missing, invalid, or has expired.',
      instance: endpoint,
    });
    expect(submissionStore.getAllSubmissions()).toHaveLength(0);
  });

  it('rejects a signed student with no active class membership', async () => {
    const response = await post(randomUUID(), bearerFor('std_not_enrolled'))
      .send({ code })
      .expect(403);
    expect(response.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');
    expect(submissionStore.getAllSubmissions()).toHaveLength(0);
  });

  it('returns 409 for the same student and key reused in another enrolled lab', async () => {
    const key = randomUUID();
    await post(key).send({ code }).expect(201);
    const response = await post(key, bearerFor(), 'lab_second_001').send({ code }).expect(409);
    expect(response.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/idempotency-conflict',
      title: 'Conflict',
      status: 409,
      detail:
        'The provided Idempotency-Key has already been used with different request parameters.',
      instance: '/labs/lab_second_001/submissions',
    });
    expect(submissionStore.getAllSubmissions()).toHaveLength(1);
  });

  it('scopes identical keys to each student and never returns another student response', async () => {
    const key = randomUUID();
    const first = await post(key).send({ code }).expect(201);
    const second = await post(key, bearerFor('std_second_student')).send({ code }).expect(201);
    expect(first.body.studentId).toBe('std_23120244');
    expect(second.body.studentId).toBe('std_second_student');
    expect(second.body.id).not.toBe(first.body.id);
    expect(submissionStore.getAllSubmissions()).toHaveLength(2);
  });

  it('creates only one record for simultaneous identical requests', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(key).send({ code })));
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    expect(submissionStore.getAllSubmissions()).toHaveLength(1);
  });

  it('does not let a cache hit bypass request validation', async () => {
    const key = randomUUID();
    await post(key).send({ code }).expect(201);
    const response = await post(key)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ code }))
      .expect(415);
    expect(response.body.type).toBe('https://leetkob.edu.vn/errors/unsupported-media-type');
    expect(submissionStore.getAllSubmissions()).toHaveLength(1);
  });

  it('returns the original result for an accepted submission retried after its deadline', async () => {
    const key = randomUUID();
    const first = await post(key).send({ code }).expect(201);
    submissionStore.getLab(lab)!.deadline = new Date(Date.now() - 1).toISOString();
    const retry = await post(key).send({ code }).expect(201);
    expect(retry.body).toEqual(first.body);
    expect(submissionStore.getAllSubmissions()).toHaveLength(1);
  });

  it('treats a key as new after its 24-hour retention period', async () => {
    const key = randomUUID();
    const token = bearerFor();
    const first = await post(key, token).send({ code }).expect(201);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 24 * 60 * 60 * 1000 + 1);
    const second = await post(key, token).send({ code }).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(submissionStore.getAllSubmissions()).toHaveLength(2);
  });

  it.each([{}, { code: 42 }, { code: null }])(
    'rejects missing or non-string code: %j',
    async (body) => {
      const response = await post().send(body).expect(400);
      expect(response.body.type).toBe('https://leetkob.edu.vn/errors/bad-request');
    },
  );

  it('accepts exactly 64 KiB of source even when JSON escaping expands its wire size', async () => {
    const suffix = '*/\nint main(){return 0;}';
    const source = '/*' + '\n'.repeat(65536 - 2 - Buffer.byteLength(suffix)) + suffix;
    expect(Buffer.byteLength(source, 'utf8')).toBe(65536);
    expect(Buffer.byteLength(JSON.stringify({ code: source }))).toBeGreaterThan(100 * 1024);
    await post().send({ code: source }).expect(201);
  });

  it('measures UTF-8 bytes rather than JavaScript character count', async () => {
    const response = await post()
      .send({ code: 'é'.repeat(32769) })
      .expect(400);
    expect(response.body.detail).toContain('65538 bytes');
  });

  it('returns the contracted 400 problem for malformed JSON', async () => {
    const response = await post().send('{"code":').expect(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid JSON request body.',
      instance: endpoint,
    });
  });

  it('returns a 413 problem for a body beyond the 512 KiB transport limit', async () => {
    const response = await post()
      .send({ code: 'a'.repeat(512 * 1024) })
      .expect(413);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://leetkob.edu.vn/errors/payload-too-large',
      title: 'Payload Too Large',
      status: 413,
      detail: 'Request body exceeds the 512 KB transport limit.',
      instance: endpoint,
    });
  });

  it.each([
    new Error('INTERNAL_SENTINEL_DO_NOT_EXPOSE'),
    new HttpException('INTERNAL_SENTINEL_DO_NOT_EXPOSE', 500),
  ])(
    'returns a safe 500 problem and allows a successful retry after an internal failure',
    async (error) => {
      const service = app.get(SubmissionsService);
      jest.spyOn(service, 'createSubmission').mockImplementationOnce(() => {
        throw error;
      });
      const key = randomUUID();
      const response = await post(key).send({ code }).expect(500);
      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(response.body).toEqual({
        type: 'https://leetkob.edu.vn/errors/internal-server-error',
        title: 'Internal Server Error',
        status: 500,
        detail:
          'An unexpected error occurred while processing the submission. Please retry with the same Idempotency-Key.',
        instance: endpoint,
      });
      expect(JSON.stringify(response.body)).not.toContain('INTERNAL_SENTINEL');
      await post(key).send({ code }).expect(201);
      expect(submissionStore.getAllSubmissions()).toHaveLength(1);
    },
  );
});
