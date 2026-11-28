import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../api/api-context';
import { useAuth } from '../../auth/auth-context-core';
import { ProblemBanner } from '../../components/ProblemBanner';
import tableStyles from '../../components/ResponsiveTable.module.css';
import { EmptyPanel, ForbiddenPanel, LoadingPanel } from '../../components/StatePanels';
import { useRouter } from '../../router/router-core';
import type { SessionUser } from '../../types/auth';
import type { ClassSummary } from '../../types/lab';
import { isApiError, type Rfc9457ProblemDetails } from '../../types/problem-details';

export function AdminClassesPage() {
  const api = useApiClient();
  const { session, logout, setExpiredMessage } = useAuth();
  const { navigate } = useRouter();

  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [tas, setTas] = useState<SessionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Rfc9457ProblemDetails | null>(null);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [term, setTerm] = useState('HK1 2026-2027');
  const [taId, setTaId] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<Rfc9457ProblemDetails | null>(null);

  const loadClasses = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setProblem(null);
    try {
      const [res, taList] = await Promise.all([
        api.listClasses(session.accessToken),
        api.listUsers(session.accessToken, 'TA').catch(() => [] as SessionUser[]),
      ]);
      setClasses(res.items);
      setTas(taList);
      setTaId((prev) => {
        if (prev && taList.some((ta) => ta.id === prev)) {
          return prev;
        }
        return taList[0]?.id ?? '';
      });
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
    void loadClasses();
  }, [loadClasses]);

  const openCreateDialog = () => {
    setFormError(null);
    dialogRef.current?.showModal();
  };

  const closeCreateDialog = () => {
    dialogRef.current?.close();
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return;
    setCreating(true);
    setFormError(null);
    try {
      const created = await api.createClass(session.accessToken, {
        code,
        name,
        term,
        taIds: taId ? [taId] : [],
      });
      setClasses((prev) => [...prev, created]);
      setCode('');
      setName('');
      closeCreateDialog();
    } catch (err) {
      if (isApiError(err)) {
        setFormError(err.problem);
      }
    } finally {
      setCreating(false);
    }
  };

  if (problem && (problem.status === 403 || problem.status === 404)) {
    return <ForbiddenPanel status={problem.status} message={problem.detail} />;
  }

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
            Quản lý Lớp học (Admin)
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)' }}>
            Tạo lớp học mới và gán Trợ giảng phụ trách từng lớp.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreateDialog}>
          + Tạo lớp học mới
        </button>
      </div>

      {problem && <ProblemBanner problem={problem} onRetry={loadClasses} />}

      {loading ? (
        <LoadingPanel message="Đang tải danh sách lớp học..." />
      ) : classes.length === 0 ? (
        <EmptyPanel
          title="Chưa có lớp học nào"
          description="Tạo lớp học đầu tiên để bắt đầu phân công Trợ giảng và mở bài Lab."
          action={
            <button type="button" className="btn btn-primary" onClick={openCreateDialog}>
              + Tạo lớp học đầu tiên
            </button>
          }
        />
      ) : (
        <div
          className={tableStyles.wrapper}
          tabIndex={0}
          role="region"
          aria-labelledby="admin-cls-cap"
        >
          <table className={tableStyles.table}>
            <caption id="admin-cls-cap">
              Danh sách lớp học trong hệ thống ({classes.length})
            </caption>
            <thead>
              <tr>
                <th scope="col">Mã lớp</th>
                <th scope="col">Tên môn học</th>
                <th scope="col">Học kỳ</th>
                <th scope="col">TA phụ trách</th>
                <th scope="col">Số bài Lab</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((cls) => (
                <tr key={cls.id}>
                  <th scope="row" className="mono">
                    {cls.code}
                  </th>
                  <td data-label="Tên môn học">{cls.name}</td>
                  <td data-label="Học kỳ">{cls.term}</td>
                  <td data-label="TA phụ trách" className="mono">
                    {cls.taIds.join(', ') || 'Chưa gán'}
                  </td>
                  <td data-label="Số bài Lab" className="mono">
                    {cls.labCount}
                  </td>
                  <td data-label="Thao tác">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => navigate(`/ta/classes/${cls.id}`)}
                    >
                      Xem bài Lab
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dialog ref={dialogRef} className="app-dialog" aria-labelledby="create-class-title">
        <h2 id="create-class-title" style={{ marginTop: 0 }}>
          Tạo lớp học mới
        </h2>
        {formError && <ProblemBanner problem={formError} />}
        <form onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="cls-code">Mã lớp</label>
            <input
              id="cls-code"
              name="code"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CSC10002-24CLC3"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cls-name">Tên môn học</label>
            <input
              id="cls-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kỹ thuật lập trình — Nhóm 3"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cls-term">Học kỳ</label>
            <input
              id="cls-term"
              name="term"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cls-ta">Trợ giảng phụ trách</label>
            <select id="cls-ta" name="taId" value={taId} onChange={(e) => setTaId(e.target.value)}>
              {tas.length === 0 ? (
                <option value="">-- Chưa có Trợ giảng khả dụng --</option>
              ) : (
                tas.map((ta) => (
                  <option key={ta.id} value={ta.id}>
                    {ta.displayName} ({ta.id})
                  </option>
                ))
              )}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
            <button type="button" className="btn" onClick={closeCreateDialog}>
              Hủy
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating}
              aria-busy={creating}
            >
              {creating ? 'Đang tạo...' : 'Tạo lớp'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
