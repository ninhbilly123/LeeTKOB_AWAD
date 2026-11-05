import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { submissionStore } from '../src/submissions/submissions.fixtures';

describe('POST /labs/:labId/submissions (Contract Suite)', () => {
  let app: INestApplication;

  const validLabId = 'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001';
  const validStudentToken = 'Bearer valid_student_token';
  const validCode = '#include <iostream>\nint main() { std::cout << "Hello World"; return 0; }';

  beforeEach(async () => {
    submissionStore.reset();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('User Story 1 — Happy Path & Normal Execution (201 Created)', () => {
    it('returns 201 Created and QUEUED status for a valid enrolled student submission', async () => {
      const idempotencyKey = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

      const response = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', validStudentToken)
        .set('Idempotency-Key', idempotencyKey)
        .set('Content-Type', 'application/json')
        .send({ code: validCode })
        .expect(201);

      // Verify Headers
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['idempotency-key']).toBe(idempotencyKey);
      expect(response.headers['location']).toMatch(
        new RegExp(`^/labs/${validLabId}/submissions/sub_`),
      );

      // Verify Body Structure
      expect(response.body).toHaveProperty('id');
      expect(response.body.id).toMatch(/^sub_/);
      expect(response.body.labId).toBe(validLabId);
      expect(response.body.studentId).toBe('std_23120244');
      expect(response.body.status).toBe('QUEUED');
      expect(response.body.idempotencyKey).toBe(idempotencyKey);
      expect(typeof response.body.submittedAt).toBe('string');
      expect(new Date(response.body.submittedAt).getTime()).not.toBeNaN();
    });
  });

  describe('User Story 2 — Idempotent Retry on Network Failure (Priority: P1)', () => {
    it('returns the cached 201 response on identical retransmission without creating duplicate records', async () => {
      const idempotencyKey = '11111111-2222-4333-8444-555555555555';

      // First submission
      const firstResponse = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', validStudentToken)
        .set('Idempotency-Key', idempotencyKey)
        .set('Content-Type', 'application/json')
        .send({ code: validCode })
        .expect(201);

      expect(submissionStore.getAllSubmissions().length).toBe(1);

      // Second identical transmission with same key and same code
      const secondResponse = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', validStudentToken)
        .set('Idempotency-Key', idempotencyKey)
        .set('Content-Type', 'application/json')
        .send({ code: validCode })
        .expect(201);

      // Verify zero duplicate records created
      expect(submissionStore.getAllSubmissions().length).toBe(1);

      // Verify identical response payloads and headers
      expect(secondResponse.body.id).toBe(firstResponse.body.id);
      expect(secondResponse.body.submittedAt).toBe(firstResponse.body.submittedAt);
      expect(secondResponse.headers['location']).toBe(firstResponse.headers['location']);
      expect(secondResponse.headers['idempotency-key']).toBe(idempotencyKey);
    });

    it('rejects reused Idempotency-Key with mismatched payload returning 409 Conflict per RFC 9457', async () => {
      const idempotencyKey = '22222222-3333-4444-8555-666666666666';

      // First submission
      await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', validStudentToken)
        .set('Idempotency-Key', idempotencyKey)
        .set('Content-Type', 'application/json')
        .send({ code: validCode })
        .expect(201);

      // Second submission reusing same key with different code
      const conflictResponse = await request(app.getHttpServer())
        .post(`/labs/${validLabId}/submissions`)
        .set('Authorization', validStudentToken)
        .set('Idempotency-Key', idempotencyKey)
        .set('Content-Type', 'application/json')
        .send({ code: '#include <iostream>\n// Completely different code\nint main() { return 1; }' })
        .expect(409);

      // Verify RFC 9457 problem details
      expect(conflictResponse.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(conflictResponse.body).toEqual({
        type: 'https://leetkob.edu.vn/errors/idempotency-conflict',
        title: 'Conflict',
        status: 409,
        detail: 'The provided Idempotency-Key has already been used with different request parameters.',
        instance: `/labs/${validLabId}/submissions`,
      });
    });
  });
});
