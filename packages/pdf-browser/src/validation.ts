import { PdfError } from "./errors";
import type { MergeLimits, PdfErrorCode, PdfInput } from "./types";

export function validatePdfCandidate(
  file: Pick<File, "name" | "type" | "size">,
  limits: MergeLimits,
): PdfErrorCode | undefined {
  if (file.size === 0) return "EMPTY_INPUT";
  if (
    !/\.pdf$/i.test(file.name) ||
    (file.type &&
      !["application/pdf", "application/octet-stream"].includes(file.type))
  )
    return "UNSUPPORTED_TYPE";
  if (file.size > limits.maxFileBytes) return "INPUT_LIMIT";
}

export function validateMergeInputs(
  inputs: readonly PdfInput[],
  limits: MergeLimits,
): void {
  if (
    Object.values(limits).some(
      (limit) => !Number.isSafeInteger(limit) || limit <= 0,
    )
  )
    throw new PdfError("INPUT_LIMIT");
  if (inputs.length < 2) throw new PdfError("INPUT_COUNT");
  if (inputs.length > limits.maxFiles) throw new PdfError("INPUT_LIMIT");
  let total = 0;
  for (const input of inputs) {
    if (input.blob.size === 0) throw new PdfError("EMPTY_INPUT", input.id);
    if (input.blob.size > limits.maxFileBytes)
      throw new PdfError("INPUT_LIMIT", input.id);
    total += input.blob.size;
  }
  if (total > limits.maxTotalBytes) throw new PdfError("INPUT_LIMIT");
}

export async function readPdfBytes(
  input: PdfInput,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const header = new Uint8Array(
      await input.blob.slice(0, 1024).arrayBuffer(),
    );
    if (!new TextDecoder("latin1").decode(header).includes("%PDF-"))
      throw new PdfError("UNSUPPORTED_TYPE", input.id);
    return new Uint8Array(await input.blob.arrayBuffer());
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError("UNREADABLE_FILE", input.id);
  }
}
