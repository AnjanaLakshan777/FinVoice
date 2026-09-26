import { Module } from "@nestjs/common";

import { KnowledgeModule } from "../../knowledge/knowledge.module.js";
import { GeminiModule } from "../gemini/gemini.module.js";
import { AgentToolRegistry } from "../tools/tool-registry.js";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";

/** The FinVoice text agent: POST /api/v1/agent/chat. */
@Module({
  imports: [GeminiModule, KnowledgeModule],
  controllers: [AgentController],
  providers: [AgentToolRegistry, AgentService],
  exports: [AgentToolRegistry],
})
export class AgentModule {}
