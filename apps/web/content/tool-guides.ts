/**
 * Original guide copy for each available tool (M6B, ADR-029).
 *
 * Rules for this file:
 *  - Every statement must be true of the shipped tool. The sources are the tool
 *    pages themselves and the decision records (ADR-012 to ADR-025).
 *  - No figures that already live in the registry (file counts, sizes, page
 *    caps). The workspace shows them from the registry, so copying them here
 *    would let the two drift apart.
 *  - No "up to X%" savings, no speed promises, no guarantees the tool does not
 *    make. Say what it does not do as plainly as what it does.
 *  - Written per tool. A test fails if a sentence is reused between tools.
 *
 * Tools are looked up by registry slug, so a guide can only describe a tool the
 * registry knows about, and a test fails if an available tool has no guide.
 */

import { ABANDONED_JOB_IDLE_MINUTES } from "../lib/retention";

export interface ToolFaq {
  readonly question: string;
  readonly answer: string;
}

export interface ToolGuideContent {
  /** What the tool does, in two sentences or fewer. */
  readonly overview: string;
  /** Three to five steps, in the order the page presents them. */
  readonly steps: readonly string[];
  /** Behaviour, limits and honest caveats not obvious from the page. */
  readonly goodToKnow: readonly string[];
  /** Three or four real questions with direct answers. */
  readonly faq: readonly ToolFaq[];
}

