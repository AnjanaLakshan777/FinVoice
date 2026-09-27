import type { IncomingMessage, ServerResponse } from "node:http";

import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { apiError } from "./common/api.exception.js";
import { RequestValidationPipe } from "./common/request-validation.pipe.js";

/**
 * Version prefix of the domain API. Health checks stay at the root for probes, and the internal
 * service-to-service endpoints stay outside the public API under /internal.
 */
export const API_PREFIX = "api/v1";

/** The body of every "no such route" response, inside or outside /api/v1. */
export const ROUTE_NOT_FOUND = apiError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Route not found");

/**
 * Applies the HTTP configuration shared by the running server and the tests, so tests exercise
 * exactly what runs in production, and initialises the application (registers its routes).
 */
export async function configureApp(app: NestExpressApplication): Promise<void> {
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
      // Every INTERNAL, token-protected route (voice setup and tools, user context).
      { path: "internal/{*path}", method: RequestMethod.ALL },
    ],
  });
  app.useGlobalPipes(new RequestValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
  app.disable("x-powered-by");

  // Nest answers unknown routes with its JSON 404 only under the global prefix (/api/v1). Paths
  // outside it (/internal/*, /health/*, anything else) would fall through to Express's HTML
  // "Cannot GET …" page. Once the routes are registered (init), a final handler gives those the
  // same JSON error format, without echoing the path.
  await app.init();
  app.use((_request: IncomingMessage, response: ServerResponse) => {
    response.statusCode = ROUTE_NOT_FOUND.statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(ROUTE_NOT_FOUND));
  });
}
