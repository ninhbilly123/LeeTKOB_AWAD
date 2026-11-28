import type { ConstraintCheckVerdict } from '../types/review';
import type { JudgeVerdict, SubmissionPipelineStatus } from '../types/submission';
import styles from './VerdictBadge.module.css';

interface JudgeBadgeProps {
  verdict: JudgeVerdict;
  labelSuffix?: string;
}

export function JudgeVerdictBadge({ verdict, labelSuffix }: JudgeBadgeProps) {
  const map: Record<JudgeVerdict, { icon: string; tone: string; text: string }> = {
    AC: { icon: '✓', tone: styles.pass, text: 'AC' },
    WA: { icon: '!', tone: styles.fail, text: 'WA' },
    TLE: { icon: '⏱', tone: styles.warn, text: 'TLE' },
    MLE: { icon: '▤', tone: styles.warn, text: 'MLE' },
    RE: { icon: '×', tone: styles.fail, text: 'RE' },
    CE: { icon: '×', tone: styles.compile, text: 'CE' },
  };
  const cfg = map[verdict];
  return (
    <span className={`${styles.badge} ${cfg.tone} mono`}>
      <span aria-hidden="true">{cfg.icon}</span>
      <span>
        {cfg.text}
        {labelSuffix ? ` ${labelSuffix}` : ''}
      </span>
    </span>
  );
}

export function PipelineStatusBadge({ status }: { status: SubmissionPipelineStatus }) {
  const map: Record<SubmissionPipelineStatus, { icon: string; tone: string; text: string }> = {
    QUEUED: { icon: '…', tone: styles.info, text: 'Đang xếp hàng (QUEUED)' },
    JUDGING: { icon: '⚙', tone: styles.info, text: 'Đang chấm test (JUDGING)' },
    COMPLETED: { icon: '✓', tone: styles.pass, text: 'Hoàn tất chấm test' },
    JUDGE_ERROR: { icon: '!', tone: styles.fail, text: 'Lỗi hệ thống chấm' },
  };
  const cfg = map[status];
  return (
    <span className={`${styles.badge} ${cfg.tone}`}>
      <span aria-hidden="true">{cfg.icon}</span>
      <span>{cfg.text}</span>
    </span>
  );
}

export function ConstraintVerdictBadge({ verdict }: { verdict: ConstraintCheckVerdict }) {
  const map: Record<ConstraintCheckVerdict, { icon: string; tone: string; text: string }> = {
    pass: { icon: '✓', tone: styles.pass, text: 'PASS — Đạt' },
    violation: { icon: '!', tone: styles.fail, text: 'VIOLATION — Vi phạm' },
    unsure: { icon: '?', tone: styles.warn, text: 'UNSURE — Cần TA kiểm tra' },
  };
  const cfg = map[verdict];
  return (
    <span className={`${styles.badge} ${cfg.tone}`}>
      <span aria-hidden="true">{cfg.icon}</span>
      <span>{cfg.text}</span>
    </span>
  );
}
