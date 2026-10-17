import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPrismaClient,
  expectCheckViolation,
  expectDatabaseError,
  truncateAllTables,
} from "./database.js";

const prisma = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(prisma);
});

function createUser() {
  return prisma.user.create({ data: { preferredLanguage: "EN" } });
}

const T1 = new Date("2026-09-01T10:00:00.000Z");
const T2 = new Date("2026-09-02T10:00:00.000Z");

describe("financial_literacy_profiles", () => {
  it("belongs to an existing user and is removed with the user", async () => {
    const user = await createUser();
    await prisma.financialLiteracyProfile.create({ data: { userId: user.id } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.financialLiteracyProfile.count()).toBe(0);
  });

  it("rejects a profile for an unknown user", async () => {
    await expectDatabaseError(
      prisma.financialLiteracyProfile.create({ data: { userId: randomUUID() } }),
      { code: "P2003" },
    );
  });

  it("allows only one profile per user", async () => {
    const user = await createUser();
    await prisma.financialLiteracyProfile.create({ data: { userId: user.id } });

    await expectDatabaseError(
      prisma.financialLiteracyProfile.create({ data: { userId: user.id } }),
      { code: "P2002" },
    );
  });

  it("defaults to an unassessed beginner (assessedAt null)", async () => {
    const user = await createUser();
    const profile = await prisma.financialLiteracyProfile.create({ data: { userId: user.id } });

    expect(profile).toMatchObject({ level: "BEGINNER", assessmentVersion: "1", assessedAt: null });
  });

  it.each(["BEGINNER", "DEVELOPING", "CONFIDENT"] as const)(
    "accepts the level %s",
    async (level) => {
      const user = await createUser();
      const profile = await prisma.financialLiteracyProfile.create({
        data: { userId: user.id, level, assessedAt: T1 },
      });
      expect(profile.level).toBe(level);
    },
  );

  it("rejects an unknown level", async () => {
    const user = await createUser();
    await expectDatabaseError(
      prisma.$executeRaw`
        INSERT INTO financial_literacy_profiles (user_id, level)
        VALUES (${user.id}::uuid, 'EXPERT'::financial_literacy_level)`,
      { code: "P2010", message: "invalid input value for enum" },
    );
  });

  it.each(["", " 1", "v 2", "-1"])(
    "rejects the assessment version %j",
    async (assessmentVersion) => {
      const user = await createUser();
      await expectCheckViolation(
        prisma.financialLiteracyProfile.create({ data: { userId: user.id, assessmentVersion } }),
        "financial_literacy_profiles_assessment_version_format_check",
      );
    },
  );
});

describe("financial_literacy_topic_progress", () => {
  it("stores progress per user and topic", async () => {
    const user = await createUser();
    const progress = await prisma.financialLiteracyTopicProgress.create({
      data: {
        userId: user.id,
        topic: "SAVING",
        status: "IN_PROGRESS",
        startedAt: T1,
        lastActivityAt: T1,
      },
    });

    expect(progress).toMatchObject({ topic: "SAVING", status: "IN_PROGRESS", completedAt: null });
  });

  it("rejects a second row for the same user and topic", async () => {
    const user = await createUser();
    const data = {
      userId: user.id,
      topic: "BUDGETING" as const,
      status: "IN_PROGRESS" as const,
      startedAt: T1,
    };
    await prisma.financialLiteracyTopicProgress.create({ data });

    await expectDatabaseError(prisma.financialLiteracyTopicProgress.create({ data }), {
      code: "P2002",
    });
  });

  it("allows the same topic for different users", async () => {
    const a = await createUser();
    const b = await createUser();
    for (const user of [a, b]) {
      await prisma.financialLiteracyTopicProgress.create({
        data: {
          userId: user.id,
          topic: "SCAMS",
          status: "COMPLETED",
          startedAt: T1,
          completedAt: T2,
        },
      });
    }
    expect(await prisma.financialLiteracyTopicProgress.count()).toBe(2);
  });

  it("rejects progress for an unknown user", async () => {
    await expectDatabaseError(
      prisma.financialLiteracyTopicProgress.create({
        data: { userId: randomUUID(), topic: "SAVING", status: "IN_PROGRESS", startedAt: T1 },
      }),
      { code: "P2003" },
    );
  });

  it("rejects an unknown topic", async () => {
    const user = await createUser();
    await expectDatabaseError(
      prisma.$executeRaw`
        INSERT INTO financial_literacy_topic_progress (user_id, topic)
        VALUES (${user.id}::uuid, 'CRYPTO'::knowledge_category)`,
      { code: "P2010", message: "invalid input value for enum" },
    );
  });

  it.each([
    ["NOT_STARTED with a start time", { status: "NOT_STARTED", startedAt: T1 }],
    ["NOT_STARTED with a completion time", { status: "NOT_STARTED", completedAt: T1 }],
    ["IN_PROGRESS without a start time", { status: "IN_PROGRESS" }],
    [
      "IN_PROGRESS with a completion time",
      { status: "IN_PROGRESS", startedAt: T1, completedAt: T2 },
    ],
    ["COMPLETED without a start time", { status: "COMPLETED", completedAt: T2 }],
    ["COMPLETED without a completion time", { status: "COMPLETED", startedAt: T1 }],
  ] as const)("rejects %s", async (_case, values) => {
    const user = await createUser();
    await expectCheckViolation(
      prisma.financialLiteracyTopicProgress.create({
        data: { userId: user.id, topic: "SAVING", ...values },
      }),
      "financial_literacy_topic_progress_status_timestamps_check",
    );
  });

  it("rejects completion before the start", async () => {
    const user = await createUser();
    await expectCheckViolation(
      prisma.financialLiteracyTopicProgress.create({
        data: {
          userId: user.id,
          topic: "SAVING",
          status: "COMPLETED",
          startedAt: T2,
          completedAt: T1,
        },
      }),
      "financial_literacy_topic_progress_completed_after_started_check",
    );
  });

  it("accepts every valid lifecycle state", async () => {
    const user = await createUser();
    await prisma.financialLiteracyTopicProgress.createMany({
      data: [
        { userId: user.id, topic: "SAVING" },
        { userId: user.id, topic: "BUDGETING", status: "IN_PROGRESS", startedAt: T1 },
        { userId: user.id, topic: "SCAMS", status: "COMPLETED", startedAt: T1, completedAt: T1 },
      ],
    });
    expect(await prisma.financialLiteracyTopicProgress.count()).toBe(3);
  });
});
