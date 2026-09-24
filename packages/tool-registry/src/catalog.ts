export const categories = [
  {
    id: "convert",
    title: "Convert",
    description: "Move between document and image formats.",
  },
  {
    id: "organize",
    title: "Organize",
    description: "Put pages in the order you need.",
  },
  {
    id: "optimize",
    title: "Optimize",
    description: "Review file size and supported metadata.",
  },
  {
    id: "extract",
    title: "Extract",
    description: "Take out the pages or text you need.",
  },
] as const;

export type CategoryId = (typeof categories)[number]["id"];
export type ProcessingMode = "LOCAL" | "SERVER" | "HYBRID";
export type PageAvailability = "planned" | "preview";

export interface AcceptedType {
  readonly mime: string;
  readonly extensions: readonly string[];
}

export interface ToolDefinition {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: CategoryId;
  readonly acceptedTypes: readonly AcceptedType[];
  readonly processingMode: ProcessingMode;
  readonly relatedSlugs: readonly string[];
  readonly featured: boolean;
  readonly availability: PageAvailability;
}

const pdf = [{ mime: "application/pdf", extensions: [".pdf"] }] as const;

// Current approved MVP intent. Changes to processing location require review.
// Descriptive accepted types are not file validation or a processing contract.
export const tools: readonly ToolDefinition[] = [
  {
    slug: "merge-pdf",
    title: "Merge PDF",
    description: "Combine PDFs in the order you choose.",
    category: "organize",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["split-pdf", "organize-pdf"],
    featured: true,
    availability: "preview",
  },
  {
    slug: "compress-pdf",
    title: "Compress PDF",
    description:
      "Explore ways to reduce PDF file size. Results will depend on the document.",
    category: "optimize",
    acceptedTypes: pdf,
    processingMode: "HYBRID",
    relatedSlugs: ["remove-pdf-metadata", "merge-pdf"],
    featured: true,
    availability: "planned",
  },
  {
    slug: "split-pdf",
    title: "Split PDF",
    description: "Separate a PDF into the page ranges you need.",
    category: "organize",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["extract-pdf-pages", "merge-pdf"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "jpg-to-pdf",
    title: "Images to PDF",
    description: "Arrange JPG and PNG images into a PDF.",
    category: "convert",
    acceptedTypes: [
      { mime: "image/jpeg", extensions: [".jpg", ".jpeg"] },
      { mime: "image/png", extensions: [".png"] },
    ],
    processingMode: "LOCAL",
    relatedSlugs: ["pdf-to-jpg", "merge-pdf"],
    featured: true,
    availability: "planned",
  },
  {
    slug: "pdf-to-jpg",
    title: "PDF to JPG",
    description: "Turn PDF pages into JPG images.",
    category: "convert",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["jpg-to-pdf", "extract-pdf-pages"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "pdf-to-word",
    title: "PDF to Word",
    description:
      "Convert supported PDFs to DOCX. Conversion quality is still under review.",
    category: "convert",
    acceptedTypes: pdf,
    processingMode: "SERVER",
    relatedSlugs: ["word-to-pdf", "pdf-to-text"],
    featured: true,
    availability: "planned",
  },
  {
    slug: "word-to-pdf",
    title: "Word to PDF",
    description: "Convert DOCX documents to PDF.",
    category: "convert",
    acceptedTypes: [
      {
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extensions: [".docx"],
      },
    ],
    processingMode: "SERVER",
    relatedSlugs: ["pdf-to-word", "merge-pdf"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "organize-pdf",
    title: "Organize PDF",
    description: "Reorder PDF pages into a useful sequence.",
    category: "organize",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["rotate-pdf", "delete-pdf-pages"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "extract-pdf-pages",
    title: "Extract PDF Pages",
    description: "Keep selected pages in a separate PDF.",
    category: "extract",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["split-pdf", "delete-pdf-pages"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "delete-pdf-pages",
    title: "Delete PDF Pages",
    description: "Remove unwanted pages from a PDF.",
    category: "organize",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["extract-pdf-pages", "organize-pdf"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "rotate-pdf",
    title: "Rotate PDF",
    description: "Change the orientation of selected PDF pages.",
    category: "organize",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["organize-pdf", "merge-pdf"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "remove-pdf-metadata",
    title: "Remove PDF Metadata",
    description:
      "Remove supported metadata fields. This will not guarantee removal of every identifying detail.",
    category: "optimize",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["compress-pdf", "pdf-to-text"],
    featured: false,
    availability: "planned",
  },
  {
    slug: "pdf-to-text",
    title: "PDF to Text",
    description:
      "Extract text from text-based PDFs. Scanned pages will need a different approach.",
    category: "extract",
    acceptedTypes: pdf,
    processingMode: "LOCAL",
    relatedSlugs: ["pdf-to-word", "extract-pdf-pages"],
    featured: false,
    availability: "planned",
  },
];
