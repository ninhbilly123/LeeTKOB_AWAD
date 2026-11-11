import { AuthenticatedUser, Lab, ClassMembership } from '../../src/submissions/submissions.types';
import { SubmissionStore } from '../../src/submissions/submissions.store';

export const MOCK_LABS: Record<string, Lab> = {
  'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001': {
    id: 'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001',
    classId: 'class_cs101',
    title: 'Sorting Lab — Merge Sort',
    deadline: '2099-12-31T23:59:59.000Z', // Far future deadline (active)
    maxPayloadSize: 65536, // 64 KB
    isActive: true,
  },
  lab_expired_001: {
    id: 'lab_expired_001',
    classId: 'class_cs101',
    title: 'Closed Sorting Lab',
    deadline: '2020-01-01T00:00:00.000Z', // Past deadline (expired)
    maxPayloadSize: 65536,
    isActive: true,
  },
};

export const MOCK_MEMBERSHIPS: ClassMembership[] = [
  {
    id: 'mem_001',
    studentId: 'std_23120244',
    classId: 'class_cs101',
    status: 'ACTIVE',
  },
  {
    id: 'mem_002',
    studentId: 'std_other_class',
    classId: 'class_diff202',
    status: 'ACTIVE',
  },
];

export const MOCK_USERS: Record<string, AuthenticatedUser> = {
  student_enrolled: {
    id: 'std_23120244',
    role: 'STUDENT',
    classIds: ['class_cs101'],
  },
  student_other_class: {
    id: 'std_other_class',
    role: 'STUDENT',
    classIds: ['class_diff202'],
  },
  ta_user: {
    id: 'usr_ta_01',
    role: 'TA',
    classIds: ['class_cs101'],
  },
  admin_user: {
    id: 'usr_admin_01',
    role: 'ADMIN',
    classIds: [],
  },
};

MOCK_LABS.lab_second_001 = {
  ...MOCK_LABS['lab_018f2d5e-7a91-7f3c-b26a-98124d63e001'],
  id: 'lab_second_001',
};
MOCK_USERS.second_student = {
  id: 'std_second_student',
  role: 'STUDENT',
  classIds: ['class_cs101'],
};
MOCK_MEMBERSHIPS.push({
  id: 'mem_003',
  studentId: 'std_second_student',
  classId: 'class_cs101',
  status: 'ACTIVE',
});

class TestSubmissionStore extends SubmissionStore {
  override reset(): void {
    super.reset(Object.values(MOCK_LABS), MOCK_MEMBERSHIPS);
  }
}
export const submissionStore = new TestSubmissionStore();
