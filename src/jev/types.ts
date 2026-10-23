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

/** Map of option label -> human description of that option (or null). */
export type ChoiceCriteria = Record<string, string | null>;

/** Ordered level descriptions for a Score question, lowest to highest. */
export type ScoreCriteria = string[];

/**
 * Optional criteria for a Noul question: descriptions keyed by `"true"` /
 * `"false"`. May be omitted entirely.
 */
export type NoulCriteria = Record<string, string | null>;

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: ChoiceCriteria;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: ScoreCriteria;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: NoulCriteria;
}

export type JevQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

/** Body sent to `POST /v1/systemone`. */
export interface JevDecideRequest {
  /** Model id; defaults to the client's configured model (`jev-latest`). */
  model?: string;
  state: JevState;
  questions: Record<string, JevQuestion>;
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

export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

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
