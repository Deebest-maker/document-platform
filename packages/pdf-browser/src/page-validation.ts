import { PageError } from "./page-errors";
import type { PageInput, PageLimits } from "./page-types";

export function validatePageInput(input: PageInput, limits: PageLimits) {
  if (
    !limits ||
    [limits.maxInputBytes, limits.maxPages, limits.maxOutputBytes].some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    ) ||
    !input ||
    !(input.blob instanceof Blob) ||
    input.blob.size < 1 ||
    input.blob.size > limits.maxInputBytes
  )
    throw new PageError("INPUT_LIMIT");
}
export async function readPageInput(
  input: PageInput,
  limits: PageLimits,
): Promise<Uint8Array<ArrayBuffer>> {
  validatePageInput(input, limits);
  try {
    const header = new TextDecoder("latin1").decode(
      await input.blob.slice(0, 1024).arrayBuffer(),
    );
    if (!header.includes("%PDF-")) throw new PageError("INVALID_PDF");
    return new Uint8Array(await input.blob.arrayBuffer());
  } catch {
    throw new PageError("INVALID_PDF");
  }
}
