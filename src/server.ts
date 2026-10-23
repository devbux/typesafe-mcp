import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadConfig, type TypesafeConfig } from "./config.js";
import { JevClient } from "./jev/client.js";
import type {
  ChoiceCriteria,
  JevEntry,
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

/** A Jev entry: text, structured JSON (object or array), or null. */
const entrySchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);

/** Instructions for choice/score/noul: an entry; strings must not be empty. */
const instructionsSchema = z.union([
  z.string().min(1, "instructions must not be empty"),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);

function isEntryValue(value: unknown): boolean {
  return (
    value === null || typeof value === "string" || typeof value === "object"
  );
}

/**
 * Stack-safe base64 shape check: standard alphabet, `=` padding only at
 * the end, total length a multiple of 4, no whitespace. A single regex
 * over a multi-megabyte string can overflow the regex engine's stack,
 * so the character set is tested in chunks.
 */
function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (/\s/.test(value)) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const body = padding > 0 ? value.slice(0, -padding) : value;
  if (body.includes("=")) return false;
  for (let i = 0; i < body.length; i += 8192) {
    if (!/^[A-Za-z0-9+/]+$/.test(body.slice(i, i + 8192))) return false;
  }
  return true;
}

/** Images for a request, keyed by reference string (see the Images docs). */
const assetsSchema = z.record(
  z
    .string()
    .refine(
      (ref) => ref.trim().length > 0 && ref.length <= 1024,
      "asset references must be non-empty and at most 1024 characters",
    ),
  z.object({
    kind: z.literal("image").optional(),
    data_base64: z
      .string()
      .min(1)
      .refine(isValidBase64, {
        message:
          "data_base64 must be standard base64 with padding and no data: prefix",
      }),
    format: z.enum(["png", "jpg", "jpeg"]),
  }),
);

const ASSETS_DESCRIPTION =
  "Images keyed by reference string. Write each reference in the state, " +
  "instructions, or criteria where the image belongs. PNG or JPEG only, " +
  "base64-encoded with no data: prefix. API limits: 16 MiB per image, " +
  "280-1568 px per side.";

const longContextSchema = z
  .boolean()
  .optional()
  .describe(
    "Opt into Jev's 262k long-context limits (an experimental danger-zone " +
      "feature: slower and less accurate).",
  );

