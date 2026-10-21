import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from "pdf-lib";
import { inflateZlibBounded } from "./compress-inflate";
import { filterNames, flateParams, name, numberOf } from "./compress-pdfobj";
import {
  IDENTITY,
  multiply,
  scanContentStream,
  type Matrix,
  type ScanBudget,
} from "./compress-scan";

// Finds out how large each image is drawn on the pages, so the engine can pick
// a target resolution. The answer is only trusted when it is complete: every
// resource dictionary that refers to an image must have been reached through a
// page, and nothing may have been cut short (ADR-025).

const MAX_FORM_DEPTH = 8;

export interface ImageUse {
  readonly ref: PDFRef;
  readonly stream: PDFRawStream;
  // Largest drawn size over all uses, in points.
  width: number;
  height: number;
}

export interface LayoutResult {
  readonly uses: ReadonlyMap<number, ImageUse>;
  // False when sizes cannot be trusted for any image in this document.
  readonly complete: boolean;
  // Object numbers of images also referenced from places the scan did not visit
  // (annotation appearances, patterns, Type 3 glyphs, masks, ...).
  readonly shared: ReadonlySet<number>;
}

export interface LayoutOptions {
  readonly maxScanBytes: number;
  readonly checkCancelled: () => void;
}

function contentBytes(
  ctx: PDFContext,
  stream: PDFStream,
  budget: ScanBudget,
): Uint8Array | undefined {
  if (!(stream instanceof PDFRawStream)) return undefined;
  const filters = filterNames(ctx, stream.dict);
  if (!filters) return undefined;
  if (filters.length === 0) return stream.contents;
  if (filters.length !== 1 || filters[0] !== "FlateDecode") return undefined;
  const params = flateParams(ctx, stream.dict);
  if (!params || params.predictor !== 1) return undefined;
  const result = inflateZlibBounded(
    stream.contents,
    Math.max(0, budget.remaining),
  );
  return result.ok ? result.bytes : undefined;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let length = 0;
  for (const part of parts) length += part.length + 1;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
    out[offset++] = 10;
  }
  return out;
}

function matrixOf(ctx: PDFContext, dict: PDFDict): Matrix {
  const array = ctx.lookupMaybe(dict.get(name("Matrix")), PDFArray);
  if (!array || array.size() !== 6) return IDENTITY;
  const values: number[] = [];
  for (let index = 0; index < 6; index++) {
    const value = ctx.lookup(array.get(index));
    const number = value instanceof PDFNumber ? value.asNumber() : Number.NaN;
    if (!Number.isFinite(number)) return IDENTITY;
    values.push(number);
  }
  return values as unknown as Matrix;
}

// Counts references to the given object numbers among the objects reachable
// from the document catalog. Orphaned objects (for example pages removed in an
// earlier revision) cannot be drawn and are not counted.
function countReferences(
  ctx: PDFContext,
  wanted: ReadonlySet<number>,
): Map<number, number> {
  const counts = new Map<number, number>();
  const visited = new Set<number>();
  const pending: PDFObject[] = [];
  const roots = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  for (const root of roots) if (root) pending.push(root);
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (value instanceof PDFRef) {
      if (wanted.has(value.objectNumber))
        counts.set(
          value.objectNumber,
          (counts.get(value.objectNumber) ?? 0) + 1,
        );
      if (visited.has(value.objectNumber)) continue;
      visited.add(value.objectNumber);
      const target = ctx.lookup(value);
      if (target) pending.push(target);
    } else if (value instanceof PDFDict) {
      for (const [, entry] of value.entries()) pending.push(entry);
    } else if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index++)
        pending.push(value.get(index));
    } else if (value instanceof PDFStream) {
      pending.push(value.dict);
    }
  }
  return counts;
}

