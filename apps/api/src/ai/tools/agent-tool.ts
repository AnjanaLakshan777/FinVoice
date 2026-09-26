import type { AgentLanguage, AgentToolName } from "@finvoice/contracts";
import type { z } from "zod";

import type { JsonObject, ModelToolDeclaration } from "../model/language-model.js";

/** Request-level context available to every tool (never supplied by the model). */
export type ToolContext = {
  /** The language the user asked to be answered in; the default for knowledge lookups. */
  language: AgentLanguage;
};

/** Thrown when the model's arguments do not satisfy the tool's input contract. */
export class ToolInputError extends Error {
  constructor(readonly issues: { field: string | null; message: string }[]) {
    super("Invalid tool arguments");
    this.name = "ToolInputError";
  }
}

/** A tool the agent may use: its declaration for the model and its server-side execution. */
export type AgentTool = {
  declaration: ModelToolDeclaration & { name: AgentToolName };
  /** Validates the untrusted arguments, then runs the tool. Returns plain data. */
  execute(rawArguments: unknown, context: ToolContext): Promise<unknown>;
};

/**
 * Defines a tool whose arguments are validated against a contract schema before `run` is
 * called: `run` only ever receives valid input.
 */
export function defineTool<TSchema extends z.ZodType>(definition: {
  name: AgentToolName;
  description: string;
  parameters: JsonObject;
  input: TSchema;
  run: (input: z.output<TSchema>, context: ToolContext) => unknown;
}): AgentTool {
  return {
    declaration: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
    execute: async (rawArguments, context) => {
      const parsed = definition.input.safeParse(rawArguments ?? {});
      if (!parsed.success) {
        throw new ToolInputError(
          parsed.error.issues.map((issue) => ({
            field: issue.path.length > 0 ? issue.path.map(String).join(".") : null,
            message: issue.message,
          })),
        );
      }
      return await definition.run(parsed.data, context);
    },
  };
}
