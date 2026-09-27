import { Module } from "@nestjs/common";

import { InternalTokenGuard } from "../../common/internal-token.guard.js";
import { AgentModule } from "../agent/agent.module.js";
import { VoiceInternalController } from "./voice-internal.controller.js";

/** Internal endpoints used by the voice gateway: /internal/voice/*. */
@Module({
  imports: [AgentModule],
  controllers: [VoiceInternalController],
  providers: [InternalTokenGuard],
})
export class VoiceInternalModule {}
