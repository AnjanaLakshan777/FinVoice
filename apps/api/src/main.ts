import { loadApiConfig } from "@finvoice/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
  Logger.log(`finvoice-api listening on http://${config.host}:${String(config.port)}`, "Bootstrap");
}

await bootstrap();
