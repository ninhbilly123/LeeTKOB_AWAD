import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../../api/api-context';
import { useAuth } from '../../auth/auth-context-core';
import { ProblemBanner } from '../../components/ProblemBanner';
import tableStyles from '../../components/ResponsiveTable.module.css';
import { EmptyPanel, ForbiddenPanel, LoadingPanel } from '../../components/StatePanels';
import { JudgeVerdictBadge } from '../../components/VerdictBadge';
import { Link } from '../../router/router';
import { useRouter } from '../../router/router-core';
import type { ClassSummary, LabSummary } from '../../types/lab';
import { isApiError, type Rfc9457ProblemDetails } from '../../types/problem-details';
import { formatDateTimeVi } from '../../utils/utf8';

export function StudentLabsPage() {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Rfc9457ProblemDetails | null>(null);

  const loadLabs = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setProblem(null);
    try {
      const clsRes = await api.listClasses(session.accessToken);
      setClasses(clsRes.items);
      const allLabs: LabSummary[] = [];
      for (const cls of clsRes.items) {
        const res = await api.listClassLabs(session.accessToken, cls.id);
        allLabs.push(...res.items);
      }
      setLabs(allLabs);
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
  }, [api, logout, navigate, session, setExpiredMessage]);

  useEffect(() => {
    void loadLabs();
  }, [loadLabs]);

  if (problem && (problem.status === 403 || problem.status === 404)) {
    return <ForbiddenPanel status={problem.status} message={problem.detail} />;
  }

  const visibleLabs =
    selectedClassId === 'ALL' ? labs : labs.filter((l) => l.classId === selectedClassId);

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
            Bài Lab của tôi
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)' }}>
            Chọn bài Lab trong lớp đang ghi danh để đọc đề, xem ràng buộc và nộp mã nguồn C++17.
          </p>
        </div>

        {classes.length > 1 && (
          <div className="field" style={{ marginBottom: 0, minWidth: '220px' }}>
            <label htmlFor="student-class-filter">Lọc theo lớp</label>
            <select
              id="student-class-filter"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
            >
              <option value="ALL">Tất cả lớp ({classes.length})</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.code} — {cls.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {problem && <ProblemBanner problem={problem} onRetry={loadLabs} />}

      {loading ? (
        <LoadingPanel message="Đang tải danh sách bài Lab..." />
      ) : visibleLabs.length === 0 ? (
        <EmptyPanel
          title="Chưa có bài Lab nào được mở"
          description="Khi Trợ giảng mở bài Lab mới trong lớp của bạn, bài sẽ xuất hiện tại đây."
        />
      ) : (
        <div
          className={tableStyles.wrapper}
          tabIndex={0}
          role="region"
          aria-labelledby="stu-labs-cap"
        >
          <table className={tableStyles.table}>
            <caption id="stu-labs-cap">Danh sách bài Lab đang học ({visibleLabs.length})</caption>
            <thead>
              <tr>
                <th scope="col">Bài Lab</th>
                <th scope="col">Lớp</th>
                <th scope="col">Hạn nộp</th>
                <th scope="col">Kết quả test gần nhất</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visibleLabs.map((lab) => (
                <tr key={lab.id}>
                  <th scope="row">{lab.title}</th>
                  <td data-label="Lớp" className="mono">
                    {lab.classCode}
                  </td>
                  <td data-label="Hạn nộp" className="mono">
                    {formatDateTimeVi(lab.deadline)}
                  </td>
                  <td data-label="Kết quả test gần nhất">
                    {lab.latestStudentVerdict ? (
                      <JudgeVerdictBadge verdict={lab.latestStudentVerdict} />
                    ) : (
                      <span className="field-hint">Chưa nộp</span>
                    )}
                  </td>
                  <td data-label="Thao tác">
                    <Link to={`/student/labs/${lab.id}`} className="btn btn-primary">
                      Làm bài &amp; Nộp C++
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
