import {
  scamShieldAnalyzeRequestSchema,
  type ScamShieldAnalysisResponse,
  type ScamShieldAnalyzeRequest,
} from "@finvoice/contracts";
import { Body, Controller, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { ScamShieldService } from "./scam-shield.service.js";
import { Public } from "../auth/auth.decorators.js";

/**
 * ScamShield: checks user-supplied content for scam warning indicators. No authentication: it only
 * analyses the submitted text and reads public knowledge, never account data. POST with 200
 * because nothing is created or stored. Responses quote parts of the content, so they must not be
 * cached.
 */
@Public()
@Controller("scamshield")
export class ScamShieldController {
  constructor(private readonly scamShield: ScamShieldService) {}

  @Post("analyze")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  analyze(
    @Body({ schema: scamShieldAnalyzeRequestSchema }) body: ScamShieldAnalyzeRequest,
  ): Promise<ScamShieldAnalysisResponse> {
    return this.scamShield.analyze(body);
  }
}
