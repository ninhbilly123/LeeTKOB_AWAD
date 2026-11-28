import type { DemoAccount, SessionUser } from '../types/auth';
import type { ClassSummary, TaLabDetail } from '../types/lab';
import type { ConstraintVerdictDetail, ReviewQueueBucket } from '../types/review';
import type {
  JudgeVerdict,
  StudentTestVerdict,
  SubmissionPipelineStatus,
} from '../types/submission';

export interface MockUserRecord extends SessionUser {
  password: string;
}

export interface MockInternalSubmission {
  id: string;
  labId: string;
  studentId: string;
  studentName: string;
  code: string;
  submittedAt: string;
  idempotencyKey: string;
  status: SubmissionPipelineStatus;
  overallVerdict: JudgeVerdict | null;
  compileOutput: string | null;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  isCountedForGrade: boolean;
  /** Internal test runs include I/O so mock can verify student API strips them (FAQ-02). */
  internalTestRuns: Array<
    StudentTestVerdict & {
      input: string;
      expectedOutput: string;
      actualOutput: string;
    }
  >;
  checkerStatus: 'PENDING' | 'COMPLETED';
  queueBucket: ReviewQueueBucket;
  constraintVerdicts: ConstraintVerdictDetail[];
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: 'admin@leetkob.edu.vn',
    password: 'demo-password',
    displayName: 'Quản trị viên (Admin)',
    role: 'ADMIN',
    summary: 'Quản lý toàn bộ lớp học & gán TA',
  },
  {
    email: 'ta1@leetkob.edu.vn',
    password: 'demo-password',
    displayName: 'TA Nguyễn Minh Tuấn (Lớp 1)',
    role: 'TA',
    summary: 'Phụ trách lớp CSC10002-24CLC1 (có Lab Merge Sort)',
  },
  {
    email: 'ta2@leetkob.edu.vn',
    password: 'demo-password',
    displayName: 'TA Trần Bảo Ngọc (Lớp 2)',
    role: 'TA',
    summary: 'Phụ trách lớp CSC10002-24CLC2 (test chặn chéo lớp 403)',
  },
  {
    email: 'student1@leetkob.edu.vn',
    password: 'demo-password',
    displayName: 'SV Lê Hoàng Nam (23120001)',
    role: 'STUDENT',
    summary: 'Học lớp CSC10002-24CLC1 — đã nộp 3 bài Merge Sort mẫu',
  },
  {
    email: 'student2@leetkob.edu.vn',
    password: 'demo-password',
    displayName: 'SV Phạm Gia Hân (23120002)',
    role: 'STUDENT',
    summary: 'Học lớp CSC10002-24CLC1 — chưa nộp bài (test Empty state)',
  },
];

export const CLEAN_MERGE_SORT_CPP = `#include <iostream>
#include <vector>

void mergeRanges(std::vector<int>& a, int left, int mid, int right) {
  std::vector<int> buf;
  buf.reserve(right - left + 1);
  int i = left;
  int j = mid + 1;
  while (i <= mid && j <= right) {
    if (a[i] <= a[j]) buf.push_back(a[i++]);
    else buf.push_back(a[j++]);
  }
  while (i <= mid) buf.push_back(a[i++]);
  while (j <= right) buf.push_back(a[j++]);
  for (int k = 0; k < static_cast<int>(buf.size()); ++k) {
    a[left + k] = buf[k];
  }
}

void mergeSort(std::vector<int>& a, int left, int right) {
  if (left >= right) return;
  int mid = left + (right - left) / 2;
  mergeSort(a, left, mid);
  mergeSort(a, mid + 1, right);
  mergeRanges(a, left, mid, right);
}

int main() {
  int n;
  if (!(std::cin >> n)) return 0;
  std::vector<int> a(n);
  for (int i = 0; i < n; ++i) std::cin >> a[i];
  if (n > 0) mergeSort(a, 0, n - 1);
  for (int i = 0; i < n; ++i) {
    if (i > 0) std::cout << ' ';
    std::cout << a[i];
  }
  std::cout << '\\n';
  return 0;
}`;

