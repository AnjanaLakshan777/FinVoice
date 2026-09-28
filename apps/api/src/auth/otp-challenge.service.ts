import { randomUUID } from "node:crypto";

import type { ApiConfig } from "@finvoice/config";
import { AUTH_ERROR_MESSAGES } from "@finvoice/contracts";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { ApiException, apiError } from "../common/api.exception.js";
import { API_CONFIG } from "../config/api-config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { hashOtp, otpMatches } from "./auth-crypto.js";

export type CreatedChallenge = { challengeId: string; code: string; expiresAt: Date };

/**
 * OTP challenges (otp_challenges). Stores only HMAC-SHA-256(AUTH_OTP_PEPPER, "<id>:<code>"), the
 * phone number, timestamps and the attempt counter: no plaintext code, no message, no delivery
 * response, no IP address, no user agent.
 *
 * Every state change is a single conditional statement, so concurrent requests cannot bypass the
 * attempt limit or use a code twice.
 */
@Injectable()
export class OtpChallengeService {
  private readonly pepper: string | null;
  private readonly otp: ApiConfig["auth"]["otp"];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.pepper = config.auth.enabled ? config.auth.otpPepper : null;
    this.otp = config.auth.otp;
  }

  get ttlSeconds(): number {
    return this.otp.ttlSeconds;
  }

  /**
   * Creates a challenge for `phoneNumber` with `code`, after the rate limit check, and supersedes
   * the phone's still-active challenges (only the newest code is ever valid).
   *
   * Rate limit: at most AUTH_OTP_REQUEST_LIMIT challenges per phone number per
   * AUTH_OTP_REQUEST_WINDOW_SECONDS, counted from this table (no IP addresses, no Redis). A
   * transaction-scoped advisory lock per phone number serialises concurrent requests for the same
   * number, so they cannot all pass the count at once. Throws 429 when exceeded.
   */
  async create(
    phoneNumber: string,
    code: string,
    now: Date = new Date(),
  ): Promise<CreatedChallenge> {
    const pepper = this.requirePepper();
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + this.otp.ttlSeconds * 1000);
    const windowStart = new Date(now.getTime() - this.otp.requestWindowSeconds * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`otp-request:${phoneNumber}`}, 0))`;
      const recent = await tx.otpChallenge.count({
        where: { phoneNumber, createdAt: { gt: windowStart } },
      });
      if (recent >= this.otp.requestLimit) {
        throw new ApiException(
          apiError(
            HttpStatus.TOO_MANY_REQUESTS,
            "TOO_MANY_REQUESTS",
            AUTH_ERROR_MESSAGES.tooManyOtpRequests,
          ),
        );
      }
      await tx.otpChallenge.updateMany({
        where: { phoneNumber, consumedAt: null, supersededAt: null, expiresAt: { gt: now } },
        data: { supersededAt: now },
      });
      await tx.otpChallenge.create({
        data: {
          id: challengeId,
          phoneNumber,
          codeHash: hashOtp(pepper, challengeId, code),
          expiresAt,
          maxAttempts: this.otp.maxAttempts,
          createdAt: now,
        },
      });
    });
    return { challengeId, code, expiresAt };
  }

  /** Invalidates a challenge whose code could not be delivered. */
  async abandon(challengeId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, supersededAt: null },
      data: { supersededAt: now },
    });
  }

  /**
   * Checks `code` against the challenge and consumes it. Returns the challenge's phone number on
   * success, null on any failure (unknown, expired, superseded, consumed, out of attempts, or
   * wrong code): callers answer every failure identically.
   *
   * 1. Reserve an attempt: one conditional UPDATE increments `attempts` only while the challenge
   *    is usable and attempts < max_attempts. Concurrent guesses each take a slot, so no more than
   *    max_attempts codes are ever compared, and an exhausted challenge stays exhausted (a correct
   *    code after the limit fails too).
   * 2. Compare the HMAC in constant time.
   * 3. Consume: one conditional UPDATE sets consumed_at only if it is still null, so of several
   *    concurrent correct submissions exactly one succeeds.
   */
  async verify(challengeId: string, code: string, now: Date = new Date()): Promise<string | null> {
    const pepper = this.requirePepper();
    const [challenge] = await this.prisma.otpChallenge.updateManyAndReturn({
      where: {
        id: challengeId,
        consumedAt: null,
        supersededAt: null,
        expiresAt: { gt: now },
        attempts: { lt: this.prisma.otpChallenge.fields.maxAttempts },
      },
      data: { attempts: { increment: 1 } },
      select: { id: true, phoneNumber: true, codeHash: true },
    });
    if (challenge === undefined || !otpMatches(pepper, challenge.id, code, challenge.codeHash)) {
      return null;
    }
    const { count } = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, supersededAt: null },
      data: { consumedAt: now },
    });
    return count === 1 ? challenge.phoneNumber : null;
  }

  private requirePepper(): string {
    if (this.pepper === null) {
      throw new Error("AUTH_OTP_PEPPER is not configured");
    }
    return this.pepper;
  }
}