export function collectImageUses(
  doc: PDFDocument,
  options: LayoutOptions,
): LayoutResult {
  const ctx = doc.context;
  const uses = new Map<number, ImageUse>();
  const visitedDicts = new Set<PDFDict>();
  const visitedCounts = new Map<number, number>();
  const budget: ScanBudget = { remaining: options.maxScanBytes };
  let complete = true;

  const imageOf = (ref: PDFRef): PDFRawStream | undefined => {
    const target = ctx.lookup(ref);
    return target instanceof PDFRawStream &&
      target.dict.get(name("Subtype")) === name("Image")
      ? target
      : undefined;
  };

  const visitXObjects = (xobjects: PDFDict) => {
    if (visitedDicts.has(xobjects)) return;
    visitedDicts.add(xobjects);
    for (const [, entry] of xobjects.entries())
      if (entry instanceof PDFRef && imageOf(entry))
        visitedCounts.set(
          entry.objectNumber,
          (visitedCounts.get(entry.objectNumber) ?? 0) + 1,
        );
  };

  const walk = (
    bytes: Uint8Array,
    resources: PDFDict | undefined,
    base: Matrix,
    depth: number,
    chain: ReadonlySet<number>,
  ) => {
    if (depth > MAX_FORM_DEPTH) {
      complete = false;
      return;
    }
    const xobjects = resources
      ? ctx.lookupMaybe(resources.get(name("XObject")), PDFDict)
      : undefined;
    if (xobjects) visitXObjects(xobjects);
    const finished = scanContentStream(
      bytes,
      (operand, ctm) => {
        const ref = xobjects?.get(name(operand));
        if (!(ref instanceof PDFRef)) return;
        const target = ctx.lookup(ref);
        if (!(target instanceof PDFRawStream)) return;
        const subtype = target.dict.get(name("Subtype"));
        const full = multiply(ctm, base);
        if (subtype === name("Image")) {
          const use = uses.get(ref.objectNumber) ?? {
            ref,
            stream: target,
            width: 0,
            height: 0,
          };
          use.width = Math.max(use.width, Math.hypot(full[0], full[1]));
          use.height = Math.max(use.height, Math.hypot(full[2], full[3]));
          uses.set(ref.objectNumber, use);
        } else if (subtype === name("Form")) {
          if (chain.has(ref.objectNumber)) {
            complete = false;
            return;
          }
          const inner = contentBytes(ctx, target, budget);
          if (!inner) {
            complete = false;
            return;
          }
          const own =
            ctx.lookupMaybe(target.dict.get(name("Resources")), PDFDict) ??
            resources;
          walk(
            inner,
            own,
            multiply(matrixOf(ctx, target.dict), full),
            depth + 1,
            new Set([...chain, ref.objectNumber]),
          );
        }
      },
      budget,
    );
    if (!finished) complete = false;
  };

  for (const page of doc.getPages()) {
    options.checkCancelled();
    if (!complete) break;
    const unit = numberOf(ctx, page.node, "UserUnit");
    if (unit !== undefined && unit !== 1) {
      complete = false;
      break;
    }
    const resources = ctx.lookupMaybe(
      page.node.getInheritableAttribute(PDFName.of("Resources")),
      PDFDict,
    );
    const contents = page.node.Contents();
    const streams: PDFStream[] = [];
    if (contents instanceof PDFStream) streams.push(contents);
    else if (contents instanceof PDFArray)
      for (let index = 0; index < contents.size(); index++) {
        const entry = ctx.lookup(contents.get(index));
        if (entry instanceof PDFStream) streams.push(entry);
        else complete = false;
      }
    const parts: Uint8Array[] = [];
    for (const stream of streams) {
      const bytes = contentBytes(ctx, stream, budget);
      if (!bytes) {
        complete = false;
        break;
      }
      parts.push(bytes);
    }
    if (!complete || parts.length === 0) continue;
    walk(concatenate(parts), resources, IDENTITY, 0, new Set());
  }

  const shared = new Set<number>();
  if (uses.size > 0) {
    const totals = countReferences(ctx, new Set(uses.keys()));
    for (const objectNumber of uses.keys())
      if (
        (totals.get(objectNumber) ?? 0) !==
        (visitedCounts.get(objectNumber) ?? 0)
      )
        shared.add(objectNumber);
  }
  return { uses, complete, shared };
}