export const BANNED_STD_SORT_CPP = `#include <iostream>
#include <algorithm>
#include <vector>

int main() {
  int n;
  if (!(std::cin >> n)) return 0;
  std::vector<int> a(n);
  for (int i = 0; i < n; ++i) std::cin >> a[i];
  std::sort(a.begin(), a.end());
  for (int i = 0; i < n; ++i) {
    if (i > 0) std::cout << ' ';
    std::cout << a[i];
  }
  std::cout << '\\n';
  return 0;
}`;

export const ITERATIVE_BUBBLE_CPP = `#include <iostream>
#include <vector>

void customSort(std::vector<int>& a) {
  int n = static_cast<int>(a.size());
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j + 1 < n - i; ++j) {
      if (a[j] > a[j + 1]) {
        int tmp = a[j];
        a[j] = a[j + 1];
        a[j + 1] = tmp;
      }
    }
  }
}

int main() {
  int n;
  if (!(std::cin >> n)) return 0;
  std::vector<int> a(n);
  for (int i = 0; i < n; ++i) std::cin >> a[i];
  customSort(a);
  for (int i = 0; i < n; ++i) {
    if (i > 0) std::cout << ' ';
    std::cout << a[i];
  }
  std::cout << '\\n';
  return 0;
}`;

export function createInitialSeed() {
  const users: MockUserRecord[] = [
    {
      id: 'usr_admin_1',
      email: 'admin@leetkob.edu.vn',
      password: 'demo-password',
      displayName: 'Quản trị viên (Admin)',
      role: 'ADMIN',
      classIds: ['cls_1', 'cls_2'],
    },
    {
      id: 'usr_ta_1',
      email: 'ta1@leetkob.edu.vn',
      password: 'demo-password',
      displayName: 'TA Nguyễn Minh Tuấn',
      role: 'TA',
      classIds: ['cls_1'],
    },
    {
      id: 'usr_ta_2',
      email: 'ta2@leetkob.edu.vn',
      password: 'demo-password',
      displayName: 'TA Trần Bảo Ngọc',
      role: 'TA',
      classIds: ['cls_2'],
    },
    {
      id: 'usr_stu_1',
      email: 'student1@leetkob.edu.vn',
      password: 'demo-password',
      displayName: 'SV Lê Hoàng Nam (23120001)',
      role: 'STUDENT',
      classIds: ['cls_1'],
    },
    {
      id: 'usr_stu_2',
      email: 'student2@leetkob.edu.vn',
      password: 'demo-password',
      displayName: 'SV Phạm Gia Hân (23120002)',
      role: 'STUDENT',
      classIds: ['cls_1'],
    },
  ];

  const classes: ClassSummary[] = [
    {
      id: 'cls_1',
      code: 'CSC10002-24CLC1',
      name: 'Kỹ thuật lập trình — Nhóm 1',
      term: 'HK1 2026-2027',
      taIds: ['usr_ta_1'],
      studentCount: 2,
      labCount: 1,
    },
    {
      id: 'cls_2',
      code: 'CSC10002-24CLC2',
      name: 'Kỹ thuật lập trình — Nhóm 2',
      term: 'HK1 2026-2027',
      taIds: ['usr_ta_2'],
      studentCount: 0,
      labCount: 1,
    },
  ];

  const labs: TaLabDetail[] = [
    {
      id: 'lab_sort_merge',
      classId: 'cls_1',
      classCode: 'CSC10002-24CLC1',
      title: 'Merge Sort — Chia để trị (sort-merge)',
      statement: `# Sắp xếp trộn (Merge Sort)

Cho mảng gồm \`N\` số nguyên (\`1 <= N <= 10^5\`). Hãy sắp xếp mảng theo thứ tự tăng dần bằng thuật toán **Merge Sort** sử dụng kỹ thuật chia để trị đệ quy.

## Dữ liệu vào
- Dòng đầu tiên chứa số nguyên \`N\`.
- Dòng thứ hai chứa \`N\` số nguyên cách nhau bởi dấu cách.

## Dữ liệu ra
- In ra \`N\` số nguyên sau khi sắp xếp tăng dần trên một dòng, cách nhau bởi một dấu cách.`,
      openedAt: '2026-11-20T00:00:00.000Z',
      deadline: '2027-01-15T16:59:59.000Z',
      cpuTimeLimitSec: 1,
      memoryLimitMb: 256,
      maxCodeBytes: 65536,
      publishedAt: null,
      testCases: [
        {
          id: 'tc_1',
          ordinal: 1,
          isSample: true,
          input: '5\n4 1 3 9 7\n',
          expectedOutput: '1 3 4 7 9\n',
        },
        {
          id: 'tc_2',
          ordinal: 2,
          isSample: false,
          input: '6\n9 8 7 6 5 4\n',
          expectedOutput: '4 5 6 7 8 9\n',
        },
        {
          id: 'tc_3',
          ordinal: 3,
          isSample: false,
          input: '4\n-5 12 -5 0\n',
          expectedOutput: '-5 -5 0 12\n',
        },
        {
          id: 'tc_4',
          ordinal: 4,
          isSample: false,
          input: '1\n42\n',
          expectedOutput: '42\n',
        },
      ],
      constraints: [
        {
          id: 'con_c1',
          code: 'C1',
          type: 'BAN_LIST',
          description:
            'Không được sử dụng thư viện <algorithm> hoặc các hàm sắp xếp có sẵn (std::sort, std::stable_sort, qsort).',
          patterns: ['<algorithm>', 'std::sort', 'std::stable_sort', 'qsort'],
          deduction: 10,
        },
        {
          id: 'con_c2',
          code: 'C2',
          type: 'SEMANTIC_LLM',
          description:
            'Bắt buộc cài đặt thuật toán Merge Sort đệ quy chia đôi mảng và trộn hai nửa đã sắp xếp.',
          patterns: [],
          deduction: 5,
        },
      ],
    },
    {
      id: 'lab_cls2_graph',
      classId: 'cls_2',
      classCode: 'CSC10002-24CLC2',
      title: 'Duyệt đồ thị theo chiều rộng (BFS)',
      statement: '# BFS trên đồ thị vô hướng\n\nTìm khoảng cách ngắn nhất từ đỉnh nguồn `S`.',
      openedAt: '2026-11-20T00:00:00.000Z',
      deadline: '2027-01-20T16:59:59.000Z',
      cpuTimeLimitSec: 2,
      memoryLimitMb: 256,
      maxCodeBytes: 65536,
      publishedAt: null,
      testCases: [
        {
          id: 'tc_g1',
          ordinal: 1,
          isSample: true,
          input: '3 2\n1 2\n2 3\n',
          expectedOutput: '0 1 2\n',
        },
      ],
      constraints: [
        {
          id: 'con_g1',
          code: 'C1',
          type: 'SEMANTIC_LLM',
          description: 'Bắt buộc dùng hàng đợi (BFS), không dùng DFS đệ quy.',
          patterns: [],
          deduction: 5,
        },
      ],
    },
  ];

  const submissions: MockInternalSubmission[] = [
    {
      id: 'sub_pa3_01',
      labId: 'lab_sort_merge',
      studentId: 'usr_stu_1',
      studentName: 'SV Lê Hoàng Nam (23120001)',
      code: CLEAN_MERGE_SORT_CPP,
      submittedAt: '2026-11-25T08:10:00.000Z',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      status: 'COMPLETED',
      overallVerdict: 'AC',
      compileOutput: null,
      maxTimeMs: 36,
      maxMemoryKb: 4120,
      isCountedForGrade: false,
      internalTestRuns: [
        {
          ordinal: 1,
          verdict: 'AC',
          timeMs: 6,
          input: '5\n4 1 3 9 7\n',
          expectedOutput: '1 3 4 7 9\n',
          actualOutput: '1 3 4 7 9\n',
        },
        {
          ordinal: 2,
          verdict: 'AC',
          timeMs: 12,
          input: 'SECRET_HIDDEN_INPUT_987654',
          expectedOutput: 'SECRET_HIDDEN_OUT_456789',
          actualOutput: 'SECRET_HIDDEN_OUT_456789',
        },
        {
          ordinal: 3,
          verdict: 'AC',
          timeMs: 10,
          input: '4\n-5 12 -5 0\n',
          expectedOutput: '-5 -5 0 12\n',
          actualOutput: '-5 -5 0 12\n',
        },
        {
          ordinal: 4,
          verdict: 'AC',
          timeMs: 8,
          input: '1\n42\n',
          expectedOutput: '42\n',
          actualOutput: '42\n',
        },
      ],
      checkerStatus: 'COMPLETED',
      queueBucket: 'PASS_SAMPLE_10PCT',
      constraintVerdicts: [
        {
          constraintId: 'con_c1',
          code: 'C1',
          description:
            'Không được sử dụng thư viện <algorithm> hoặc các hàm sắp xếp có sẵn (std::sort, std::stable_sort, qsort).',
          source: 'HARD_RULE',
          verdict: 'pass',
          unsureReason: null,
          taConfiguredDeduction: 10,
          proposedDeduction: 0,
          rationale:
            'Không phát hiện chỉ thị include hoặc lời gọi hàm sắp xếp bị cấm trong cây AST.',
          evidence: [],
        },
        {
          constraintId: 'con_c2',
          code: 'C2',
          description:
            'Bắt buộc cài đặt thuật toán Merge Sort đệ quy chia đôi mảng và trộn hai nửa đã sắp xếp.',
          source: 'LLM',
          verdict: 'pass',
          unsureReason: null,
          taConfiguredDeduction: 5,
          proposedDeduction: 0,
          rationale: 'Hàm mergeSort chia đôi đoạn [left, right] đệ quy và trộn bằng mergeRanges.',
          evidence: [
            {
              lineStart: 20,
              lineEnd: 26,
              snippet: 'void mergeSort(std::vector<int>& a, int left, int right)',
            },
          ],
        },
      ],
    },
    {
      id: 'sub_pa3_02',
      labId: 'lab_sort_merge',
      studentId: 'usr_stu_1',
      studentName: 'SV Lê Hoàng Nam (23120001)',
      code: BANNED_STD_SORT_CPP,
      submittedAt: '2026-11-25T08:25:00.000Z',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      status: 'COMPLETED',
      overallVerdict: 'AC',
      compileOutput: null,
      maxTimeMs: 18,
      maxMemoryKb: 3680,
      isCountedForGrade: false,
      internalTestRuns: [
        {
          ordinal: 1,
          verdict: 'AC',
          timeMs: 4,
          input: '5\n4 1 3 9 7\n',
          expectedOutput: '1 3 4 7 9\n',
          actualOutput: '1 3 4 7 9\n',
        },
        {
          ordinal: 2,
          verdict: 'AC',
          timeMs: 6,
          input: 'SECRET_HIDDEN_INPUT_987654',
          expectedOutput: 'SECRET_HIDDEN_OUT_456789',
          actualOutput: 'SECRET_HIDDEN_OUT_456789',
        },
        {
          ordinal: 3,
          verdict: 'AC',
          timeMs: 4,
          input: '4\n-5 12 -5 0\n',
          expectedOutput: '-5 -5 0 12\n',
          actualOutput: '-5 -5 0 12\n',
        },
        {
          ordinal: 4,
          verdict: 'AC',
          timeMs: 4,
          input: '1\n42\n',
          expectedOutput: '42\n',
          actualOutput: '42\n',
        },
      ],
      checkerStatus: 'COMPLETED',
      queueBucket: 'HARD_RULE_VIOLATION',
      constraintVerdicts: [
        {
          constraintId: 'con_c1',
          code: 'C1',
          description:
            'Không được sử dụng thư viện <algorithm> hoặc các hàm sắp xếp có sẵn (std::sort, std::stable_sort, qsort).',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          taConfiguredDeduction: 10,
          proposedDeduction: 10,
          rationale: 'Phát hiện #include <algorithm> và lời gọi trực tiếp std::sort bị cấm.',
          evidence: [
            { lineStart: 2, lineEnd: 2, snippet: '#include <algorithm>' },
            { lineStart: 10, lineEnd: 10, snippet: 'std::sort(a.begin(), a.end());' },
          ],
        },
        {
          constraintId: 'con_c2',
          code: 'C2',
          description:
            'Bắt buộc cài đặt thuật toán Merge Sort đệ quy chia đôi mảng và trộn hai nửa đã sắp xếp.',
          source: 'LLM',
          verdict: 'unsure',
          unsureReason: 'LOW_CONFIDENCE',
          taConfiguredDeduction: 5,
          proposedDeduction: 0,
          rationale:
            'Bài nộp đã bị đánh dấu vi phạm quy tắc cứng C1; chuyển TA tự kiểm tra thêm C2.',
          evidence: [{ lineStart: 10, lineEnd: 10, snippet: 'std::sort(a.begin(), a.end());' }],
        },
      ],
    },
    {
      id: 'sub_pa3_03',
      labId: 'lab_sort_merge',
      studentId: 'usr_stu_1',
      studentName: 'SV Lê Hoàng Nam (23120001)',
      code: ITERATIVE_BUBBLE_CPP,
      submittedAt: '2026-11-25T08:40:00.000Z',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      status: 'COMPLETED',
      overallVerdict: 'AC',
      compileOutput: null,
      maxTimeMs: 42,
      maxMemoryKb: 3840,
      isCountedForGrade: true,
      internalTestRuns: [
        {
          ordinal: 1,
          verdict: 'AC',
          timeMs: 8,
          input: '5\n4 1 3 9 7\n',
          expectedOutput: '1 3 4 7 9\n',
          actualOutput: '1 3 4 7 9\n',
        },
        {
          ordinal: 2,
          verdict: 'AC',
          timeMs: 14,
          input: 'SECRET_HIDDEN_INPUT_987654',
          expectedOutput: 'SECRET_HIDDEN_OUT_456789',
          actualOutput: 'SECRET_HIDDEN_OUT_456789',
        },
        {
          ordinal: 3,
          verdict: 'AC',
          timeMs: 12,
          input: '4\n-5 12 -5 0\n',
          expectedOutput: '-5 -5 0 12\n',
          actualOutput: '-5 -5 0 12\n',
        },
        {
          ordinal: 4,
          verdict: 'AC',
          timeMs: 8,
          input: '1\n42\n',
          expectedOutput: '42\n',
          actualOutput: '42\n',
        },
      ],
      checkerStatus: 'COMPLETED',
      queueBucket: 'LLM_VIOLATION',
      constraintVerdicts: [
        {
          constraintId: 'con_c1',
          code: 'C1',
          description:
            'Không được sử dụng thư viện <algorithm> hoặc các hàm sắp xếp có sẵn (std::sort, std::stable_sort, qsort).',
          source: 'HARD_RULE',
          verdict: 'pass',
          unsureReason: null,
          taConfiguredDeduction: 10,
          proposedDeduction: 0,
          rationale: 'Không sử dụng <algorithm> hay hàm sắp xếp thư viện chuẩn.',
          evidence: [],
        },
        {
          constraintId: 'con_c2',
          code: 'C2',
          description:
            'Bắt buộc cài đặt thuật toán Merge Sort đệ quy chia đôi mảng và trộn hai nửa đã sắp xếp.',
          source: 'LLM',
          verdict: 'violation',
          unsureReason: null,
          taConfiguredDeduction: 5,
          proposedDeduction: 5,
          rationale:
            'Hàm customSort cài đặt hai vòng lặp lồng nhau hoán đổi phần tử kề (Bubble Sort O(n^2)), không phải Merge Sort chia để trị đệ quy.',
          evidence: [
            { lineStart: 4, lineEnd: 15, snippet: 'void customSort(std::vector<int>& a) { ... }' },
          ],
        },
      ],
    },
  ];

  return { users, classes, labs, submissions };
}
