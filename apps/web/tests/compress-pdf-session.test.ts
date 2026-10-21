import { describe, expect, it, vi } from "vitest";
import {
  PageError,
  type CompressLimits,
  type CompressOptions,
  type CompressPhase,
  type CompressProfileId,
  type CompressResult,
} from "@document-platform/pdf-browser/compress";
import {
  CompressSession,
  compressErrorCopy,
  compressProfileCopy,
  compressedFilename,
  describeOutcome,
  savedPercent,
  summarizeSkips,
  type CompressSnapshot,
} from "../components/compress-pdf/session";

const LIMITS: CompressLimits = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxPages: 100,
  maxOutputBytes: 1024 * 1024,
  maxJpegPixels: 64_000_000,
  maxRasterPixels: 32_000_000,
  maxImages: 1000,
  maxTotalInflateBytes: 256 * 1024 * 1024,
  maxStreamInflateBytes: 64 * 1024 * 1024,
  imageBudgetMs: 60_000,
  maxScanBytes: 32 * 1024 * 1024,
});

type Compress = ConstructorParameters<typeof CompressSession>[0]["compress"];

function fakeResult(overrides: Partial<CompressResult> = {}): CompressResult {
  return Object.freeze({
    outcome: "reduced",
    blob: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    }),
    profile: "balanced",
    inputBytes: 1000,
    outputBytes: 400,
    pageCount: 3,
    images: Object.freeze({
      found: 4,
      optimized: 2,
      bytesBefore: 800,
      bytesAfter: 250,
      skipped: Object.freeze({ at_target: 1, has_mask: 1 }),
    }),
    streamsRecompressed: 5,
    streamsRepaired: 0,
    warnings: Object.freeze([]),
    timingsMs: Object.freeze({
      load: 1,
      images: 1,
      structure: 1,
      save: 1,
      verify: 1,
      total: 5,
    }),
    ...overrides,
  }) as CompressResult;
}

function pdfFile(name = "report.pdf", size = 4) {
  return new File([new Uint8Array(size).fill(1)], name, {
    type: "application/pdf",
  });
}

function makeSession(compress: Compress = async () => fakeResult()) {
  const createObjectUrl = vi.fn<(blob: Blob) => string>(() => "blob:/fake");
  const revokeObjectUrl = vi.fn<(url: string) => void>(() => {});
  const session = new CompressSession({
    compress,
    limits: LIMITS,
    createObjectUrl,
    revokeObjectUrl,
  });
  return { session, createObjectUrl, revokeObjectUrl };
}

