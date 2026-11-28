import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../../api/api-context';
import { useAuth } from '../../auth/auth-context-core';
import { ProblemBanner } from '../../components/ProblemBanner';
import tableStyles from '../../components/ResponsiveTable.module.css';
import { EmptyPanel, ForbiddenPanel, LoadingPanel } from '../../components/StatePanels';
import { Link } from '../../router/router';
import { useRouter } from '../../router/router-core';
import type { ClassSummary, LabSummary } from '../../types/lab';
import { isApiError, type Rfc9457ProblemDetails } from '../../types/problem-details';
import { formatDateTimeVi } from '../../utils/utf8';

interface TaClassLabsPageProps {
  classId?: string;
}

export function TaClassLabsPage({ classId }: TaClassLabsPageProps) {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(classId ?? null);
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Rfc9457ProblemDetails | null>(null);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setProblem(null);
    try {
      const clsRes = await api.listClasses(session.accessToken);
      setClasses(clsRes.items);
      const targetClassId = classId ?? clsRes.items[0]?.id ?? null;
      setSelectedClassId(targetClassId);

      if (targetClassId) {
        const labsRes = await api.listClassLabs(session.accessToken, targetClassId);
        setLabs(labsRes.items);
      } else {
        setLabs([]);
      }
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401) {
          logout();
          setExpiredMessage('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
          navigate('/login', { replace: true });
          return;
        }
        setProblem(err.problem);
      }
    } finally {
      setLoading(false);
    }
  }, [api, classId, logout, navigate, session, setExpiredMessage]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (problem && (problem.status === 403 || problem.status === 404)) {
    return <ForbiddenPanel status={problem.status} message={problem.detail} />;
  }

  const activeClass = classes.find((c) => c.id === selectedClassId);

  return (
    <div className="container-page">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h1 id="main-content" tabIndex={-1} style={{ margin: 0 }}>
            Quản lý Bài Lab (Trợ giảng)
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)' }}>
            {activeClass
              ? `Lớp ${activeClass.code} — ${activeClass.name} (${activeClass.term})`
              : 'Chọn lớp bạn phụ trách để tạo Lab hoặc mở Hàng chờ Soát Ràng buộc.'}
          </p>
        </div>

        {selectedClassId && (
          <Link to={`/ta/classes/${selectedClassId}/labs/new`} className="btn btn-primary">
            + Tạo bài Lab mới
          </Link>
        )}
      </div>

      {classes.length > 1 && (
        <div className="tablist" role="tablist" aria-label="Chọn lớp phụ trách">
          {classes.map((cls) => (
            <button
              key={cls.id}
              type="button"
              role="tab"
              className="tab-btn"
              aria-selected={cls.id === selectedClassId}
              onClick={() => navigate(`/ta/classes/${cls.id}`)}
            >
              {cls.code}
            </button>
          ))}
        </div>
      )}

      {problem && <ProblemBanner problem={problem} onRetry={loadData} />}

      {loading ? (
        <LoadingPanel message="Đang tải danh sách bài Lab của lớp..." />
      ) : !selectedClassId ? (
        <EmptyPanel
          title="Chưa được phân công lớp nào"
          description="Liên hệ quản trị viên (Admin) để được gán vào lớp học."
        />
      ) : labs.length === 0 ? (
        <EmptyPanel
          title="Lớp chưa có bài Lab nào"
          description="Tạo bài Lab mới với đề Markdown, bộ test và danh sách ràng buộc kỹ thuật."
          action={
            <Link to={`/ta/classes/${selectedClassId}/labs/new`} className="btn btn-primary">
              + Tạo bài Lab đầu tiên
            </Link>
          }
        />
      ) : (
        <div
          className={tableStyles.wrapper}
          tabIndex={0}
          role="region"
          aria-labelledby="ta-labs-cap"
        >
          <table className={tableStyles.table}>
            <caption id="ta-labs-cap">
              Bài Lab của lớp {activeClass?.code ?? selectedClassId} ({labs.length})
            </caption>
            <thead>
              <tr>
                <th scope="col">Bài Lab</th>
                <th scope="col">Hạn nộp</th>
                <th scope="col">Bài nộp / Chờ soát AC</th>
                <th scope="col">Trạng thái công bố</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {labs.map((lab) => (
                <tr key={lab.id}>
                  <th scope="row">
                    <div>{lab.title}</div>
                    <div className="field-hint mono">{lab.id}</div>
                  </th>
                  <td data-label="Hạn nộp" className="mono">
                    {formatDateTimeVi(lab.deadline)}
                  </td>
                  <td data-label="Bài nộp / Chờ soát AC" className="mono">
                    {lab.submissionCount} bài ({lab.pendingReviewCount} AC)
                  </td>
                  <td data-label="Trạng thái công bố">
                    {lab.publishedAt ? 'Đã công bố' : 'Nháp — Chờ TA duyệt'}
                  </td>
                  <td data-label="Thao tác">
                    <Link to={`/ta/labs/${lab.id}/review`} className="btn btn-primary">
                      Mở Hàng chờ Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
