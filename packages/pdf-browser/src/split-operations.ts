import { PageError } from "./page-errors";
import { validatePagePlan } from "./page-model";
import { createPageOutputBytes, loadPageSource } from "./page-operations";
import type { PageInput, PageLimits } from "./page-types";
import type { SplitLimits, SplitOptions, SplitResult } from "./split-types";
import type { PagePlan } from "./page-model";

const filename = (index: number) =>
  `split-${String(index + 1).padStart(2, "0")}.pdf`;

export async function splitPdf(
  input: PageInput,
  plans: readonly PagePlan[],
  pageLimits: PageLimits,
  limits: SplitLimits,
  options: SplitOptions = {},
): Promise<SplitResult> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  try {
    if (
      !plans.length ||
      plans.length > limits.maxOutputs ||
      !Number.isSafeInteger(limits.maxOutputs) ||
      limits.maxOutputs < 1 ||
      !Number.isSafeInteger(limits.maxCombinedPdfBytes) ||
      limits.maxCombinedPdfBytes < 1 ||
      !Number.isSafeInteger(limits.maxArchiveBytes) ||
      limits.maxArchiveBytes < 1
    )
      throw new PageError("OUTPUT_LIMIT");
    for (const plan of plans) {
      validatePagePlan(plan);
      if (
        plan.sessionId !== input.id ||
        plan.sessionId !== plans[0].sessionId ||
        plan.sourcePageCount !== plans[0].sourcePageCount
      )
        throw new PageError("INVALID_PLAN");
    }
    options.onPhase?.("reading");
    const source = await loadPageSource(input, plans[0], pageLimits, cancelled);
    const outputs: Uint8Array[] = [];
    let combinedPdfBytes = 0;
    let pageCount = 0;
    for (const plan of plans) {
      options.onPhase?.("transforming");
      const output = await createPageOutputBytes(
        source,
        plan,
        pageLimits,
        cancelled,
        () => options.onPhase?.("validating"),
      );
      combinedPdfBytes += output.bytes.byteLength;
      if (combinedPdfBytes > limits.maxCombinedPdfBytes)
        throw new PageError("OUTPUT_LIMIT");
      pageCount += output.pageCount;
      outputs.push(output.bytes);
    }
    cancelled();
    if (outputs.length === 1)
      return {
        blob: new Blob([new Uint8Array(outputs[0]).buffer], {
          type: "application/pdf",
        }),
        kind: "pdf",
        fileCount: 1,
        pageCount,
        combinedPdfBytes,
      };

    options.onPhase?.("archiving");
    const { zipSync } = await import("fflate");
    cancelled();
    const entries = Object.fromEntries(
      outputs.map((output, index) => [filename(index), output]),
    );
    const archive = zipSync(entries, { level: 0 });
    cancelled();
    if (archive.byteLength > limits.maxArchiveBytes)
      throw new PageError("OUTPUT_LIMIT");
    return {
      blob: new Blob([new Uint8Array(archive).buffer], {
        type: "application/zip",
      }),
      kind: "zip",
      fileCount: outputs.length,
      pageCount,
      combinedPdfBytes,
    };
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("OPERATION_FAILED");
  }
}
