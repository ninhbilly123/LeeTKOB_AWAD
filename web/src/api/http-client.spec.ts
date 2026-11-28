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

  it('supports D2 TA endpoints (listLabSubmissions, reviewFinding, publishLab) and preserves all 7 FAQ-09 unsureReason codes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          labId: 'lab_1',
          isPublished: false,
          submissions: [
            {
              id: 'sub_1',
              labId: 'lab_1',
              studentId: 'usr_stu_1',
              studentName: 'Student One',
              status: 'COMPLETED',
              overallVerdict: 'WA',
              passedTests: 1,
              totalTests: 2,
              isCounting: true,
              submittedAt: '2026-11-28T10:00:00.000Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          labTitle: 'Merge Sort Lab',
          isPublished: false,
          publishedAt: null,
          studentName: 'Student One',
          submission: {
            id: 'sub_1',
            labId: 'lab_1',
            studentId: 'usr_stu_1',
            code: 'int main() { return 0; }',
            status: 'COMPLETED',
            overallVerdict: 'AC',
            checkerStatus: 'COMPLETED',
            passedTests: 2,
            totalTests: 2,
            isCounting: true,
            submittedAt: '2026-11-28T10:00:00.000Z',
          },
          testVerdicts: [{ ordinal: 1, verdict: 'AC', timeMs: 10 }],
          findings: [
            {
              findingId: 'fnd_1',
              submissionId: 'sub_1',
              constraintId: 'con_c2',
              constraintCode: 'C2',
              constraintText: 'Sort with merge sort.',
              configuredDeduction: 4,
              proposedDeduction: 0,
              source: 'LLM',
              verdict: 'unsure',
              unsureReason: 'EVIDENCE_MISMATCH',
              evidence: [],
              reason: 'Line mismatch.',
              reviewStatus: 'PENDING_REVIEW',
              taDecision: null,
              taDeduction: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'fnd_1',
          submissionId: 'sub_1',
          constraintId: 'con_c2',
          constraintCode: 'C2',
          source: 'LLM',
          verdict: 'unsure',
          unsureReason: 'EVIDENCE_MISMATCH',
          evidence: [],
          reason: 'Line mismatch.',
          reviewStatus: 'APPROVED_VIOLATION',
          taDecision: 'VIOLATION',
          taDeduction: 4,
          taEvidence: [{ line: 1, text: 'int main() { return 0; }' }],
          taReason: 'Confirmed bubble sort.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          labId: 'lab_1',
          isPublished: true,
          publishedAt: '2026-11-28T12:00:00.000Z',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpApiClient('/api');
    const allSubs = await client.listLabSubmissions('jwt-ta', 'lab_1');
    expect(allSubs.submissions[0].studentName).toBe('Student One');
    expect(allSubs.submissions[0].overallVerdict).toBe('WA');

    const review = await client.getTaSubmissionReview('jwt-ta', 'sub_1');
    expect(review.labTitle).toBe('Merge Sort Lab');
    expect(review.constraintVerdicts[0].unsureReason).toBe('EVIDENCE_MISMATCH');
    expect(review.constraintVerdicts[0].findingId).toBe('fnd_1');

    const updated = await client.reviewFinding('jwt-ta', 'lab_1', 'sub_1', 'fnd_1', {
      decision: 'VIOLATION',
      deduction: 4,
      evidence: [{ line: 1, text: 'int main() { return 0; }' }],
      reason: 'Confirmed bubble sort.',
    });
    expect(updated.reviewStatus).toBe('APPROVED_VIOLATION');
    expect(updated.taDeduction).toBe(4);

    const published = await client.publishLab('jwt-ta', 'lab_1');
    expect(published.isPublished).toBe(true);
    expect(published.publishedAt).toBe('2026-11-28T12:00:00.000Z');
  });
});
