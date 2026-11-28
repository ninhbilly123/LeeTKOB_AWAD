import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app';
import { labsStore, submissionStore } from './support/submissions.fixtures';

describe('Task D2: Student Results, TA Review Queue & Publish Contract', () => {
  let app: INestApplication;

  async function login(username: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ username, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function createSortMergeLab(taToken: string, deadline = '2099-12-31T23:59:59.000Z') {
    const res = await request(app.getHttpServer())
      .post('/labs')
      .set('Authorization', `Bearer ${taToken}`)
      .set('Content-Type', 'application/json')
      .send({
        classId: 'class_cs101',
        title: 'Sorting Lab — Merge Sort',
        statement: 'Implement merge sort without calling library sort functions.',
        deadline,
        testCases: [
          { id: 'tc_1', input: '5\n4 2 1 5 3\n', expectedOutput: '1 2 3 4 5\n', isHidden: false },
          { id: 'tc_2', input: '4\n9 7 5 3\n', expectedOutput: '3 5 7 9\n', isHidden: true },
        ],
        constraints: [
          {
            id: 'C1',
            text: 'Do not call a library sort function: `std::sort`.',
            deduction: 3,
          },
          {
            id: 'C2',
            text: 'Sort with a merge sort you wrote yourself.',
            deduction: 4,
          },
        ],
      })
      .expect(201);
    return res.body.id as string;
  }

  async function submitCode(labId: string, studentToken: string, code: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/labs/${labId}/submissions`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send({ code })
      .expect(201);
    return res.body.id as string;
  }

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('enforces Syllabus Rule before Publish: hides test I/O, findings, evidence, unsureReason, and deductions from students', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const student1Token = await login('student1', 'student123');
    const student2Token = await login('student2', 'student123');

    const labId = await createSortMergeLab(ta1Token);
    const subId = await submitCode(
      labId,
      student1Token,
      '#include <algorithm>\nint main() { std::sort(a, a+n); return 0; }',
    );

    await submissionStore.recordJudgeResultAsync({
      submissionId: subId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [
        { ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 3000 },
        { ordinal: 2, verdict: 'AC', timeMs: 12, memoryKb: 3200 },
      ],
      maxTimeMs: 12,
      maxMemoryKb: 3200,
      judgedAt: new Date().toISOString(),
    });

    await submissionStore.recordCheckerResultAsync({
      submissionId: subId,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 2, text: 'int main() { std::sort(a, a+n); return 0; }' }],
          reason: 'AST detected banned call to std::sort.',
        },
        {
          constraintCode: 'C2',
          source: 'LLM',
          verdict: 'unsure',
          unsureReason: 'TIMEOUT',
          evidence: [],
          reason: 'Model call timed out.',
        },
      ],
      callLogs: [],
    });

    // Student 1 sees overallVerdict & testVerdicts[] ONLY before Publish
    const res = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${subId}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);

    expect(res.body.id).toBe(subId);
    expect(res.body.overallVerdict).toBe('AC');
    expect(res.body.isPublished).toBe(false);
    expect(res.body.testVerdicts).toEqual([
      { ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 3000 },
      { ordinal: 2, verdict: 'AC', timeMs: 12, memoryKb: 3200 },
    ]);

    // Strict Syllabus Rule & FAQ-02/FAQ-08 redaction assertions
    expect(res.body.code).toBeUndefined();
    expect(res.body.findings).toBeUndefined();
    expect(res.body.evidence).toBeUndefined();
    expect(res.body.unsureReason).toBeUndefined();
    expect(res.body.deductions).toBeUndefined();
    expect(res.body.finalScore).toBeUndefined();
    expect(res.body.testVerdicts[0].input).toBeUndefined();
    expect(res.body.testVerdicts[0].expectedOutput).toBeUndefined();

    // Student 2 cannot view Student 1's submission (IDOR protection)
    const idorRes = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${subId}`)
      .set('Authorization', `Bearer ${student2Token}`)
      .expect(403);
    expect(idorRes.headers['content-type']).toContain('application/problem+json');
    expect(idorRes.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');
  });

  it('builds TA review queue (100% violation/unsure + ceil(10% pass) on counted AC only) and enforces 403 for other-class TA & students', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const ta2Token = await login('ta2', 'ta123');
    const student1Token = await login('student1', 'student123');
    const student2Token = await login('student2', 'student123');

    const labId = await createSortMergeLab(ta1Token);

    // Student 1 submits an old attempt (superseded, isCounting = false) then a counting AC attempt
    const oldSubId = await submitCode(labId, student1Token, 'int main() { return 0; }');
    await submissionStore.recordJudgeResultAsync({
      submissionId: oldSubId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 8, memoryKb: 2000 }],
      maxTimeMs: 8,
      maxMemoryKb: 2000,
      judgedAt: new Date().toISOString(),
    });
    await submissionStore.recordCheckerResultAsync({
      submissionId: oldSubId,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 1, text: 'old violation' }],
          reason: 'Old submission violation should not appear in counted queue.',
        },
      ],
      callLogs: [],
    });

    const countingSub1 = await submitCode(
      labId,
      student1Token,
      '#include <iostream>\nint main() { /* merge sort */ return 0; }',
    );
    await submissionStore.recordJudgeResultAsync({
      submissionId: countingSub1,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [
        { ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 3000 },
        { ordinal: 2, verdict: 'AC', timeMs: 11, memoryKb: 3100 },
      ],
      maxTimeMs: 11,
      maxMemoryKb: 3100,
      judgedAt: new Date().toISOString(),
    });
    await submissionStore.recordCheckerResultAsync({
      submissionId: countingSub1,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'pass',
          unsureReason: null,
          evidence: [],
          reason: null,
        },
        {
          constraintCode: 'C2',
          source: 'LLM',
          verdict: 'unsure',
          unsureReason: 'SCHEMA_INVALID',
          evidence: [],
          reason: 'Model output violated JSON schema.',
        },
      ],
      callLogs: [],
    });

    // Student 2 submits a WA submission (must NOT enter constraint review queue)
    const waSub2 = await submitCode(labId, student2Token, 'int main() { return 1; }');
    await submissionStore.recordJudgeResultAsync({
      submissionId: waSub2,
      overallVerdict: 'WA',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'WA', timeMs: 5, memoryKb: 2000 }],
      maxTimeMs: 5,
      maxMemoryKb: 2000,
      judgedAt: new Date().toISOString(),
    });

    // TA 2 (other class) and Student 1 are strictly rejected with 403 Forbidden
    for (const token of [ta2Token, student1Token]) {
      const denied = await request(app.getHttpServer())
        .get(`/labs/${labId}/review-queue`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(denied.headers['content-type']).toContain('application/problem+json');
      expect(denied.body.type).toBe('https://leetkob.edu.vn/errors/forbidden');
    }

    // TA 1 (owning class) sees counted AC queue:
    // - countingSub1 C2 (unsure with SCHEMA_INVALID)
    // - countingSub1 C1 (1 pass in lab -> ceil(0.1 * 1) = 1 sampled pass)
    // - excludes oldSubId (superseded) and waSub2 (WA)
    const queueRes = await request(app.getHttpServer())
      .get(`/labs/${labId}/review-queue`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);

    expect(queueRes.body.labId).toBe(labId);
    expect(queueRes.body.scope).toBe('counted');
    expect(queueRes.body.pendingReviewCount).toBe(2);
    expect(queueRes.body.items).toHaveLength(2);
    expect(
      queueRes.body.items.every((i: { submissionId: string }) => i.submissionId === countingSub1),
    ).toBe(true);

    const c2Item = queueRes.body.items.find(
      (i: { constraintCode: string }) => i.constraintCode === 'C2',
    );
    expect(c2Item.verdict).toBe('unsure');
    expect(c2Item.unsureReason).toBe('SCHEMA_INVALID');
    expect(c2Item.configuredDeduction).toBe(4);
    expect(c2Item.proposedDeduction).toBe(0);

    const c1Item = queueRes.body.items.find(
      (i: { constraintCode: string }) => i.constraintCode === 'C1',
    );
    expect(c1Item.verdict).toBe('pass');
    expect(c1Item.isSampledPass).toBe(true);

    // TA 1 can inspect any single submission (including superseded oldSubId) with full code
    const inspectRes = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${oldSubId}/review`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(inspectRes.body.submission.code).toBe('int main() { return 0; }');
    expect(inspectRes.body.findings).toHaveLength(1);
  });

  it('enforces TA decision evidence rule, blocks Publish on unreviewed items/before deadline (409), and reveals finalScore after Publish', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const student1Token = await login('student1', 'student123');
    const student2Token = await login('student2', 'student123');

    const labId = await createSortMergeLab(ta1Token, '2099-12-31T23:59:59.000Z');
    const sub1 = await submitCode(
      labId,
      student1Token,
      '#include <algorithm>\nint main() { std::sort(a, a + n); return 0; }',
    );
    const sub2 = await submitCode(labId, student2Token, 'int main() { return 0; }');

    await submissionStore.recordJudgeResultAsync({
      submissionId: sub1,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [
        { ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 3000 },
        { ordinal: 2, verdict: 'AC', timeMs: 11, memoryKb: 3100 },
      ],
      maxTimeMs: 11,
      maxMemoryKb: 3100,
      judgedAt: new Date().toISOString(),
    });
    await submissionStore.recordCheckerResultAsync({
      submissionId: sub1,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 2, text: 'int main() { std::sort(a, a + n); return 0; }' }],
          reason: 'AST detected std::sort.',
        },
        {
          constraintCode: 'C2',
          source: 'LLM',
          verdict: 'unsure',
          unsureReason: 'TIMEOUT',
          evidence: [],
          reason: 'Model timed out.',
        },
      ],
      callLogs: [],
    });

    await submissionStore.recordJudgeResultAsync({
      submissionId: sub2,
      overallVerdict: 'WA',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'WA', timeMs: 5, memoryKb: 2000 }],
      maxTimeMs: 5,
      maxMemoryKb: 2000,
      judgedAt: new Date().toISOString(),
    });

    // Publish before deadline MUST fail with 409 Conflict (FAQ-12)
    const earlyPublish = await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(409);
    expect(earlyPublish.headers['content-type']).toContain('application/problem+json');
    expect(earlyPublish.body.detail).toContain('deadline');

    // Simulate deadline has passed
    const lab = labsStore.getLab(labId)!;
    labsStore.saveLab({ ...lab, deadline: '2020-01-01T00:00:00.000Z' });

    // Publish while PENDING_REVIEW items remain MUST fail with 409 Conflict (FAQ-12)
    const unreviewedPublish = await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(409);
    expect(unreviewedPublish.body.detail).toContain('PENDING_REVIEW');

    // Fetch review queue to get finding IDs
    const queue = await request(app.getHttpServer())
      .get(`/labs/${labId}/review-queue`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    const c1 = queue.body.items.find((i: { constraintCode: string }) => i.constraintCode === 'C1');
    const c2 = queue.body.items.find((i: { constraintCode: string }) => i.constraintCode === 'C2');

    // VIOLATION without evidence MUST fail with 400 Bad Request (FAQ-09)
    await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${sub1}/findings/${c1.findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ decision: 'VIOLATION', evidence: [] })
      .expect(400);

    // Approve C1 as VIOLATION with evidence (deduction defaults to 3 from lab constraint)
    const c1Reviewed = await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${sub1}/findings/${c1.findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({
        decision: 'VIOLATION',
        evidence: [{ line: 2, text: 'int main() { std::sort(a, a + n); return 0; }' }],
        reason: 'Confirmed std::sort usage.',
      })
      .expect(200);
    expect(c1Reviewed.body.reviewStatus).toBe('APPROVED_VIOLATION');
    expect(c1Reviewed.body.taDeduction).toBe(3);

    // Dismiss C2 (unsure) as PASS
    const c2Reviewed = await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${sub1}/findings/${c2.findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ decision: 'PASS', reason: 'Manual check confirms no C2 penalty.' })
      .expect(200);
    expect(c2Reviewed.body.reviewStatus).toBe('DISMISSED_PASS');

    // Now Publish succeeds (200 OK) and is idempotent on retry
    const publish1 = await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(publish1.body.isPublished).toBe(true);
    expect(typeof publish1.body.publishedAt).toBe('string');

    const publish2 = await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(publish2.body.publishedAt).toBe(publish1.body.publishedAt);

    // After Publish: Student 1 sees finalScore = 7 and ONLY C1 approved violation (C2 dismissed/unsure is hidden!)
    const student1After = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${sub1}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(student1After.body.isPublished).toBe(true);
    expect(student1After.body.finalScore).toBe(7);
    expect(student1After.body.deductions).toHaveLength(1);
    expect(student1After.body.deductions[0].constraintCode).toBe('C1');
    expect(student1After.body.deductions[0].deduction).toBe(3);
    expect(student1After.body.deductions[0].evidence).toEqual([
      { line: 2, text: 'int main() { std::sort(a, a + n); return 0; }' },
    ]);
    expect(student1After.body.unsureReason).toBeUndefined();
    expect(student1After.body.isSampledPass).toBeUndefined();

    // After Publish: Student 2 (WA) gets finalScore = 0 (FAQ-04)
    const student2After = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${sub2}`)
      .set('Authorization', `Bearer ${student2Token}`)
      .expect(200);
    expect(student2After.body.finalScore).toBe(0);
    expect(student2After.body.deductions).toEqual([]);
  });

  it('AC2: blocks cross-class TA and students with 403 across all review & publish endpoints with zero state mutation', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const ta2Token = await login('ta2', 'ta123');
    const student1Token = await login('student1', 'student123');

    const labId = await createSortMergeLab(ta1Token, '2099-12-31T23:59:59.000Z');
    const subId = await submitCode(labId, student1Token, 'int main() { return 0; }');

    await submissionStore.recordJudgeResultAsync({
      submissionId: subId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 2048 }],
      maxTimeMs: 10,
      maxMemoryKb: 2048,
      judgedAt: new Date().toISOString(),
    });
    await submissionStore.recordCheckerResultAsync({
      submissionId: subId,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 1, text: 'int main() { return 0; }' }],
          reason: 'Violation sample.',
        },
      ],
      callLogs: [],
    });

    const findingsBefore = await submissionStore.getSubmissionFindingsAsync(subId);
    const findingId = findingsBefore[0].id;

    for (const deniedToken of [ta2Token, student1Token]) {
      await request(app.getHttpServer())
        .get(`/labs/${labId}/submissions/${subId}/review`)
        .set('Authorization', `Bearer ${deniedToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/labs/${labId}/submissions/${subId}/findings/${findingId}`)
        .set('Authorization', `Bearer ${deniedToken}`)
        .set('Content-Type', 'application/json')
        .send({ decision: 'PASS' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/labs/${labId}/publish`)
        .set('Authorization', `Bearer ${deniedToken}`)
        .expect(403);
    }

    // Zero side effects after refusals (Engineering Rules §5)
    const findingsAfter = await submissionStore.getSubmissionFindingsAsync(subId);
    expect(findingsAfter[0].reviewStatus).toBe('PENDING_REVIEW');
    expect(findingsAfter[0].taDecision).toBeNull();
    expect(labsStore.getLab(labId)?.isPublished).toBe(false);
    expect(submissionStore.getAuditLogs()).toHaveLength(0);
  });

  it('AC3 & AC4: samples ceil(10%) of pass findings randomly, allows TA override of non-queued pass, and logs before/after audit state', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const labId = await createSortMergeLab(ta1Token, '2099-12-31T23:59:59.000Z');

    // Seed 11 distinct counted AC submissions (1 pass finding each -> ceil(0.10 * 11) = 2 sampled)
    const subIds: string[] = [];
    for (let i = 1; i <= 11; i += 1) {
      const subId = `sub_sample_${i}`;
      subIds.push(subId);
      submissionStore.saveSubmission({
        id: subId,
        labId,
        studentId: `std_batch_${i}`,
        code: 'int main() { /* merge sort */ return 0; }',
        status: 'QUEUED',
        isCounting: true,
        submittedAt: new Date(Date.now() + i * 1000).toISOString(),
        idempotencyKey: randomUUID(),
      });
      await submissionStore.recordJudgeResultAsync({
        submissionId: subId,
        overallVerdict: 'AC',
        compileOutput: null,
        testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 8, memoryKb: 2048 }],
        maxTimeMs: 8,
        maxMemoryKb: 2048,
        judgedAt: new Date().toISOString(),
      });
      await submissionStore.recordCheckerResultAsync({
        submissionId: subId,
        labId,
        findings: [
          {
            constraintCode: 'C1',
            source: 'HARD_RULE',
            verdict: 'pass',
            unsureReason: null,
            evidence: [],
            reason: null,
          },
        ],
        callLogs: [],
      });
    }

    const queueRes = await request(app.getHttpServer())
      .get(`/labs/${labId}/review-queue?scope=counted`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);

    expect(queueRes.body.labTitle).toBe('Sorting Lab — Merge Sort');
    expect(queueRes.body.items).toHaveLength(2);
    expect(queueRes.body.pendingReviewCount).toBe(2);
    expect(
      queueRes.body.items.every(
        (item: { verdict: string; isSampledPass: boolean }) =>
          item.verdict === 'pass' && item.isSampledPass === true,
      ),
    ).toBe(true);

    // Find one NOT_QUEUED pass submission and verify TA can inspect & override it to VIOLATION (FAQ-10)
    const queuedSubIds = new Set(
      queueRes.body.items.map((item: { submissionId: string }) => item.submissionId),
    );
    const unqueuedSubId = subIds.find((id) => !queuedSubIds.has(id))!;
    const inspectRes = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${unqueuedSubId}/review`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);
    expect(inspectRes.body.findings[0].reviewStatus).toBe('NOT_QUEUED');

    const findingId = inspectRes.body.findings[0].findingId as string;
    const overrideRes = await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${unqueuedSubId}/findings/${findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({
        decision: 'VIOLATION',
        deduction: 2.5,
        evidence: [{ line: 1, text: 'int main() { /* merge sort */ return 0; }' }],
        reason: 'Manual audit spotted violation.',
      })
      .expect(200);
    expect(overrideRes.body.reviewStatus).toBe('APPROVED_VIOLATION');
    expect(overrideRes.body.taDeduction).toBe(2.5);

    const logs = submissionStore.getAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('TA_REVIEW_FINDING');
    expect(logs[0].beforeState).toMatchObject({ reviewStatus: 'NOT_QUEUED', taDecision: null });
    expect(logs[0].afterState).toMatchObject({
      reviewStatus: 'APPROVED_VIOLATION',
      decision: 'VIOLATION',
      deduction: 2.5,
    });
  });

  it('AC5 & AC6: blocks Publish while counted submissions are unjudged or unchecked, and requires non-empty reason for post-publish edits (FAQ-03, FAQ-12)', async () => {
    const ta1Token = await login('ta1', 'ta123');
    const student1Token = await login('student1', 'student123');

    const labId = await createSortMergeLab(ta1Token, '2099-12-31T23:59:59.000Z');
    const subId = await submitCode(labId, student1Token, 'int main() { return 0; }');

    // Simulate deadline passed while submission is still QUEUED (unjudged)
    const lab = labsStore.getLab(labId)!;
    labsStore.saveLab({ ...lab, deadline: '2020-01-01T00:00:00.000Z' });

    const unjudgedPublish = await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(409);
    expect(unjudgedPublish.body.detail).toContain('judging');
    expect(labsStore.getLab(labId)?.isPublished).toBe(false);

    // Judge finishes as AC, but checker is still PENDING
    await submissionStore.recordJudgeResultAsync({
      submissionId: subId,
      overallVerdict: 'AC',
      compileOutput: null,
      testResults: [{ ordinal: 1, verdict: 'AC', timeMs: 10, memoryKb: 2048 }],
      maxTimeMs: 10,
      maxMemoryKb: 2048,
      judgedAt: new Date().toISOString(),
    });
    const uncheckedPublish = await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(409);
    expect(uncheckedPublish.body.detail).toContain('constraint checking');
    expect(labsStore.getLab(labId)?.isPublished).toBe(false);

    // Checker finishes -> TA approves -> Publish succeeds
    await submissionStore.recordCheckerResultAsync({
      submissionId: subId,
      labId,
      findings: [
        {
          constraintCode: 'C1',
          source: 'HARD_RULE',
          verdict: 'violation',
          unsureReason: null,
          evidence: [{ line: 1, text: 'int main() { return 0; }' }],
          reason: 'Initial flag.',
        },
      ],
      callLogs: [],
    });
    const findingId = (await submissionStore.getSubmissionFindingsAsync(subId))[0].id;
    await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${subId}/findings/${findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({
        decision: 'VIOLATION',
        deduction: 3,
        evidence: [{ line: 1, text: 'int main() { return 0; }' }],
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/labs/${labId}/publish`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .expect(200);

    // Post-publish edit without reason MUST fail with 400 (FAQ-12)
    await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${subId}/findings/${findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ decision: 'PASS', reason: '   ' })
      .expect(400);

    // Post-publish edit WITH non-empty reason succeeds and updates student's score immediately
    await request(app.getHttpServer())
      .patch(`/labs/${labId}/submissions/${subId}/findings/${findingId}`)
      .set('Authorization', `Bearer ${ta1Token}`)
      .set('Content-Type', 'application/json')
      .send({ decision: 'PASS', reason: 'Accepted student appeal after manual review.' })
      .expect(200);

    const updatedStudentView = await request(app.getHttpServer())
      .get(`/labs/${labId}/submissions/${subId}`)
      .set('Authorization', `Bearer ${student1Token}`)
      .expect(200);
    expect(updatedStudentView.body.finalScore).toBe(10);
    expect(updatedStudentView.body.deductions).toEqual([]);
  });
});
