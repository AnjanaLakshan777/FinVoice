-- Step 12 fix: a short grace period for the immediately previous refresh token.
--
-- Additive only: one nullable column and one CHECK constraint. No existing row changes (every
-- existing session has grace_reused_at NULL, which satisfies the check).
--
-- grace_reused_at is set once, atomically, when a token that was rotated moments ago (at most a
-- few seconds) is presented again by the same browser, for example because the page was reloaded
-- while its refresh request was in flight. A token can be grace-reused at most once; any other
-- use of a rotated token is still treated as reuse (token theft) and revokes the whole family.

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "grace_reused_at" TIMESTAMPTZ(3);

-- Only a rotated session (one with a known replacement) can ever have been grace-reused.
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_grace_reuse_requires_replacement_check"
  CHECK ("grace_reused_at" IS NULL OR "replaced_by_session_id" IS NOT NULL);
