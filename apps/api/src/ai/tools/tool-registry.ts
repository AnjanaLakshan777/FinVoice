import { AGENT_TOOL_NAMES, type AgentToolName } from "@finvoice/contracts";
import { FinanceValidationError } from "@finvoice/finance-engine";
import { Injectable, Logger } from "@nestjs/common";

import { KnowledgeService } from "../../knowledge/knowledge.service.js";
import type { JsonObject, ModelToolCall, ModelToolDeclaration } from "../model/language-model.js";
import { ToolInputError, type AgentTool, type ToolContext } from "./agent-tool.js";
import { createCalculationTools } from "./calculation.tools.js";
import { toJsonObject } from "./json.js";
import { createKnowledgeTools } from "./knowledge.tools.js";

export type ToolExecution = {
  /** The allowlisted tool that ran, or null when the name was not on the allowlist. */
  tool: AgentToolName | null;
  /** JSON sent back to the model: the tool's result, or a structured error. */
  result: JsonObject;
  isError: boolean;
};

/**
 * The only tools the model can use, and the only way they run. Transport-independent: the text
 * agent uses it today, and a future Live (voice) agent can use the same declarations and
 * `execute`.
 *
 * `execute` never throws for problems caused by the model: an unknown tool, invalid arguments or
 * a failing tool all become structured error results the model can react to (for example by
 * asking the user for a missing amount).
 */
@Injectable()
export class AgentToolRegistry {
  private readonly logger = new Logger(AgentToolRegistry.name);
  private readonly tools: ReadonlyMap<AgentToolName, AgentTool>;

  constructor(knowledge: KnowledgeService) {
    const tools = [...createKnowledgeTools(knowledge), ...createCalculationTools()];
    this.tools = new Map(tools.map((tool) => [tool.declaration.name, tool]));
    const missing = AGENT_TOOL_NAMES.filter((name) => !this.tools.has(name));
    if (missing.length > 0 || this.tools.size !== AGENT_TOOL_NAMES.length) {
      throw new Error("Agent tool registry does not match the AGENT_TOOL_NAMES allowlist");
    }
  }

  /** Declarations sent to the model, in allowlist order. */
  declarations(): ModelToolDeclaration[] {
    return AGENT_TOOL_NAMES.map((name) => this.lookup(name).declaration);
  }

  async execute(call: ModelToolCall, context: ToolContext): Promise<ToolExecution> {
    if (!isAllowedToolName(call.name)) {
      this.logger.warn("Model requested a tool that is not on the allowlist");
      return failure(
        null,
        "UNKNOWN_TOOL",
        "This tool does not exist. Use only the declared tools.",
      );
    }
    const name = call.name;
    const started = performance.now();
    try {
      const result = toJsonObject(await this.lookup(name).execute(call.arguments, context));
      this.logger.log(`Tool ${name} succeeded in ${elapsed(started)} ms`);
      return { tool: name, result, isError: false };
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof FinanceValidationError) {
        this.logger.log(`Tool ${name} rejected invalid arguments in ${elapsed(started)} ms`);
        return failure(
          name,
          "INVALID_ARGUMENTS",
          "The arguments are invalid. Fix them or ask the user for the missing or correct values.",
          error.issues.map(({ field, message }) => ({ field, message })),
        );
      }
      this.logger.error(
        `Tool ${name} failed in ${elapsed(started)} ms (${error instanceof Error ? error.name : "unknown error"})`,
      );
      return failure(
        name,
        "TOOL_FAILED",
        "The tool could not be completed. Do not guess the answer.",
      );
    }
  }

  private lookup(name: AgentToolName): AgentTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} is not registered`);
    }
    return tool;
  }
}

function isAllowedToolName(name: string): name is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

function failure(
  tool: AgentToolName | null,
  code: "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "TOOL_FAILED",
  message: string,
  issues?: { field: string | null; message: string }[],
): ToolExecution {
  return {
    tool,
    isError: true,
    result: { error: { code, message, ...(issues ? { issues } : {}) } },
  };
}

function elapsed(started: number): string {
  return (performance.now() - started).toFixed(0);
}
