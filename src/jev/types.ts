/**
 * Types for the TypeSafe AI "Jev" decision model API (System One).
 *
 * Jev never generates prose. You send it a `state` (text or structured JSON
 * describing a situation) plus a map of typed `questions`, and it returns
 * typed `answers` with calibrated probabilities.
 *
 * Endpoint: `POST https://api.typesafe.ai/v1/systemone`
 */

/** Any JSON-serialisable value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** The situation Jev should decide about: free text or structured JSON. */
export type JevState = string | { [key: string]: unknown } | unknown[];

/**
 * A Jev "entry": the shapes `instructions` and `criteria` accept.
 * Plain text, structured JSON (object or array), or null.
 * Any string may contain image references (see `JevImageAsset`).
 */
export type JevEntry =
  | string
  | { [key: string]: unknown }
  | unknown[]
  | null;

/** Map of option label -> description of that option (an entry). */
export type ChoiceCriteria = Record<string, JevEntry>;

/** Ordered level descriptions for a Score question, lowest to highest. */
export type ScoreCriteria = JevEntry[];

/**
 * Optional criteria for a Noul question: entries keyed by `"true"` /
 * `"false"`. May be omitted entirely.
 */
export type NoulCriteria = Record<string, JevEntry>;

export interface ChoiceQuestion {
  type: "choice";
  instructions: JevEntry;
  criteria: ChoiceCriteria;
}

export interface ScoreQuestion {
  type: "score";
  instructions: JevEntry;
  criteria: ScoreCriteria;
}

export interface NoulQuestion {
  type: "noul";
  instructions: JevEntry;
  criteria?: NoulCriteria;
}

/**
 * A Box question: find where something is in an image. Takes no criteria.
 * Requires an image in the request and a Jev 1.14 model
 * (`jev-1.14.0` or `jev-preview`).
 */
export interface BoxQuestion {
  type: "box";
  instructions: string;
}

export type JevQuestion =
  | ChoiceQuestion
  | ScoreQuestion
  | NoulQuestion
  | BoxQuestion;

/**
 * One image in a request's top-level `assets` map, keyed by its reference
 * string. The reference is written wherever the image belongs (in the
 * `state`, `instructions`, or `criteria` strings) and the API substitutes
 * the image there. This client sends images base64-encoded in the JSON
 * body; the API also accepts multipart uploads, which MCP tool calls
 * cannot use.
 */
export interface JevImageAsset {
  /** Asset kind. Optional; when sent it must be `"image"`. */
  kind?: "image";
  /** The image file, base64-encoded (standard alphabet, no `data:` prefix). */
  data_base64: string;
  /** Image format, lowercase: `"png"`, `"jpg"`, or `"jpeg"`. */
  format: "png" | "jpg" | "jpeg";
}

/** Body sent to `POST /v1/systemone`. */
export interface JevDecideRequest {
  /** Model id; defaults to the client's configured model (`jev-latest`). */
  model?: string;
  state: JevState;
  questions: Record<string, JevQuestion>;
  /** Images for this request, keyed by reference string. */
  assets?: Record<string, JevImageAsset>;
  /**
   * Opt into the 262k long-context limits with the
   * `TypeSafe-Danger-Zone-Long-Context: true` header.
   */
  longContext?: boolean;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  [key: string]: unknown;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  /** The level description the score refers to, when the API returns it. */
  legend?: unknown;
  confidence?: number;
  probabilities?: Record<string, number> | number[];
  [key: string]: unknown;
}

export interface NoulAnswer {
  type: "noul";
  /** Calibrated probability (0..1) that the proposition is true. */
  noul: number;
  [key: string]: unknown;
}

export interface BoxAnswer {
  type: "box";
  /** The four edges of the box, each a fraction from 0 to 1. */
  box: { top: number; bottom: number; left: number; right: number };
  confidence?: number;
  [key: string]: unknown;
}

export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer | BoxAnswer;

/** Response returned by `POST /v1/systemone`. Extra fields are tolerated. */
export interface JevDecideResponse {
  answers: Record<string, JevAnswer>;
  /** Resolved model id that produced the answers. */
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JevModelInfo {
  name: string;
  description?: string;
  release_date?: string;
  [key: string]: unknown;
}

/** Response returned by `GET /v1/models`. */
export interface JevListModelsResponse {
  models: JevModelInfo[];
  [key: string]: unknown;
}
