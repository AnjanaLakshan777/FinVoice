import {
  agentChatRequestSchema,
  type AgentChatCommand,
  type AgentChatResponse,
} from "@finvoice/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { AgentService } from "./agent.service.js";
import { Public } from "../../auth/auth.decorators.js";

/** Text chat with the FinVoice agent. Stateless: one message in, one answer out. */
@Public()
@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post("chat")
  @HttpCode(HttpStatus.OK)
  chat(
    @Body({ schema: agentChatRequestSchema }) body: AgentChatCommand,
  ): Promise<AgentChatResponse> {
    return this.agent.chat(body);
  }
}
