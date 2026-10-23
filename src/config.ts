/**
 * Environment configuration for the typesafe-mcp server.
 *
 * - `TYPESAFE_API_KEY`  — Bearer token for the TypeSafe AI API. Optional at
 *   startup: the server must be able to start (and list its tools) without a
 *   key; tools return a clear error naming this variable when it is missing.
 * - `TYPESAFE_BASE_URL` — API base URL (default `https://api.typesafe.ai`).
 * - `TYPESAFE_JEV_MODEL` — Jev model id to request (default `jev-latest`).
 */

export interface TypesafeConfig {
  /** API key, or `undefined` when `TYPESAFE_API_KEY` is not set. */
  apiKey?: string;
  /** Base URL of the TypeSafe AI API, without a trailing slash. */
  baseUrl: string;
  /** Jev model identifier sent with each decision request. */
  model: string;
}

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): TypesafeConfig {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  const baseUrlRaw = env.TYPESAFE_BASE_URL?.trim();
  const model = env.TYPESAFE_JEV_MODEL?.trim();

  return {
    ...(apiKey ? { apiKey } : {}),
    baseUrl: (baseUrlRaw ? baseUrlRaw : DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: model ? model : DEFAULT_MODEL,
  };
}
