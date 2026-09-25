import type { DependencyStatus, ServiceHealth, ServiceReadiness } from "@finvoice/shared";
import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";

export const API_SERVICE_NAME = "finvoice-api";

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Get()
  getHealth(): ServiceHealth {
    return { status: "ok", service: API_SERVICE_NAME };
  }

  /** Readiness: the API can reach PostgreSQL. Responds 503 when it cannot. */
  @Get("ready")
  async getReadiness(): Promise<ServiceReadiness> {
    const database = await this.checkDatabase();
    const readiness: ServiceReadiness = {
      status: database === "up" ? "ok" : "error",
      service: API_SERVICE_NAME,
      checks: { database },
    };

    if (readiness.status === "error") {
      throw new ServiceUnavailableException(readiness);
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
