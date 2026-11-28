import { LabConstraint, LabTestCase } from '../../submissions/submissions.types';

export interface CreateLabInput {
  classId: string;
  title: string;
  statement: string;
  openedAt?: string;
  deadline: string;
  cpuTimeLimitSec?: number;
  memoryLimitMb?: number;
  testCases: LabTestCase[];
  constraints: LabConstraint[];
}
