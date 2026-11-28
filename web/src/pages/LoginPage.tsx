import React, { useState } from 'react';
import { useApiClient } from '../api/api-context';
import { DEMO_ACCOUNTS } from '../api/mock-seed';
import { defaultHomePathForRole, useAuth } from '../auth/auth-context-core';
import { ProblemBanner } from '../components/ProblemBanner';
import { useRouter } from '../router/router-core';
import type { UserRole } from '../types/auth';
import { isApiError, type Rfc9457ProblemDetails } from '../types/problem-details';

interface QuickDemoAccount {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  summary: string;
}

const BACKEND_DEMO_ACCOUNTS: QuickDemoAccount[] = [
  {
    email: 'admin@leetkob.edu.vn',
    password: 'admin123',
    displayName: 'Admin Hệ Thống',
    role: 'ADMIN',
    summary: 'Quản lý danh sách lớp học và gán Trợ giảng phụ trách (DB seed)',
  },
  {
    email: 'ta1@leetkob.edu.vn',
    password: 'ta123',
    displayName: 'TA 1 (CSC10002-24CLC1)',
    role: 'TA',
    summary: 'Phụ trách lớp CSC10002-24CLC1 — tạo Lab, soát ràng buộc & Publish',
  },
  {
    email: 'ta2@leetkob.edu.vn',
    password: 'ta123',
    displayName: 'TA 2 (CSC10002-24CLC2)',
    role: 'TA',
    summary: 'Phụ trách lớp CSC10002-24CLC2 — kiểm thử cách ly 403 khác lớp',
  },
  {
    email: 'student1@leetkob.edu.vn',
    password: 'student123',
    displayName: 'Sinh viên 1 (CSC10002-24CLC1)',
    role: 'STUDENT',
    summary: 'Ghi danh lớp CSC10002-24CLC1 — đọc đề, nộp C++17 & xem điểm sau Publish',
  },
  {
    email: 'student2@leetkob.edu.vn',
    password: 'student123',
    displayName: 'SV Phạm Gia Hân (CSC10002-24CLC1)',
    role: 'STUDENT',
    summary: 'Ghi danh lớp CSC10002-24CLC1 — kiểm thử cách ly bài nộp giữa các sinh viên',
  },
];

export function LoginPage() {
  const api = useApiClient();
  const { login, expiredMessage } = useAuth();
  const { navigate } = useRouter();

  const showDemoAccounts =
    api.mode === 'mock' || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
  const demoAccounts: QuickDemoAccount[] =
    api.mode === 'mock' ? DEMO_ACCOUNTS : BACKEND_DEMO_ACCOUNTS;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<Rfc9457ProblemDetails | null>(null);

  const emailError =
    (touched.email || submitted) && !email.trim() ? 'Vui lòng nhập email trường.' : null;
  const passwordError =
    (touched.password || submitted) && !password ? 'Vui lòng nhập mật khẩu.' : null;

  const doLogin = async (targetEmail: string, targetPassword: string) => {
    setProblem(null);
    setSubmitting(true);
    try {
      const session = await login({ email: targetEmail, password: targetPassword });
      navigate(defaultHomePathForRole(session.user.role), { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        setProblem(err.problem);
      } else {
        setProblem({
          type: 'https://leetkob.edu.vn/errors/unexpected',
          title: 'Đăng nhập thất bại',
          status: 500,
          detail: 'Không thể hoàn tất đăng nhập. Vui lòng thử lại.',
          instance: '/auth/login',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!email.trim() || !password) return;
    await doLogin(email, password);
  };

  return (
    <div className="container-page" style={{ maxWidth: '860px' }}>
      <h1 id="main-content" tabIndex={-1} style={{ marginTop: 0 }}>
        Đăng nhập LeeTKOB
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: '-0.35rem', marginBottom: '1.25rem' }}>
        Hệ thống chấm Lab C++17 và soát ràng buộc kỹ thuật có sự xác nhận của Trợ giảng.
      </p>

      {expiredMessage && (
        <div className="notice-box" role="status" style={{ marginBottom: '1rem' }}>
          {expiredMessage}
        </div>
      )}

      {problem && <ProblemBanner problem={problem} />}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        <section className="card" aria-labelledby="login-form-heading">
          <h2 id="login-form-heading" style={{ marginTop: 0, fontSize: '1.15rem' }}>
            Tài khoản của bạn
          </h2>
          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="login-email">Email hoặc tên đăng nhập</label>
              <input
                id="login-email"
                name="email"
                type="text"
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                aria-invalid={emailError ? 'true' : undefined}
                aria-describedby={emailError ? 'login-email-error' : undefined}
                placeholder="ta1@leetkob.edu.vn hoặc ta1"
                required
              />
              {emailError && (
                <span id="login-email-error" className="field-error">
                  {emailError}
                </span>
              )}
            </div>

            <div className="field">
              <label htmlFor="login-password">Mật khẩu</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                aria-invalid={passwordError ? 'true' : undefined}
                aria-describedby={passwordError ? 'login-password-error' : undefined}
                required
              />
              {passwordError && (
                <span id="login-password-error" className="field-error">
                  {passwordError}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              aria-busy={submitting}
              style={{ width: '100%' }}
            >
              {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        </section>

        {showDemoAccounts && (
          <section className="card" aria-labelledby="demo-accounts-heading">
            <h2 id="demo-accounts-heading" style={{ marginTop: 0, fontSize: '1.15rem' }}>
              {api.mode === 'mock'
                ? '5 Tài khoản mẫu PA#3 (Chế độ Mock)'
                : '5 Tài khoản mẫu PA#3 (Chế độ Demo HTTP)'}
            </h2>
            <p className="field-hint" style={{ marginTop: '-0.25rem', marginBottom: '0.85rem' }}>
              Bấm chọn nhanh để kiểm thử cách ly quyền giữa Admin, 2 TA khác lớp và 2 Sinh viên.
            </p>
            <ul
              style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}
            >
              {demoAccounts.map((acc) => (
                <li
                  key={acc.email}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.65rem 0.8rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.6rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                      {acc.displayName}{' '}
                      <span
                        className="mono"
                        style={{ fontSize: '0.78rem', color: 'var(--brand-600)' }}
                      >
                        [{acc.role}]
                      </span>
                    </div>
                    <div className="field-hint">{acc.summary}</div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={submitting}
                    onClick={() => {
                      setEmail(acc.email);
                      setPassword(acc.password);
                      void doLogin(acc.email, acc.password);
                    }}
                  >
                    Vào ngay
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
