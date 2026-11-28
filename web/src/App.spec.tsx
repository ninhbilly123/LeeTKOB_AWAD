import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MockApiClient } from './api/mock-client';
import { BANNED_STD_SORT_CPP, CLEAN_MERGE_SORT_CPP } from './api/mock-seed';
import { App } from './App';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

async function loginAs(client: MockApiClient, email: string) {
  return client.login({ email, password: 'demo-password' });
}

describe('LeeTKOB Frontend PA#3 Flows', () => {
  it('renders login page with 5 PA#3 demo accounts in mock mode', () => {
    const client = new MockApiClient({ judgeStepDelayMs: 0 });
    render(<App apiClient={client} initialPath="/login" initialSession={null} />);

    expect(screen.getByRole('heading', { name: /Đăng nhập LeeTKOB/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Vào ngay/i })).toHaveLength(5);
  });

  it('blocks cross-class TA access and student access to TA review queue with 403', async () => {
    const client = new MockApiClient({ judgeStepDelayMs: 0 });
    const ta2Session = await loginAs(client, 'ta2@leetkob.edu.vn');

    const { unmount } = render(
      <App
        apiClient={client}
        initialPath="/ta/labs/lab_sort_merge/review"
        initialSession={ta2Session}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/HTTP 403/i)).toBeTruthy();
    });
    expect(screen.queryByText(/#include <algorithm>/i)).toBeNull();
    unmount();

    const stuSession = await loginAs(client, 'student1@leetkob.edu.vn');
    render(
      <App
        apiClient={client}
        initialPath="/ta/labs/lab_sort_merge/review"
        initialSession={stuSession}
      />,
    );

    expect(screen.getByText(/HTTP 403/i)).toBeTruthy();
  });

  it('blocks student from viewing a lab in a class they are not enrolled in', async () => {
    const client = new MockApiClient({ judgeStepDelayMs: 0 });
    const stuSession = await loginAs(client, 'student1@leetkob.edu.vn');

    render(
      <App
        apiClient={client}
        initialPath="/student/labs/lab_cls2_graph"
        initialSession={stuSession}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/HTTP 403/i)).toBeTruthy();
    });
    expect(screen.queryByText(/BFS trên đồ thị vô hướng/i)).toBeNull();
  });

  it('allows TA 1 to create a new lab across the 4-step form with validation', async () => {
    const client = new MockApiClient({ judgeStepDelayMs: 0 });
    const ta1Session = await loginAs(client, 'ta1@leetkob.edu.vn');

    render(
      <App
        apiClient={client}
        initialPath="/ta/classes/cls_1/labs/new"
        initialSession={ta1Session}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Tạo bài Lab mới/i })).toBeTruthy();
    });

    // Attempt next without title triggers post-interaction validation
    fireEvent.click(screen.getByRole('button', { name: /Tiếp theo/i }));
    expect(screen.getByText(/Tiêu đề bài Lab không được để trống/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Tiêu đề bài Lab/i), {
      target: { value: 'Quick Sort — Phân hoạch Hoare' },
    });

    // Step 1 -> Step 2 -> Step 3 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: /Tiếp theo/i }));
    expect(screen.getByRole('heading', { name: /Bước 2: Bộ Test Case/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Tiếp theo/i }));
    expect(screen.getByText(/Thông báo minh bạch phía Sinh viên \(FAQ-06\)/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Tiếp theo/i }));
    expect(screen.getByDisplayValue(/64 KB \(C\+\+17 g\+\+ -O2\)/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Tạo bài Lab/i }));

    await waitFor(() => {
      expect(screen.getByText(/Quick Sort — Phân hoạch Hoare/i)).toBeTruthy();
    });
  });

  it('enforces FAQ-02 & FAQ-08 student privacy boundary and supports Idempotency-Key retry', async () => {
    const client = new MockApiClient({ judgeStepDelayMs: 0, failNextSubmitCount: 1 });
    const stuSession = await loginAs(client, 'student1@leetkob.edu.vn');

    // Negative privacy assertion directly on API response before Publish
    const rawView = await client.getStudentSubmission(stuSession.accessToken, 'sub_pa3_02');
    const serialized = JSON.stringify(rawView);
    expect(serialized).not.toContain('SECRET_HIDDEN_INPUT_987654');
    expect(serialized).not.toContain('SECRET_HIDDEN_OUT_456789');
    expect(serialized).not.toContain('constraintVerdicts');
    expect(serialized).not.toContain('unsureReason');
    expect(serialized).not.toContain('proposedDeduction');

    render(
      <App
        apiClient={client}
        initialPath="/student/labs/lab_sort_merge"
        initialSession={stuSession}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Thông báo minh bạch kiểm tra \(FAQ-06\)/i)).toBeTruthy();
    });

    // Negative privacy assertion on Student DOM before Publish
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toContain('SECRET_HIDDEN_INPUT_987654');
    expect(bodyText).not.toContain('SECRET_HIDDEN_OUT_456789');
    expect(bodyText).not.toContain('LOW_CONFIDENCE');
    expect(bodyText).not.toContain('Bubble Sort');

    // Oversized > 64 KB code disables submit
    const editor = screen.getByRole('textbox', { name: /Mã nguồn C\+\+17/i });
    fireEvent.change(editor, { target: { value: 'a'.repeat(65537) } });
    fireEvent.blur(editor);
    expect(screen.getByText(/Vượt giới hạn 64 KB/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Nộp bài C\+\+17/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Valid C++ code triggers simulated 500 once, then retries cleanly with preserved Idempotency-Key
    fireEvent.change(editor, { target: { value: CLEAN_MERGE_SORT_CPP } });
    fireEvent.click(screen.getByRole('button', { name: /Nộp bài C\+\+17/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('[500]');
    });

    fireEvent.click(screen.getByRole('button', { name: /Thử gửi lại/i }));

    await waitFor(() => {
      expect(screen.getByText('sub_101')).toBeTruthy();
      expect(screen.getByText(/★ Bài đang tính điểm/i)).toBeTruthy();
    });
  });

  it('shows TA review queue verdicts, unsureReason, TA deductions, and highlights exact C++ evidence lines', async () => {
    const client = new MockApiClient({ judgeStepDelayMs: 0 });
    const ta1Session = await loginAs(client, 'ta1@leetkob.edu.vn');

    render(
      <App
        apiClient={client}
        initialPath="/ta/labs/lab_sort_merge/review"
        initialSession={ta1Session}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Danh sách bài \(3\)/i)).toBeTruthy();
    });

    // sub_pa3_02 (HARD_RULE_VIOLATION) is highest priority in queue; wait for detail panel to finish loading
    await waitFor(() => {
      expect(screen.getByText(/VIOLATION — Vi phạm/i)).toBeTruthy();
    });
    expect(screen.getAllByText(/Mức trừ TA cấu hình:/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/LOW_CONFIDENCE/i)).toBeTruthy();
    expect(screen.getByText(/0 điểm \(Unsure/i)).toBeTruthy();

    // No "Approve All" button for LLM flags (Syllabus Rule)
    expect(screen.queryByRole('button', { name: /Duyệt tất cả|Approve All/i })).toBeNull();

    // Click evidence chip for line 2 (#include <algorithm>) and verify original line number highlight
    const line2Btn = screen.getByRole('button', { name: /Dòng 2:.*#include <algorithm>/i });
    fireEvent.click(line2Btn);

    const row2 = document.querySelector('tr[data-line-number="2"]');
    expect(row2).not.toBeNull();
    expect(row2?.getAttribute('data-highlighted')).toBe('true');
    expect(row2?.getAttribute('data-active')).toBe('true');
    expect(row2?.textContent).toContain('#include <algorithm>');

    // Verify BANNED_STD_SORT_CPP line 10 also highlighted
    const row10 = document.querySelector('tr[data-line-number="10"]');
    expect(BANNED_STD_SORT_CPP.split('\n')[9]).toContain('std::sort');
    expect(row10?.getAttribute('data-highlighted')).toBe('true');
  });

  it('AC7: blocks Publish while PENDING_REVIEW remains, lets TA review & lookup submission, then shows official grade & deductions to student', async () => {
    // Advance mock clock past lab_sort_merge deadline (2027-01-15) to test post-deadline publish gate
    const client = new MockApiClient({
      judgeStepDelayMs: 0,
      nowProvider: () => Date.parse('2027-02-01T00:00:00.000Z'),
    });
    const ta1Session = await loginAs(client, 'ta1@leetkob.edu.vn');
    const stuSession = await loginAs(client, 'student1@leetkob.edu.vn');

    const { unmount } = render(
      <App
        apiClient={client}
        initialPath="/ta/labs/lab_sort_merge/review"
        initialSession={ta1Session}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Danh sách bài \(3\)/i)).toBeTruthy();
    });

    // Publish before reviewing counted submission sub_pa3_03 MUST fail with [409]
    fireEvent.click(screen.getByRole('button', { name: /Công bố điểm \(Publish\)/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('[409]');
      expect(screen.getByRole('alert').textContent).toContain('PENDING_REVIEW');
    });

    // Use direct submission lookup input to open counted submission sub_pa3_03
    const lookupInput = screen.getByLabelText(/Tra cứu trực tiếp theo Submission ID/i);
    fireEvent.change(lookupInput, { target: { value: 'sub_pa3_03' } });
    fireEvent.click(screen.getByRole('button', { name: /Mở bài nộp/i }));

    await waitFor(() => {
      expect(screen.getByText(/Lưu quyết định C2/i)).toBeTruthy();
    });

    // TA confirms C2 violation with custom deduction 4, line 4 evidence, and note
    fireEvent.change(
      screen.getByLabelText(/Mức trừ \(0–10\)/i, { selector: '#ta-deduction-fnd_sub_pa3_03_C2' }),
      {
        target: { value: '4' },
      },
    );
    fireEvent.change(
      screen.getByLabelText(/Ghi chú \/ Lý do TA/i, { selector: '#ta-reason-fnd_sub_pa3_03_C2' }),
      {
        target: { value: 'Bubble sort thay vì Merge Sort' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: /Lưu quyết định C2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Mức trừ TA đã đặt:/i)).toBeTruthy();
      expect(screen.getByText(/-4 điểm \(VIOLATION\)/i)).toBeTruthy();
    });

    // Now Publish succeeds cleanly
    fireEvent.click(screen.getByRole('button', { name: /Công bố điểm \(Publish\)/i }));
    await waitFor(() => {
      expect(screen.getByText(/Đã công bố điểm chính thức cho Lab/i)).toBeTruthy();
    });
    unmount();

    // Student 1 opens lab after Publish and sees official score (6 / 10) + confirmed C2 deduction
    render(
      <App
        apiClient={client}
        initialPath="/student/labs/lab_sort_merge"
        initialSession={stuSession}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/6 \/ 10 điểm/i)).toBeTruthy();
      expect(screen.getByText(/Bubble sort thay vì Merge Sort/i)).toBeTruthy();
    });
  });
});