export const toolGuides: Readonly<Record<string, ToolGuideContent>> = {
  "merge-pdf": {
    overview:
      "Merge PDF joins two or more PDF files into a single document. You decide the order, and every page is copied across as it is, so text stays selectable and nothing is turned into a picture.",
    steps: [
      "Choose at least two PDFs, or drop them onto the file area. You can add more files at any time.",
      "Check the list. Use the earlier and later buttons to put the files in order, and remove any you do not want.",
      "Select Merge PDFs and wait while your browser builds the new document.",
      "Download merged.pdf and open it to check the order before you send or delete anything.",
    ],
    goodToKnow: [
      "Pages keep their size and rotation, so a mix of portrait and landscape files stays mixed.",
      "The same file can be added more than once if you want its pages repeated.",
      "Merging copies page content only. Bookmarks and fillable form fields from the originals may be lost, and a digital signature will no longer be valid in the merged file.",
      "Your original files are never changed. Merge only builds a new document.",
      "A password-protected file stops the merge with a message. Save an unprotected copy from the program that created it and add that instead.",
    ],
    faq: [
      {
        question: "How do I merge PDFs in a particular order?",
        answer:
          "Add the files, then move each one up or down the list until the order is right. The merged document follows the list from top to bottom.",
      },
      {
        question: "Will merging lower the quality of my PDFs?",
        answer:
          "No. Pages are copied directly instead of being redrawn, so text, images and layout match the originals.",
      },
      {
        question: "Can I merge scanned PDFs?",
        answer:
          "Yes. A scan is a PDF made of page images, and those pages are copied like any other. Merging does not add searchable text, so a scan stays unsearchable.",
      },
      {
        question: "Is there a limit on how many files I can merge?",
        answer:
          "Yes. The current limits are shown beside the Merge PDFs button. They keep the work reliable inside a single browser tab.",
      },
    ],
  },

  "compress-pdf": {
    overview:
      "Compress PDF makes a PDF smaller by shrinking the images inside it. Text, fonts, drawings and page layout are left exactly as they are, so only the pictures change.",
    steps: [
      "Choose one PDF.",
      "Pick a strength. Light keeps the most detail, Balanced is the recommended default, and Strong gives the smallest file.",
      "Start compression. Your browser works through the images and checks the finished file.",
      "Compare the sizes shown for your file and download compressed.pdf. If it is not small enough, go back and try another strength.",
    ],
    goodToKnow: [
      "Scanned documents and photo-heavy PDFs have the most to gain, because most of their size is in images.",
      "A PDF that is mostly text or line drawings is already compact. For those files the tool may find little or nothing to save.",
      "A compressed copy is offered only when it is at least 1% smaller. Otherwise you are told nothing useful was found, and no file is created.",
      "Resized images are saved as JPEG, which discards some fine detail. Strong shows this most, especially in photos and scans.",
      "Screenshots and flat-colour diagrams are not converted to JPEG, because that would blur their sharp edges. The result panel lists what was left unchanged and why.",
    ],
    faq: [
      {
        question: "How much smaller will my PDF get?",
        answer:
          "That depends entirely on what is inside it, so no figure can be promised. The result shows the exact before and after sizes for your file.",
      },
      {
        question: "Does compressing remove text or make it unsearchable?",
        answer:
          "No. Text and fonts are not touched, so you can still search and select text in the compressed copy.",
      },
      {
        question: "Why did my PDF not get smaller?",
        answer:
          "Usually because it has no large images to reduce. Try Strong once, since it resizes images more firmly. If that also fails, the file is probably as small as this tool can make it.",
      },
      {
        question: "Which strength should I choose?",
        answer:
          "Start with Balanced, which suits email and screens. Choose Light when image quality matters, and Strong only when size matters more than fine detail.",
      },
    ],
  },

  "split-pdf": {
    overview:
      "Split PDF cuts one document into several smaller ones. Describe the groups of pages you want, or turn individual pages into separate files.",
    steps: [
      "Choose one PDF. Page previews appear so you can see what you are splitting.",
      "Pick a mode: Range groups, or Individual selected pages.",
      "In Range groups, type the pages for each group, such as 1-3 or 2, 5, 8-10, and add a group for every file you want. In the other mode, select the pages instead.",
      "Create the files, then download the result.",
    ],
    goodToKnow: [
      "Each range group becomes its own PDF. A single page, a range, or a comma-separated mix of both is accepted, counted from page 1.",
      "Within one group a page can be named only once, so 2-4, 3 is rejected. The same page can appear in different groups.",
      "One output downloads as a plain PDF. Several outputs arrive together in one ZIP file, named split-01.pdf, split-02.pdf and so on.",
      "Every file is built and checked before anything is offered, so you never receive a half-finished set.",
      "Splitting copies pages only. Bookmarks, form fields and signatures from the original are not carried over.",
    ],
    faq: [
      {
        question: "How do I split a PDF into separate pages?",
        answer:
          "Choose Individual selected pages and select the pages you want as their own files. A single split can create only a limited number of files, so split a long document in stages.",
      },
      {
        question: "What is the difference between Split and Extract?",
        answer:
          "Split can produce many files in one go. Extract PDF Pages produces a single file holding the pages you pick.",
      },
      {
        question: "Can two files share the same page?",
        answer:
          "Yes. A page may be reused in different groups, which is handy for a cover page or an appendix that belongs in every file.",
      },
      {
        question: "Why do I get a ZIP instead of a PDF?",
        answer:
          "A ZIP is used whenever the split makes more than one file, so a single download carries them all.",
      },
    ],
  },

  "jpg-to-pdf": {
    overview:
      "Images to PDF turns JPG and PNG pictures into one PDF, with one image on each page. It suits receipts, handwritten notes, photographed documents and anything else you need to send as a single file.",
    steps: [
      "Choose your JPEG or PNG images, or drop them in. You can add more later.",
      "Arrange them. Each picture has earlier and later buttons, and the order you set is the page order.",
      "Choose a layout: page size, orientation, and how each image fits its page.",
      "Create the PDF and download images-to-pdf.pdf.",
    ],
    goodToKnow: [
      "Page size can be Auto, A4 or Letter. Auto gives each page the size of its image, while A4 and Letter use standard paper sizes.",
      "Contain shows the whole image with margins where the shapes differ. Cover fills the page and crops whatever does not fit.",
      "Orientation can follow each image or be forced to portrait or landscape.",
      "Transparent areas of a PNG are placed on white, so they print white rather than black.",
      "Photos taken sideways are turned the right way up using the orientation the camera recorded.",
      "Only the picture itself goes into the PDF. Camera details, location and other information stored inside a JPEG or PNG file are left out.",
    ],
    faq: [
      {
        question: "Can I combine JPG and PNG images in one PDF?",
        answer:
          "Yes. Both formats can be mixed, and each image gets its own page.",
      },
      {
        question: "How do I make a photo fill the whole page?",
        answer:
          "Set the image fit to Cover. The picture is scaled until it fills the page, and any edges that do not fit are cropped.",
      },
      {
        question: "Will the pictures lose quality?",
        answer:
          "Pictures are not shrunk or degraded to make the PDF smaller. A JPEG is re-saved only when it has to be turned upright.",
      },
      {
        question: "Can I put several images on one page?",
        answer:
          "Not in this tool. Each image becomes its own page, so build a page layout elsewhere first if you need several pictures together.",
      },
    ],
  },

  "pdf-to-jpg": {
    overview:
      "PDF to JPG turns pages of a PDF into ordinary pictures that you can share, post or edit in any image program. You choose which pages to convert and how sharp the pictures should be.",
    steps: [
      "Choose one PDF. Thumbnails of its pages appear.",
      "Pick the pages to convert, either every page or a selection.",
      "Choose a resolution: 96, 150 or 300 DPI.",
      "Convert, then download. One page arrives as a single JPG, and several pages arrive together in a ZIP.",
    ],
    goodToKnow: [
      "150 DPI is the default and a sensible middle. 96 DPI gives smaller images for screens, and 300 DPI keeps more detail for printing or zooming in.",
      "Resolution sets the pixel size of each picture. At 150 DPI an A4 page comes out at roughly 1,240 by 1,754 pixels, and at 300 DPI roughly 2,480 by 3,508.",
      "Every page is drawn on a white background, so transparent areas of the PDF appear white.",
      "Rotated pages come out the way you see them in the preview.",
      "A JPG is a picture. Text in the images can no longer be selected or searched.",
      "Pages are converted one after another. If any page fails, the whole batch is cancelled, so you are never handed a partial set.",
    ],
    faq: [
      {
        question: "What DPI should I choose?",
        answer:
          "For viewing on screen or sending in a message, 96 or 150 is plenty. Choose 300 when the images will be printed or when you need to zoom in on fine detail.",
      },
      {
        question: "Can I convert only some pages?",
        answer:
          "Yes. Select specific pages in the preview before converting, and only those pages are rendered.",
      },
      {
        question: "Why did I get a ZIP file?",
        answer:
          "Whenever more than one page is converted, the images are packed into a single ZIP so you download them together. A single page comes as a plain JPG.",
      },
      {
        question: "Is there a limit on pages or image size?",
        answer:
          "Yes. A single conversion can include only a limited number of pages and pixels, and the page tells you if a request goes over.",
      },
    ],
  },

  "word-to-pdf": {
    overview:
      "Word to PDF converts a .docx document into a PDF that looks the same on any device and is easy to send. Unlike most tools here, this conversion runs on our server rather than in your browser.",
    steps: [
      "Choose a DOCX file, or drop it onto the file area.",
      "Read the privacy note, then start the conversion. The file is uploaded over an encrypted connection.",
      "Wait while the document is converted. Longer documents take longer.",
      "Download the PDF and open it to check the layout before you send it.",
    ],
    goodToKnow: [
      "Converting Word documents needs a full word-processing engine, so this tool uses LibreOffice on our server.",
      `Your file is removed from the server as soon as your PDF has been downloaded. If a conversion is abandoned, for example because the tab was closed, a cleanup process deletes the leftover file automatically once it has been idle for ${ABANDONED_JOB_IDLE_MINUTES} minutes.`,
      "Only .docx files are accepted. Older .doc files, macro-enabled files and password-protected documents are not supported.",
      "The PDF may not match Word exactly. Fonts that are not available on the server may be replaced with similar ones, and unusual features can shift the layout.",
      "If the service is busy or unavailable you will see a message and can try again in a moment.",
    ],
    faq: [
      {
        question: "Is it safe to upload my document?",
        answer:
          "The file travels over an encrypted connection, is converted on our own server, and is deleted once you have downloaded the result. It is not shared with third parties. If you would rather not upload a particular file, do not use this tool; the other available tools work entirely on your device.",
      },
      {
        question: "Why does my PDF look different from the Word file?",
        answer:
          "Word and LibreOffice lay out text in slightly different ways, and fonts can differ between computers. Common fonts and plain formatting give the most predictable result, so compare the PDF with your original.",
      },
      {
        question: "Can I convert a PDF back to Word?",
        answer:
          "Not yet. PDF to Word is planned for a later version. We tested it and are holding it back until the quality is good enough to rely on.",
      },
      {
        question: "Can I rely on every feature of my document converting?",
        answer:
          "The aim is a faithful page appearance, but no promise is made for each feature of a Word file. Check anything important in the PDF before you share it.",
      },
    ],
  },

  "organize-pdf": {
    overview:
      "Organize PDF lets you rearrange the pages of a single PDF. Page previews show what you are moving, so you can fix a scrambled scan or reorder a report without guessing.",
    steps: [
      "Choose one PDF. Each page appears as a thumbnail with its current position.",
      "Move pages with the earlier and later buttons under each thumbnail until the sequence is right.",
      "Create the new PDF.",
      "Download organized.pdf and check the order.",
    ],
    goodToKnow: [
      "Pages move with buttons rather than by dragging, which suits keyboards, screen readers and touch screens alike. The first page cannot move earlier and the last cannot move later.",
      "Only the order changes. Page content, size and rotation stay as they were.",
      "Thumbnails are drawn on your device for orientation only. The new PDF is built from the original pages, not from the pictures.",
      "Bookmarks, form fields and signatures from the original are not promised to survive reordering.",
    ],
    faq: [
      {
        question: "How do I reorder pages in a PDF?",
        answer:
          "Choose the file, move pages earlier or later until the thumbnails show the order you want, then create and download the new PDF.",
      },
      {
        question: "Can I remove or rotate pages here as well?",
        answer:
          "No, this tool only changes the order. Use Delete PDF Pages to remove pages and Rotate PDF to turn them, then come back to reorder.",
      },
      {
        question: "Why are the printed page numbers now out of sequence?",
        answer:
          "Printed numbers are part of each page itself, so they travel with the page. Reordering moves pages but does not renumber what is printed on them.",
      },
    ],
  },

  "extract-pdf-pages": {
    overview:
      "Extract PDF Pages pulls the pages you choose out of a PDF and saves them as a new, smaller document. The original stays as it is.",
    steps: [
      "Choose one PDF.",
      "Select the pages you want to keep by ticking their thumbnails. Select all pages and Clear selection help with long documents.",
      "Create your extracted PDF.",
      "Download extracted-pages.pdf.",
    ],
    goodToKnow: [
      "The new file keeps the selected pages in the order they appear in the original.",
      "Page content, size and rotation are copied without change.",
      "At least one page must be selected before you can create the file.",
      "Extract makes exactly one file. To make several different files from one document, use Split PDF.",
    ],
    faq: [
      {
        question: "How do I save a single page from a PDF?",
        answer:
          "Select that one page and create the extracted PDF. The download contains just that page.",
      },
      {
        question:
          "What is the difference between extracting and deleting pages?",
        answer:
          "They reach the same kind of result from opposite directions. Extract starts from the pages you want to keep, while Delete starts from the pages you want to lose. Use whichever is quicker to select.",
      },
      {
        question: "Will extracted pages keep their form fields and bookmarks?",
        answer:
          "Document-level features such as bookmarks, forms and signatures are not guaranteed to carry over, so check the result if you rely on them.",
      },
    ],
  },

  "delete-pdf-pages": {
    overview:
      "Delete PDF Pages removes the pages you do not want and keeps the rest in their original order. It is a quick way to drop a blank page, a cover sheet or a scan that went wrong.",
    steps: [
      "Choose one PDF.",
      "Mark the pages you want to remove by selecting their thumbnails.",
      "Select Export remaining pages.",
      "Download pages-removed.pdf.",
    ],
    goodToKnow: [
      "Pages are only marked until you export. Clear a mark at any time to change your mind.",
      "The pages that remain keep their relative order, size and rotation.",
      "You cannot remove every page. At least one must remain.",
      "The new PDF simply leaves those pages out. This is not a secure-erasure tool, and your original file still contains the pages.",
    ],
    faq: [
      {
        question: "How do I delete a page from a PDF?",
        answer:
          "Choose the file, mark the unwanted page in the thumbnails, export, and download the PDF without it.",
      },
      {
        question: "Can I undo a deletion?",
        answer:
          "Before you export, yes: clear the removal mark. After downloading, your original file is unchanged, so you can start again from it.",
      },
      {
        question: "Can I delete pages from several PDFs at once?",
        answer:
          "Work on one PDF at a time. If you want a single document afterwards, join the cleaned files with Merge PDF.",
      },
    ],
  },

  "rotate-pdf": {
    overview:
      "Rotate PDF turns pages sideways or upside down. Fix one scanned page that came in the wrong way, or turn the whole document at once.",
    steps: [
      "Choose one PDF.",
      "Pick the scope. Select pages and use Rotate selected left or right, or use Rotate all left or right for the whole document.",
      "Repeat as needed. Each press is one quarter turn, and turns add up.",
      "Create the rotated PDF and download rotated.pdf.",
    ],
    goodToKnow: [
      "Rotation is applied on top of whatever orientation a page already has, so pages that were turned in the original end up correct too.",
      "Thumbnails show the rotation you have asked for before you create the file.",
      "Rotating changes how a page is displayed. It does not redraw or alter the text and images on it.",
      "At least one page must be rotated before you can export.",
    ],
    faq: [
      {
        question: "How do I rotate just one page in a PDF?",
        answer:
          "Select that page and press Rotate selected left or Rotate selected right. Pages you leave unselected are not changed.",
      },
      {
        question: "Will the rotation hold when I open the file elsewhere?",
        answer:
          "Yes. The new file stores the rotation for each page, and standard PDF viewers respect it.",
      },
      {
        question: "Can I rotate by an angle other than 90 degrees?",
        answer:
          "No. Pages turn in quarter turns only, so the total for any page is 90, 180 or 270 degrees.",
      },
    ],
  },

  "remove-pdf-metadata": {
    overview:
      "Remove PDF Metadata clears the descriptive details stored inside a PDF, such as the author, the title and the program that made it, so they are not passed on when you share the file.",
    steps: [
      "Choose one PDF and read the note about what the tool does and does not remove.",
      "Start cleaning.",
      "Review the verification summary, which reports what was found and what was removed.",
      "Download metadata-removed.pdf.",
    ],
    goodToKnow: [
      "It removes the Document Information fields (title, author, subject, keywords, creator, producer, dates and any custom fields), the XMP metadata stream, and the file identifier where the tool is able to.",
      "It checks its own work by reopening the cleaned file, and it says so plainly when something could not be removed, such as the file identifier in some PDFs.",
      "This is not redaction. Text and images on the pages are left as they are, and the tool makes no promise about other hidden content, such as embedded attachments or signature data.",
      "Names or details that appear on the pages themselves are not hidden.",
      "A photo placed in a PDF can still carry its own camera details, such as where it was taken, because the images inside the pages are not changed.",
    ],
    faq: [
      {
        question: "What is PDF metadata?",
        answer:
          "It is information stored alongside the visible pages, such as who created the file, which software produced it and when it was made. Most viewers never show it, but it travels with the file.",
      },
      {
        question: "Does this make a PDF anonymous?",
        answer:
          "No. It removes the standard hidden fields only. Details on the pages and other hidden data can remain, so treat the result as one step rather than a guarantee.",
      },
      {
        question: "Why would I remove metadata?",
        answer:
          "Documents often record their author, their software and their dates. Clearing those fields before you share a file publicly keeps that background private.",
      },
    ],
  },

  "pdf-to-text": {
    overview:
      "PDF to Text pulls the words out of a PDF and gives them to you as plain text you can copy or download. It works on PDFs that contain real text, such as exports from word processors, web pages and many reports.",
    steps: [
      "Choose one PDF.",
      "Start extraction. The text is collected page by page.",
      "Read the preview to check that it looks right.",
      "Copy the text, or download extracted-text.txt.",
    ],
    goodToKnow: [
      "Scanned or photographed pages are pictures with no text to pull out. If no page has text the tool says so, and it does not attempt character recognition (OCR).",
      "If only some pages lack text, you still receive the rest, and the pages without text are listed.",
      "Text comes out in the order the PDF stores it. Columns, tables and sidebars can appear in an unexpected order, because the tool does not try to rebuild the layout.",
      "Formatting such as bold, fonts and images is dropped. Only the characters remain.",
      "The preview can be shortened for very long documents, but Copy and Download always give you the full text.",
      "The download is UTF-8, so text in other languages opens correctly in most editors.",
    ],
    faq: [
      {
        question:
          "How do I copy text from a PDF that will not let me select it?",
        answer:
          "That is usually a scanned page. If the preview reports no text, the page is an image and this tool cannot read it. You would need OCR software for that.",
      },
      {
        question: "Can PDF to Text handle tables?",
        answer:
          "It extracts the words in a table, but not the grid. Expect cell contents to run together or appear line by line.",
      },
      {
        question: "Where does the extracted text go?",
        answer:
          "Nowhere else. It stays in your browser until you copy it or download it.",
      },
      {
        question: "Can I get a Word document instead?",
        answer:
          "Not at the moment. PDF to Word is on the plan for a later release, and for now plain text is the editable output this site offers.",
      },
    ],
  },
};

export function getToolGuide(slug: string): ToolGuideContent | undefined {
  return toolGuides[slug];
}
