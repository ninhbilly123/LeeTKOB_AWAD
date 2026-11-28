import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ConstraintVerdictDetail,
  FindingReviewStatus,
  LabSubmissionLookupItem,
  ReviewEvidenceLine,
  ReviewQueueBucket,
  ReviewQueueItem,
  ReviewScope,
  TaDecision,
  TaSubmissionReviewView,
  UnsureReason,
} from '../../types/review';
import { formatDateTimeVi } from '../../utils/utf8';
import styles from './TaReviewQueuePage.module.css';

interface TaReviewQueuePageProps {
  labId: string;
}

interface FindingDraftState {
  decision: TaDecision;
  deduction: string;
  evidenceLinesText: string;
  reason: string;
}

const BUCKET_OPTIONS: Array<{ value: ReviewQueueBucket | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tất cả nhóm ưu tiên' },
  { value: 'HARD_RULE_VIOLATION', label: 'Vi phạm quy tắc cứng' },
  { value: 'LLM_VIOLATION', label: 'LLM đề xuất vi phạm' },
  { value: 'UNSURE', label: 'Không chắc chắn (Unsure)' },
  { value: 'PASS_SAMPLE_10PCT', label: 'Mẫu đối chứng 10% Pass' },
];

const UNSURE_LABELS: Record<UnsureReason, string> = {
  MODEL_UNSURE: 'MODEL_UNSURE — Mô hình tự đánh dấu không chắc chắn, cần TA xem code (FAQ-09)',
  SCHEMA_INVALID: 'SCHEMA_INVALID — Đầu ra mô hình sai schema JSON (FAQ-09)',
  EVIDENCE_MISMATCH: 'EVIDENCE_MISMATCH — Dòng bằng chứng mô hình nêu không khớp code gốc (FAQ-09)',
  TIMEOUT: 'TIMEOUT — Hết thời gian chờ phản hồi mô hình (FAQ-09)',
  COST_CAP_EXCEEDED: 'COST_CAP_EXCEEDED — Lab đã vượt hạn mức chi phí / số lần gọi (FAQ-09)',
  MODEL_OFF: 'MODEL_OFF — Đang chạy ở chế độ tắt mô hình (MODEL_OFF=1)',
  PROVIDER_ERROR: 'PROVIDER_ERROR — Lỗi kết nối / nhà cung cấp mô hình (FAQ-09)',
  PARSE_FAILURE: 'PARSE_FAILURE — Không thể phân tích cấu trúc đầu ra mô hình',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED — Đạt giới hạn quota miễn phí (FAQ-09)',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE — Mô hình không đủ độ tin cậy, cần TA tự xem code',
};

const REVIEW_STATUS_LABELS: Record<FindingReviewStatus, string> = {
  NOT_QUEUED: 'Ngoài hàng chờ 10% (có thể đổi nếu cần)',
  PENDING_REVIEW: 'Chờ TA quyết định (PENDING_REVIEW)',
  APPROVED_VIOLATION: 'TA xác nhận vi phạm (APPROVED_VIOLATION)',
  DISMISSED_PASS: 'TA bác / xác nhận đạt (DISMISSED_PASS)',
  OVERRIDDEN: 'TA đã ghi đè quyết định (OVERRIDDEN)',
};

function buildInitialDraft(cv: ConstraintVerdictDetail): FindingDraftState {
  const initialDecision: TaDecision =
    cv.taDecision ?? (cv.verdict === 'violation' ? 'VIOLATION' : 'PASS');
  const initialDeduction =
    cv.taDeduction !== null && cv.taDeduction !== undefined
      ? String(cv.taDeduction)
      : String(cv.taConfiguredDeduction);
  const evLines =
    cv.taEvidence && cv.taEvidence.length > 0
      ? cv.taEvidence.map((e) => e.line)
      : cv.evidence.map((span) => span.lineStart);
  const uniqueLines = Array.from(new Set(evLines)).sort((a, b) => a - b);
  return {
    decision: initialDecision,
    deduction: initialDeduction,
    evidenceLinesText: uniqueLines.join(', '),
    reason: cv.taReason ?? '',
  };
}

function parseEvidenceLinesFromCode(linesText: string, code: string): ReviewEvidenceLine[] {
  const sourceLines = code.replace(/\r\n/g, '\n').split('\n');
  const tokens = linesText
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<number>();
  const result: ReviewEvidenceLine[] = [];
  for (const token of tokens) {
    const num = Number(token);
    if (!Number.isInteger(num) || num < 1 || num > sourceLines.length || seen.has(num)) {
      continue;
    }
    seen.add(num);
    const rawText = sourceLines[num - 1]?.trim();
    result.push({
      line: num,
      text: rawText && rawText.length > 0 ? rawText : `(line ${num})`,
    });
  }
  return result;
}

