import type { SandboxExecutionResult, SubmissionJob } from '../types';

/**
 * Pluggable C++17 execution boundary.
 * Task N1 ships ProcessSandboxRunner for end-to-end queue/worker verification;
 * Task N2 plugs in DockerSandboxRunner enforcing all 9 OS/container isolation layers.
 */
export interface SandboxRunner {
  evaluate(job: SubmissionJob): Promise<SandboxExecutionResult>;
}
