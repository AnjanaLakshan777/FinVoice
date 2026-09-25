import type { ApiConfig } from "@finvoice/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { API_CONFIG } from "./config/api-config.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const config = app.get<ApiConfig>(API_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(`finvoice-api listening on http://${config.host}:${String(config.port)}`, "Bootstrap");
}

await bootstrap();