function deferred() {
  let resolve!: (value: CompressResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CompressResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CompressSession", () => {
  it("starts idle with the balanced profile", () => {
    const { session } = makeSession();
    const snapshot = session.getSnapshot();
    expect(snapshot.state).toBe("idle");
    expect(snapshot.profile).toBe("balanced");
  });

  it("selecting a file reads nothing and does not start compression", () => {
    const compress = vi.fn<Compress>();
    const { session } = makeSession(compress);
    session.choose(pdfFile("Q3 report.pdf", 10));
    expect(session.getSnapshot()).toMatchObject({
      state: "selected",
      inputBytes: 10,
    });
    expect(compress).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized files before any processing", () => {
    const compress = vi.fn<Compress>();
    const { session } = makeSession(compress);
    session.choose(pdfFile("a.pdf", 0));
    expect(session.getSnapshot()).toMatchObject({
      state: "error",
      error: "INPUT_LIMIT",
    });
    session.choose(pdfFile("b.pdf", LIMITS.maxInputBytes + 1));
    expect(session.getSnapshot().error).toBe("INPUT_LIMIT");
    expect(session.getSnapshot().announcement).toBe(
      compressErrorCopy.INPUT_LIMIT,
    );
    expect(compress).not.toHaveBeenCalled();
  });

  it("passes the chosen profile, limits and a signal to the engine", async () => {
    const compress = vi.fn<Compress>(async () => fakeResult());
    const { session } = makeSession(compress);
    session.choose(pdfFile());
    session.setProfile("strong");
    await session.start();
    expect(compress).toHaveBeenCalledTimes(1);
    const [input, profile, limits, options] = compress.mock.calls[0];
    expect(input.blob).toBeInstanceOf(Blob);
    expect(profile).toBe<CompressProfileId>("strong");
    expect(limits).toBe(LIMITS);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("publishes a reduced result with a fixed filename and rounded saving", async () => {
    const { session, createObjectUrl } = makeSession();
    session.choose(pdfFile("MY-SECRET-PAYROLL.pdf"));
    await session.start();
    const snapshot = session.getSnapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.outcome).toMatchObject({
      kind: "reduced",
      savedPercent: 60,
      inputBytes: 1000,
      outputBytes: 400,
      pageCount: 3,
      imagesFound: 4,
      imagesOptimized: 2,
      url: "blob:/fake",
      fileName: compressedFilename,
    });
    expect(snapshot.outcome?.unchanged).toEqual({
      efficient: 1,
      protected: 1,
      limits: 0,
      unreadable: 0,
    });
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(snapshot.announcement).toBe(
      "Compressed PDF ready, 60 percent smaller.",
    );
    expect(JSON.stringify(snapshot.announcement)).not.toContain("SECRET");
  });

  it("creates no file and no link when the engine reports no reduction", async () => {
    const { session, createObjectUrl } = makeSession(async () =>
      fakeResult({
        outcome: "no-reduction",
        blob: undefined,
        outputBytes: 1000,
      }),
    );
    session.choose(pdfFile());
    await session.start();
    const outcome = session.getSnapshot().outcome!;
    expect(outcome.kind).toBe("no-reduction");
    expect(outcome.url).toBeUndefined();
    expect(outcome.fileName).toBeUndefined();
    expect(outcome.savedPercent).toBe(0);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(session.getSnapshot().announcement).toMatch(/No file was created/);
  });

  it("never claims a saving when the output is not smaller", async () => {
    // A blob that is somehow reported with outcome "reduced" but not smaller
    // still cannot be presented as a percentage saving.
    expect(savedPercent(1000, 1000)).toBe(0);
    expect(savedPercent(1000, 1200)).toBe(0);
    expect(savedPercent(0, 0)).toBe(0);
  });

  it("caps the displayed saving below 100%", () => {
    expect(savedPercent(1_000_000, 1)).toBe(99);
    expect(savedPercent(1000, 990)).toBe(1);
    expect(savedPercent(1000, 400)).toBe(60);
  });

  it("carries engine warnings through to the outcome", async () => {
    const { session } = makeSession(async () =>
      fakeResult({ warnings: Object.freeze(["signatures", "pdfa"] as const) }),
    );
    session.choose(pdfFile());
    await session.start();
    expect(session.getSnapshot().outcome?.warnings).toEqual([
      "signatures",
      "pdfa",
    ]);
  });

  it("tracks phases and image progress while processing", async () => {
    const gate = deferred();
    let options: CompressOptions | undefined;
    const { session } = makeSession((_input, _profile, _limits, opts) => {
      options = opts;
      return gate.promise;
    });
    session.choose(pdfFile());
    const running = session.start();
    expect(session.getSnapshot().state).toBe("processing");
    expect(session.getSnapshot().progress).toEqual({ phase: "reading" });
    options?.onPhase?.("images" satisfies CompressPhase);
    options?.onProgress?.({ phase: "images", done: 2, total: 5 });
    expect(session.getSnapshot().progress).toEqual({
      phase: "images",
      done: 2,
      total: 5,
    });
    gate.resolve(fakeResult());
    await running;
    expect(session.getSnapshot().state).toBe("ready");
  });

  it("cancel returns to selection with the same file and no error", async () => {
    const gate = deferred();
    let signal: AbortSignal | undefined;
    const { session } = makeSession((_input, _profile, _limits, opts) => {
      signal = opts?.signal;
      return gate.promise;
    });
    session.choose(pdfFile("a.pdf", 7));
    const running = session.start();
    session.cancel();
    expect(signal?.aborted).toBe(true);
    gate.reject(new PageError("CANCELLED"));
    await running;
    expect(session.getSnapshot()).toMatchObject({
      state: "selected",
      inputBytes: 7,
    });
    expect(session.getSnapshot().error).toBeUndefined();
    expect(session.getSnapshot().announcement).toBe(
      compressErrorCopy.CANCELLED,
    );
  });

  it("maps engine failures to error copy and keeps nothing published", async () => {
    for (const code of [
      "ENCRYPTED_PDF",
      "INVALID_PDF",
      "PAGE_LIMIT",
      "OUTPUT_INVALID",
      "OPERATION_FAILED",
    ] as const) {
      const { session, createObjectUrl } = makeSession(async () => {
        throw new PageError(code);
      });
      session.choose(pdfFile());
      await session.start();
      expect(session.getSnapshot()).toMatchObject({
        state: "error",
        error: code,
      });
      expect(session.getSnapshot().announcement).toBe(compressErrorCopy[code]);
      expect(session.getSnapshot().outcome).toBeUndefined();
      expect(createObjectUrl).not.toHaveBeenCalled();
    }
  });

  it("treats unknown failures as OPERATION_FAILED", async () => {
    const { session } = makeSession(async () => {
      throw new Error("boom");
    });
    session.choose(pdfFile());
    await session.start();
    expect(session.getSnapshot().error).toBe("OPERATION_FAILED");
  });

  it("tryAnotherStrength releases the previous result and keeps the file", async () => {
    const { session, revokeObjectUrl } = makeSession();
    session.choose(pdfFile("a.pdf", 9));
    await session.start();
    session.setProfile("light");
    session.tryAnotherStrength();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:/fake");
    expect(session.getSnapshot()).toMatchObject({
      state: "selected",
      profile: "light",
      inputBytes: 9,
    });
    expect(session.getSnapshot().outcome).toBeUndefined();
    // And it can run again without choosing the file again.
    await session.start();
    expect(session.getSnapshot().state).toBe("ready");
  });

  it("ignores a superseded run", async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    const { session, createObjectUrl } = makeSession(
      () => queue.shift()!.promise,
    );
    session.choose(pdfFile("a.pdf"));
    const firstRun = session.start();
    session.choose(pdfFile("b.pdf", 11));
    first.resolve(fakeResult());
    await firstRun;
    expect(session.getSnapshot()).toMatchObject({
      state: "selected",
      inputBytes: 11,
    });
    expect(createObjectUrl).not.toHaveBeenCalled();
    const secondRun = session.start();
    second.resolve(fakeResult());
    await secondRun;
    expect(session.getSnapshot().state).toBe("ready");
  });

  it("does not start twice while processing", async () => {
    const gate = deferred();
    const compress = vi.fn<Compress>(() => gate.promise);
    const { session } = makeSession(compress);
    session.choose(pdfFile());
    const running = session.start();
    await session.start();
    expect(compress).toHaveBeenCalledTimes(1);
    gate.resolve(fakeResult());
    await running;
  });

  it("locks the strength while processing", async () => {
    const gate = deferred();
    const { session } = makeSession(() => gate.promise);
    session.choose(pdfFile());
    const running = session.start();
    session.setProfile("strong");
    expect(session.getSnapshot().profile).toBe("balanced");
    gate.resolve(fakeResult());
    await running;
  });

  it("reset and dispose release the object URL and the file", async () => {
    const { session, revokeObjectUrl } = makeSession();
    session.choose(pdfFile());
    await session.start();
    session.reset();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({
      state: "idle",
      profile: "balanced",
    });
    await session.start();
    expect(session.getSnapshot().state).toBe("idle");

    session.choose(pdfFile());
    await session.start();
    const listener = vi.fn();
    session.subscribe(listener);
    session.dispose();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
    session.choose(pdfFile());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the source filename out of announcements", async () => {
    const seen: string[] = [];
    const { session } = makeSession();
    session.subscribe((snapshot: CompressSnapshot) =>
      seen.push(snapshot.announcement),
    );
    session.choose(pdfFile("SECRET-SOURCE-NAME.pdf"));
    await session.start();
    expect(seen.join("\n")).not.toContain("SECRET-SOURCE-NAME");
  });
});

