import { Injectable, Logger } from "@nestjs/common";

import { ApiException } from "../../common/api.exception.js";
import { FinancialContextService } from "../../financial-context/financial-context.service.js";
import type { JsonObject, ModelToolCall, ModelToolDeclaration } from "../model/language-model.js";
import { toJsonObject } from "./json.js";
import { TrustedUserContext } from "./trusted-user-context.js";

/**
 * Tools for a FUTURE authenticated agent to read the signed-in user's personal context.
 *
 * They are deliberately separate from AgentToolRegistry (the public agent's allowlist): the public
 * text agent and browser voice cannot declare or call them. They take no arguments at all. The
 * user comes only from a TrustedUserContext issued by server code, so a model or a client can
 * never choose whose data is read. Results contain no ids, phone numbers or credentials, and money
 * stays exact decimal strings.
 */
export const USER_CONTEXT_TOOL_NAMES = [
  "get_user_financial_context",
  "get_user_literacy_context",
] as const;
export type UserContextToolName = (typeof USER_CONTEXT_TOOL_NAMES)[number];

/** Sent with every result, so the boundary travels with the data. */
export const USER_CONTEXT_GUIDANCE =
  "Personal data of the signed-in user, for personalising explanations only. These are stored facts: do not infer anything beyond them, do not judge the user, and do not turn them into recommendations. A null amount means not provided, not zero. Calculations still come only from the calculation tools.";

const NO_PARAMETERS: JsonObject = { type: "object", properties: {}, additionalProperties: false };

const DECLARATIONS: readonly ModelToolDeclaration[] = [
  {
    name: "get_user_financial_context",
    description:
      "Get the signed-in user's stored financial context: preferred language, monthly income and expenses (if provided), active goals, financial-literacy level and topic progress, and which details are still missing. Takes no arguments.",
    parameters: NO_PARAMETERS,
  },
  {
    name: "get_user_literacy_context",
    description:
      "Get the signed-in user's financial-literacy level and the topics they have started or completed. Takes no arguments.",
    parameters: NO_PARAMETERS,
  },
];

export type UserContextToolExecution = {
  tool: UserContextToolName | null;
  result: JsonObject;
  isError: boolean;
};

@Injectable()
export class UserContextToolRegistry {
  private readonly logger = new Logger(UserContextToolRegistry.name);

  constructor(private readonly context: FinancialContextService) {}

  declarations(): ModelToolDeclaration[] {
    return [...DECLARATIONS];
  }

  /**
   * Runs one call for the user in `trusted`. Throws (a programming error, not a model error) if
   * `trusted` was not issued by the server.
   */
  async execute(
    call: ModelToolCall,
    trusted: TrustedUserContext,
  ): Promise<UserContextToolExecution> {
    if (!TrustedUserContext.isTrusted(trusted)) {
      throw new Error("User-context tools require a server-issued TrustedUserContext");
    }
    if (!isUserContextToolName(call.name)) {
      return failure(
        null,
        "UNKNOWN_TOOL",
        "This tool does not exist. Use only the declared tools.",
      );
    }
    const tool = call.name;
    if (!hasNoArguments(call.arguments)) {
      return failure(
        tool,
        "INVALID_ARGUMENTS",
        "This tool takes no arguments: the user is already known to FinVoice.",
      );
    }
    const started = performance.now();
    try {
      const context =
        tool === "get_user_financial_context"
          ? await this.context.getFinancialContext(trusted.userId)
          : await this.context.getLiteracyContext(trusted.userId);
      this.logger.log(`Tool ${tool} succeeded in ${elapsed(started)} ms`);
      return {
        tool,
        isError: false,
        result: toJsonObject({ guidance: USER_CONTEXT_GUIDANCE, context }),
      };
    } catch (error) {
      const notFound = error instanceof ApiException && error.body.statusCode === 404;
      this.logger.error(`Tool ${tool} failed in ${elapsed(started)} ms`);
      return failure(
        tool,
        "TOOL_FAILED",
        notFound
          ? "The signed-in user's context is not available."
          : "The tool could not be completed. Do not guess the user's details.",
      );
    }
  }
}

function isUserContextToolName(name: string): name is UserContextToolName {
  return (USER_CONTEXT_TOOL_NAMES as readonly string[]).includes(name);
}

function hasNoArguments(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function failure(
  tool: UserContextToolName | null,
  code: "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "TOOL_FAILED",
  message: string,
): UserContextToolExecution {
  return { tool, isError: true, result: { error: { code, message } } };
}

function elapsed(started: number): string {
  return (performance.now() - started).toFixed(0);
}
