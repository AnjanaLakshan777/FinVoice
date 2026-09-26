import { Module } from "@nestjs/common";

import { KnowledgeController } from "./knowledge.controller.js";
import { KnowledgeService } from "./knowledge.service.js";

/** Read-only, source-backed financial-literacy knowledge. */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
