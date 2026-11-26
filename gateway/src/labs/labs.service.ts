import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { problemException } from '../common/http-problems';
import { AuthStore } from '../auth/auth.store';
import { LabsStore } from './labs.store';
import { Lab, LabConstraint, LabTestCase, UserRole } from '../submissions/submissions.types';
import { CreateLabInput } from './dto/create-lab.dto';

const REVIEW_NOTICE =
  'Submitted code is checked by syntax hard rules and an anonymized LLM constraint checker ' +
  '(comments, names, and student IDs are removed). A TA reviews all deductions before grades are published.';

export interface LabStudentView {
  id: string;
  classId: string;
  title: string;
  statement: string;
  deadline: string;
  maxPayloadSize: number;
  isActive: boolean;
  isPublished: boolean;
  constraints: LabConstraint[];
  testCases: LabTestCase[];
  reviewNotice: string;
}

@Injectable()
export class LabsService {
  constructor(
    private readonly authStore: AuthStore,
    private readonly labsStore: LabsStore,
  ) {}

  async createLab(taUserId: string, input: CreateLabInput): Promise<Lab> {
    const managedClasses = await this.authStore.taClassesAsync(taUserId);
    if (!managedClasses.includes(input.classId)) {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'You are not authorized to access labs in this class.',
      );
    }

    const lab: Lab = {
      id: `lab_${randomUUID()}`,
      classId: input.classId,
      title: input.title,
      statement: input.statement,
      deadline: input.deadline,
      maxPayloadSize: 65536,
      isActive: true,
      testCases: input.testCases,
      constraints: input.constraints,
      isPublished: false,
    };

    await this.labsStore.saveLabAsync(lab);
    return lab;
  }

  async listLabs(userId: string, role: UserRole): Promise<Array<Lab | LabStudentView>> {
    const allowedClasses =
      role === 'ADMIN'
        ? null
        : role === 'TA'
          ? await this.authStore.taClassesAsync(userId)
          : await this.authStore.activeClassesAsync(userId);

    const labs = await this.labsStore.getAllLabsAsync();
    return labs
      .filter((lab) => allowedClasses === null || allowedClasses.includes(lab.classId))
      .map((lab) => (role === 'STUDENT' ? this.toStudentView(lab) : lab));
  }

  async getLabForUser(
    labId: string,
    userId: string,
    role: UserRole,
  ): Promise<Lab | LabStudentView> {
    const lab = await this.labsStore.getLabAsync(labId);
    if (!lab) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `The requested lab with ID '${labId}' does not exist.`,
      );
    }

    if (role === 'TA') {
      const managedClasses = await this.authStore.taClassesAsync(userId);
      if (!managedClasses.includes(lab.classId)) {
        throw problemException(
          HttpStatus.FORBIDDEN,
          'You are not authorized to access labs in this class.',
        );
      }
      return lab;
    }

    if (role === 'STUDENT') {
      const enrolledClasses = await this.authStore.activeClassesAsync(userId);
      if (!enrolledClasses.includes(lab.classId)) {
        throw problemException(
          HttpStatus.FORBIDDEN,
          'You are not enrolled in the class owning this lab.',
        );
      }
      return this.toStudentView(lab);
    }

    return lab;
  }

  private toStudentView(lab: Lab): LabStudentView {
    return {
      id: lab.id,
      classId: lab.classId,
      title: lab.title,
      statement: lab.statement ?? '',
      deadline: lab.deadline,
      maxPayloadSize: lab.maxPayloadSize,
      isActive: lab.isActive,
      isPublished: lab.isPublished ?? false,
      constraints: lab.constraints ?? [],
      testCases: (lab.testCases ?? []).filter((tc) => !tc.isHidden),
      reviewNotice: REVIEW_NOTICE,
    };
  }
}
