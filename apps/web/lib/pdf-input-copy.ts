/**
 * What the PDF tools say when the chosen file is refused before anything is
 * read (M7D). One wording for all ten PDF tools, so the same file gets the same
 * answer wherever it is dropped, and the answer names the real cause. Over the
 * size limit stays with each tool, because the limit differs.
 *
 * Merge keeps its own longer wording for these two, because it shows a list
 * and tells the person to remove the row.
 */
export const pdfInputCopy = {
  EMPTY_INPUT: "This file is empty. Choose a PDF with pages.",
  UNSUPPORTED_TYPE:
    "This file is not a supported PDF. Choose a file whose name ends in .pdf.",
} as const;
