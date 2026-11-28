import type { Rfc9457ProblemDetails } from '../types/problem-details';

interface ProblemBannerProps {
  problem: Rfc9457ProblemDetails;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ProblemBanner({ problem, onRetry, retryLabel = 'Thử lại' }: ProblemBannerProps) {
  return (
    <div
      role="alert"
      style={{
        border: '1px solid var(--status-fail-border)',
        background: 'var(--status-fail-bg)',
        color: 'var(--status-fail-text)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <strong>
            {problem.status > 0 ? `[${problem.status}] ` : ''}
            {problem.title}
          </strong>
          <p style={{ margin: '0.25rem 0 0' }}>{problem.detail}</p>
        </div>
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
      </div>
      {problem.errors && problem.errors.length > 0 && (
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          {problem.errors.map((err, idx) => (
            <li key={`${err.field}-${idx}`}>
              <code className="mono">{err.field}</code>: {err.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
