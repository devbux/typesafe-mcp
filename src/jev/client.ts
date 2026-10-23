import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "../config.js";
import type {
  JevDecideRequest,
  JevDecideResponse,
  JevListModelsResponse,
  JevQuestion,
} from "./types.js";

export type FetchLike = typeof fetch;

export interface JevClientOptions {
  /** API key. When missing, requests fail with a clear configuration error. */
  apiKey?: string;
  /** Base URL, default `https://api.typesafe.ai`. */
  baseUrl?: string;
  /** Default model id, default `jev-latest`. */
  model?: string;
  /** Fetch implementation (injectable for tests). Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Per-request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
}

/** Error raised for any Jev API failure. Never contains the API key. */
export class JevError extends Error {
  /** HTTP status code, when the failure came from an HTTP response. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevError";
    if (status !== undefined) {
      this.status = status;
    }
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class JevClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: JevClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Ask Jev one or more typed questions about a state.
   * Calls `POST /v1/systemone`.
   */
  async decide(request: JevDecideRequest): Promise<JevDecideResponse> {
    const questions: Record<string, JevQuestion> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      if (question.type === "noul" && question.criteria === undefined) {
        // Omit empty noul criteria entirely, as the API expects.
        const { criteria: _omitted, ...rest } = question;
        questions[name] = rest as JevQuestion;
      } else {
        questions[name] = question;
      }
    }

    const body = {
      model: request.model ?? this.model,
      state: request.state,
      questions,
    };

    const data = await this.requestJson<unknown>("/v1/systemone", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as { answers?: unknown }).answers !== "object" ||
      (data as { answers?: unknown }).answers === null
    ) {
      throw new JevError(
        "Unexpected response from the TypeSafe AI API: missing 'answers' object.",
      );
    }
    return data as JevDecideResponse;
  }

  /** List the models available to this API key. Calls `GET /v1/models`. */
  async listModels(): Promise<JevListModelsResponse> {
    const data = await this.requestJson<unknown>("/v1/models", {
      method: "GET",
    });

    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as { models?: unknown }).models)
    ) {
      throw new JevError(
        "Unexpected response from the TypeSafe AI API: missing 'models' array.",
      );
    }
    return data as JevListModelsResponse;
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new JevError(
        "TYPESAFE_API_KEY is not set. Set the TYPESAFE_API_KEY environment " +
          "variable to your TypeSafe AI API key and restart the server.",
      );
    }
    return this.apiKey;
  }

  private async requestJson<T>(
    path: string,
    init: { method: string; body?: string },
  ): Promise<T> {
    const apiKey = this.requireApiKey();
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new JevError(
          `Request to the TypeSafe AI API timed out after ${this.timeoutMs} ms.`,
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new JevError(`Network error calling the TypeSafe AI API: ${detail}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      throw new JevError(
        httpErrorMessage(response.status, parsed),
        response.status,
      );
    }

    if (parsed === undefined) {
      throw new JevError(
        `The TypeSafe AI API returned a non-JSON response (HTTP ${response.status}).`,
        response.status,
      );
    }
    return parsed as T;
  }
}

/** Build a clear, credential-free message for an HTTP error response. */
function httpErrorMessage(status: number, body: unknown): string {
  const serverDetail = extractServerMessage(body);
  const suffix = serverDetail ? ` ${serverDetail}` : "";

  switch (status) {
    case 400:
      return `TypeSafe AI API rejected the request (HTTP 400 Bad Request).${suffix}`;
    case 401:
      return (
        "TypeSafe AI API authentication failed (HTTP 401 Unauthorized). " +
        `Check that TYPESAFE_API_KEY is correct.${suffix}`
      );
    case 403:
      return (
        "TypeSafe AI API access forbidden (HTTP 403 Forbidden). " +
        `The API key may not have access to this model or endpoint.${suffix}`
      );
    case 404:
      return `TypeSafe AI API endpoint not found (HTTP 404).${suffix}`;
    case 429:
      return (
        "TypeSafe AI API rate limit exceeded (HTTP 429 Too Many Requests). " +
        `Wait a moment and try again.${suffix}`
      );
    default:
      if (status >= 500) {
        return `TypeSafe AI API server error (HTTP ${status}). Try again later.${suffix}`;
      }
      return `TypeSafe AI API request failed (HTTP ${status}).${suffix}`;
  }
}

/** Pull a short human-readable message out of an API error body, if present. */
function extractServerMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const candidates: unknown[] = [
    record.message,
    record.detail,
    typeof record.error === "string" ? record.error : undefined,
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>).message
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      // Keep messages short and single-line.
      return `Server said: ${candidate.trim().slice(0, 300)}`;
    }
  }
  return undefined;
}
