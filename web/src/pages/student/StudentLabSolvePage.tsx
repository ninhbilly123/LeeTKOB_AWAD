import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../api/api-context';
import { useAuth } from '../../auth/auth-context-core';
import { CodeViewer } from '../../components/CodeViewer';
import { ProblemBanner } from '../../components/ProblemBanner';
import tableStyles from '../../components/ResponsiveTable.module.css';
import { EmptyPanel, ForbiddenPanel, LoadingPanel } from '../../components/StatePanels';
import { JudgeVerdictBadge, PipelineStatusBadge } from '../../components/VerdictBadge';
import { Link } from '../../router/router';
import { useRouter } from '../../router/router-core';
import { MAX_CPP_CODE_BYTES, type StudentLabDetail } from '../../types/lab';
import { isApiError, type Rfc9457ProblemDetails } from '../../types/problem-details';
import type { StudentSubmissionSummary, StudentSubmissionView } from '../../types/submission';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { SafeMarkdown } from '../../utils/safe-markdown';
import { formatDateTimeVi, formatKilobytes, utf8ByteLength } from '../../utils/utf8';
import styles from './StudentLabSolvePage.module.css';

interface StudentLabSolvePageProps {
  labId: string;
}

type LeftTab = 'statement' | 'constraints' | 'history';

