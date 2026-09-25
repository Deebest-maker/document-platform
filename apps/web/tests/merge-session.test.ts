import { describe, expect, it, vi } from "vitest";
import { getTool } from "@document-platform/tool-registry";
import type {
  MergeOptions,
  MergeResult,
} from "@document-platform/pdf-browser/types";
import { displayName, MergeSession } from "../components/merge/session";

const limits = getTool("merge-pdf")!.limits!;
const file = (name = "same.pdf", bytes = "synthetic") =>
  new File([bytes], name, { type: "application/pdf" });
const result: MergeResult = {
  blob: new Blob(["synthetic result"], { type: "application/pdf" }),
  pageCount: 2,
  inputCount: 2,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(merge = vi.fn(async () => result)) {
  let next = 0;
  const load = vi.fn(async () => ({ mergePdfs: merge }));
  const createUrl = vi.fn(() => `blob:synthetic-${++next}`),
    revokeUrl = vi.fn();
  const session = new MergeSession(limits, {
    load,
    createUrl,
    revokeUrl,
    id: () => `selection-${++next}`,
  });
  return { session, merge, load, createUrl, revokeUrl };
}

describe("route-local Merge session", () => {
  it("enforces two-file minimum, explicit duplicates, add/remove and exact ordering", async () => {
    const { session, merge, load } = setup();
    session.add([file()]);
    await session.merge();
    expect(load).not.toHaveBeenCalled();
    session.add([file(), file("third.pdf")]);
    const [a, b, c] = session.getSnapshot().rows;
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    session.move(c.id, -1);
    session.move(c.id, -1);
    session.move(c.id, -1);
    session.remove(b.id);
    expect(session.canMerge()).toBe(true);
    await session.merge();
    expect(merge).toHaveBeenCalledWith(
      [
        { id: c.id, blob: c.file },
        { id: a.id, blob: a.file },
      ],
      limits,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onPhase: expect.any(Function),
      }),
    );
  });
  it("validates input metadata, count and total bytes before engine loading", () => {
    const { session, load } = setup();
    session.add([file("zero.pdf", ""), file("wrong.txt"), file()]);
    expect(session.getSnapshot().rows.map((row) => row.error)).toEqual([
      "EMPTY_INPUT",
      "UNSUPPORTED_TYPE",
      undefined,
    ]);
    expect(session.canMerge()).toBe(false);
    session.reset();
    session.add(Array.from({ length: limits.maxFiles + 1 }, () => file()));
    expect(session.getSnapshot().rows).toHaveLength(0);
    expect(session.getSnapshot().error).toBe("INPUT_LIMIT");
    const bounded = new MergeSession({
      ...limits,
      maxFileBytes: 10,
      maxTotalBytes: 12,
    });
    bounded.add([file(), file()]);
    expect(bounded.canMerge()).toBe(false);
    expect(bounded.getSnapshot().error).toBe("INPUT_LIMIT");
    expect(load).not.toHaveBeenCalled();
  });
  it("guards double submission and owns one URL until edit, replacement, reset or unmount", async () => {
    const pending = deferred<MergeResult>();
    const { session, merge, createUrl, revokeUrl } = setup(
      vi.fn(() => pending.promise),
    );
    session.add([file(), file()]);
    const first = session.merge();
    await session.merge();
    pending.resolve(result);
    await first;
    expect(merge).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
    const url = session.getSnapshot().result!.url;
    expect(session.getSnapshot().result!.url).toBe(url);
    expect(revokeUrl).not.toHaveBeenCalled();
    session.edit();
    expect(revokeUrl).toHaveBeenCalledWith(url);
    expect(session.getSnapshot().result).toBeUndefined();
    await session.merge();
    const replacement = session.getSnapshot().result!.url;
    expect(replacement).not.toBe(url);
    session.reset();
    expect(revokeUrl).toHaveBeenCalledWith(replacement);
    expect(session.getSnapshot().rows).toHaveLength(0);
    session.add([file(), file()]);
    await session.merge();
    const last = session.getSnapshot().result!.url;
    session.dispose();
    expect(revokeUrl).toHaveBeenCalledWith(last);
    expect(session.getSnapshot().result).toBeUndefined();
    expect(session.getSnapshot().rows).toHaveLength(0);
  });
  it.each(["reset", "dispose", "cancel"] as const)(
    "ignores stale success/phase after %s",
    async (action) => {
      const pending = deferred<MergeResult>();
      let options: MergeOptions | undefined;
      const { session, createUrl } = setup(
        vi.fn(async (...args: unknown[]) => {
          options = args[2] as MergeOptions;
          return pending.promise;
        }),
      );
      session.add([file(), file()]);
      const work = session.merge();
      await Promise.resolve();
      session[action]();
      expect(options?.signal?.aborted).toBe(true);
      options?.onPhase?.("validating");
      pending.resolve(result);
      await work;
      expect(createUrl).not.toHaveBeenCalled();
      expect(session.getSnapshot().result).toBeUndefined();
      expect(session.getSnapshot().phase).toBeUndefined();
      expect(session.getSnapshot().rows).toHaveLength(
        action === "cancel" ? 2 : 0,
      );
    },
  );
  it("ignores stale engine loading and late failure without overwriting a new selection", async () => {
    const loading = deferred<{ mergePdfs: () => Promise<MergeResult> }>();
    const merge = vi.fn(async () => result);
    const session = new MergeSession(limits, { load: () => loading.promise });
    session.add([file(), file()]);
    const old = session.merge();
    session.reset();
    session.add([file("new.pdf")]);
    loading.resolve({ mergePdfs: merge });
    await old;
    expect(merge).not.toHaveBeenCalled();
    expect(session.getSnapshot().rows[0].file.name).toBe("new.pdf");
    const failure = deferred<MergeResult>();
    const later = setup(vi.fn(() => failure.promise));
    later.session.add([file(), file()]);
    const rejected = later.session.merge();
    await Promise.resolve();
    later.session.reset();
    failure.reject(new Error("synthetic private detail"));
    await rejected;
    expect(later.session.getSnapshot().state).toBe("idle");
  });
  it("maps load/parser failures safely and allows remove/add recovery", async () => {
    const loadFail = new MergeSession(limits, {
      load: async () => {
        throw new Error("internal path");
      },
    });
    loadFail.add([file(), file()]);
    await loadFail.merge();
    expect(loadFail.getSnapshot().error).toBe("ENGINE_LOAD_FAILED");
    const safe = setup(
      vi.fn(async (...args: unknown[]) => {
        throw {
          code: "ENCRYPTED_PDF",
          inputId: (args[0] as { id: string }[])[1].id,
          message: "private content",
        };
      }),
    );
    safe.session.add([file(), file()]);
    await safe.session.merge();
    expect(safe.session.getSnapshot().rows[1].error).toBe("ENCRYPTED_PDF");
    expect(JSON.stringify(safe.session.getSnapshot())).not.toContain(
      "private content",
    );
    safe.session.remove(safe.session.getSnapshot().rows[1].id);
    safe.session.add([file()]);
    expect(safe.session.canMerge()).toBe(true);
    expect(safe.createUrl).not.toHaveBeenCalled();
    const unknown = setup(
      vi.fn(async () => {
        throw new Error("raw parser trace");
      }),
    );
    unknown.session.add([file(), file()]);
    await unknown.session.merge();
    expect(unknown.session.getSnapshot().error).toBe("MERGE_FAILED");
  });
  it("renders only a bounded basename without control or bidi characters", () => {
    expect(displayName("folder\\secret\u202e.pdf")).toBe("secret.pdf");
    expect(displayName("\u0000")).toBe("PDF");
    expect(displayName("a".repeat(500))).toHaveLength(160);
  });
});
