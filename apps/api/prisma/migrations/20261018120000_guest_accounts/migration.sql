-- Guest accounts: FinVoice no longer uses phone numbers or OTP codes to sign in.
--
-- A user is now a guest account created from a preferred language only, reachable through the
-- refresh cookie of the browser that created it (see docs/architecture/authentication-authorization.md).
--
-- DESTRUCTIVE by design:
-- - users.phone_number is dropped, deleting every stored phone number (FinVoice should not keep
--   them). Existing users and their profiles and goals stay, but can no longer sign in, so
--   `pnpm auth:cleanup` deletes them once they have no usable session.
-- - otp_challenges is dropped with all its rows (hashed codes for phone numbers).
-- Rolling back cannot restore the deleted phone numbers or challenges.

-- AlterTable: the phone number, its uniqueness and its E.164 check.
ALTER TABLE "users" DROP CONSTRAINT "users_phone_number_e164_check";
DROP INDEX "users_phone_number_key";
ALTER TABLE "users" DROP COLUMN "phone_number";

-- Guest-creation rate limit (accounts created in the last window) and cleanup by age.
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- DropTable: OTP challenges, with their indexes and checks.
DROP TABLE "otp_challenges";
