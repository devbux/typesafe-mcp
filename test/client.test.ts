import { describe, expect, it, vi } from "vitest";

import { JevClient, JevError, type FetchLike } from "../src/jev/client.js";
import { loadConfig } from "../src/config.js";

interface CapturedCall {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a fake fetch that records its calls and delegates to a responder. */
function fakeFetch(responder: (call: CapturedCall) => Response | Promise<Response>) {
  const calls: CapturedCall[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call: CapturedCall = {
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return responder(call);
  });
  return { impl: impl as unknown as FetchLike, calls };
}

const sampleAnswers = {
  answers: {
    department: {
      type: "choice",
      choice: "billing",
      confidence: 0.91,
      probabilities: { billing: 0.91, technical: 0.06, sales: 0.03 },
    },
    urgency: {
      type: "score",
      score: 4,
      confidence: 0.8,
      probabilities: { "1": 0.02, "2": 0.05, "3": 0.13, "4": 0.55, "5": 0.25 },
    },
    refund_likely: { type: "noul", noul: 0.72 },
  },
  model: "jev-1.13.0",
  usage: { input_tokens: 120, output_tokens: 45 },
};

describe("JevClient.decide", () => {
  it("posts to /v1/systemone with auth headers and the exact body shape for mixed question types", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, sampleAnswers));
    const client = new JevClient({ apiKey: "test-key-123", fetchImpl: impl });

    const result = await client.decide({
      state: "Customer says they were charged twice and wants their money back.",
      questions: {
        department: {
          type: "choice",
          instructions: "Which department should handle this ticket?",
          criteria: { billing: "Billing and payment issues", technical: null, sales: null },
        },
        urgency: {
          type: "score",
          instructions: "How urgent is this ticket?",
          criteria: ["not urgent", "low", "medium", "high", "critical"],
        },
        refund_likely: {
          type: "noul",
          instructions: "Is this customer likely to request a refund?",
        },
      },
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.method).toBe("POST");
    expect(call?.headers.Authorization).toBe("Bearer test-key-123");
    expect(call?.headers["Content-Type"]).toBe("application/json");
    expect(call?.body).toEqual({
      model: "jev-latest",
      state: "Customer says they were charged twice and wants their money back.",
      questions: {
        department: {
          type: "choice",
          instructions: "Which department should handle this ticket?",
          criteria: { billing: "Billing and payment issues", technical: null, sales: null },
        },
        urgency: {
          type: "score",
          instructions: "How urgent is this ticket?",
          criteria: ["not urgent", "low", "medium", "high", "critical"],
        },
        // noul without criteria must omit the criteria key entirely
        refund_likely: {
          type: "noul",
          instructions: "Is this customer likely to request a refund?",
        },
      },
    });

    expect(result.answers.department).toMatchObject({ type: "choice", choice: "billing" });
    expect(result.answers.urgency).toMatchObject({ type: "score", score: 4 });
    expect(result.answers.refund_likely).toMatchObject({ type: "noul", noul: 0.72 });
    expect(result.model).toBe("jev-1.13.0");
    expect(result.usage).toEqual({ input_tokens: 120, output_tokens: 45 });
  });

  it("accepts a structured JSON state and honours a per-request model override", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, sampleAnswers));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    await client.decide({
      model: "jev-1.13.0",
      state: { ticket_id: 42, channel: "email" },
      questions: {
        spam: { type: "noul", instructions: "Is this spam?" },
      },
    });

    expect(calls[0]?.body).toMatchObject({
      model: "jev-1.13.0",
      state: { ticket_id: 42, channel: "email" },
    });
  });

  it("fails with a TYPESAFE_API_KEY error and never calls fetch when the key is missing", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, sampleAnswers));
    const client = new JevClient({ fetchImpl: impl });

    await expect(
      client.decide({
        state: "anything",
        questions: { q: { type: "noul", instructions: "Is it true?" } },
      }),
    ).rejects.toThrow(/TYPESAFE_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe("JevClient images, box and long context", () => {
  const pngAsset = { data_base64: "aGVsbG8=", format: "png" as const };

  it("sends assets in the body and sets the images header when an asset is referenced", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, sampleAnswers));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    await client.decide({
      state: "Doorbell photo: doorbell_img",
      questions: {
        person: { type: "noul", instructions: "Is a person visible in doorbell_img?" },
      },
      assets: { doorbell_img: pngAsset },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["TypeSafe-Danger-Zone-Images"]).toBe("true");
    expect(calls[0]?.headers["TypeSafe-Danger-Zone-Long-Context"]).toBeUndefined();
    expect(calls[0]?.body).toMatchObject({
      assets: { doorbell_img: { data_base64: "aGVsbG8=", format: "png" } },
    });
  });

  it("sets the images header for a box question and returns the box answer", async () => {
    const payload = {
      answers: {
        mug: {
          type: "box",
          box: { top: 0.1, bottom: 0.5, left: 0.2, right: 0.6 },
          confidence: 0.83,
        },
      },
      model: "jev-1.14.0",
    };
    const { impl, calls } = fakeFetch(() => jsonResponse(200, payload));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    const result = await client.decide({
      model: "jev-1.14.0",
      state: { photo: "kitchen_img" },
      questions: {
        mug: { type: "box", instructions: "the coffee mug in `kitchen_img`" },
      },
      assets: { kitchen_img: pngAsset },
    });

    expect(calls[0]?.headers["TypeSafe-Danger-Zone-Images"]).toBe("true");
    expect(calls[0]?.body).toMatchObject({ model: "jev-1.14.0" });
    expect(result.answers.mug).toMatchObject({
      type: "box",
      box: { top: 0.1, bottom: 0.5, left: 0.2, right: 0.6 },
      confidence: 0.83,
    });
  });

  it("rejects an unreferenced asset before calling fetch", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, sampleAnswers));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    await expect(
      client.decide({
        state: "no images here",
        questions: { q: { type: "noul", instructions: "Is it true?" } },
        assets: { unused_img: pngAsset },
      }),
    ).rejects.toThrow(/not referenced/);
    expect(calls).toHaveLength(0);
  });

  it("sets the long-context header when longContext is true, and no images header for a plain request", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, sampleAnswers));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    await client.decide({
      state: "a very long state",
      questions: { q: { type: "noul", instructions: "Is it true?" } },
      longContext: true,
    });

    expect(calls[0]?.headers["TypeSafe-Danger-Zone-Long-Context"]).toBe("true");
    expect(calls[0]?.headers["TypeSafe-Danger-Zone-Images"]).toBeUndefined();
    expect(calls[0]?.body).not.toHaveProperty("assets");
  });
});

