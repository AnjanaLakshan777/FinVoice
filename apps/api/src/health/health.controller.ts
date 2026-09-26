import type { DependencyStatus, ServiceHealth, ServiceReadiness } from "@finvoice/shared";
import { Controller, Get, HttpStatus, Logger, Res } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";

export const API_SERVICE_NAME = "finvoice-api";

/** The part of the HTTP response used to set the status code. */
type StatusResponse = { status(code: number): unknown };

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Get()
  getHealth(): ServiceHealth {
    return { status: "ok", service: API_SERVICE_NAME };
  }

  /**
   * Readiness: the API can reach PostgreSQL. Responds 503 with the same body shape when it cannot.
   * The status is set directly (not by throwing), because the global exception filter turns every
   * unexpected 5xx into a generic error body.
   */
  @Get("ready")
  async getReadiness(
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<ServiceReadiness> {
    const database = await this.checkDatabase();
    const readiness: ServiceReadiness = {
      status: database === "up" ? "ok" : "error",
      service: API_SERVICE_NAME,
      checks: { database },
    };

    if (readiness.status === "error") {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await this.prisma.ping();
      return "up";
    } catch (error) {
      // Log only the error class and code: driver messages can include connection details.
      this.logger.warn(`Database readiness check failed (${describeError(error)})`);
      return "down";
    }
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown error";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name}, code ${code}` : error.name;
}
