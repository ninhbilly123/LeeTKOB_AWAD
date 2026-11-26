import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '../../api/api-context';
import { useAuth } from '../../auth/auth-context-core';
import { CodeViewer } from '../../components/CodeViewer';
import { ProblemBanner } from '../../components/ProblemBanner';
import { EmptyPanel, ForbiddenPanel, LoadingPanel } from '../../components/StatePanels';
import { ConstraintVerdictBadge, JudgeVerdictBadge } from '../../components/VerdictBadge';
import { Link } from '../../router/router';
import { useRouter } from '../../router/router-core';
import { isApiError, type Rfc9457ProblemDetails } from '../../types/problem-details';
import type {
  ReviewQueueBucket,
  ReviewQueueItem,
  ReviewScope,
  TaSubmissionReviewView,
  UnsureReason,
} from '../../types/review';
import { formatDateTimeVi } from '../../utils/utf8';
import styles from './TaReviewQueuePage.module.css';

interface TaReviewQueuePageProps {
  labId: string;
}

const BUCKET_OPTIONS: Array<{ value: ReviewQueueBucket | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tất cả nhóm ưu tiên' },
  { value: 'HARD_RULE_VIOLATION', label: 'Vi phạm quy tắc cứng' },
  { value: 'LLM_VIOLATION', label: 'LLM đề xuất vi phạm' },
  { value: 'UNSURE', label: 'Không chắc chắn (Unsure)' },
  { value: 'PASS_SAMPLE_10PCT', label: 'Mẫu đối chứng 10% Pass' },
];

const UNSURE_LABELS: Record<UnsureReason, string> = {
  PARSE_FAILURE: 'PARSE_FAILURE — Không thể phân tích cấu trúc đầu ra mô hình',
  TIMEOUT: 'TIMEOUT — Hết thời gian phân tích LLM',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED — Đạt giới hạn quota miễn phí (FAQ-09)',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE — Mô hình không đủ độ tin cậy, cần TA tự xem code',
};

