import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadConfig, type TypesafeConfig } from "./config.js";
import { JevClient } from "./jev/client.js";
import type {
  ChoiceCriteria,
  JevQuestion,
  NoulCriteria,
  ScoreCriteria,
} from "./jev/types.js";

/** The question name used by the single-question convenience tools. */
const SINGLE_QUESTION_NAME = "answer";

/** A Jev `state`: free text, a JSON object, or a JSON array. */
const stateSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const criteriaValueSchema = z.union([z.string(), z.null()]);

/** One typed question for `jev_decide`, validated per question type. */
const questionSchema = z
  .object({
    type: z.enum(["choice", "score", "noul"]),
    instructions: z.string().min(1, "instructions must not be empty"),
    criteria: z.unknown().optional(),
  })
  .superRefine((question, ctx) => {
    const { type, criteria } = question;
    if (type === "choice") {
      if (!isPlainObject(criteria)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "choice questions require criteria: an object mapping each option label to a description string or null",
          path: ["criteria"],
        });
        return;
      }
      const count = Object.keys(criteria).length;
      if (count < 2 || count > 255) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `choice questions require between 2 and 255 options, got ${count}`,
          path: ["criteria"],
        });
      }
      for (const [label, value] of Object.entries(criteria)) {
        if (typeof value !== "string" && value !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `choice option "${label}" must map to a description string or null`,
            path: ["criteria", label],
          });
        }
      }
    } else if (type === "score") {
      if (
        !Array.isArray(criteria) ||
        criteria.length < 2 ||
        !criteria.every((level) => typeof level === "string")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "score questions require criteria: an array of at least 2 ordered level descriptions (strings)",
          path: ["criteria"],
        });
      }
    } else if (type === "noul") {
      if (criteria !== undefined) {
        if (!isPlainObject(criteria)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'noul criteria, when provided, must be an object such as { "true": "...", "false": "..." }',
            path: ["criteria"],
          });
        } else {
          for (const [label, value] of Object.entries(criteria)) {
            if (typeof value !== "string" && value !== null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `noul criteria "${label}" must map to a description string or null`,
                path: ["criteria", label],
              });
            }
          }
        }
      }
    }
  });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Convert a validated loose question into the typed Jev API shape. */
function toJevQuestion(question: z.infer<typeof questionSchema>): JevQuestion {
  switch (question.type) {
    case "choice":
      return {
        type: "choice",
        instructions: question.instructions,
        criteria: question.criteria as ChoiceCriteria,
      };
    case "score":
      return {
        type: "score",
        instructions: question.instructions,
        criteria: question.criteria as ScoreCriteria,
      };
    case "noul":
      return question.criteria === undefined
        ? { type: "noul", instructions: question.instructions }
        : {
            type: "noul",
            instructions: question.instructions,
            criteria: question.criteria as NoulCriteria,
          };
  }
}

function textResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export interface CreateServerOptions {
  config?: TypesafeConfig;
  client?: JevClient;
}