export function TaReviewQueuePage({ labId }: TaReviewQueuePageProps) {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [scope, setScope] = useState<ReviewScope>('all');
  const [bucket, setBucket] = useState<ReviewQueueBucket | 'ALL'>('ALL');
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<LabSubmissionLookupItem[]>([]);
  const [lookupInput, setLookupInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaSubmissionReviewView | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'queue' | 'code' | 'verdicts'>('verdicts');

  const [drafts, setDrafts] = useState<Record<string, FindingDraftState>>({});
  const [savingFindingId, setSavingFindingId] = useState<string | null>(null);
  const [reviewActionProblem, setReviewActionProblem] = useState<Rfc9457ProblemDetails | null>(
    null,
  );
  const [reviewActionNotice, setReviewActionNotice] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishProblem, setPublishProblem] = useState<Rfc9457ProblemDetails | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [labPublishedAt, setLabPublishedAt] = useState<string | null>(null);

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
      const [res, subList] = await Promise.all([
        api.listReviewQueue(session.accessToken, labId, { scope, bucket }),
        api.listLabSubmissions(session.accessToken, labId).catch(() => ({
          labId,
          isPublished: false,
          submissions: [] as LabSubmissionLookupItem[],
        })),
      ]);
      setQueue(res.items);
      setAllSubmissions(subList.submissions);
      setSelectedId((prev) => {
        if (prev && res.items.some((item) => item.submissionId === prev)) {
          return prev;
        }
        if (prev && subList.submissions.some((item) => item.id === prev)) {
          return prev;
        }
        return res.items[0]?.submissionId ?? subList.submissions[0]?.id ?? null;
      });
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
      setReviewActionProblem(null);
      setActiveLine(null);
      try {
        const res = await api.getTaSubmissionReview(session.accessToken, submissionId);
        setDetail(res);
        if (res.publishedAt) {
          setLabPublishedAt(res.publishedAt);
        }
        const nextDrafts: Record<string, FindingDraftState> = {};
        for (const cv of res.constraintVerdicts) {
          const key = cv.findingId ?? cv.constraintId;
          nextDrafts[key] = buildInitialDraft(cv);
        }
        setDrafts(nextDrafts);
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
      cv.taEvidence?.forEach((ev) => lines.add(ev.line));
    });
    return Array.from(lines);
  }, [detail]);

  const handleLookupSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = lookupInput.trim();
    if (!trimmed) return;
    setSelectedId(trimmed);
    setMobilePanel('code');
  };

  const updateDraft = (key: string, patch: Partial<FindingDraftState>) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? { decision: 'PASS', deduction: '0', evidenceLinesText: '', reason: '' }),
        ...patch,
      },
    }));
  };

  const handleSaveDecision = async (cv: ConstraintVerdictDetail) => {
    if (!session || !detail || !cv.findingId) return;
    const key = cv.findingId;
    const draft = drafts[key] ?? buildInitialDraft(cv);
    setReviewActionProblem(null);
    setReviewActionNotice(null);

    const parsedDeduction = Number(draft.deduction);
    const evidence =
      draft.decision === 'VIOLATION'
        ? parseEvidenceLinesFromCode(draft.evidenceLinesText, detail.code)
        : undefined;

    setSavingFindingId(key);
    try {
      await api.reviewFinding(session.accessToken, detail.labId, detail.submissionId, key, {
        decision: draft.decision,
        deduction:
          draft.decision === 'VIOLATION' && Number.isFinite(parsedDeduction) ? parsedDeduction : 0,
        evidence,
        reason: draft.reason.trim() ? draft.reason.trim() : null,
      });
      setReviewActionNotice(
        `Đã lưu quyết định TA cho ràng buộc ${cv.code} (${draft.decision === 'VIOLATION' ? `VIOLATION -${draft.deduction}đ` : 'PASS 0đ'}).`,
      );
      await Promise.all([loadDetail(detail.submissionId), loadQueue()]);
    } catch (err) {
      if (isApiError(err)) {
        if (handleAuthError(err.status)) return;
        setReviewActionProblem(err.problem);
      }
    } finally {
      setSavingFindingId(null);
    }
  };

  const handlePublishLab = async () => {
    if (!session) return;
    setPublishing(true);
    setPublishProblem(null);
    setPublishNotice(null);
    try {
      const result = await api.publishLab(session.accessToken, labId);
      setLabPublishedAt(result.publishedAt);
      setPublishNotice(
        `Đã công bố điểm chính thức cho Lab lúc ${formatDateTimeVi(result.publishedAt)}.`,
      );
      if (selectedId) {
        await loadDetail(selectedId);
      }
      await loadQueue();
    } catch (err) {
      if (isApiError(err)) {
        if (handleAuthError(err.status)) return;
        setPublishProblem(err.problem);
      }
    } finally {
      setPublishing(false);
    }
  };

  if (queueProblem && (queueProblem.status === 403 || queueProblem.status === 404)) {
    return <ForbiddenPanel status={queueProblem.status} message={queueProblem.detail} />;
  }

  const effectivePublishedAt = detail?.publishedAt ?? labPublishedAt;

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
              {effectivePublishedAt
                ? `Đã công bố (${formatDateTimeVi(effectivePublishedAt)})`
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

          <button
            type="button"
            className="btn btn-primary"
            disabled={publishing}
            aria-busy={publishing}
            onClick={() => void handlePublishLab()}
          >
            {publishing
              ? 'Đang công bố...'
              : effectivePublishedAt
                ? 'Đã công bố điểm'
                : 'Công bố điểm (Publish)'}
          </button>
        </div>
      </div>

      {/* Direct single-submission lookup bar for live demo (FAQ-10) */}
      <form
        onSubmit={handleLookupSubmit}
        className="card"
        style={{
          marginBottom: '0.85rem',
          padding: '0.7rem 0.9rem',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'end',
          flexWrap: 'wrap',
        }}
        aria-label="Tra cứu từng bài nộp trong Lab"
      >
        <div className="field" style={{ marginBottom: 0, minWidth: '220px', flex: '1 1 220px' }}>
          <label htmlFor="ta-submission-lookup">Tra cứu trực tiếp theo Submission ID (demo)</label>
          <input
            id="ta-submission-lookup"
            type="text"
            className="mono"
            placeholder="Nhập mã bài nộp (ví dụ: sub_...)"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
          />
        </div>
        <button type="submit" className="btn">
          Mở bài nộp
        </button>

        {allSubmissions.length > 0 && (
          <div className="field" style={{ marginBottom: 0, minWidth: '260px', flex: '1 1 260px' }}>
            <label htmlFor="ta-all-submissions-select">
              Hoặc chọn mọi bài nộp trong Lab ({allSubmissions.length})
            </label>
            <select
              id="ta-all-submissions-select"
              value={selectedId ?? ''}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedId(e.target.value);
                  setMobilePanel('code');
                }
              }}
            >
              <option value="">-- Chọn bài nộp bất kỳ (AC / WA / TLE / CE...) --</option>
              {allSubmissions.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.id} — {sub.studentName} ({sub.overallVerdict ?? sub.status}
                  {sub.isCountedForGrade ? ', ★ Tính điểm' : ''})
                </option>
              ))}
            </select>
          </div>
        )}
      </form>

      {publishProblem && <ProblemBanner problem={publishProblem} />}
      {publishNotice && (
        <div className="notice-box" role="status" style={{ marginBottom: '0.85rem' }}>
          {publishNotice}
        </div>
      )}
      {queueProblem && <ProblemBanner problem={queueProblem} onRetry={loadQueue} />}

      {loadingQueue ? (
        <LoadingPanel message="Đang tải hàng chờ soát ràng buộc..." />
      ) : queue.length === 0 && !selectedId ? (
        <EmptyPanel
          title={
            bucket === 'ALL'
              ? 'Chưa có bài nộp AC nào trong hàng chờ'
              : 'Không có bài nộp nào khớp bộ lọc hiện tại'
          }
          description={
            bucket === 'ALL'
              ? 'Các bài nộp đạt AC của sinh viên sẽ tự động xuất hiện tại đây sau khi Checker hoàn tất, hoặc bạn có thể tra cứu trực tiếp bằng Submission ID ở trên.'
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
              {queue.length === 0 ? (
                <p className="field-hint">
                  Hàng chờ hiện không có mục khớp bộ lọc — đang mở bài tra cứu trực tiếp.
                </p>
              ) : (
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
              )}
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
                      {detail.overallVerdict ?? 'QUEUED'} • Test: {detail.passedTests}/
                      {detail.totalTests} AC
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

            {/* Right Column: Per-constraint Verdicts, Evidence Lines, TA Deductions & Decision Form */}
            <section
              className={`card ${mobilePanel !== 'verdicts' ? styles.hiddenMobile : ''}`}
              aria-label="Chi tiết đánh giá theo từng ràng buộc"
            >
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Verdict theo từng ràng buộc</h2>
              {reviewActionProblem && <ProblemBanner problem={reviewActionProblem} />}
              {reviewActionNotice && (
                <div className="notice-box" role="status" style={{ marginBottom: '0.65rem' }}>
                  {reviewActionNotice}
                </div>
              )}

              {loadingDetail ? (
                <LoadingPanel message="Đang tải kết quả soát ràng buộc..." />
              ) : !detail ? null : detail.checkerStatus === 'NOT_APPLICABLE' ? (
                <div className="notice-box" role="status">
                  Bài nộp không đạt <code>AC</code> (<code>{detail.overallVerdict ?? 'N/A'}</code>),
                  nên không chạy soát ràng buộc theo <code>FAQ-04</code> (mặc định 0 điểm).
                </div>
              ) : detail.checkerStatus === 'PENDING' ? (
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

                  {detail.constraintVerdicts.map((cv) => {
                    const draftKey = cv.findingId ?? cv.constraintId;
                    const draft = drafts[draftKey] ?? buildInitialDraft(cv);
                    const isSaving = savingFindingId === draftKey;

                    return (
                      <article
                        key={draftKey}
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

                        {cv.reviewStatus && (
                          <div className="field-hint mono" style={{ fontSize: '0.8rem' }}>
                            Trạng thái duyệt:{' '}
                            <strong>{REVIEW_STATUS_LABELS[cv.reviewStatus]}</strong>
                          </div>
                        )}

                        <p
                          style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}
                        >
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
                          {cv.taDecision && (
                            <div>
                              Mức trừ TA đã đặt:{' '}
                              <strong>
                                {cv.taDecision === 'VIOLATION'
                                  ? `-${cv.taDeduction ?? cv.taConfiguredDeduction} điểm (VIOLATION)`
                                  : '0 điểm (PASS)'}
                              </strong>
                            </div>
                          )}
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
                              style={{
                                fontSize: '0.82rem',
                                fontWeight: 700,
                                marginBottom: '0.3rem',
                              }}
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

                        {/* Per-finding TA review decision form (FAQ-09, FAQ-10, FAQ-12) */}
                        {cv.findingId && (
                          <div
                            style={{
                              marginTop: '0.35rem',
                              paddingTop: '0.55rem',
                              borderTop: '1px dashed var(--border-subtle)',
                              display: 'grid',
                              gap: '0.45rem',
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 110px',
                                gap: '0.45rem',
                              }}
                            >
                              <div className="field" style={{ marginBottom: 0 }}>
                                <label htmlFor={`ta-decision-${draftKey}`}>Quyết định của TA</label>
                                <select
                                  id={`ta-decision-${draftKey}`}
                                  value={draft.decision}
                                  onChange={(e) =>
                                    updateDraft(draftKey, {
                                      decision: e.target.value as TaDecision,
                                    })
                                  }
                                >
                                  <option value="PASS">PASS — Đạt / Bác đề xuất (0đ)</option>
                                  <option value="VIOLATION">VIOLATION — Xác nhận vi phạm</option>
                                </select>
                              </div>

                              <div className="field" style={{ marginBottom: 0 }}>
                                <label htmlFor={`ta-deduction-${draftKey}`}>Mức trừ (0–10)</label>
                                <input
                                  id={`ta-deduction-${draftKey}`}
                                  type="number"
                                  min={0}
                                  max={10}
                                  step={0.25}
                                  disabled={draft.decision !== 'VIOLATION'}
                                  value={draft.decision === 'VIOLATION' ? draft.deduction : '0'}
                                  onChange={(e) =>
                                    updateDraft(draftKey, { deduction: e.target.value })
                                  }
                                />
                              </div>
                            </div>

                            {draft.decision === 'VIOLATION' && (
                              <div className="field" style={{ marginBottom: 0 }}>
                                <label htmlFor={`ta-evidence-${draftKey}`}>
                                  Số dòng bằng chứng (bắt buộc theo FAQ-09, cách nhau dấu phẩy)
                                </label>
                                <input
                                  id={`ta-evidence-${draftKey}`}
                                  type="text"
                                  className="mono"
                                  placeholder="Ví dụ: 2, 10"
                                  value={draft.evidenceLinesText}
                                  onChange={(e) =>
                                    updateDraft(draftKey, { evidenceLinesText: e.target.value })
                                  }
                                />
                              </div>
                            )}

                            <div className="field" style={{ marginBottom: 0 }}>
                              <label htmlFor={`ta-reason-${draftKey}`}>
                                Ghi chú / Lý do TA
                                {effectivePublishedAt ? ' (bắt buộc sau Publish — FAQ-12)' : ''}
                              </label>
                              <input
                                id={`ta-reason-${draftKey}`}
                                type="text"
                                placeholder="Ghi lý do ngắn gọn để lưu nhật ký và hiển thị cho SV sau Publish"
                                value={draft.reason}
                                onChange={(e) => updateDraft(draftKey, { reason: e.target.value })}
                              />
                            </div>

                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={isSaving}
                              aria-busy={isSaving}
                              onClick={() => void handleSaveDecision(cv)}
                            >
                              {isSaving ? 'Đang lưu...' : `Lưu quyết định ${cv.code}`}
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
