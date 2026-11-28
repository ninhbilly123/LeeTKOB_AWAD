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

  it('authenticates via POST /auth/login + GET /auth/me and maps createLab payload to Gateway DTO', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'aaa.eyJleHAiOjQxMDI0NDQ4MDB9.ccc',
          user: { id: 'usr_ta_01', username: 'ta1', role: 'TA', classIds: ['class_cs101'] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'usr_ta_01',
          username: 'ta1',
          email: 'ta1@leetkob.edu.vn',
          displayName: 'TA Nguyễn Minh Tuấn',
          role: 'TA',
          classIds: ['class_cs101'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'lab_1',
          classId: 'class_cs101',
          title: 'Sort Merge',
          statement: '# Sort',
          deadline: '2099-12-31T00:00:00.000Z',
          maxPayloadSize: 65536,
          testCases: [{ id: 'tc_1', input: '1', expectedOutput: '1', isHidden: false }],
          constraints: [{ id: 'C1', text: 'Do not call `std::sort`.', deduction: 3 }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpApiClient('/api');
    const session = await client.login({ email: 'ta1@leetkob.edu.vn', password: 'ta123' });
    expect(session.user.email).toBe('ta1@leetkob.edu.vn');
    expect(session.user.displayName).toBe('TA Nguyễn Minh Tuấn');

    const created = await client.createLab(session.accessToken, 'class_cs101', {
      title: 'Sort Merge',
      statement: '# Sort',
      openedAt: '2026-11-28T00:00:00.000Z',
      deadline: '2099-12-31T00:00:00.000Z',
      cpuTimeLimitSec: 2,
      memoryLimitMb: 256,
      testCases: [{ ordinal: 1, isSample: true, input: '1', expectedOutput: '1' }],
      constraints: [
        {
          code: 'C1',
          type: 'BAN_LIST',
          description: 'Do not call `std::sort`.',
          patterns: ['std::sort'],
          deduction: 3,
        },
      ],
    });
    expect(created.testCases[0].isSample).toBe(true);
    expect(created.constraints[0].description).toBe('Do not call `std::sort`.');
  });
});