describe("JevClient.listModels", () => {
  it("GETs /v1/models and parses the models array", async () => {
    const payload = {
      models: [
        { name: "jev-latest", description: "Latest Jev", release_date: "2026-09-01" },
        { name: "jev-1.13.0", description: "Pinned Jev", release_date: "2026-09-01" },
      ],
    };
    const { impl, calls } = fakeFetch(() => jsonResponse(200, payload));
    const client = new JevClient({
      apiKey: "k",
      baseUrl: "https://example.test/api/",
      fetchImpl: impl,
    });

    const result = await client.listModels();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/api/v1/models");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.Authorization).toBe("Bearer k");
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({ name: "jev-latest" });
  });
});

describe("JevClient error mapping", () => {
  it("maps 401 to an authentication error that never contains the API key", async () => {
    const secret = "sk-super-secret-key";
    const { impl } = fakeFetch(() =>
      jsonResponse(401, { error: { message: "invalid api key" } }),
    );
    const client = new JevClient({ apiKey: secret, fetchImpl: impl });

    const err = await client.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevError);
    expect((err as JevError).status).toBe(401);
    expect((err as JevError).message).toContain("401");
    expect((err as JevError).message).toContain("TYPESAFE_API_KEY");
    expect((err as JevError).message).not.toContain(secret);
  });

  it("maps 429 to a rate-limit error", async () => {
    const { impl } = fakeFetch(() => jsonResponse(429, { message: "slow down" }));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    const err = await client.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevError);
    expect((err as JevError).status).toBe(429);
    expect((err as JevError).message).toMatch(/rate limit/i);
  });

  it("maps 5xx to a server error", async () => {
    const { impl } = fakeFetch(() => jsonResponse(503, {}));
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    const err = await client.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevError);
    expect((err as JevError).status).toBe(503);
    expect((err as JevError).message).toContain("503");
  });

  it("maps a network failure to a clear error without a status", async () => {
    const impl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as FetchLike;
    const client = new JevClient({ apiKey: "k", fetchImpl: impl });

    const err = await client.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevError);
    expect((err as JevError).status).toBeUndefined();
    expect((err as JevError).message).toMatch(/network error/i);
  });

  it("maps a timeout (AbortError) to a timeout error", async () => {
    const impl = vi.fn(async () => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }) as unknown as FetchLike;
    const client = new JevClient({ apiKey: "k", fetchImpl: impl, timeoutMs: 5 });

    const err = await client.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevError);
    expect((err as JevError).message).toMatch(/timed out/i);
  });
});

describe("loadConfig", () => {
  it("applies documented defaults when nothing is set", () => {
    const config = loadConfig({});
    expect(config.baseUrl).toBe("https://api.typesafe.ai");
    expect(config.model).toBe("jev-latest");
    expect(config.apiKey).toBeUndefined();
  });

  it("reads overrides and trims a trailing slash from the base URL", () => {
    const config = loadConfig({
      TYPESAFE_API_KEY: "  abc  ",
      TYPESAFE_BASE_URL: "https://staging.example.test/",
      TYPESAFE_JEV_MODEL: "jev-1.13.0",
    });
    expect(config.apiKey).toBe("abc");
    expect(config.baseUrl).toBe("https://staging.example.test");
    expect(config.model).toBe("jev-1.13.0");
  });
});
