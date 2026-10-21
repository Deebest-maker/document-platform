import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";

// Small, defensive accessors over pdf-lib objects. Document data is untrusted,
// so every accessor returns undefined instead of throwing on unexpected shapes.

export const name = (value: string) => PDFName.of(value);

export function numberOf(
  ctx: PDFContext,
  dict: PDFDict,
  key: string,
): number | undefined {
  const value = ctx.lookupMaybe(dict.get(name(key)), PDFNumber);
  const number = value?.asNumber();
  return number !== undefined && Number.isFinite(number) ? number : undefined;
}

// Filter names without the leading slash, or undefined if the entry is
// malformed. No /Filter yields an empty list.
export function filterNames(
  ctx: PDFContext,
  dict: PDFDict,
): readonly string[] | undefined {
  const value = ctx.lookup(dict.get(name("Filter")));
  if (value === undefined || value === PDFNull) return [];
  if (value instanceof PDFName) return [value.asString().slice(1)];
  if (value instanceof PDFArray) {
    const names: string[] = [];
    for (let index = 0; index < value.size(); index++) {
      const entry = ctx.lookup(value.get(index));
      if (!(entry instanceof PDFName)) return undefined;
      names.push(entry.asString().slice(1));
    }
    return names;
  }
  return undefined;
}

export interface FlateParams {
  readonly predictor: number;
  readonly columns: number;
  readonly colors: number;
  readonly bitsPerComponent: number;
}

// Decode parameters for a single Flate filter, with the PDF defaults applied.
export function flateParams(
  ctx: PDFContext,
  dict: PDFDict,
): FlateParams | undefined {
  let params: PDFObject | undefined = ctx.lookup(dict.get(name("DecodeParms")));
  if (params instanceof PDFArray) {
    if (params.size() > 1) return undefined;
    params = params.size() === 1 ? ctx.lookup(params.get(0)) : undefined;
  }
  if (params === undefined || params === PDFNull)
    return { predictor: 1, columns: 1, colors: 1, bitsPerComponent: 8 };
  if (!(params instanceof PDFDict)) return undefined;
  return {
    predictor: numberOf(ctx, params, "Predictor") ?? 1,
    columns: numberOf(ctx, params, "Columns") ?? 1,
    colors: numberOf(ctx, params, "Colors") ?? 1,
    bitsPerComponent: numberOf(ctx, params, "BitsPerComponent") ?? 8,
  };
}