export function TaReviewQueuePage({ labId }: TaReviewQueuePageProps) {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [scope, setScope] = useState<ReviewScope>('all');
  const [bucket, setBucket] = useState<ReviewQueueBucket | 'ALL'>('ALL');
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaSubmissionReviewView | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'queue' | 'code' | 'verdicts'>('verdicts');

  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [queueProblem, setQueueProblem] = useState<Rfc9457ProblemDetails | null>(null);
  const [detailProblem, setDetailProblem] = useState<Rfc9457ProblemDetails | null>(null);

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

  const loadQueue = useCallback(async () => {
    if (!session) return;
    setLoadingQueue(true);
    setQueueProblem(null);
    try {
      const res = await api.listReviewQueue(session.accessToken, labId, { scope, bucket });
      setQueue(res.items);
      setSelectedId((prev) =>
        prev && res.items.some((item) => item.submissionId === prev)
          ? prev
          : (res.items[0]?.submissionId ?? null),
      );
    } catch (err) {
      if (isApiError(err)) {
        if (handleAuthError(err.status)) return;
        setQueueProblem(err.problem);
      }
    } finally {
      setLoadingQueue(false);
    }
  }, [api, bucket, handleAuthError, labId, scope, session]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const loadDetail = useCallback(
    async (submissionId: string) => {
      if (!session) return;
      setLoadingDetail(true);
      setDetailProblem(null);
      setActiveLine(null);
      try {
        const res = await api.getTaSubmissionReview(session.accessToken, submissionId);
        setDetail(res);
      } catch (err) {
        if (isApiError(err)) {
          if (handleAuthError(err.status)) return;
          setDetailProblem(err.problem);
        }
      } finally {
        setLoadingDetail(false);
      }
    },
    [api, handleAuthError, session],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const highlightedLines = useMemo(() => {
    if (!detail) return [];
    const lines = new Set<number>();
    detail.constraintVerdicts.forEach((cv) => {
      cv.evidence.forEach((span) => {
        for (let ln = span.lineStart; ln <= span.lineEnd; ln += 1) {
          lines.add(ln);
        }
      });
    });
    return Array.from(lines);
  }, [detail]);

  if (queueProblem && (queueProblem.status === 403 || queueProblem.status === 404)) {
    return <ForbiddenPanel status={queueProblem.status} message={queueProblem.detail} />;
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
          <Link to="/ta/classes">&larr; Quay lại danh sách bài Lab</Link>
          <h1 id="main-content" tabIndex={-1} style={{ margin: '0.2rem 0 0', fontSize: '1.35rem' }}>
            Hàng chờ Soát Ràng buộc (TA) — {detail?.labTitle ?? labId}
          </h1>
          <div className="field-hint">
            Trạng thái:{' '}
            <strong>
              {detail?.publishedAt
                ? `Đã công bố (${formatDateTimeVi(detail.publishedAt)})`
                : 'NHÁP — Chưa công bố cho sinh viên (Syllabus Rule / FAQ-08)'}
            </strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="review-scope">Phạm vi bài nộp AC</label>
            <select
              id="review-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as ReviewScope)}
            >
              <option value="all">Mọi bài nộp AC (đối chiếu nhiều lần nộp)</option>
              <option value="counted">Chỉ bài tính điểm mới nhất mỗi SV (FAQ-04)</option>
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="review-bucket">Nhóm ưu tiên (FAQ-10)</label>
            <select
              id="review-bucket"
              value={bucket}
              onChange={(e) => setBucket(e.target.value as ReviewQueueBucket | 'ALL')}
            >
              {BUCKET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {queueProblem && <ProblemBanner problem={queueProblem} onRetry={loadQueue} />}

      {loadingQueue ? (
        <LoadingPanel message="Đang tải hàng chờ soát ràng buộc..." />
      ) : queue.length === 0 ? (
        <EmptyPanel
          title={
            bucket === 'ALL'
              ? 'Chưa có bài nộp AC nào trong hàng chờ'
              : 'Không có bài nộp nào khớp bộ lọc hiện tại'
          }
          description={
            bucket === 'ALL'
              ? 'Các bài nộp đạt AC của sinh viên sẽ tự động xuất hiện tại đây sau khi Checker hoàn tất.'
              : 'Thử chuyển nhóm ưu tiên về "Tất cả nhóm ưu tiên" hoặc chuyển phạm vi sang "Mọi bài nộp AC".'
          }
          action={
            bucket !== 'ALL' ? (
              <button type="button" className="btn btn-primary" onClick={() => setBucket('ALL')}>
                Xóa bộ lọc
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div
            className={`tablist ${styles.mobileTabs}`}
            role="tablist"
            aria-label="Chuyển vùng xem trên màn hình nhỏ"
          >
            <button
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={mobilePanel === 'queue'}
              onClick={() => setMobilePanel('queue')}
            >
              Hàng chờ ({queue.length})
            </button>
            <button
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={mobilePanel === 'code'}
              onClick={() => setMobilePanel('code')}
            >
              Mã nguồn C++
            </button>
            <button
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={mobilePanel === 'verdicts'}
              onClick={() => setMobilePanel('verdicts')}
            >
              Verdict &amp; Bằng chứng
            </button>
          </div>

          <div className={styles.workbench}>
            {/* Left Column: Queue list */}
            <aside
              className={`card ${mobilePanel !== 'queue' ? styles.hiddenMobile : ''}`}
              aria-label="Danh sách bài chờ soát"
            >
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Danh sách bài ({queue.length})</h2>
              <ul className={styles.queueList}>
                {queue.map((item) => {
                  const isSelected = item.submissionId === selectedId;
                  return (
                    <li key={item.submissionId}>
                      <button
                        type="button"
                        className={`${styles.queueBtn} ${isSelected ? styles.queueBtnActive : ''}`}
                        aria-current={isSelected ? 'true' : undefined}
                        onClick={() => {
                          setSelectedId(item.submissionId);
                          setMobilePanel('verdicts');
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <strong style={{ fontSize: '0.9rem' }}>{item.studentName}</strong>
                          <JudgeVerdictBadge verdict={item.overallVerdict} />
                        </div>
                        <div className="field-hint mono">
                          {item.submissionId}{' '}
                          {item.isCountedForGrade ? '• ★ Tính điểm' : '• Lần nộp khác'}
                        </div>
                        <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                          {item.checkerStatus === 'PENDING'
                            ? 'Đang phân tích ràng buộc...'
                            : item.summaryLabel}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Center Column: Original C++ Code Viewer */}
            <section
              className={mobilePanel !== 'code' ? styles.hiddenMobile : ''}
              aria-label="Mã nguồn C++ gốc có số dòng"
            >
              {loadingDetail ? (
                <LoadingPanel message="Đang tải mã nguồn bài nộp..." />
              ) : detailProblem ? (
                <ProblemBanner
                  problem={detailProblem}
                  onRetry={selectedId ? () => void loadDetail(selectedId) : undefined}
                />
              ) : detail ? (
                <div className="card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.65rem',
                    }}
                  >
                    <h2 style={{ margin: 0, fontSize: '1rem' }}>
                      Mã nguồn C++ gốc — <span className="mono">{detail.submissionId}</span>
                    </h2>
                    <span className="field-hint mono">
                      Test: {detail.passedTests}/{detail.totalTests} AC
                      {detail.maxTimeMs !== null ? ` • ${detail.maxTimeMs}ms` : ''}
                    </span>
                  </div>
                  <CodeViewer
                    code={detail.code}
                    highlightedLines={highlightedLines}
                    activeLine={activeLine}
                    caption={`Mã nguồn C++ của ${detail.studentName} (${detail.submissionId})`}
                  />
                </div>
              ) : null}
            </section>

            {/* Right Column: Per-constraint Verdicts, Evidence Lines, TA Deductions */}
            <section
              className={`card ${mobilePanel !== 'verdicts' ? styles.hiddenMobile : ''}`}
              aria-label="Chi tiết đánh giá theo từng ràng buộc"
            >
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Verdict theo từng ràng buộc</h2>
              {loadingDetail ? (
                <LoadingPanel message="Đang tải kết quả soát ràng buộc..." />
              ) : !detail ? null : detail.checkerStatus === 'PENDING' ? (
                <div className="notice-box" role="status">
                  Checker đang phân tích ràng buộc cho bài nộp này. Kết quả sẽ hiển thị sau giây
                  lát.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  <div className="notice-box">
                    <strong>Nguyên tắc Syllabus Rule:</strong> Mọi kết luận vi phạm từ quy tắc cứng
                    hay LLM đều là đề xuất cho Trợ giảng xem xét — chưa tự động trừ điểm sinh viên
                    và không có nút duyệt hàng loạt cho cờ LLM.
                  </div>

                  {detail.constraintVerdicts.map((cv) => (
                    <article
                      key={cv.constraintId}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.8rem',
                        display: 'grid',
                        gap: '0.45rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.4rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong className="mono">
                          {cv.code}{' '}
                          <span className="field-hint">
                            ({cv.source === 'HARD_RULE' ? 'Quy tắc cứng' : 'LLM hỗ trợ TA'})
                          </span>
                        </strong>
                        <ConstraintVerdictBadge verdict={cv.verdict} />
                      </div>

                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                        {cv.description}
                      </p>

                      <div
                        className="mono"
                        style={{
                          fontSize: '0.85rem',
                          padding: '0.45rem 0.6rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-subtle)',
                        }}
                      >
                        <div>
                          Mức trừ TA cấu hình: <strong>-{cv.taConfiguredDeduction} điểm</strong>
                        </div>
                        <div>
                          Khoản trừ đề xuất:{' '}
                          <strong>
                            {cv.verdict === 'unsure'
                              ? '0 điểm (Unsure — TA tự quyết định)'
                              : `-${cv.proposedDeduction} điểm`}
                          </strong>
                        </div>
                      </div>

                      {cv.verdict === 'unsure' && cv.unsureReason && (
                        <div
                          style={{
                            fontSize: '0.83rem',
                            padding: '0.45rem 0.6rem',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--status-warn-bg)',
                            color: 'var(--status-warn-text)',
                            border: '1px solid var(--status-warn-border)',
                          }}
                        >
                          <strong>Lý do Unsure (FAQ-09):</strong> {UNSURE_LABELS[cv.unsureReason]}
                        </div>
                      )}

                      <p style={{ margin: 0, fontSize: '0.88rem' }}>{cv.rationale}</p>

                      {cv.evidence.length > 0 && (
                        <div>
                          <div
                            style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.3rem' }}
                          >
                            Dòng bằng chứng (bấm để nhảy tới dòng code):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {cv.evidence.map((ev, idx) => {
                              const label =
                                ev.lineStart === ev.lineEnd
                                  ? `Dòng ${ev.lineStart}`
                                  : `Dòng ${ev.lineStart}–${ev.lineEnd}`;
                              return (
                                <button
                                  key={`${cv.constraintId}-ev-${idx}`}
                                  type="button"
                                  className={`${styles.evidenceBtn} mono`}
                                  onClick={() => {
                                    setActiveLine(ev.lineStart);
                                    setMobilePanel('code');
                                  }}
                                >
                                  <span>{label}:</span>
                                  <span>{ev.snippet}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
