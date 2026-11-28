import React, { useEffect, useState } from 'react';
import { useApiClient } from '../../api/api-context';
import { useAuth } from '../../auth/auth-context-core';
import { ProblemBanner } from '../../components/ProblemBanner';
import { ForbiddenPanel, LoadingPanel } from '../../components/StatePanels';
import { Link } from '../../router/router';
import { useRouter } from '../../router/router-core';
import {
  DEFAULT_CPU_LIMIT_SEC,
  DEFAULT_MEMORY_LIMIT_MB,
  type ConstraintInput,
  type ConstraintType,
  type TestCaseInput,
} from '../../types/lab';
import { isApiError, type Rfc9457ProblemDetails } from '../../types/problem-details';
import { SafeMarkdown } from '../../utils/safe-markdown';

interface TaCreateLabPageProps {
  classId: string;
}

const STEP_LABELS = [
  '1. Đề bài & Thời hạn',
  '2. Bộ Test (Sample & Hidden)',
  '3. Ràng buộc & Mức trừ',
  '4. Giới hạn & Xác nhận',
];

function defaultDateTimeLocal(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaCreateLabPage({ classId }: TaCreateLabPageProps) {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState<Rfc9457ProblemDetails | null>(null);

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState(
    '# Đề bài\n\nMô tả bài toán, định dạng dữ liệu vào/ra và yêu cầu thuật toán...',
  );
  const [openedAt, setOpenedAt] = useState(() => defaultDateTimeLocal(0));
  const [deadline, setDeadline] = useState(() => defaultDateTimeLocal(7));
  const [testCases, setTestCases] = useState<TestCaseInput[]>([
    { ordinal: 1, isSample: true, input: '5\n4 1 3 9 7\n', expectedOutput: '1 3 4 7 9\n' },
    { ordinal: 2, isSample: false, input: '3\n9 2 1\n', expectedOutput: '1 2 9\n' },
  ]);
  const [constraints, setConstraints] = useState<ConstraintInput[]>([
    {
      code: 'C1',
      type: 'BAN_LIST',
      description:
        'Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::partial_sort`, `qsort`.',
      patterns: ['std::sort', 'std::stable_sort', 'std::partial_sort', 'qsort'],
      deduction: 3,
    },
    {
      code: 'C2',
      type: 'SEMANTIC_LLM',
      description: 'Sort with a merge sort you wrote yourself.',
      patterns: [],
      deduction: 4,
    },
  ]);
  const [cpuTimeLimitSec, setCpuTimeLimitSec] = useState(DEFAULT_CPU_LIMIT_SEC);
  const [memoryLimitMb, setMemoryLimitMb] = useState(DEFAULT_MEMORY_LIMIT_MB);

  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [stepAttempted, setStepAttempted] = useState<Record<number, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<Rfc9457ProblemDetails | null>(null);

  // Verify class ownership upfront so TA of another class is stopped immediately
  useEffect(() => {
    let active = true;
    const verifyClass = async () => {
      if (!session) return;
      setCheckingAccess(true);
      try {
        await api.listClassLabs(session.accessToken, classId);
        if (active) setAccessError(null);
      } catch (err) {
        if (!active) return;
        if (isApiError(err)) {
          if (err.status === 401) {
            logout();
            setExpiredMessage('Phiên đăng nhập đã hết hạn.');
            navigate('/login', { replace: true });
            return;
          }
          setAccessError(err.problem);
        }
      } finally {
        if (active) setCheckingAccess(false);
      }
    };
    void verifyClass();
    return () => {
      active = false;
    };
  }, [api, classId, logout, navigate, session, setExpiredMessage]);

  const validateStep = (targetStep: number): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (targetStep === 0) {
      if (!title.trim()) errors.title = 'Tiêu đề bài Lab không được để trống.';
      if (!statement.trim()) errors.statement = 'Đề bài Markdown không được để trống.';
      if (new Date(deadline).getTime() <= new Date(openedAt).getTime()) {
        errors.deadline = 'Hạn nộp phải diễn ra sau thời điểm mở bài.';
      }
    }
    if (targetStep === 1) {
      if (testCases.length === 0) {
        errors.testCases = 'Cần ít nhất 1 test case để chấm bài.';
      }
      testCases.forEach((tc, idx) => {
        if (!tc.expectedOutput.trim()) {
          errors[`tc.${idx}.expectedOutput`] =
            `Test #${idx + 1} cần đầu ra mong đợi (expected stdout).`;
        }
      });
    }
    if (targetStep === 2) {
      constraints.forEach((c, idx) => {
        if (!c.description.trim()) {
          errors[`con.${idx}.description`] =
            `Ràng buộc #${idx + 1} cần mô tả công khai cho sinh viên.`;
        }
        if (Number.isNaN(c.deduction) || c.deduction <= 0 || c.deduction > 10) {
          errors[`con.${idx}.deduction`] = `Mức trừ phải lớn hơn 0 và nhỏ hơn hoặc bằng 10 điểm.`;
        }
      });
    }
    if (targetStep === 3) {
      if (cpuTimeLimitSec < 1 || cpuTimeLimitSec > 5) {
        errors.cpuTimeLimitSec = 'Thời gian CPU phải trong khoảng 1–5 giây (FAQ-05).';
      }
      if (memoryLimitMb < 64 || memoryLimitMb > 512) {
        errors.memoryLimitMb = 'Bộ nhớ phải trong khoảng 64–512 MB (FAQ-05).';
      }
    }
    return errors;
  };

  const currentErrors = validateStep(step);

  const showError = (fieldKey: string): string | null => {
    if (touchedFields[fieldKey] || stepAttempted[step]) {
      return currentErrors[fieldKey] ?? null;
    }
    return null;
  };

  const handleNext = () => {
    setStepAttempted((prev) => ({ ...prev, [step]: true }));
    if (Object.keys(currentErrors).length > 0) return;
    setStep((prev) => Math.min(STEP_LABELS.length - 1, prev + 1));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return;
    setStepAttempted({ 0: true, 1: true, 2: true, 3: true });
    for (let s = 0; s < STEP_LABELS.length; s += 1) {
      if (Object.keys(validateStep(s)).length > 0) {
        setStep(s);
        return;
      }
    }

    setSubmitting(true);
    setProblem(null);
    try {
      await api.createLab(session.accessToken, classId, {
        title: title.trim(),
        statement,
        openedAt: new Date(openedAt).toISOString(),
        deadline: new Date(deadline).toISOString(),
        cpuTimeLimitSec,
        memoryLimitMb,
        testCases: testCases.map((tc, idx) => ({ ...tc, ordinal: idx + 1 })),
        constraints,
      });
      navigate(`/ta/classes/${classId}`);
    } catch (err) {
      if (isApiError(err)) {
        setProblem(err.problem);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingAccess) {
    return (
      <div className="container-page">
        <LoadingPanel message="Đang kiểm tra quyền phụ trách lớp..." />
      </div>
    );
  }

  if (accessError && (accessError.status === 403 || accessError.status === 404)) {
    return <ForbiddenPanel status={accessError.status} message={accessError.detail} />;
  }

  return (
    <div className="container-page">
      <div style={{ marginBottom: '0.75rem' }}>
        <Link to={`/ta/classes/${classId}`}>&larr; Quay lại danh sách bài Lab</Link>
      </div>
      <h1 id="main-content" tabIndex={-1} style={{ marginTop: 0 }}>
        Tạo bài Lab mới
      </h1>

      <div className="tablist" role="tablist" aria-label="Các bước tạo bài Lab">
        {STEP_LABELS.map((label, idx) => (
          <button
            key={label}
            type="button"
            role="tab"
            className="tab-btn"
            aria-selected={step === idx}
            onClick={() => setStep(idx)}
          >
            {label}
          </button>
        ))}
      </div>

      {problem && <ProblemBanner problem={problem} />}

      <form onSubmit={handleSubmit} noValidate>
        {step === 0 && (
          <section className="card" aria-labelledby="step-1-heading">
            <h2 id="step-1-heading" style={{ marginTop: 0, fontSize: '1.15rem' }}>
              Bước 1: Thông tin chung &amp; Đề bài Markdown
            </h2>
            <div className="field">
              <label htmlFor="lab-title">Tiêu đề bài Lab</label>
              <input
                id="lab-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTouchedFields((p) => ({ ...p, title: true }))}
                aria-invalid={showError('title') ? 'true' : undefined}
                aria-describedby={showError('title') ? 'lab-title-err' : undefined}
                placeholder="Ví dụ: Merge Sort — Chia để trị (sort-merge)"
                required
              />
              {showError('title') && (
                <span id="lab-title-err" className="field-error">
                  {showError('title')}
                </span>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '1rem',
              }}
            >
              <div className="field">
                <label htmlFor="lab-opened">Thời điểm mở bài</label>
                <input
                  id="lab-opened"
                  type="datetime-local"
                  value={openedAt}
                  onChange={(e) => setOpenedAt(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="lab-deadline">Hạn nộp bài</label>
                <input
                  id="lab-deadline"
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  onBlur={() => setTouchedFields((p) => ({ ...p, deadline: true }))}
                  aria-invalid={showError('deadline') ? 'true' : undefined}
                  aria-describedby={showError('deadline') ? 'lab-deadline-err' : undefined}
                  required
                />
                {showError('deadline') && (
                  <span id="lab-deadline-err" className="field-error">
                    {showError('deadline')}
                  </span>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
              }}
            >
              <div className="field">
                <label htmlFor="lab-statement">Đề bài (Markdown)</label>
                <textarea
                  id="lab-statement"
                  rows={10}
                  className="mono"
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  onBlur={() => setTouchedFields((p) => ({ ...p, statement: true }))}
                  aria-invalid={showError('statement') ? 'true' : undefined}
                  aria-describedby={showError('statement') ? 'lab-statement-err' : undefined}
                  required
                />
                {showError('statement') && (
                  <span id="lab-statement-err" className="field-error">
                    {showError('statement')}
                  </span>
                )}
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.92rem', margin: '0 0 0.35rem' }}>
                  Xem trước hiển thị (An toàn XSS)
                </p>
                <div
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem 1rem',
                    minHeight: '220px',
                    background: 'var(--bg-subtle)',
                  }}
                >
                  <SafeMarkdown content={statement} />
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="card" aria-labelledby="step-2-heading">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginBottom: '0.75rem',
              }}
            >
              <h2 id="step-2-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
                Bước 2: Bộ Test Case ({testCases.length})
              </h2>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setTestCases((prev) => [
                    ...prev,
                    { ordinal: prev.length + 1, isSample: false, input: '', expectedOutput: '' },
                  ])
                }
              >
                + Thêm Test Case
              </button>
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Test đánh dấu <strong>Sample</strong> chỉ hiển thị minh họa trong đề bài. Toàn bộ
              input/output khi chạy chấm đều bị ẩn với sinh viên theo <code>FAQ-02</code>.
            </p>
            {showError('testCases') && <p className="field-error">{showError('testCases')}</p>}

            <div style={{ display: 'grid', gap: '1rem' }}>
              {testCases.map((tc, idx) => (
                <fieldset
                  key={idx}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.9rem',
                  }}
                >
                  <legend style={{ fontWeight: 700, padding: '0 0.4rem' }}>Test #{idx + 1}</legend>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.6rem',
                    }}
                  >
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input
                        type="checkbox"
                        checked={tc.isSample}
                        onChange={(e) =>
                          setTestCases((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, isSample: e.target.checked } : item,
                            ),
                          )
                        }
                      />
                      <span>Test mẫu (hiển thị trong đề bài)</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={testCases.length <= 1}
                      onClick={() => setTestCases((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Xóa test
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '0.75rem',
                    }}
                  >
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor={`tc-in-${idx}`}>Input (stdin)</label>
                      <textarea
                        id={`tc-in-${idx}`}
                        rows={3}
                        className="mono"
                        value={tc.input}
                        onChange={(e) =>
                          setTestCases((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, input: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor={`tc-out-${idx}`}>Expected Output (stdout)</label>
                      <textarea
                        id={`tc-out-${idx}`}
                        rows={3}
                        className="mono"
                        value={tc.expectedOutput}
                        onChange={(e) =>
                          setTestCases((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, expectedOutput: e.target.value } : item,
                            ),
                          )
                        }
                        onBlur={() =>
                          setTouchedFields((p) => ({ ...p, [`tc.${idx}.expectedOutput`]: true }))
                        }
                        aria-invalid={showError(`tc.${idx}.expectedOutput`) ? 'true' : undefined}
                      />
                      {showError(`tc.${idx}.expectedOutput`) && (
                        <span className="field-error">{showError(`tc.${idx}.expectedOutput`)}</span>
                      )}
                    </div>
                  </div>
                </fieldset>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="card" aria-labelledby="step-3-heading">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginBottom: '0.75rem',
              }}
            >
              <h2 id="step-3-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
                Bước 3: Ràng buộc kỹ thuật &amp; Mức trừ điểm ({constraints.length})
              </h2>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setConstraints((prev) => [
                    ...prev,
                    {
                      code: `C${prev.length + 1}`,
                      type: 'SEMANTIC_LLM',
                      description: '',
                      patterns: [],
                      deduction: 5,
                    },
                  ])
                }
              >
                + Thêm ràng buộc
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
              {constraints.map((c, idx) => (
                <fieldset
                  key={idx}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.9rem',
                  }}
                >
                  <legend style={{ fontWeight: 700, padding: '0 0.4rem' }}>
                    Ràng buộc {c.code || `C${idx + 1}`}
                  </legend>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '0.75rem',
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`con-code-${idx}`}>Mã ràng buộc</label>
                      <input
                        id={`con-code-${idx}`}
                        className="mono"
                        value={c.code}
                        onChange={(e) =>
                          setConstraints((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, code: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`con-type-${idx}`}>Cơ chế kiểm tra</label>
                      <select
                        id={`con-type-${idx}`}
                        value={c.type}
                        onChange={(e) =>
                          setConstraints((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, type: e.target.value as ConstraintType }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="BAN_LIST">Quy tắc cứng (AST / Include / Hàm cấm)</option>
                        <option value="SEMANTIC_LLM">Ngữ nghĩa thuật toán (LLM hỗ trợ TA)</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`con-deduct-${idx}`}>Mức trừ điểm (0–10)</label>
                      <input
                        id={`con-deduct-${idx}`}
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="10"
                        className="mono"
                        value={c.deduction}
                        onChange={(e) =>
                          setConstraints((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, deduction: Number(e.target.value) } : item,
                            ),
                          )
                        }
                        onBlur={() =>
                          setTouchedFields((p) => ({ ...p, [`con.${idx}.deduction`]: true }))
                        }
                        aria-invalid={showError(`con.${idx}.deduction`) ? 'true' : undefined}
                      />
                      {showError(`con.${idx}.deduction`) && (
                        <span className="field-error">{showError(`con.${idx}.deduction`)}</span>
                      )}
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor={`con-desc-${idx}`}>Mô tả hiển thị cho sinh viên</label>
                    <input
                      id={`con-desc-${idx}`}
                      value={c.description}
                      onChange={(e) =>
                        setConstraints((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, description: e.target.value } : item,
                          ),
                        )
                      }
                      onBlur={() =>
                        setTouchedFields((p) => ({ ...p, [`con.${idx}.description`]: true }))
                      }
                      aria-invalid={showError(`con.${idx}.description`) ? 'true' : undefined}
                    />
                    {showError(`con.${idx}.description`) && (
                      <span className="field-error">{showError(`con.${idx}.description`)}</span>
                    )}
                  </div>

                  {c.type === 'BAN_LIST' && (
                    <div className="field">
                      <label htmlFor={`con-pat-${idx}`}>
                        Danh sách từ khóa / header cấm (phân cách bằng dấu phẩy)
                      </label>
                      <input
                        id={`con-pat-${idx}`}
                        className="mono"
                        value={c.patterns.join(', ')}
                        onChange={(e) =>
                          setConstraints((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    patterns: e.target.value
                                      .split(',')
                                      .map((p) => p.trim())
                                      .filter(Boolean),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setConstraints((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Xóa ràng buộc
                    </button>
                  </div>
                </fieldset>
              ))}
            </div>

            <div className="notice-box">
              <strong>Xem trước thông báo minh bạch phía Sinh viên (FAQ-06):</strong> Bài nộp có thể
              được công cụ phân tích tự động hỗ trợ kiểm tra các ràng buộc kỹ thuật nêu trên. Mọi
              kết luận vi phạm và khoản trừ điểm đều do Trợ giảng trực tiếp xem xét và xác nhận
              trước khi công bố.
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="card" aria-labelledby="step-4-heading">
            <h2 id="step-4-heading" style={{ marginTop: 0, fontSize: '1.15rem' }}>
              Bước 4: Giới hạn chạy sandbox (FAQ-05) &amp; Xác nhận tạo
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1rem',
              }}
            >
              <div className="field">
                <label htmlFor="lab-cpu">Giới hạn thời gian CPU (1–5 giây)</label>
                <input
                  id="lab-cpu"
                  type="number"
                  min={1}
                  max={5}
                  className="mono"
                  value={cpuTimeLimitSec}
                  onChange={(e) => setCpuTimeLimitSec(Number(e.target.value))}
                  aria-invalid={showError('cpuTimeLimitSec') ? 'true' : undefined}
                />
                {showError('cpuTimeLimitSec') && (
                  <span className="field-error">{showError('cpuTimeLimitSec')}</span>
                )}
              </div>

              <div className="field">
                <label htmlFor="lab-mem">Giới hạn bộ nhớ RAM (64–512 MB)</label>
                <input
                  id="lab-mem"
                  type="number"
                  min={64}
                  max={512}
                  step={64}
                  className="mono"
                  value={memoryLimitMb}
                  onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                  aria-invalid={showError('memoryLimitMb') ? 'true' : undefined}
                />
                {showError('memoryLimitMb') && (
                  <span className="field-error">{showError('memoryLimitMb')}</span>
                )}
              </div>

              <div className="field">
                <label htmlFor="lab-size">Giới hạn dung lượng mã nguồn (Cố định — FAQ-05)</label>
                <input id="lab-size" className="mono" value="64 KB (C++17 g++ -O2)" readOnly />
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.85rem 1rem',
                marginTop: '0.5rem',
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Tóm tắt cấu hình</h3>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li>
                  Tiêu đề: <strong>{title || '(Chưa nhập)'}</strong>
                </li>
                <li>
                  Số test case: <strong className="mono">{testCases.length}</strong> (
                  {testCases.filter((t) => t.isSample).length} Sample,{' '}
                  {testCases.filter((t) => !t.isSample).length} Hidden)
                </li>
                <li>
                  Số ràng buộc kỹ thuật: <strong className="mono">{constraints.length}</strong>
                </li>
                <li>
                  Giới hạn chạy:{' '}
                  <span className="mono">
                    {cpuTimeLimitSec}s CPU / {memoryLimitMb} MB RAM / 64 KB mã nguồn
                  </span>
                </li>
              </ul>
            </div>
          </section>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1rem',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            className="btn"
            disabled={step === 0}
            onClick={() => setStep((prev) => Math.max(0, prev - 1))}
          >
            &larr; Bước trước
          </button>

          {step < STEP_LABELS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={handleNext}>
              Tiếp theo &rarr;
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? 'Đang tạo bài Lab...' : 'Tạo bài Lab'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
