import { Module } from "@nestjs/common";

import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { ScamShieldController } from "./scam-shield.controller.js";
import { ScamShieldService } from "./scam-shield.service.js";

/**
 * ScamShield API: the deterministic @finvoice/scam-shield engine plus knowledge-base enrichment.
 * Reads published knowledge only; persists no submitted content or analysis history (only a
 * typed SCAM_ANALYSIS analytics event).
 */
@Module({
  imports: [KnowledgeModule],
  controllers: [ScamShieldController],
  providers: [ScamShieldService],
})
export class ScamShieldModule {}
