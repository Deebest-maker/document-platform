import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProcessorClientError,
  convert,
  createJob,
  parseProcessorError,
} from "../components/word-to-pdf/api";

/**
 * Contract tests against the processor's real error body.
 *
 * The processor (FastAPI) returns failures as
 *   { "detail": { "code": "limit_exceeded", "message": "..." } }
 * (see services/processor/app/api/jobs.py `_raise` and app/errors.py).
 * The session maps on upper-case codes, so the client must unwrap `detail`
 * and normalise case. These tests pin that contract.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseProcessorError", () => {
  it("unwraps the FastAPI detail envelope and upper-cases the code", () => {
    expect(
      parseProcessorError({
        detail: {
          code: "limit_exceeded",
          message: "The request exceeds a configured processing limit.",
        },
      }),
    ).toEqual({
      code: "LIMIT_EXCEEDED",
      message: "The request exceeds a configured processing limit.",
    });
  });

  it("covers every code in the processor vocabulary", () => {
    const codes = [
      "invalid_job",
      "invalid_token",
      "invalid_input",
      "limit_exceeded",
      "cancelled",
      "conflict",
      "not_ready",
      "internal",
    ];
    for (const code of codes) {
      expect(
        parseProcessorError({ detail: { code, message: "m" } })?.code,
      ).toBe(code.toUpperCase());
    }
  });

  it("returns undefined for shapes that are not the processor's", () => {
    expect(parseProcessorError(undefined)).toBeUndefined();
    expect(parseProcessorError(null)).toBeUndefined();
    expect(parseProcessorError("Bad Gateway")).toBeUndefined();
    // FastAPI request-validation errors carry a list in `detail`.
    expect(
      parseProcessorError({ detail: [{ loc: ["body"], msg: "bad" }] }),
    ).toBeUndefined();
    // The old, wrong, top-level shape is no longer accepted.
    expect(
      parseProcessorError({ code: "limit_exceeded", message: "m" }),
    ).toBeUndefined();
    expect(parseProcessorError({ detail: { code: "" } })).toBeUndefined();
  });

  it("tolerates a missing message", () => {
    expect(parseProcessorError({ detail: { code: "internal" } })).toEqual({
      code: "INTERNAL",
      message: "",
    });
  });
});

describe("client error handling uses the real envelope", () => {
  it("surfaces LIMIT_EXCEEDED with status 413 from a fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(413, {
          detail: { code: "limit_exceeded", message: "too big" },
        }),
      ),
    );
    const error = await convert("job", "token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessorClientError);
    expect(error).toMatchObject({
      code: "LIMIT_EXCEEDED",
      status: 413,
      message: "too big",
    });
  });

  it("falls back to UNKNOWN for a non-JSON proxy error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })),
    );
    const error = await createJob().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "UNKNOWN", status: 502 });
  });
});
