import type { ScamShieldAnalysisResponse, ScamShieldAnalyzeRequest } from "@finvoice/contracts";
import { analyzeScam, ScamShieldInputError, type ScamAnalysisResult } from "@finvoice/scam-shield";
import { Injectable } from "@nestjs/common";

import { AnalyticsRecorder, elapsedMs, errorCodeOf } from "../analytics/analytics-recorder.js";
import { ApiException } from "../common/api.exception.js";
import { KnowledgeService } from "../knowledge/knowledge.service.js";
import { citedSlugs, toScamShieldResponse } from "./scam-shield.mapper.js";

/**
 * ScamShield orchestration: the deterministic engine, then ONE knowledge-base query that resolves
 * every article the result cites.
 *
 * Privacy: the submitted content and the evidence exist only for the duration of the request.
 * ScamShield does not persist user-submitted content or analysis history. It may emit a
 * privacy-safe SCAM_ANALYSIS analytics event containing only typed operational metadata: language,
 * the selected content type, the final risk level, success and duration; never the content,
 * evidence or indicators. Nothing is logged, and nothing is sent to Gemini or any other external
 * service.
 * The engine is authoritative; nothing here changes its indicators, level or actions.
 */
@Injectable()
export class ScamShieldService {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly analytics: AnalyticsRecorder,
  ) {}

  async analyze(request: ScamShieldAnalyzeRequest): Promise<ScamShieldAnalysisResponse> {
    const started = performance.now();
    let result: ScamAnalysisResult | undefined;
    try {
      result = runEngine(request);
      const articles = await this.knowledge.getPublishedMany(citedSlugs(result), request.language);
      const response = toScamShieldResponse(result, articles);
      this.track(request, started, result);
      return response;
    } catch (error) {
      this.track(request, started, result, error);
      throw error;
    }
  }

  private track(
    request: ScamShieldAnalyzeRequest,
    started: number,
    result: ScamAnalysisResult | undefined,
    error?: unknown,
  ): void {
    this.analytics.record({
      eventType: "SCAM_ANALYSIS",
      source: "API",
      language: request.language,
      scamSourceType: request.sourceType,
      ...(result === undefined ? {} : { scamRiskLevel: result.riskLevel }),
      success: error === undefined,
      durationMs: elapsedMs(started),
      ...(error === undefined ? {} : { errorCode: errorCodeOf(error) }),
    });
  }
}

/**
 * Runs the engine. Input errors become 400s (the contract already checks the same rules). Any other
 * failure is replaced by an error that names only the error type: its message or stack could quote
 * the content, and the global error filter logs unexpected errors.
 */
function runEngine(request: ScamShieldAnalyzeRequest): ScamAnalysisResult {
  try {
    return analyzeScam(request);
  } catch (error) {
    if (error instanceof ScamShieldInputError) {
      throw ApiException.validation(
        error.issues.map((issue) => ({ field: issue.field, message: issue.message })),
      );
    }
    const type = error instanceof Error ? error.name : typeof error;
    throw new Error(`ScamShield analysis failed (${type})`);
  }
}