describe("compress copy helpers", () => {
  it("groups skip reasons into four user-facing categories", () => {
    expect(
      summarizeSkips({
        at_target: 1,
        not_smaller: 1,
        has_mask: 1,
        image_mask: 2,
        time_budget: 3,
      }),
    ).toEqual({ efficient: 2, protected: 3, limits: 3, unreadable: 0 });
    expect(summarizeSkips({})).toEqual({
      efficient: 0,
      protected: 0,
      limits: 0,
      unreadable: 0,
    });
  });

  it("describes both outcomes without overclaiming", () => {
    expect(
      describeOutcome({
        kind: "no-reduction",
        profile: "balanced",
        inputBytes: 10,
        outputBytes: 10,
        savedPercent: 0,
        pageCount: 1,
        imagesFound: 0,
        imagesOptimized: 0,
        unchanged: { efficient: 0, protected: 0, limits: 0, unreadable: 0 },
        warnings: [],
      }),
    ).toBe(
      "This PDF could not be made meaningfully smaller. No file was created.",
    );
  });

  it("has copy for every error code and profile, with honest quality notes", () => {
    for (const code of [
      "INVALID_PLAN",
      "INPUT_LIMIT",
      "INVALID_PDF",
      "ENCRYPTED_PDF",
      "PAGE_LIMIT",
      "OUTPUT_LIMIT",
      "OUTPUT_INVALID",
      "OPERATION_FAILED",
      "PREVIEW_FAILED",
      "RENDER_FAILED",
      "CANCELLED",
      "WORKER_UNAVAILABLE",
    ] as const)
      expect(compressErrorCopy[code].length).toBeGreaterThan(10);
    expect(compressProfileCopy.balanced.summary).toMatch(/Recommended/);
    expect(compressProfileCopy.strong.detail).toMatch(/softer/);
    for (const copy of Object.values(compressProfileCopy))
      expect(copy.detail).not.toMatch(/lossless|no quality loss|guarantee/i);
  });
});
