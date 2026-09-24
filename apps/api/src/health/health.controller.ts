import type { ServiceHealth } from "@finvoice/shared";
import { Controller, Get } from "@nestjs/common";

export const API_SERVICE_NAME = "finvoice-api";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): ServiceHealth {
    return { status: "ok", service: API_SERVICE_NAME };
  }
}
