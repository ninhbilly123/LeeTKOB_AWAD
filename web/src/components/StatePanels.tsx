import React from 'react';
import { defaultHomePathForRole, useAuth } from '../auth/auth-context-core';
import { Link } from '../router/router';

export function LoadingPanel({ message = 'Đang tải dữ liệu...' }: { message?: string }) {
  return (
    <div className="card" role="status" aria-live="polite" aria-busy="true">
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 500 }}>{message}</p>
    </div>
  );
}

interface EmptyPanelProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyPanel({ title, description, action }: EmptyPanelProps) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
      <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{title}</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: action ? '1.25rem' : 0 }}>
        {description}
      </p>
      {action}
    </div>
  );
}

interface ForbiddenPanelProps {
  status?: number;
  message?: string;
}

/**
 * Handles both 403 Forbidden (PA#2/PA#3 contract) and 404 Not Found (Session 06 resource hiding)
 * cleanly without revealing details of another class's resources.
 */
export function ForbiddenPanel({
  status = 403,
  message = 'Bạn không có quyền truy cập vào tài nguyên này hoặc tài nguyên không thuộc lớp học của bạn.',
}: ForbiddenPanelProps) {
  const { session } = useAuth();
  const home = session ? defaultHomePathForRole(session.user.role) : '/login';

  return (
    <section className="container-page" aria-labelledby="forbidden-heading">
      <div
        className="card"
        role="alert"
        style={{
          borderColor: 'var(--status-fail-border)',
          maxWidth: '640px',
          marginInline: 'auto',
          marginTop: '2rem',
        }}
      >
        <p
          className="mono"
          style={{ margin: 0, color: 'var(--status-fail-text)', fontWeight: 700 }}
        >
          HTTP {status}
        </p>
        <h1 id="forbidden-heading" style={{ margin: '0.35rem 0 0.75rem', fontSize: '1.35rem' }}>
          {status === 404 ? 'Không tìm thấy hoặc không có quyền truy cập' : 'Truy cập bị từ chối'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>{message}</p>
        <Link to={home} className="btn btn-primary">
          Quay về trang chính
        </Link>
      </div>
    </section>
  );
}
