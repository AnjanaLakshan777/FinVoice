import {
  voiceSessionSetupQuerySchema,
  voiceToolExecutionRequestSchema,
  type VoiceSessionSetupQuery,
  type VoiceSessionSetupResponse,
  type VoiceToolExecutionRequest,
  type VoiceToolExecutionResponse,
} from "@finvoice/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  AnalyticsRecorder,
  elapsedMs,
  toolExecutionErrorCode,
} from "../../analytics/analytics-recorder.js";
import { InternalTokenGuard } from "../../common/internal-token.guard.js";
import {
  AGENT_VERSION,
  buildLiveSystemInstruction,
  MAX_TOOL_CALLS_PER_REQUEST,
} from "../agent/agent.prompt.js";
import { AgentToolRegistry } from "../tools/tool-registry.js";
import { withSpokenAmounts } from "./spoken-amounts.js";

/** Id given to tool calls from the voice gateway; the gateway keeps the provider's call ids. */
const VOICE_CALL_ID = "voice";

/**
 * Internal endpoints for the voice gateway (not part of the public /api/v1 API, token-protected).
 * They keep the prompt, the tool declarations and tool execution in one place, so the voice
 * gateway never touches the database or duplicates any business logic.
 */
@Controller("internal/voice")
@UseGuards(InternalTokenGuard)
export class VoiceInternalController {
  constructor(
    private readonly tools: AgentToolRegistry,
    private readonly analytics: AnalyticsRecorder,
  ) {}

  /** The server-controlled setup of a Live session in the requested language. */
  @Get("session-setup")
  sessionSetup(
    @Query({ schema: voiceSessionSetupQuerySchema }) query: VoiceSessionSetupQuery,
  ): VoiceSessionSetupResponse {
    return {
      agentVersion: AGENT_VERSION,
      language: query.language,
      systemInstruction: buildLiveSystemInstruction(query.language),
      tools: this.tools.declarations(),
      maxToolCallsPerTurn: MAX_TOOL_CALLS_PER_REQUEST,
    };
  }

  /**
   * Runs one tool call requested by the Live model, through the same registry as the text agent:
   * allowlist, Step 6 input contracts, finance engine and knowledge service. Problems caused by
   * the model (unknown tool, invalid arguments) are structured results, not HTTP errors.
   * Calculation results also carry `spokenAmounts` (the same amounts formatted for speech).
   * Counted here as a VOICE_TOOL_CALL analytics event (tool name, language, success, duration),
   * where the tool actually runs, so the gateway does not have to report it.
   */
  @Post("tools/execute")
  @HttpCode(HttpStatus.OK)
  async executeTool(
    @Body({ schema: voiceToolExecutionRequestSchema }) body: VoiceToolExecutionRequest,
  ): Promise<VoiceToolExecutionResponse> {
    const started = performance.now();
    const execution = await this.tools.execute(
      { id: VOICE_CALL_ID, name: body.name, arguments: body.arguments },
      { language: body.language },
    );
    const errorCode = toolExecutionErrorCode(execution);
    this.analytics.record({
      eventType: "VOICE_TOOL_CALL",
      source: "VOICE",
      language: body.language,
      ...(execution.tool === null ? {} : { toolName: execution.tool }),
      success: !execution.isError,
      durationMs: elapsedMs(started),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    return withSpokenAmounts(execution);
  }
}
