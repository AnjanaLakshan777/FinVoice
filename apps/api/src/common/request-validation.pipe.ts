import type { ApiErrorDetail } from "@finvoice/contracts";
import {
  Injectable,
  StandardSchemaValidationPipe,
  type ArgumentMetadata,
  type StandardSchemaValidationPipeOptions,
} from "@nestjs/common";

import { ApiException } from "./api.exception.js";

type Issue = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions["exceptionFactory"]>
>[0][number];

const VALIDATED_SOURCES = new Set<ArgumentMetadata["type"]>(["body", "query", "param"]);

/**
 * Global validation pipe. Validates every `@Body()`, `@Query()` and `@Param()` against the zod
 * schema passed to the decorator (`@Body({ schema })`), replaces the input with the parsed output,
 * and reports failures in the API error format.
 *
 * Fails closed: a body, query or route parameter declared *without* a schema is a programming
 * error, and the request fails with a 500 instead of passing unvalidated input to a handler.
 */
@Injectable()
export class RequestValidationPipe extends StandardSchemaValidationPipe {
  constructor() {
    super({ exceptionFactory: (issues) => ApiException.validation(issues.map(toErrorDetail)) });
  }

  override async transform<T = unknown>(value: T, metadata: ArgumentMetadata): Promise<T> {
    if (!metadata.schema && VALIDATED_SOURCES.has(metadata.type)) {
      throw new Error(`No validation schema declared for @${metadata.type}() input`);
    }
    return super.transform(value, metadata);
  }
}

function toErrorDetail(issue: Issue): ApiErrorDetail {
  const path = issue.path?.map((segment) =>
    typeof segment === "object" ? String(segment.key) : String(segment),
  );
  return { field: path?.length ? path.join(".") : null, message: issue.message };
}
