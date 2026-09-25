import { afterAll, describe, expect, inject, it } from "vitest";

import { createTestPrismaClient } from "./database.js";
import { runPrisma } from "./prisma-cli.js";

// The global setup has already run `prisma migrate deploy` against a fresh database.
describe("database migrations", () => {
  const databaseUrl = inject("databaseUrl");
  const prisma = createTestPrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("applied every migration successfully", async () => {
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;

    expect(applied.map((row) => row.migration_name)).toContain("20260925180300_init_core_domain");

    const status = runPrisma(["migrate", "status"], databaseUrl);
    expect(status.exitCode, status.stderr).toBe(0);
    expect(status.stdout).toContain("Database schema is up to date");
  });

  it("produces exactly the schema described by schema.prisma (no drift)", () => {
    const drift = runPrisma(
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      databaseUrl,
    );
    expect(drift.exitCode, `${drift.stdout}\n${drift.stderr}`).toBe(0);

    // Guard against a false pass: the same command must report a difference from an empty schema.
    const sanity = runPrisma(
      ["migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--exit-code"],
      databaseUrl,
    );
    expect(sanity.exitCode).toBe(2);
  });

  // Uniqueness is enforced by unique indexes (checked below), not listed here. NOT NULL
  // constraints (contype 'n', recorded in pg_constraint since PostgreSQL 18) are also excluded.
  it("creates every primary-key, foreign-key and check constraint", async () => {
    const constraints = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid IN ('users'::regclass, 'financial_profiles'::regclass, 'financial_goals'::regclass)
        AND contype IN ('p', 'f', 'c')`;

    expect(constraints.map((row) => row.name).sort()).toEqual(
      [
        "users_pkey",
        "users_phone_number_e164_check",
        "users_display_name_not_blank_check",
        "users_timezone_not_blank_check",
        "financial_profiles_pkey",
        "financial_profiles_user_id_fkey",
        "financial_profiles_currency_iso4217_check",
        "financial_profiles_monthly_income_non_negative_check",
        "financial_profiles_monthly_expenses_non_negative_check",
        "financial_goals_pkey",
        "financial_goals_user_id_fkey",
        "financial_goals_name_not_blank_check",
        "financial_goals_currency_iso4217_check",
        "financial_goals_target_amount_positive_check",
        "financial_goals_current_amount_non_negative_check",
        "financial_goals_current_amount_within_target_check",
      ].sort(),
    );
  });

  it("creates only the intended indexes", async () => {
    const indexes = await prisma.$queryRaw<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'financial_profiles', 'financial_goals')`;

    expect(indexes.map((row) => row.name).sort()).toEqual(
      [
        "users_pkey",
        "users_phone_number_key",
        "financial_profiles_pkey",
        "financial_profiles_user_id_key",
        "financial_goals_pkey",
        "financial_goals_user_id_status_target_date_idx",
        "financial_goals_status_target_date_idx",
      ].sort(),
    );
  });

  it("initialises the database with UTF-8 encoding and ICU collation", async () => {
    const [database] = await prisma.$queryRaw<{ encoding: string; provider: string }[]>`
      SELECT pg_encoding_to_char(encoding) AS encoding, datlocprovider::text AS provider
      FROM pg_database WHERE datname = current_database()`;

    expect(database).toEqual({ encoding: "UTF8", provider: "i" });
  });
});
