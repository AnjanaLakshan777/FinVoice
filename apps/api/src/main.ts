import type { ApiConfig } from "@finvoice/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { API_CONFIG } from "./config/api-config.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get<ApiConfig>(API_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(`finvoice-api listening on http://${config.host}:${String(config.port)}`, "Bootstrap");
}

await bootstrap();
