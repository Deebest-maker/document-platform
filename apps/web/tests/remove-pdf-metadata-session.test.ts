import { describe, expect, it, vi } from "vitest";
import { PageError } from "@document-platform/pdf-browser/pages";
import type {
  MetadataRemovalLimits,
  MetadataRemovalResult,
} from "@document-platform/pdf-browser/metadata-removal";
import {
  RemoveMetadataSession,
  removeMetadataErrorCopy,
  __testing,
} from "../components/remove-pdf-metadata/session";

const LIMITS: MetadataRemovalLimits = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024,
  maxPages: 200,
  maxOutputBytes: 32 * 1024 * 1024,
});

function fakeResult(
  overrides: Partial<MetadataRemovalResult> = {},
): MetadataRemovalResult {
  const standardFlags = {
    Title: true,
    Author: true,
    Subject: false,
    Keywords: false,
    Creator: true,
    Producer: true,
    CreationDate: true,
    ModDate: true,
    Trapped: false,
  } as const;
  const emptyFlags = {
    Title: false,
    Author: false,
    Subject: false,
    Keywords: false,
    Creator: false,
    Producer: false,
    CreationDate: false,
    ModDate: false,
    Trapped: false,
  } as const;
  return Object.freeze({
    blob: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer], {
      type: "application/pdf",
    }),
    bytes: 4,
    pageCount: 3,
    before: Object.freeze({
      standardInfoPresent: standardFlags,
      customInfoKeys: Object.freeze(["AcmeCanary"]),
      xmpStreamPresent: true,
      trailerIdPresent: true,
    }),
    after: Object.freeze({
      standardInfoPresent: emptyFlags,
      customInfoKeys: Object.freeze([] as string[]),
      xmpStreamPresent: false,
      trailerIdPresent: false,
    }),
    removed: Object.freeze({
      standardInfo: Object.freeze([
        "Title",
        "Author",
        "Creator",
        "Producer",
        "CreationDate",
        "ModDate",
      ] as const),
      customInfo: Object.freeze(["AcmeCanary"]),
      xmpStream: true,
      trailerId: true,
    }),
    trailerIdControllable: true,
    pagesPreserved: true,
    pageGeometry: Object.freeze([]),
    ...overrides,
  }) as MetadataRemovalResult;
}

function makeSession(
  deps: Partial<ConstructorParameters<typeof RemoveMetadataSession>[0]> = {},
) {
  const removeMetadata = deps.removeMetadata ?? (async () => fakeResult());
  const createObjectUrl = vi.fn(() => "blob:/fake");
  const revokeObjectUrl = vi.fn(() => {});
  const session = new RemoveMetadataSession({
    removeMetadata,
    limits: LIMITS,
    createObjectUrl,
    revokeObjectUrl,
    ...deps,
  });
  return { session, createObjectUrl, revokeObjectUrl };
}

