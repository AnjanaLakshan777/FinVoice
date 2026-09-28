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

    expect(applied.map((row) => row.migration_name)).toEqual([
      "20260925180300_init_core_domain",
      "20260926081151_knowledge_base",
      "20260927120000_financial_literacy",
      "20260927200000_knowledge_fcrd_hotline",
      "20260927210000_knowledge_fcrd_hotline_summary",
      "20260927220000_analytics_events",
      "20260928063800_authentication",
    ]);

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

  it("creates only the intended knowledge base indexes and check constraints", async () => {
    const indexes = await prisma.$queryRaw<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('knowledge_sources', 'knowledge_articles', 'knowledge_article_translations')`;
    const checks = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid IN ('knowledge_sources'::regclass, 'knowledge_articles'::regclass,
                         'knowledge_article_translations'::regclass)`;

    expect(indexes.map((row) => row.name).sort()).toEqual(
      [
        "knowledge_sources_pkey",
        "knowledge_sources_url_key",
        "knowledge_articles_pkey",
        "knowledge_articles_slug_key",
        "knowledge_articles_status_category_idx",
        "knowledge_articles_source_id_idx",
        "knowledge_article_translations_pkey",
        "knowledge_article_translations_article_id_language_key",
      ].sort(),
    );
    expect(checks.map((row) => row.name).sort()).toEqual(
      [
        "knowledge_sources_url_https_check",
        "knowledge_sources_publisher_not_blank_check",
        "knowledge_sources_title_not_blank_check",
        "knowledge_sources_verified_after_retrieved_check",
        "knowledge_sources_review_after_verification_check",
        "knowledge_articles_slug_format_check",
        "knowledge_articles_published_has_source_check",
        "knowledge_articles_source_section_not_blank_check",
        "knowledge_articles_time_sensitive_review_dates_check",
        "knowledge_articles_review_order_check",
        "knowledge_article_translations_title_not_blank_check",
        "knowledge_article_translations_summary_not_blank_check",
        "knowledge_article_translations_body_not_blank_check",
        "knowledge_article_translations_keywords_not_null_check",
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

  it("creates the financial literacy tables with only the intended constraints and indexes", async () => {
    const constraints = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid IN ('financial_literacy_profiles'::regclass,
                         'financial_literacy_topic_progress'::regclass)
        AND contype IN ('p', 'f', 'c')`;
    const indexes = await prisma.$queryRaw<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('financial_literacy_profiles', 'financial_literacy_topic_progress')`;
    const enums = await prisma.$queryRaw<{ name: string; values: string }[]>`
      SELECT t.typname AS name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS values
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('financial_literacy_level', 'financial_literacy_topic_status')
      GROUP BY t.typname ORDER BY t.typname`;

    expect(constraints.map((row) => row.name).sort()).toEqual(
      [
        "financial_literacy_profiles_pkey",
        "financial_literacy_profiles_user_id_fkey",
        "financial_literacy_profiles_assessment_version_format_check",
        "financial_literacy_topic_progress_pkey",
        "financial_literacy_topic_progress_user_id_fkey",
        "financial_literacy_topic_progress_status_timestamps_check",
        "financial_literacy_topic_progress_completed_after_started_check",
      ].sort(),
    );
    // The unique (user_id, topic) index also serves "all progress of a user": no extra index.
    expect(indexes.map((row) => row.name).sort()).toEqual(
      [
        "financial_literacy_profiles_pkey",
        "financial_literacy_profiles_user_id_key",
        "financial_literacy_topic_progress_pkey",
        "financial_literacy_topic_progress_user_id_topic_key",
      ].sort(),
    );
    expect(enums).toEqual([
      { name: "financial_literacy_level", values: "BEGINNER,DEVELOPING,CONFIDENT" },
      { name: "financial_literacy_topic_status", values: "NOT_STARTED,IN_PROGRESS,COMPLETED" },
    ]);
  });

  it("creates the analytics table with only the intended constraints, indexes and columns", async () => {
    const constraints = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'analytics_events'::regclass AND contype IN ('p', 'f', 'c')`;
    const indexes = await prisma.$queryRaw<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'analytics_events'`;
    const columns = await prisma.$queryRaw<{ name: string; type: string }[]>`
      SELECT column_name AS name, udt_name AS type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'analytics_events'
      ORDER BY column_name`;

    expect(constraints.map((row) => row.name).sort()).toEqual(
      [
        "analytics_events_pkey",
        "analytics_events_duration_range_check",
        "analytics_events_error_only_on_failure_check",
        "analytics_events_scam_fields_check",
        "analytics_events_tool_name_check",
        "analytics_events_knowledge_category_check",
        "analytics_events_session_id_check",
      ].sort(),
    );
    // No foreign key: analytics rows are not linked to users or any other table.
    expect(indexes.map((row) => row.name).sort()).toEqual(
      [
        "analytics_events_pkey",
        "analytics_events_occurred_at_idx",
        "analytics_events_event_type_occurred_at_idx",
      ].sort(),
    );
    // Explicit, typed fields only: no user id, no text, no JSON metadata.
    expect(columns).toEqual([
      { name: "created_at", type: "timestamptz" },
      { name: "duration_ms", type: "int4" },
      { name: "error_code", type: "analytics_error_code" },
      { name: "event_type", type: "analytics_event_type" },
      { name: "id", type: "uuid" },
      { name: "knowledge_category", type: "knowledge_category" },
      { name: "language", type: "language" },
      { name: "occurred_at", type: "timestamptz" },
      { name: "scam_risk_level", type: "scam_risk_level" },
      { name: "scam_source_type", type: "scam_source_type" },
      { name: "session_id", type: "uuid" },
      { name: "source", type: "analytics_event_source" },
      { name: "success", type: "bool" },
      { name: "tool_name", type: "analytics_tool_name" },
    ]);
  });

  it("adds the user role (default USER) and the auth tables with only the intended structure", async () => {
    const [role] = await prisma.$queryRaw<{ type: string; nullable: string; fallback: string }[]>`
      SELECT udt_name AS type, is_nullable AS nullable, column_default AS fallback
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'`;
    const enums = await prisma.$queryRaw<{ name: string; values: string }[]>`
      SELECT t.typname AS name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS values
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'user_role'
      GROUP BY t.typname`;
    const constraints = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid IN ('otp_challenges'::regclass, 'auth_sessions'::regclass)
        AND contype IN ('p', 'f', 'c')`;
    const indexes = await prisma.$queryRaw<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('otp_challenges', 'auth_sessions')`;
    const columns = await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name || '.' || column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('otp_challenges', 'auth_sessions')`;

    expect(role).toEqual({ type: "user_role", nullable: "NO", fallback: "'USER'::user_role" });
    expect(enums).toEqual([{ name: "user_role", values: "USER,ADMIN" }]);
    expect(constraints.map((row) => row.name).sort()).toEqual(
      [
        "otp_challenges_pkey",
        "otp_challenges_phone_number_e164_check",
        "otp_challenges_code_hash_format_check",
        "otp_challenges_max_attempts_range_check",
        "otp_challenges_attempts_range_check",
        "otp_challenges_expires_after_created_check",
        "otp_challenges_single_outcome_check",
        "auth_sessions_pkey",
        "auth_sessions_user_id_fkey",
        "auth_sessions_refresh_token_hash_format_check",
        "auth_sessions_expires_after_created_check",
        "auth_sessions_replaced_is_revoked_check",
      ].sort(),
    );
    expect(indexes.map((row) => row.name).sort()).toEqual(
      [
        "otp_challenges_pkey",
        "otp_challenges_phone_number_created_at_idx",
        "otp_challenges_expires_at_idx",
        "auth_sessions_pkey",
        "auth_sessions_refresh_token_hash_key",
        "auth_sessions_user_id_idx",
        "auth_sessions_token_family_id_idx",
        "auth_sessions_expires_at_idx",
      ].sort(),
    );
    // Hashes only: no plaintext code or token, no message, no IP address, no user agent.
    expect(columns.map((row) => row.name).sort()).toEqual(
      [
        "otp_challenges.id",
        "otp_challenges.phone_number",
        "otp_challenges.code_hash",
        "otp_challenges.expires_at",
        "otp_challenges.attempts",
        "otp_challenges.max_attempts",
        "otp_challenges.created_at",
        "otp_challenges.consumed_at",
        "otp_challenges.superseded_at",
        "auth_sessions.id",
        "auth_sessions.user_id",
        "auth_sessions.refresh_token_hash",
        "auth_sessions.token_family_id",
        "auth_sessions.expires_at",
        "auth_sessions.revoked_at",
        "auth_sessions.last_used_at",
        "auth_sessions.replaced_by_session_id",
        "auth_sessions.created_at",
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