/** One typed question for `jev_decide`, validated per question type. */
const questionSchema = z
  .object({
    type: z.enum(["choice", "score", "noul", "box"]),
    instructions: z.unknown(),
    criteria: z.unknown().optional(),
  })
  .superRefine((question, ctx) => {
    const { type, criteria, instructions } = question;
    if (type === "box") {
      if (typeof instructions !== "string" || instructions.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "box questions require instructions: a non-empty string naming what to find and in which image",
          path: ["instructions"],
        });
      }
      if (criteria !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "box questions take no criteria",
          path: ["criteria"],
        });
      }
      return;
    }
    if (
      !isEntryValue(instructions) ||
      (typeof instructions === "string" && instructions.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "instructions must be a non-empty string, a structured object or array, or null",
        path: ["instructions"],
      });
      return;
    }
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
        if (!isEntryValue(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `choice option "${label}" must map to a description: a string, a structured object or array, or null`,
            path: ["criteria", label],
          });
        }
      }
    } else if (type === "score") {
      if (
        !Array.isArray(criteria) ||
        criteria.length < 2 ||
        !criteria.every((level) => isEntryValue(level))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "score questions require criteria: an array of at least 2 ordered level descriptions (strings or structured objects/arrays)",
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
            if (!isEntryValue(value)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `noul criteria "${label}" must map to a description: a string, a structured object or array, or null`,
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
        instructions: question.instructions as JevEntry,
        criteria: question.criteria as ChoiceCriteria,
      };
    case "score":
      return {
        type: "score",
        instructions: question.instructions as JevEntry,
        criteria: question.criteria as ScoreCriteria,
      };
    case "noul":
      return question.criteria === undefined
        ? { type: "noul", instructions: question.instructions as JevEntry }
        : {
            type: "noul",
            instructions: question.instructions as JevEntry,
            criteria: question.criteria as NoulCriteria,
          };
    case "box":
      return { type: "box", instructions: question.instructions as string };
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
    version: "0.2.1",
  });

  server.registerTool(
    "jev_decide",
    {
      title: "Jev: decide (multiple typed questions)",
      description:
        "Ask TypeSafe AI's Jev decision model one or more typed questions " +
        "(choice, score, noul and/or box) about a state in a single call. " +
        "Returns typed answers with calibrated probabilities. The state may " +
        "be text or structured JSON. Images: pass them in `assets` and " +
        "write each image's reference in the state, instructions, or " +
        "criteria where it belongs.",
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
              "type (choice | score | noul | box), instructions, and " +
              "criteria: choice = object of option label -> description " +
              "(string, structured object/array, or null; 2-255 options); " +
              "score = array of at least 2 ordered level descriptions " +
              "(strings or structured entries); noul = optional object of " +
              "true/false descriptions; box = instructions only, no " +
              "criteria (finds where something is in an image). " +
              "Instructions may be text or structured JSON.",
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
        assets: assetsSchema.optional().describe(ASSETS_DESCRIPTION),
        long_context: longContextSchema,
      },
    },
    async ({ state, questions, model, assets, long_context }) => {
      try {
        const typed: Record<string, JevQuestion> = {};
        for (const [name, question] of Object.entries(questions)) {
          typed[name] = toJevQuestion(question);
        }
        const result = await client.decide({
          state,
          questions: typed,
          ...(model ? { model } : {}),
          ...(assets ? { assets } : {}),
          ...(long_context ? { longContext: true } : {}),
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
        instructions: instructionsSchema.describe(
          "What Jev should decide: plain-language text, or structured JSON.",
        ),
        options: z
          .record(z.string(), entrySchema)
          .refine(
            (options) => {
              const count = Object.keys(options).length;
              return count >= 2 && count <= 255;
            },
            "choice questions require between 2 and 255 options",
          )
          .describe(
            "Object mapping each option label to a description (string, structured object/array, or null; 2-255 options). An option can be defined by example pictures: put image references in its description.",
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
        assets: assetsSchema.optional().describe(ASSETS_DESCRIPTION),
        long_context: longContextSchema,
      },
    },
    async ({ state, instructions, options, model, assets, long_context }) => {
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
          ...(assets ? { assets } : {}),
          ...(long_context ? { longContext: true } : {}),
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
        instructions: instructionsSchema.describe(
          "What Jev should rate: plain-language text, or structured JSON.",
        ),
        levels: z
          .array(entrySchema)
          .min(2, "score questions require at least 2 levels")
          .describe(
            "Ordered level descriptions, lowest to highest (at least 2). Each level may be a string or a structured entry, and may hold image references as examples.",
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
        assets: assetsSchema.optional().describe(ASSETS_DESCRIPTION),
        long_context: longContextSchema,
      },
    },
    async ({ state, instructions, levels, model, assets, long_context }) => {
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
          ...(assets ? { assets } : {}),
          ...(long_context ? { longContext: true } : {}),
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
        instructions: instructionsSchema.describe(
          "The proposition Jev should assess: plain-language text, or structured JSON.",
        ),
        criteria: z
          .record(z.string(), entrySchema)
          .optional()
          .describe(
            'Optional descriptions keyed by "true" / "false" explaining what each outcome means. Values may be strings, structured objects/arrays, or null, and may hold image references.',
          ),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional Jev model id override (default: jev-latest)."),
        assets: assetsSchema.optional().describe(ASSETS_DESCRIPTION),
        long_context: longContextSchema,
      },
    },
    async ({ state, instructions, criteria, model, assets, long_context }) => {
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
          ...(assets ? { assets } : {}),
          ...(long_context ? { longContext: true } : {}),
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "jev_box",
    {
      title: "Jev: box question (find where something is in an image)",
      description:
        "Ask Jev a single Box question: locate one target in an image. " +
        "Returns the box edges as fractions of the image size (top, " +
        "bottom, left, right, each 0..1) plus a confidence value, under " +
        'the question name "answer". The image must be in the request: ' +
        "reference it from the state or the instructions and pass it in " +
        "assets. Box needs Jev 1.14, so this tool sends jev-1.14.0 " +
        "unless you pass another model (jev-preview also works). " +
        "A Box answer is always a box, even when the target is absent; " +
        "pair it with jev_noul when you need a presence check.",
      inputSchema: {
        state: stateSchema.describe(
          "The situation: text, a JSON object, or a JSON array. Reference the image here (or in the instructions) where it belongs.",
        ),
        instructions: z
          .string()
          .min(1)
          .describe(
            'What to find, and in which image: e.g. "the coffee mug in `photo`".',
          ),
        assets: assetsSchema.optional().describe(ASSETS_DESCRIPTION),
        model: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional Jev model id override (default: jev-1.14.0, because Box requires Jev 1.14).",
          ),
        long_context: longContextSchema,
      },
    },
    async ({ state, instructions, assets, model, long_context }) => {
      try {
        const result = await client.decide({
          state,
          questions: {
            [SINGLE_QUESTION_NAME]: { type: "box", instructions },
          },
          model: model ?? "jev-1.14.0",
          ...(assets ? { assets } : {}),
          ...(long_context ? { longContext: true } : {}),
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
