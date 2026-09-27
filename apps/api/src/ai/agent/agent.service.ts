import type {
  AgentChatCommand,
  AgentChatResponse,
  AgentToolName,
  AnalyticsErrorCode,
} from "@finvoice/contracts";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";

import {
  AnalyticsRecorder,
  elapsedMs,
  errorCodeOf,
  toolExecutionErrorCode,
} from "../../analytics/analytics-recorder.js";
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
 * durations, failure kinds), never the message, tool arguments or answers. Analytics events
 * (AGENT_REQUEST, AGENT_TOOL_CALL) likewise hold language, tool name, success and duration only.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LANGUAGE_MODEL) private readonly model: LanguageModel,
    private readonly tools: AgentToolRegistry,
    private readonly analytics: AnalyticsRecorder,
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
          this.trackRequest(language, started, "TOOL_LIMIT_REACHED");
          return this.response(TOOL_LIMIT_MESSAGE, language, usedTools);
        }

        const results: ModelToolResult[] = [];
        for (const call of turn.calls) {
          toolCalls += 1;
          const toolStarted = performance.now();
          const execution = await this.tools.execute(call, { language });
          const toolError = toolExecutionErrorCode(execution);
          this.analytics.record({
            eventType: "AGENT_TOOL_CALL",
            source: "API",
            language,
            ...(execution.tool === null ? {} : { toolName: execution.tool }),
            success: !execution.isError,
            durationMs: elapsedMs(toolStarted),
            ...(toolError === undefined ? {} : { errorCode: toolError }),
          });
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
      this.trackRequest(language, started);
      return this.response(turn.text, language, usedTools);
    } catch (error) {
      const failure = this.toApiException(error);
      this.trackRequest(language, started, errorCodeOf(failure));
      throw failure;
    }
  }

  private trackRequest(
    language: AgentChatCommand["language"],
    started: number,
    errorCode?: AnalyticsErrorCode,
  ): void {
    this.analytics.record({
      eventType: "AGENT_REQUEST",
      source: "API",
      language,
      success: errorCode === undefined,
      durationMs: elapsedMs(started),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
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