export function StudentLabSolvePage({ labId }: StudentLabSolvePageProps) {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [lab, setLab] = useState<StudentLabDetail | null>(null);
  const [history, setHistory] = useState<StudentSubmissionSummary[]>([]);
  const [activeSub, setActiveSub] = useState<StudentSubmissionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState<Rfc9457ProblemDetails | null>(null);

  const [leftTab, setLeftTab] = useState<LeftTab>('statement');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<Rfc9457ProblemDetails | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const codeDialogRef = useRef<HTMLDialogElement | null>(null);

  const handleAuthError = useCallback(
    (status: number) => {
      if (status === 401) {
        logout();
        setExpiredMessage('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        navigate('/login', { replace: true });
        return true;
      }
      return false;
    },
    [logout, navigate, setExpiredMessage],
  );

  const loadLabAndHistory = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setLoadProblem(null);
    try {
      const [labDetail, subList] = await Promise.all([
        api.getStudentLab(session.accessToken, labId),
        api.listMySubmissions(session.accessToken, labId),
      ]);
      setLab(labDetail);
      setHistory(subList.items);
      if (subList.items.length > 0) {
        const latestDetail = await api.getStudentSubmission(
          session.accessToken,
          subList.items[0].id,
        );
        setActiveSub(latestDetail);
      } else {
        setActiveSub(null);
      }
    } catch (err) {
      if (isApiError(err)) {
        if (handleAuthError(err.status)) return;
        setLoadProblem(err.problem);
      }
    } finally {
      setLoading(false);
    }
  }, [api, handleAuthError, labId, session]);

  useEffect(() => {
    void loadLabAndHistory();
  }, [loadLabAndHistory]);

  // Poll submission status while QUEUED or JUDGING
  useEffect(() => {
    if (!session || !activeSub) return;
    if (activeSub.status !== 'QUEUED' && activeSub.status !== 'JUDGING') return;

    const timer = window.setTimeout(async () => {
      try {
        const updated = await api.getStudentSubmission(session.accessToken, activeSub.id);
        setActiveSub(updated);
        const refreshedList = await api.listMySubmissions(session.accessToken, labId);
        setHistory(refreshedList.items);
      } catch (err) {
        if (isApiError(err)) {
          handleAuthError(err.status);
        }
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeSub, api, handleAuthError, labId, session]);

  const byteCount = utf8ByteLength(code);
  const maxBytes = lab?.maxCodeBytes ?? MAX_CPP_CODE_BYTES;
  const isOverLimit = byteCount > maxBytes;
  const isDeadlinePassed = lab ? Date.now() > new Date(lab.deadline).getTime() : false;

  const clientCodeError = (() => {
    if (!codeTouched && !submitAttempted) return null;
    if (!code.trim()) return 'Vui lòng dán hoặc tải lên mã nguồn C++17 trước khi nộp.';
    if (isOverLimit) {
      return `Mã nguồn vượt quá giới hạn 64 KB (${formatKilobytes(byteCount)} / 64.00 KB).`;
    }
    return null;
  })();

  const handleCodeChange = (nextCode: string) => {
    setCode(nextCode);
    // Reset idempotency key when code changes so retry key matches exact payload fingerprint
    setPendingKey(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    handleCodeChange(text);
    setCodeTouched(true);
  };

  const submitWithKey = async (reuseKey: string | null) => {
    if (!session || !lab) return;
    setSubmitAttempted(true);
    if (!code.trim() || isOverLimit || isDeadlinePassed) return;

    const idempotencyKey = reuseKey ?? generateIdempotencyKey();
    setPendingKey(idempotencyKey);
    setSubmitting(true);
    setSubmitProblem(null);

    try {
      const accepted = await api.createSubmission(
        session.accessToken,
        lab.id,
        { code },
        idempotencyKey,
      );
      setPendingKey(null);
      const [detail, listRes] = await Promise.all([
        api.getStudentSubmission(session.accessToken, accepted.id),
        api.listMySubmissions(session.accessToken, lab.id),
      ]);
      setActiveSub(detail);
      setHistory(listRes.items);
    } catch (err) {
      if (isApiError(err)) {
        if (handleAuthError(err.status)) return;
        setSubmitProblem(err.problem);
        // Keep pendingKey on network/5xx errors so "Thử gửi lại" reuses the exact Idempotency-Key
        if (err.status >= 400 && err.status < 500) {
          setPendingKey(null);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitWithKey(pendingKey);
  };

  const selectSubmission = async (submissionId: string) => {
    if (!session) return;
    try {
      const detail = await api.getStudentSubmission(session.accessToken, submissionId);
      setActiveSub(detail);
    } catch (err) {
      if (isApiError(err)) {
        if (handleAuthError(err.status)) return;
        setSubmitProblem(err.problem);
      }
    }
  };

  if (loading) {
    return (
      <div className="container-wide">
        <LoadingPanel message="Đang tải đề bài Lab và lịch sử bài nộp..." />
      </div>
    );
  }

  if (loadProblem && (loadProblem.status === 403 || loadProblem.status === 404)) {
    return <ForbiddenPanel status={loadProblem.status} message={loadProblem.detail} />;
  }

  if (loadProblem || !lab) {
    return (
      <div className="container-page">
        {loadProblem && <ProblemBanner problem={loadProblem} onRetry={loadLabAndHistory} />}
      </div>
    );
  }

  return (
    <div className="container-wide">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '0.85rem',
        }}
      >
        <div>
          <Link to="/student/labs">&larr; Danh sách bài Lab</Link>
          <h1 id="main-content" tabIndex={-1} style={{ margin: '0.25rem 0 0', fontSize: '1.4rem' }}>
            {lab.title}
          </h1>
          <div className="field-hint mono">
            Lớp {lab.classCode} • Hạn nộp: {formatDateTimeVi(lab.deadline)} • Giới hạn:{' '}
            {lab.cpuTimeLimitSec}s CPU / {lab.memoryLimitMb} MB RAM / 64 KB C++17
          </div>
        </div>
        {isDeadlinePassed && (
          <span
            className="mono"
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--status-fail-bg)',
              color: 'var(--status-fail-text)',
              border: '1px solid var(--status-fail-border)',
              fontWeight: 700,
            }}
          >
            Đã hết hạn nộp
          </span>
        )}
      </div>

      <div className={styles.split}>
        {/* Left Pane: Statement, Sample Tests, Public Constraints + FAQ-06 Notice, History */}
        <section className={`card ${styles.pane}`} aria-label="Thông tin bài Lab">
          <div className="tablist" role="tablist" aria-label="Mục bài Lab">
            <button
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={leftTab === 'statement'}
              onClick={() => setLeftTab('statement')}
            >
              Đề bài &amp; Ví dụ
            </button>
            <button
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={leftTab === 'constraints'}
              onClick={() => setLeftTab('constraints')}
            >
              Ràng buộc ({lab.constraints.length})
            </button>
            <button
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={leftTab === 'history'}
              onClick={() => setLeftTab('history')}
            >
              Lịch sử nộp ({history.length})
            </button>
          </div>

          {leftTab === 'statement' && (
            <div role="tabpanel">
              <SafeMarkdown content={lab.statement} />

              {lab.sampleTests.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
                    Ví dụ minh họa (Sample thuộc đề bài)
                  </h3>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {lab.sampleTests.map((st) => (
                      <div key={st.ordinal} className={styles.sampleGrid}>
                        <div>
                          <strong style={{ fontSize: '0.86rem' }}>
                            Sample #{st.ordinal} — Input
                          </strong>
                          <pre className={`${styles.samplePre} mono`}>{st.input}</pre>
                        </div>
                        <div>
                          <strong style={{ fontSize: '0.86rem' }}>
                            Sample #{st.ordinal} — Output
                          </strong>
                          <pre className={`${styles.samplePre} mono`}>{st.expectedOutput}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="notice-box" style={{ marginTop: '1.25rem' }}>
                <strong>Thông báo minh bạch kiểm tra (FAQ-06):</strong> Bài nộp có thể được công cụ
                phân tích tự động hỗ trợ soát các ràng buộc kỹ thuật của bài Lab. Mọi kết luận vi
                phạm và điểm trừ đều do Trợ giảng trực tiếp xem xét và xác nhận trước khi công bố.
              </div>
            </div>
          )}

          {leftTab === 'constraints' && (
            <div role="tabpanel">
              <p className="field-hint" style={{ marginTop: 0 }}>
                Các ràng buộc kỹ thuật và mức trừ tối đa do Trợ giảng công bố trước khi nộp bài.
              </p>
              {lab.constraints.length === 0 ? (
                <EmptyPanel
                  title="Không có ràng buộc phụ"
                  description="Bài Lab này chỉ chấm theo kết quả test."
                />
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'grid',
                    gap: '0.75rem',
                  }}
                >
                  {lab.constraints.map((c) => (
                    <li
                      key={c.id}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.75rem 0.9rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <strong className="mono">{c.code}</strong>
                        <span
                          className="mono"
                          style={{ color: 'var(--status-warn-text)', fontWeight: 700 }}
                        >
                          Trừ tối đa: -{c.deduction} điểm
                        </span>
                      </div>
                      <p style={{ margin: '0.35rem 0 0' }}>{c.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {leftTab === 'history' && (
            <div role="tabpanel">
              {history.length === 0 ? (
                <EmptyPanel
                  title="Chưa có bài nộp nào"
                  description="Dán mã nguồn C++17 hoặc tải file .cpp ở cột bên phải để nộp bài đầu tiên."
                />
              ) : (
                <div
                  className={tableStyles.wrapper}
                  tabIndex={0}
                  role="region"
                  aria-labelledby="stu-hist-cap"
                >
                  <table className={tableStyles.table}>
                    <caption id="stu-hist-cap">
                      Lịch sử nộp bài ({history.length}) — Bài hợp lệ mới nhất trước hạn được tính
                      điểm (FAQ-04)
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Mã bài</th>
                        <th scope="col">Thời gian</th>
                        <th scope="col">Kết quả test</th>
                        <th scope="col">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((sub) => (
                        <tr key={sub.id}>
                          <th scope="row" className="mono">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void selectSubmission(sub.id)}
                            >
                              {sub.id}
                            </button>
                          </th>
                          <td data-label="Thời gian" className="mono">
                            {formatDateTimeVi(sub.submittedAt)}
                          </td>
                          <td data-label="Kết quả test">
                            {sub.overallVerdict ? (
                              <JudgeVerdictBadge
                                verdict={sub.overallVerdict}
                                labelSuffix={`(${sub.passedTests}/${sub.totalTests})`}
                              />
                            ) : (
                              <PipelineStatusBadge status={sub.status} />
                            )}
                          </td>
                          <td data-label="Ghi chú">
                            {sub.isCountedForGrade ? (
                              <strong style={{ color: 'var(--brand-600)' }}>★ Bài tính điểm</strong>
                            ) : (
                              <span className="field-hint">Bản cũ</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Pane: C++17 Submission Form + Live Verdict Tracker */}
        <div className={styles.pane} style={{ display: 'grid', gap: '1rem' }}>
          <section className="card" aria-labelledby="submit-cpp-heading">
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
              <h2 id="submit-cpp-heading" style={{ margin: 0, fontSize: '1.1rem' }}>
                Nộp mã nguồn C++17
              </h2>
              <label className="btn" style={{ cursor: 'pointer' }}>
                Tải file .cpp
                <input
                  type="file"
                  accept=".cpp,.cc,.cxx,.h,.hpp,text/plain"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>

            {submitProblem && (
              <ProblemBanner
                problem={submitProblem}
                onRetry={pendingKey ? () => void submitWithKey(pendingKey) : undefined}
                retryLabel="Thử gửi lại (giữ nguyên Idempotency-Key)"
              />
            )}

            <form onSubmit={handleSubmitForm} noValidate>
              <div className="field">
                <label htmlFor="cpp-source-input">Mã nguồn C++17 (g++ -std=c++17 -O2)</label>
                <textarea
                  id="cpp-source-input"
                  rows={12}
                  className="mono"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  onBlur={() => setCodeTouched(true)}
                  aria-invalid={clientCodeError ? 'true' : undefined}
                  aria-describedby="cpp-size-hint cpp-source-error"
                  placeholder="#include <iostream>&#10;int main() {&#10;  return 0;&#10;}"
                  spellCheck={false}
                />
                <div
                  id="cpp-size-hint"
                  className="field-hint mono"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: isOverLimit ? 'var(--status-fail-text)' : undefined,
                  }}
                >
                  <span>
                    Dung lượng UTF-8: {formatKilobytes(byteCount)} / 64.00 KB ({byteCount} bytes)
                  </span>
                  <span>{isOverLimit ? 'Vượt giới hạn 64 KB' : 'Hợp lệ'}</span>
                </div>
                {clientCodeError && (
                  <span id="cpp-source-error" className="field-error">
                    {clientCodeError}
                  </span>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || isOverLimit || isDeadlinePassed}
                aria-busy={submitting}
              >
                {submitting ? 'Đang gửi bài...' : 'Nộp bài C++17'}
              </button>
            </form>
          </section>

          <section className="card" aria-labelledby="latest-result-heading">
            <h2 id="latest-result-heading" style={{ marginTop: 0, fontSize: '1.1rem' }}>
              Theo dõi kết quả chấm test
            </h2>

            {!activeSub ? (
              <p className="field-hint" style={{ margin: 0 }}>
                Bạn chưa có bài nộp nào cho bài Lab này. Sau khi nộp, kết quả từng test sẽ tự động
                cập nhật tại đây.
              </p>
            ) : (
              <div role="status" aria-live="polite">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong className="mono">{activeSub.id}</strong>{' '}
                    {activeSub.isCountedForGrade && (
                      <span
                        style={{
                          fontSize: '0.82rem',
                          color: 'var(--brand-600)',
                          fontWeight: 700,
                        }}
                      >
                        ★ Bài đang tính điểm (FAQ-04)
                      </span>
                    )}
                    <div className="field-hint mono">
                      Nộp lúc: {formatDateTimeVi(activeSub.submittedAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <PipelineStatusBadge status={activeSub.status} />
                    {activeSub.overallVerdict && (
                      <JudgeVerdictBadge
                        verdict={activeSub.overallVerdict}
                        labelSuffix={`(${activeSub.passedTests}/${activeSub.totalTests})`}
                      />
                    )}
                  </div>
                </div>

                {activeSub.status === 'COMPLETED' && (
                  <>
                    {activeSub.maxTimeMs !== null && activeSub.maxMemoryKb !== null && (
                      <p className="field-hint mono" style={{ margin: '0.5rem 0 0' }}>
                        Thời gian tối đa: {activeSub.maxTimeMs} ms • Bộ nhớ tối đa:{' '}
                        {(activeSub.maxMemoryKb / 1024).toFixed(2)} MB
                      </p>
                    )}

                    {activeSub.compileOutput && (
                      <pre
                        className="mono"
                        style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--status-compile-bg)',
                          color: 'var(--status-compile-text)',
                          border: '1px solid var(--status-compile-border)',
                          overflowX: 'auto',
                          fontSize: '0.85rem',
                        }}
                      >
                        {activeSub.compileOutput}
                      </pre>
                    )}

                    {activeSub.testVerdicts.length > 0 && (
                      <div className={styles.testChips} aria-label="Kết quả từng test case">
                        {activeSub.testVerdicts.map((tv) => (
                          <JudgeVerdictBadge
                            key={tv.ordinal}
                            verdict={tv.verdict}
                            labelSuffix={`T${tv.ordinal}${tv.timeMs !== undefined ? ` (${tv.timeMs}ms)` : ''}`}
                          />
                        ))}
                      </div>
                    )}

                    <p
                      className="field-hint"
                      style={{ marginTop: '0.75rem', marginBottom: '0.6rem' }}
                    >
                      Chi tiết dữ liệu vào/ra của từng test được ẩn theo quy định (
                      <code>FAQ-02</code>).
                    </p>

                    {!activeSub.publishedGrade && (
                      <div className="notice-box" style={{ marginBottom: '0.75rem' }}>
                        Kết quả soát ràng buộc kỹ thuật và điểm chính thức sẽ chỉ hiển thị sau khi
                        Trợ giảng xem xét và công bố bảng điểm (<code>FAQ-08</code>).
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn"
                      onClick={() => codeDialogRef.current?.showModal()}
                    >
                      Xem lại mã nguồn đã nộp
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <dialog ref={codeDialogRef} className="app-dialog" aria-labelledby="submitted-code-title">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h2 id="submitted-code-title" style={{ margin: 0, fontSize: '1.1rem' }}>
            Mã nguồn bài nộp {activeSub?.id}
          </h2>
          <button type="button" className="btn" onClick={() => codeDialogRef.current?.close()}>
            Đóng
          </button>
        </div>
        {activeSub && <CodeViewer code={activeSub.code} caption={`Mã nguồn ${activeSub.id}`} />}
      </dialog>
    </div>
  );
}
