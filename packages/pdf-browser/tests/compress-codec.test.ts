import { describe, expect, it } from "vitest";
import { createBrowserImageCodec } from "../src/compress-codec";

// A minimal canvas model: records draws and sizes so the scaling schedule can
// be checked without a browser. Pixel results are covered by the browser tests.
function fakeScope(
  options: { rejectColorOptions?: boolean; encoderType?: string } = {},
) {
  const draws: { from: string; width: number; height: number }[] = [];
  const created: { width: number; height: number }[] = [];
  const closed: string[] = [];
  let id = 0;
  class FakeBitmap {
    label = `bitmap${id++}`;
    constructor(
      public width: number,
      public height: number,
    ) {}
    close() {
      closed.push(this.label);
    }
  }
  class FakeCanvas {
    label = `canvas${id++}`;
    constructor(
      public width: number,
      public height: number,
    ) {
      created.push({ width, height });
    }
    getContext() {
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage: (
          from: { label: string },
          _x: number,
          _y: number,
          width: number,
          height: number,
        ) => draws.push({ from: from.label, width, height }),
      };
    }
    async convertToBlob(request: { type: string; quality: number }) {
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
        type: options.encoderType ?? request.type,
      });
    }
  }
  const calls: unknown[][] = [];
  const scope = {
    OffscreenCanvas: FakeCanvas as unknown as typeof OffscreenCanvas,
    ImageData: class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    } as unknown as typeof ImageData,
    createImageBitmap: (async (...args: unknown[]) => {
      calls.push(args);
      if (options.rejectColorOptions && args.length > 1)
        throw new TypeError("bad options");
      const source = args[0] as { width?: number; height?: number };
      return new FakeBitmap(source.width ?? 4000, source.height ?? 3000);
    }) as unknown as typeof createImageBitmap,
  };
  return { scope, draws, created, closed, calls };
}

// instanceof checks inside the codec need the global classes.
function withGlobals<T>(run: () => Promise<T>) {
  const g = globalThis as Record<string, unknown>;
  const previous = g.ImageBitmap;
  g.ImageBitmap = class {};
  return run().finally(() => {
    g.ImageBitmap = previous;
  });
}

describe("browser image codec", () => {
  it("is unavailable without the needed browser APIs", () => {
    expect(createBrowserImageCodec({})).toBeUndefined();
    const { scope } = fakeScope();
    expect(
      createBrowserImageCodec({ ...scope, OffscreenCanvas: undefined }),
    ).toBeUndefined();
    expect(
      createBrowserImageCodec({ ...scope, createImageBitmap: undefined }),
    ).toBeUndefined();
    expect(
      createBrowserImageCodec({ ...scope, ImageData: undefined }),
    ).toBeUndefined();
    expect(createBrowserImageCodec(scope)).toBeDefined();
  });

  it("halves repeatedly while at least twice the target", async () => {
    const { scope, draws, created } = fakeScope();
    const codec = createBrowserImageCodec(scope)!;
    const bytes = await withGlobals(() =>
      codec.transcode(
        { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
        1000,
        750,
        75,
      ),
    );
    expect([...bytes]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    // 4000x3000 -> 2000x1500 -> 1000x750: two halvings reach the target
    // exactly, so the last canvas is encoded as it is.
    expect(created.map((c) => [c.width, c.height])).toEqual([
      [2000, 1500],
      [1000, 750],
    ]);
    expect(draws).toHaveLength(2);
  });

  it("makes a final step when halving does not land on the target", async () => {
    const { scope, created } = fakeScope();
    await withGlobals(() =>
      createBrowserImageCodec(scope)!.transcode(
        { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
        900,
        700,
        75,
      ),
    );
    expect(created.map((c) => [c.width, c.height])).toEqual([
      [2000, 1500],
      [1000, 750],
      [900, 700],
    ]);
  });

  it("takes a single step when the target is more than half the source", async () => {
    const { scope, created } = fakeScope();
    const codec = createBrowserImageCodec(scope)!;
    await withGlobals(() =>
      codec.transcode(
        { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
        3000,
        2250,
        80,
      ),
    );
    expect(created.map((c) => [c.width, c.height])).toEqual([[3000, 2250]]);
  });

  it("decodes raster samples without colour-space options", async () => {
    const { scope, calls } = fakeScope();
    const codec = createBrowserImageCodec(scope)!;
    await withGlobals(() =>
      codec.transcode(
        { kind: "rgba", width: 4, height: 2, data: new Uint8ClampedArray(32) },
        2,
        1,
        70,
      ),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
  });

  it("keeps stored colour values and retries when options are rejected", async () => {
    const withOptions = fakeScope();
    await withGlobals(() =>
      createBrowserImageCodec(withOptions.scope)!.transcode(
        { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
        2000,
        1500,
        75,
      ),
    );
    expect(withOptions.calls[0][1]).toEqual({ colorSpaceConversion: "none" });
    const strict = fakeScope({ rejectColorOptions: true });
    await withGlobals(() =>
      createBrowserImageCodec(strict.scope)!.transcode(
        { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
        2000,
        1500,
        75,
      ),
    );
    expect(strict.calls).toHaveLength(2);
    expect(strict.calls[1]).toHaveLength(1);
  });

  it("rejects when the encoder does not produce JPEG", async () => {
    const { scope } = fakeScope({ encoderType: "image/png" });
    await expect(
      withGlobals(() =>
        createBrowserImageCodec(scope)!.transcode(
          { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
          2000,
          1500,
          75,
        ),
      ),
    ).rejects.toThrow();
  });

  it("releases the decoded bitmap even when encoding fails", async () => {
    const { scope, closed } = fakeScope({ encoderType: "image/png" });
    await withGlobals(() =>
      createBrowserImageCodec(scope)!
        .transcode(
          { kind: "jpeg", bytes: new Uint8Array([0xff, 0xd8]) },
          2000,
          1500,
          75,
        )
        .catch(() => undefined),
    );
    expect(closed.length).toBeGreaterThan(0);
  });
});
