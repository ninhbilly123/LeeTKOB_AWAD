import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpApiClient } from './http-client';
import type { LeeTkobApiClient } from './client.interface';
import { App } from '../App';
import { ApiError } from '../types/problem-details';
import type { AuthSession } from '../types/auth';
import type { TaSubmissionReviewView } from '../types/review';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Frontend <-> Backend HTTP Wiring', () => {
  it('HttpApiClient supports GET /users?role=TA, Idempotency-Key on createClass/createLab, latestStudentVerdict, and review-queue metadata', async () => {
    const fetchMock = vi
      .fn()
      // 1) GET /users?role=TA
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'usr_ta_01',
              username: 'ta1',
              email: 'ta1@leetkob.edu.vn',
              displayName: 'TA Nguyễn Minh Tuấn',
              role: 'TA',
              classIds: ['class_cs101'],
            },
          ],
          nextCursor: null,
        }),
      })
      // 2) POST /classes
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'class_new',
          code: 'CSC10002-24CLC3',
          name: 'Kỹ thuật lập trình — Nhóm 3',
          term: 'HK1 2026-2027',
          taIds: ['usr_ta_01'],
          studentCount: 0,
          labCount: 0,
        }),
      })
      // 3) GET /classes/class_cs101/labs
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'lab_101',
              classId: 'class_cs101',
              classCode: 'CSC10002-24CLC1',
              title: 'Merge Sort',
              deadline: '2099-12-31T23:59:59.000Z',
              latestStudentVerdict: 'AC',
            },
          ],
          nextCursor: null,
        }),
      })
      // 4) GET /labs/lab_101/review-queue?scope=counted
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          labTitle: 'Merge Sort Lab',
          isPublished: false,
          publishedAt: null,
          pendingReviewCount: 1,
          nextCursor: 'cursor_next_1',
          items: [
            {
              findingId: 'fnd_1',
              submissionId: 'sub_1',
              studentId: 'usr_stu_01',
              studentName: 'Sinh viên 1',
              isCounting: true,
              submittedAt: '2026-11-29T00:00:00.000Z',
              constraintId: 'NO_SORT',
              constraintCode: 'NO_SORT',
              source: 'HARD_RULE',
              verdict: 'violation',
              unsureReason: null,
              evidence: [{ line: 2, text: 'std::sort' }],
              reason: 'Forbidden',
              reviewStatus: 'PENDING_REVIEW',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpApiClient('/api');
    const tas = await client.listUsers('admin-jwt', 'TA');
    expect(tas).toHaveLength(1);
    expect(tas[0].id).toBe('usr_ta_01');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users?role=TA');

    await client.createClass('admin-jwt', {
      code: 'CSC10002-24CLC3',
      name: 'Kỹ thuật lập trình — Nhóm 3',
      term: 'HK1 2026-2027',
      taIds: ['usr_ta_01'],
    });
    const createClassHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(createClassHeaders['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const labs = await client.listClassLabs('stu-jwt', 'class_cs101');
    expect(labs.items[0].classCode).toBe('CSC10002-24CLC1');
    expect(labs.items[0].latestStudentVerdict).toBe('AC');

    const queue = await client.listReviewQueue('ta-jwt', 'lab_101', { scope: 'counted' });
    expect(queue.labTitle).toBe('Merge Sort Lab');
    expect(queue.pendingReviewCount).toBe(1);
    expect(queue.nextCursor).toBe('cursor_next_1');
    expect(queue.items).toHaveLength(1);
  });

  it('AC2 UI: AdminClassesPage dynamically loads real TAs from GET /users?role=TA and submits real TA ID', async () => {
    const fetchMock = vi
      .fn()
      // listClasses
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], nextCursor: null }),
      })
      // listUsers(role=TA)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'usr_ta_01',
              username: 'ta1',
              email: 'ta1@leetkob.edu.vn',
              displayName: 'TA Thực Tế 01',
              role: 'TA',
              classIds: ['class_cs101'],
            },
            {
              id: 'usr_ta_02',
              username: 'ta2',
              email: 'ta2@leetkob.edu.vn',
              displayName: 'TA Thực Tế 02',
              role: 'TA',
              classIds: ['class_cs102'],
            },
          ],
          nextCursor: null,
        }),
      })
      // POST /classes
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'class_created_1',
          code: 'CSC10002-24CLC3',
          name: 'Nhóm 3',
          term: 'HK1 2026-2027',
          taIds: ['usr_ta_02'],
          studentCount: 0,
          labCount: 0,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const adminSession: AuthSession = {
      accessToken: 'admin-jwt',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: {
        id: 'usr_admin_01',
        email: 'admin@leetkob.edu.vn',
        displayName: 'Admin',
        role: 'ADMIN',
        classIds: [],
      },
    };

    render(
      <App
        apiClient={new HttpApiClient('/api')}
        initialPath="/admin/classes"
        initialSession={adminSession}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Tạo lớp học mới/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /\+ Tạo lớp học mới/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /TA Thực Tế 01 \(usr_ta_01\)/i, hidden: true }),
      ).toBeTruthy();
      expect(
        screen.getByRole('option', { name: /TA Thực Tế 02 \(usr_ta_02\)/i, hidden: true }),
      ).toBeTruthy();
    });

    // Hardcoded mock ID usr_ta_1 must not be present
    expect(screen.queryByRole('option', { name: /usr_ta_1\)/i, hidden: true })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Mã lớp/i), { target: { value: 'CSC10002-24CLC3' } });
    fireEvent.change(screen.getByLabelText(/Tên môn học/i), { target: { value: 'Nhóm 3' } });
    fireEvent.change(screen.getByLabelText(/Trợ giảng phụ trách/i), {
      target: { value: 'usr_ta_02' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Tạo lớp$/i, hidden: true }));

    await waitFor(() => {
      expect(screen.getByText('CSC10002-24CLC3')).toBeTruthy();
    });
    const postBody = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)) as {
      taIds: string[];
    };
    expect(postBody.taIds).toEqual(['usr_ta_02']);
  });

  it('AC4 UI: TaReviewQueuePage renders queue labTitle and auto-polls PENDING checker until COMPLETED', async () => {
    let reviewCalls = 0;
    const pendingView: TaSubmissionReviewView = {
      submissionId: 'sub_live_1',
      labId: 'lab_live',
      labTitle: 'Live Checker Lab',
      publishedAt: null,
      studentId: 'usr_stu_01',
      studentName: 'Sinh viên 1',
      submittedAt: '2026-11-29T00:00:00.000Z',
      isCountedForGrade: true,
      overallVerdict: 'AC',
      passedTests: 2,
      totalTests: 2,
      maxTimeMs: 15,
      maxMemoryKb: 2048,
      code: 'int main() { return 0; }',
      testVerdicts: [],
      checkerStatus: 'PENDING',
      queueBucket: 'PASS_SAMPLE_10PCT',
      constraintVerdicts: [],
    };
    const completedView: TaSubmissionReviewView = {
      ...pendingView,
      checkerStatus: 'COMPLETED',
      queueBucket: 'HARD_RULE_VIOLATION',
      constraintVerdicts: [
        {
          findingId: 'fnd_live_1',
          constraintId: 'C1',
          code: 'NO_SORT',
          description: 'Không dùng std::sort',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          taConfiguredDeduction: 3,
          proposedDeduction: 3,
          rationale: 'Phát hiện std::sort',
          evidence: [{ lineStart: 1, lineEnd: 1, snippet: 'std::sort' }],
          reviewStatus: 'PENDING_REVIEW',
        },
      ],
    };

    const stubApi: LeeTkobApiClient = {
      mode: 'mock', // uses 500ms polling cadence for fast deterministic test
      login: vi.fn(),
      getCurrentUser: vi.fn(),
      listUsers: vi.fn(),
      listClasses: vi.fn(),
      createClass: vi.fn(),
      listClassLabs: vi.fn(),
      createLab: vi.fn(),
      getStudentLab: vi.fn(),
      getTaLab: vi.fn(),
      createSubmission: vi.fn(),
      listMySubmissions: vi.fn(),
      getStudentSubmission: vi.fn(),
      listLabSubmissions: vi.fn().mockResolvedValue({
        labId: 'lab_live',
        isPublished: false,
        submissions: [
          {
            id: 'sub_live_1',
            labId: 'lab_live',
            studentId: 'usr_stu_01',
            studentName: 'Sinh viên 1',
            status: 'COMPLETED',
            overallVerdict: 'AC',
            passedTests: 2,
            totalTests: 2,
            maxTimeMs: 15,
            maxMemoryKb: 2048,
            isCountedForGrade: true,
            submittedAt: '2026-11-29T00:00:00.000Z',
          },
        ],
      }),
      listReviewQueue: vi.fn().mockResolvedValue({
        labTitle: 'Live Checker Lab',
        isPublished: false,
        publishedAt: null,
        pendingReviewCount: 1,
        items: [],
        nextCursor: null,
      }),
      getTaSubmissionReview: vi.fn().mockImplementation(async () => {
        reviewCalls += 1;
        return reviewCalls === 1 ? pendingView : completedView;
      }),
      reviewFinding: vi.fn(),
      publishLab: vi.fn(),
    };

    const taSession: AuthSession = {
      accessToken: 'ta-jwt',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: {
        id: 'usr_ta_01',
        email: 'ta1@leetkob.edu.vn',
        displayName: 'TA 1',
        role: 'TA',
        classIds: ['class_cs101'],
      },
    };

    render(
      <App apiClient={stubApi} initialPath="/ta/labs/lab_live/review" initialSession={taSession} />,
    );

    // Initially shows PENDING notice & live polling status
    await waitFor(() => {
      expect(screen.getByText(/Live Checker Lab/i)).toBeTruthy();
      expect(screen.getByText(/Checker đang phân tích ràng buộc/i)).toBeTruthy();
    });

    // Polling automatically updates to COMPLETED finding without reload
    await waitFor(
      () => {
        expect(screen.getByText(/Phát hiện std::sort/i)).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(reviewCalls).toBeGreaterThanOrEqual(2);
  });

  it('AC5 UI: HTTP mode scopes sessionStorage separately, clears invalid restored session on 401 /auth/me, and hides demo accounts by default', async () => {
    const staleHttpSession: AuthSession = {
      accessToken: 'expired-jwt',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: {
        id: 'usr_stu_01',
        email: 'student1@leetkob.edu.vn',
        displayName: 'Sinh viên 1',
        role: 'STUDENT',
        classIds: ['class_cs101'],
      },
    };
    window.sessionStorage.setItem('leetkob.session.v1.http', JSON.stringify(staleHttpSession));

    const httpStub: LeeTkobApiClient = {
      mode: 'http',
      login: vi.fn(),
      getCurrentUser: vi.fn().mockRejectedValue(
        new ApiError({
          type: 'https://leetkob.edu.vn/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Token expired',
          instance: '/auth/me',
        }),
      ),
      listUsers: vi.fn(),
      listClasses: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createClass: vi.fn(),
      listClassLabs: vi.fn(),
      createLab: vi.fn(),
      getStudentLab: vi.fn(),
      getTaLab: vi.fn(),
      createSubmission: vi.fn(),
      listMySubmissions: vi.fn(),
      getStudentSubmission: vi.fn(),
      listLabSubmissions: vi.fn(),
      listReviewQueue: vi.fn(),
      getTaSubmissionReview: vi.fn(),
      reviewFinding: vi.fn(),
      publishLab: vi.fn(),
    };

    render(<App apiClient={httpStub} initialPath="/student/labs" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Đăng nhập LeeTKOB/i })).toBeTruthy();
      expect(screen.getByText(/Phiên đăng nhập đã hết hạn/i)).toBeTruthy();
    });

    expect(window.sessionStorage.getItem('leetkob.session.v1.http')).toBeNull();
    // Demo quick-login panel is hidden by default in HTTP mode when VITE_SHOW_DEMO_ACCOUNTS is unset
    expect(screen.queryByRole('button', { name: /Vào ngay/i })).toBeNull();
  });
});
