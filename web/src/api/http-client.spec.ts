import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpApiClient } from './http-client';
import { ApiError } from '../types/problem-details';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpApiClient', () => {
  it('sends Bearer JWT, Content-Type JSON, and Idempotency-Key on POST /labs/:labId/submissions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'sub_abc',
        labId: 'lab_sort_merge',
        studentId: 'usr_stu_1',
        status: 'QUEUED',
        submittedAt: '2026-11-26T10:00:00.000Z',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpApiClient('/api');
    const res = await client.createSubmission(
      'jwt-token-123',
      'lab_sort_merge',
      { code: 'int main() { return 0; }' },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(res.status).toBe('QUEUED');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/labs/lab_sort_merge/submissions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token-123',
          'Content-Type': 'application/json',
          'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
  });

  it('parses RFC 9457 application/problem+json responses into ApiError with errors[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({
        type: 'https://leetkob.edu.vn/errors/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'You are not enrolled in the class owning this lab.',
        instance: '/labs/lab_cls2/submissions',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpApiClient('/api');
    await expect(client.getStudentLab('jwt-token-123', 'lab_cls2')).rejects.toMatchObject({
      name: 'ApiError',
      problem: {
        status: 403,
        type: 'https://leetkob.edu.vn/errors/forbidden',
        detail: 'You are not enrolled in the class owning this lab.',
      },
    });
    await expect(client.getStudentLab('jwt-token-123', 'lab_cls2')).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
