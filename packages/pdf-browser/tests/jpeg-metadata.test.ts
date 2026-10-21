import { describe, expect, it } from "vitest";
import { ImagePdfError } from "../src/image-types";
import { stripJpegMetadata } from "../src/jpeg-metadata";
import {
  baselineJpeg,
  cmykJpeg,
  grayJpeg,
  progressiveJpeg,
  restartJpeg,
} from "./helpers/jpeg-samples";

const samples = {
  baseline: baselineJpeg,
  progressive: progressiveJpeg,
  gray: grayJpeg,
  cmyk: cmykJpeg,
  restart: restartJpeg,
};

const text = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const segment = (marker: number, payload: Uint8Array) =>
  join(
    Uint8Array.of(0xff, marker, (payload.length + 2) >> 8, payload.length + 2),
    payload,
  );
const nul = Uint8Array.of(0);

/** Insert segments straight after SOI, as cameras and editors do. */
const inject = (jpeg: Uint8Array, ...segments: Uint8Array[]) =>
  join(jpeg.subarray(0, 2), ...segments, jpeg.subarray(2));

const SECRETS = [
  "SecretCameraModelXYZ",
  "SecretGpsLatLong",
  "SecretXmpAuthor",
  "SecretIptcCity",
  "SecretComment",
  "SecretIccDescription",
  "SecretMpfEntry",
  "SecretJfxxThumb",
  "SecretApp10",
  "SecretTrailerAfterEoi",
];

function withEverything(jpeg: Uint8Array) {
  return join(
    inject(
      jpeg,
      segment(
        0xe1,
        join(
          text("Exif\0\0"),
          text("MM\0*SecretCameraModelXYZ SecretGpsLatLong"),
        ),
      ),
      segment(
        0xe1,
        join(
          text("http://ns.adobe.com/xap/1.0/"),
          nul,
          text("<x:xmpmeta>SecretXmpAuthor</x:xmpmeta>"),
        ),
      ),
      segment(
        0xed,
        join(text("Photoshop 3.0"), nul, text("8BIM SecretIptcCity")),
      ),
      segment(0xfe, text("SecretComment")),
      segment(
        0xe2,
        join(text("ICC_PROFILE"), nul, text("SecretIccDescription")),
      ),
      segment(0xe2, join(text("MPF"), nul, text("SecretMpfEntry"))),
      segment(0xe0, join(text("JFXX"), nul, text("SecretJfxxThumb"))),
      segment(0xea, text("SecretApp10")),
    ),
    // Some cameras append a second, full image after the first one ends.
    text("SecretTrailerAfterEoi"),
    Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x41, 0x42, 0xff, 0xd9),
  );
}

const asText = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("stripJpegMetadata", () => {
  it.each(Object.entries(samples))(
    "returns a clean %s JPEG byte for byte (picture data is never touched)",
    (_name, jpeg) => {
      expect(stripJpegMetadata(jpeg)).toEqual(jpeg);
    },
  );

  it.each(Object.entries(samples))(
    "removes every kind of metadata from a %s JPEG and returns the original bytes",
    (_name, jpeg) => {
      const dirty = withEverything(jpeg);
      const dirtyText = asText(dirty);
      for (const secret of SECRETS) expect(dirtyText).toContain(secret);

      const cleaned = stripJpegMetadata(dirty);
      const cleanedText = asText(cleaned);
      for (const secret of SECRETS) expect(cleanedText).not.toContain(secret);
      expect(cleaned).toEqual(jpeg);
    },
  );

  it("is idempotent and does not change its input", () => {
    const dirty = withEverything(baselineJpeg);
    const copy = dirty.slice();
    const once = stripJpegMetadata(dirty);
    expect(dirty).toEqual(copy);
    expect(stripJpegMetadata(once)).toEqual(once);
  });

  it("keeps the Adobe segment that CMYK decoding depends on", () => {
    const cleaned = stripJpegMetadata(withEverything(cmykJpeg));
    expect(asText(cleaned)).toContain("Adobe");
  });

  it("drops a JFIF header that carries a thumbnail but keeps a plain one", () => {
    const body = (thumbW: number, thumbH: number, extra: number[]) =>
      segment(
        0xe0,
        Uint8Array.of(
          0x4a,
          0x46,
          0x49,
          0x46,
          0x00,
          1,
          1,
          0,
          0,
          1,
          0,
          1,
          thumbW,
          thumbH,
          ...extra,
        ),
      );
    const withoutOriginalJfif = (jpeg: Uint8Array) =>
      join(jpeg.subarray(0, 2), jpeg.subarray(20)); // SOI + everything after the APP0 (marker + 16 bytes)
    expect(baselineJpeg.subarray(2, 4)).toEqual(Uint8Array.of(0xff, 0xe0));

    const plain = inject(withoutOriginalJfif(baselineJpeg), body(0, 0, []));
    expect(stripJpegMetadata(plain)).toEqual(plain);

    const thumb = inject(
      withoutOriginalJfif(baselineJpeg),
      body(1, 1, [9, 9, 9]),
    );
    expect(stripJpegMetadata(thumb)).toEqual(withoutOriginalJfif(baselineJpeg));
  });

  it("works on a view into a larger buffer", () => {
    const dirty = withEverything(progressiveJpeg);
    const padded = new Uint8Array(dirty.length + 64);
    padded.set(dirty, 32);
    expect(stripJpegMetadata(padded.subarray(32, 32 + dirty.length))).toEqual(
      progressiveJpeg,
    );
  });

  it("keeps a JPEG that was cut short, without inventing an end", () => {
    const cut = baselineJpeg.subarray(0, baselineJpeg.length - 2);
    expect(stripJpegMetadata(cut)).toEqual(cut);
  });

  it("is not fooled by marker-like bytes inside the picture data", () => {
    // Stuffed 0xFF00 bytes, restart markers (restartJpeg) and a fake segment
    // length after a stray 0xFF must all stay with the picture.
    const dirty = withEverything(restartJpeg);
    expect(stripJpegMetadata(dirty)).toEqual(restartJpeg);
    const stuffed = restartJpeg.reduce(
      (count, byte, index, all) =>
        byte === 0xff && all[index + 1] === 0x00 ? count + 1 : count,
      0,
    );
    expect(stuffed).toBeGreaterThan(0);
  });

  describe("fails safe on malformed input", () => {
    const invalid = (bytes: Uint8Array) => {
      let error: unknown;
      try {
        stripJpegMetadata(bytes);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ImagePdfError);
      expect((error as ImagePdfError).code).toBe("INVALID_IMAGE");
    };

    it("rejects data that is not a JPEG", () => {
      invalid(text("not a jpeg at all"));
      invalid(new Uint8Array(0));
      invalid(Uint8Array.of(0xff, 0xd8));
    });

    it("rejects a segment whose length runs past the data", () => {
      invalid(
        join(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff), text("short")),
      );
    });

    it("rejects a file that ends before any scan", () => {
      invalid(baselineJpeg.subarray(0, 40));
    });

    it("rejects stray bytes where a marker must start", () => {
      invalid(
        join(Uint8Array.of(0xff, 0xd8), text("junk"), baselineJpeg.subarray(2)),
      );
    });

    it("rejects an end-of-image marker before any scan", () => {
      invalid(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00));
    });
  });
});
