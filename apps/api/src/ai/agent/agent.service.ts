import type { AgentChatCommand, AgentChatResponse, AgentToolName } from "@finvoice/contracts";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";

import { ApiException } from "../../common/api.exception.js";
import {
  LANGUAGE_MODEL,
  LanguageModelError,
  type LanguageModel,
  type ModelToolResult,
  type ModelTurn,
} from "../model/language-model.js";
import { AgentToolRegistry } from "../tools/tool-registry.js";
import {
  AGENT_VERSION,
  buildSystemInstruction,
  MAX_TOOL_CALLS_PER_REQUEST,
} from "./agent.prompt.js";

/** Returned instead of an answer when the model exceeds the tool-call limit. */
export const TOOL_LIMIT_MESSAGE =
  "Sorry, I could not complete this request. Please ask one simpler question at a time.";

/**
 * Answers one message: runs the model, executes the tools it requests (validated, allowlisted,
 * at most MAX_TOOL_CALLS_PER_REQUEST), sends the results back, and returns the final text.
 *
 * Nothing is stored. Logs contain operational facts only (language, sizes, tool names,
 * durations, failure kinds), never the message, tool arguments or answers.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LANGUAGE_MODEL) private readonly model: LanguageModel,
    private readonly tools: AgentToolRegistry,
  ) {}

  async chat(command: AgentChatCommand): Promise<AgentChatResponse> {
    const started = performance.now();
    const { language } = command;
    this.logger.log(
      `Agent request started (language ${language}, ${String(command.message.length)} characters)`,
    );

    const usedTools: AgentToolName[] = [];
    let toolCalls = 0;
    try {
      const conversation = this.model.startConversation({
        systemInstruction: buildSystemInstruction(language),
        tools: this.tools.declarations(),
        userMessage: command.message,
      });

      let turn: ModelTurn = await conversation.next([]);
      while (turn.type === "tool_calls") {
        if (toolCalls + turn.calls.length > MAX_TOOL_CALLS_PER_REQUEST) {
          this.logger.warn(
            `Agent request stopped: more than ${String(MAX_TOOL_CALLS_PER_REQUEST)} tool calls`,
          );
          return this.response(TOOL_LIMIT_MESSAGE, language, usedTools);
        }

        const results: ModelToolResult[] = [];
        for (const call of turn.calls) {
          toolCalls += 1;
          const execution = await this.tools.execute(call, { language });
          if (execution.tool && !execution.isError && !usedTools.includes(execution.tool)) {
            usedTools.push(execution.tool);
          }
          results.push({
            callId: call.id,
            name: call.name,
            result: execution.result,
            isError: execution.isError,
          });
        }
        turn = await conversation.next(results);
      }

      this.logger.log(
        `Agent request completed in ${(performance.now() - started).toFixed(0)} ms (${String(toolCalls)} tool calls)`,
      );
      return this.response(turn.text, language, usedTools);
    } catch (error) {
      throw this.toApiException(error);
    }
  }

  private response(
    message: string,
    language: AgentChatCommand["language"],
    usedTools: AgentToolName[],
  ): AgentChatResponse {
    return { message, language, agentVersion: AGENT_VERSION, usedTools };
  }

  /** Model failures become 503 (not configured / temporary) or 502 (provider error). */
  private toApiException(error: unknown): unknown {
    if (!(error instanceof LanguageModelError)) {
      return error;
    }
    this.logger.warn(
      `Language model failure: ${error.failure}${error.status === undefined ? "" : ` (HTTP ${String(error.status)})`}`,
    );
    switch (error.failure) {
      case "not_configured":
        return new ApiException({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: "SERVICE_UNAVAILABLE",
          message: "The AI assistant is not configured",
        });
      case "unavailable":
        return new ApiException({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: "SERVICE_UNAVAILABLE",
          message: "The AI assistant is temporarily unavailable. Please try again later.",
        });
      case "upstream":
        return new ApiException({
          statusCode: HttpStatus.BAD_GATEWAY,
          code: "BAD_GATEWAY",
          message: "The AI assistant could not complete the request",
        });
    }
  }
}
