import { AGENT_TOOL_NAMES, type FinancialContextResponse } from "@finvoice/contracts";
import { describe, expect, it, vi } from "vitest";

import { AgentToolRegistry } from "../../src/ai/tools/tool-registry.js";
import { TrustedUserContext } from "../../src/ai/tools/trusted-user-context.js";
import {
  USER_CONTEXT_GUIDANCE,
  USER_CONTEXT_TOOL_NAMES,
  UserContextToolRegistry,
} from "../../src/ai/tools/user-context.tools.js";
import { ApiException } from "../../src/common/api.exception.js";
import type { FinancialContextService } from "../../src/financial-context/financial-context.service.js";
import type { KnowledgeService } from "../../src/knowledge/knowledge.service.js";

const USER_ID = "0190f0a0-0000-7000-8000-000000000001";

const CONTEXT: FinancialContextResponse = {
  user: { preferredLanguage: "EN", timezone: "Asia/Colombo" },
  profile: { monthlyIncome: "150000.00", monthlyExpenses: null, currency: "LKR" },
  goals: [],
  moreActiveGoals: false,
  literacy: { level: "BEGINNER", assessmentVersion: "1", assessedAt: null, topics: [] },
  completeness: { profileComplete: false, missingFields: ["monthlyExpenses", "activeGoal"] },
};

function registry() {
  const service = {
    getFinancialContext: vi.fn(() => Promise.resolve(CONTEXT)),
    getLiteracyContext: vi.fn(() =>
      Promise.resolve({ level: "BEGINNER", assessmentVersion: "1", assessedAt: null, topics: [] }),
    ),
  };
  return {
    service,
    tools: new UserContextToolRegistry(service as unknown as FinancialContextService),
  };
}

const call = (name: string, args: unknown = {}) => ({ id: "c1", name, arguments: args });

describe("user-context tools", () => {
  it("are not available to the public agent", async () => {
    const publicRegistry = new AgentToolRegistry({} as KnowledgeService);
    const publicNames = publicRegistry.declarations().map((declaration) => declaration.name);

    for (const name of USER_CONTEXT_TOOL_NAMES) {
      expect(publicNames).not.toContain(name);
      expect(AGENT_TOOL_NAMES as readonly string[]).not.toContain(name);
      const execution = await publicRegistry.execute(call(name, { userId: USER_ID }), {
        language: "EN",
      });
      expect(execution.result).toMatchObject({ error: { code: "UNKNOWN_TOOL" } });
    }
  });

  it("declare no parameters, so a model cannot name a user", () => {
    const { tools } = registry();
    for (const declaration of tools.declarations()) {
      expect(declaration.parameters).toEqual({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
    }
  });

  it("require a server-issued trusted context", async () => {
    const { tools, service } = registry();
    const forged = { userId: USER_ID } as unknown as TrustedUserContext;

    await expect(tools.execute(call("get_user_financial_context"), forged)).rejects.toThrow(
      "server-issued TrustedUserContext",
    );
    expect(service.getFinancialContext).not.toHaveBeenCalled();
    expect(TrustedUserContext.isTrusted(forged)).toBe(false);
  });

  it.each([{ userId: "someone-else" }, { user: "x" }, [USER_ID], "userId"])(
    "reject any argument (%j) instead of reading another user",
    async (args) => {
      const { tools, service } = registry();
      const execution = await tools.execute(
        call("get_user_financial_context", args),
        TrustedUserContext.fromAuthenticatedUser(USER_ID),
      );

      expect(execution).toMatchObject({
        isError: true,
        result: { error: { code: "INVALID_ARGUMENTS" } },
      });
      expect(service.getFinancialContext).not.toHaveBeenCalled();
    },
  );

  it("read the trusted user's minimised context", async () => {
    const { tools, service } = registry();
    const execution = await tools.execute(
      call("get_user_financial_context"),
      TrustedUserContext.fromAuthenticatedUser(USER_ID),
    );

    expect(service.getFinancialContext).toHaveBeenCalledWith(USER_ID);
    expect(execution).toEqual({
      tool: "get_user_financial_context",
      isError: false,
      result: { guidance: USER_CONTEXT_GUIDANCE, context: CONTEXT },
    });
    expect(JSON.stringify(execution.result)).not.toContain(USER_ID);
  });

  it("read the literacy context", async () => {
    const { tools, service } = registry();
    const execution = await tools.execute(
      call("get_user_literacy_context", null),
      TrustedUserContext.fromAuthenticatedUser(USER_ID),
    );

    expect(service.getLiteracyContext).toHaveBeenCalledWith(USER_ID);
    expect(execution.isError).toBe(false);
  });

  it("answer unknown names and failures with structured errors", async () => {
    const { tools, service } = registry();
    const trusted = TrustedUserContext.fromAuthenticatedUser(USER_ID);
    service.getFinancialContext.mockRejectedValueOnce(ApiException.notFound("User not found"));

    expect((await tools.execute(call("update_user_income"), trusted)).result).toMatchObject({
      error: { code: "UNKNOWN_TOOL" },
    });
    const failed = await tools.execute(call("get_user_financial_context"), trusted);
    expect(failed.result).toMatchObject({ error: { code: "TOOL_FAILED" } });
    expect(JSON.stringify(failed.result)).not.toContain(USER_ID);
  });
});
