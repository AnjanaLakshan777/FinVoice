import { RequestMethod } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { RequestValidationPipe } from "./common/request-validation.pipe.js";

/** Version prefix of the domain API. Health checks stay at the root for probes. */
export const API_PREFIX = "api/v1";

/**
 * Applies the HTTP configuration shared by the running server and the tests, so tests exercise
 * exactly what runs in production.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(new RequestValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
  app.disable("x-powered-by");
}
