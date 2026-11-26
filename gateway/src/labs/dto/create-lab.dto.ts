import { LabConstraint, LabTestCase } from '../../submissions/submissions.types';

export interface CreateLabInput {
  classId: string;
  title: string;
  statement: string;
  deadline: string;
  testCases: LabTestCase[];
  constraints: LabConstraint[];
}
