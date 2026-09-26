import { Module } from "@nestjs/common";

import { KnowledgeController } from "./knowledge.controller.js";
import { KnowledgeService } from "./knowledge.service.js";

/** Read-only, source-backed financial-literacy knowledge. KnowledgeService is also used by the agent's tools. */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