/**
 * Create the typesafe-mcp MCP server with all Jev tools registered.
 *
 * The server starts even when `TYPESAFE_API_KEY` is missing; in that case
 * every tool returns a clear error result naming the variable.
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfig();
  const client =
    options.client ??
    new JevClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });

  const server = new McpServer({
    name: "typesafe-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "jev_decide",
    {
      title: "Jev: decide (multiple typed questions)",
      description:
        "Ask TypeSafe AI's Jev decision model one or more typed questions " +
        "(choice, score and/or noul) about a state in a single call. Returns " +
        "typed answers with calibrated probabilities. The state may be text " +
        "or structured JSON.",
      inputSchema: {
        state: stateSchema.describe(
          "The situation to decide about: text, a JSON object, or a JSON array.",
        ),
        questions: z
          .record(z.string(), questionSchema)
          .refine(
            (questions) => Object.keys(questions).length >= 1,
            "at least one question is required",
          )
          .describe(
            "Map of question name to typed question. Each question has a " +
              "type (choice | score | noul), instructions, and criteria: " +
              "choice = object of option label -> description or null " +
              "(2-255 options); score = array of at least 2 ordered level " +
              "descriptions; noul = optional object of true/false descriptions.",
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
      },
    },
    async ({ state, questions, model }) => {
      try {
        const typed: Record<string, JevQuestion> = {};
        for (const [name, question] of Object.entries(questions)) {
          typed[name] = toJevQuestion(question);
        }
        const result = await client.decide({
          state,
          questions: typed,
          ...(model ? { model } : {}),
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "jev_choice",
    {
      title: "Jev: choice question",
      description:
        "Ask Jev a single Choice question: pick exactly one option from a " +
        "labelled set. Returns the chosen option, a confidence value, and " +
        "calibrated probabilities for every option. The answer is returned " +
        'under the question name "answer".',
      inputSchema: {
        state: stateSchema.describe(
          "The situation to decide about: text, a JSON object, or a JSON array.",
        ),
        instructions: z
          .string()
          .min(1)
          .describe("What Jev should decide, in plain language."),
        options: z
          .record(z.string(), criteriaValueSchema)
          .refine(
            (options) => {
              const count = Object.keys(options).length;
              return count >= 2 && count <= 255;
            },
            "choice questions require between 2 and 255 options",
          )
          .describe(
            "Object mapping each option label to a description string or null (2-255 options).",
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
      },
    },
    async ({ state, instructions, options, model }) => {
      try {
        const result = await client.decide({
          state,
          questions: {
            [SINGLE_QUESTION_NAME]: {
              type: "choice",
              instructions,
              criteria: options,
            },
          },
          ...(model ? { model } : {}),
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "jev_score",
    {
      title: "Jev: score question",
      description:
        "Ask Jev a single Score question: rate the state on an ordered scale " +
        "you define. Returns a numeric score, a confidence value, and " +
        "probabilities per level. The answer is returned under the question " +
        'name "answer".',
      inputSchema: {
        state: stateSchema.describe(
          "The situation to decide about: text, a JSON object, or a JSON array.",
        ),
        instructions: z
          .string()
          .min(1)
          .describe("What Jev should rate, in plain language."),
        levels: z
          .array(z.string())
          .min(2, "score questions require at least 2 levels")
          .describe(
            "Ordered level descriptions, lowest to highest (at least 2).",
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
      },
    },
    async ({ state, instructions, levels, model }) => {
      try {
        const result = await client.decide({
          state,
          questions: {
            [SINGLE_QUESTION_NAME]: {
              type: "score",
              instructions,
              criteria: levels,
            },
          },
          ...(model ? { model } : {}),
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "jev_noul",
    {
      title: "Jev: noul question",
      description:
        "Ask Jev a single Noul question: estimate the probability (0..1) " +
        "that a proposition about the state is true. Returns the calibrated " +
        'probability under the question name "answer".',
      inputSchema: {
        state: stateSchema.describe(
          "The situation to decide about: text, a JSON object, or a JSON array.",
        ),
        instructions: z
          .string()
          .min(1)
          .describe("The proposition Jev should assess, in plain language."),
        criteria: z
          .record(z.string(), criteriaValueSchema)
          .optional()
          .describe(
            'Optional descriptions keyed by "true" / "false" explaining what each outcome means.',
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
      },
    },
    async ({ state, instructions, criteria, model }) => {
      try {
        const result = await client.decide({
          state,
          questions: {
            [SINGLE_QUESTION_NAME]: {
              type: "noul",
              instructions,
              ...(criteria !== undefined ? { criteria } : {}),
            },
          },
          ...(model ? { model } : {}),
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "jev_list_models",
    {
      title: "Jev: list models",
      description:
        "List the TypeSafe AI models available to the configured API key " +
        "(name, description, release date).",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.listModels();
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