async function waitForState(
  session: RemoveMetadataSession,
  predicate: (s: ReturnType<RemoveMetadataSession["getSnapshot"]>) => boolean,
  timeoutMs = 1000,
) {
  const start = Date.now();
  while (!predicate(session.getSnapshot())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("RemoveMetadataSession", () => {
  it("starts in idle state", () => {
    const { session } = makeSession();
    expect(session.getSnapshot().state).toBe("idle");
  });

  it("transitions idle → loading → processing → ready on success", async () => {
    const { session, createObjectUrl } = makeSession();
    const file = new File([new Uint8Array([1, 2, 3])], "report.pdf", {
      type: "application/pdf",
    });
    const states: string[] = [];
    session.subscribe((snap) => states.push(snap.state));
    await session.run(file);
    expect(session.getSnapshot().state).toBe("ready");
    expect(states).toContain("loading");
    expect(states).toContain("processing");
    expect(states).toContain("ready");
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().result?.fileName).toBe("metadata-removed.pdf");
  });

  it("uses a fixed output filename and never derives it from the source", async () => {
    const { session } = makeSession();
    for (const name of [
      "MY-SECRET-PAYROLL.pdf",
      "日本語 財務報告.pdf",
      "../etc/passwd.pdf",
      "x.pdf",
    ]) {
      const file = new File([new Uint8Array([1])], name, {
        type: "application/pdf",
      });
      await session.run(file);
      expect(session.getSnapshot().result?.fileName).toBe(
        "metadata-removed.pdf",
      );
    }
  });

  it("refuses an empty or mislabelled file for its own reason, before reading it", async () => {
    const { session } = makeSession();
    await session.run(new File([], "empty.pdf", { type: "application/pdf" }));
    expect(session.getSnapshot()).toMatchObject({
      state: "error",
      error: "EMPTY_INPUT",
      announcement: removeMetadataErrorCopy.EMPTY_INPUT,
    });
    await session.run(
      new File([new Uint8Array([1])], "../etc/passwd", {
        type: "application/pdf",
      }),
    );
    expect(session.getSnapshot()).toMatchObject({
      state: "error",
      error: "UNSUPPORTED_TYPE",
      announcement: removeMetadataErrorCopy.UNSUPPORTED_TYPE,
    });
    expect(session.getSnapshot().result).toBeUndefined();
  });

  it("keeps the source filename out of the result URL and the announcement", async () => {
    const createdUrls: string[] = [];
    const { session } = makeSession({
      createObjectUrl: () => {
        const url = `blob:metadata-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      },
    });
    const file = new File([new Uint8Array([1])], "SECRET-SOURCE-NAME.pdf", {
      type: "application/pdf",
    });
    await session.run(file);
    expect(createdUrls.join("\n")).not.toContain("SECRET-SOURCE-NAME");
    expect(session.getSnapshot().announcement ?? "").not.toContain(
      "SECRET-SOURCE-NAME",
    );
    expect(session.getSnapshot().result?.fileName ?? "").not.toContain(
      "SECRET-SOURCE-NAME",
    );
  });

  it("reports before/after counts truthfully", async () => {
    const { session } = makeSession();
    const file = new File([new Uint8Array([1])], "a.pdf", {
      type: "application/pdf",
    });
    await session.run(file);
    const snap = session.getSnapshot();
    expect(snap.before?.standardInfoCount).toBe(6);
    expect(snap.before?.customInfoCount).toBe(1);
    expect(snap.before?.xmpStreamPresent).toBe(true);
    expect(snap.before?.trailerIdPresent).toBe(true);
    expect(snap.after?.standardInfoCount).toBe(0);
    expect(snap.after?.customInfoCount).toBe(0);
    expect(snap.after?.xmpStreamPresent).toBe(false);
    expect(snap.after?.trailerIdPresent).toBe(false);
  });

  it("surfaces trailerIdControllable=false in the snapshot", async () => {
    const { session } = makeSession({
      removeMetadata: async () =>
        fakeResult({
          after: Object.freeze({
            standardInfoPresent: {
              Title: false,
              Author: false,
              Subject: false,
              Keywords: false,
              Creator: false,
              Producer: false,
              CreationDate: false,
              ModDate: false,
              Trapped: false,
            },
            customInfoKeys: Object.freeze([] as string[]),
            xmpStreamPresent: false,
            trailerIdPresent: true,
          }),
          removed: Object.freeze({
            standardInfo: Object.freeze(["Title"] as const),
            customInfo: Object.freeze([] as string[]),
            xmpStream: true,
            trailerId: false,
          }),
          trailerIdControllable: false,
        }),
    });
    const file = new File([new Uint8Array([1])], "x.pdf", {
      type: "application/pdf",
    });
    await session.run(file);
    expect(session.getSnapshot().trailerIdControllable).toBe(false);
    expect(session.getSnapshot().removed?.trailerId).toBe(false);
  });

  it("maps engine errors to workflow error copy", async () => {
    const { session } = makeSession({
      removeMetadata: async () => {
        throw new PageError("ENCRYPTED_PDF");
      },
    });
    const file = new File([new Uint8Array([1])], "x.pdf", {
      type: "application/pdf",
    });
    await session.run(file);
    const snap = session.getSnapshot();
    expect(snap.state).toBe("error");
    expect(snap.error).toBe("ENCRYPTED_PDF");
    expect(snap.announcement).toBe(removeMetadataErrorCopy.ENCRYPTED_PDF);
  });

  it("maps engine-load failure to ENGINE_LOAD_FAILED", async () => {
    const { session } = makeSession({
      loadEngine: async () => {
        throw new Error("boom");
      },
    });
    const file = new File([new Uint8Array([1])], "x.pdf", {
      type: "application/pdf",
    });
    await session.run(file);
    expect(session.getSnapshot().state).toBe("error");
    expect(session.getSnapshot().error).toBe("ENGINE_LOAD_FAILED");
  });

  it("suppresses results from a superseded run (generation guard)", async () => {
    const releases: Array<() => void> = [];
    const removeMetadata = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return fakeResult();
    });
    const { session } = makeSession({ removeMetadata });
    const file1 = new File([new Uint8Array([1])], "a.pdf", {
      type: "application/pdf",
    });
    const file2 = new File([new Uint8Array([2])], "b.pdf", {
      type: "application/pdf",
    });
    const first = session.run(file1);
    await waitForState(session, (s) => s.state === "processing");
    const second = session.run(file2);
    await waitForState(session, () => releases.length === 2);
    for (const release of releases) release();
    await Promise.all([first, second]);
    // Final state belongs to the second run.
    expect(session.getSnapshot().fileName).toBe("b.pdf");
    expect(session.getSnapshot().state).toBe("ready");
  });

  it("revokes the previous object URL on reset", async () => {
    const { session, revokeObjectUrl } = makeSession();
    const file = new File([new Uint8Array([1])], "x.pdf", {
      type: "application/pdf",
    });
    await session.run(file);
    session.reset();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:/fake");
    expect(session.getSnapshot().state).toBe("idle");
  });

  it("describeOutcome reflects what was removed in plain English", () => {
    expect(
      __testing.describeOutcome(
        fakeResult({
          removed: Object.freeze({
            standardInfo: Object.freeze(["Title"] as const),
            customInfo: Object.freeze([] as string[]),
            xmpStream: false,
            trailerId: false,
          }),
        }),
      ),
    ).toContain("1 standard metadata field");
    expect(
      __testing.describeOutcome(
        fakeResult({
          removed: Object.freeze({
            standardInfo: Object.freeze([] as const),
            customInfo: Object.freeze([] as string[]),
            xmpStream: false,
            trailerId: false,
          }),
        }),
      ),
    ).toBe("No supported metadata was present.");
  });
});
