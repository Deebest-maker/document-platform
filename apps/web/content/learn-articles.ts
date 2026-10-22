/**
 * Original Learn guides (M6C, ADR-031).
 *
 * Rules for this file:
 *  - Every statement must be true of the shipped tools. The sources are the
 *    tool pages and the decision records (ADR-012 to ADR-030). General PDF
 *    knowledge is allowed where it is standard and does not depend on us.
 *  - No numbers that live in the registry (file counts, sizes, page caps), no
 *    "up to X%" savings, no speed promises, no guarantees the tools do not make.
 *  - Written one guide at a time. A test fails if a sentence is reused between
 *    guides, or between a guide and any tool guide.
 *  - Links are tokens such as {tool:merge-pdf} and {learn:slug|text}; see
 *    lib/learn-text.ts. A token that points at nothing real fails the build.
 *
 * Nothing here names an author or a publication date: there is no approved
 * byline yet (M6D), and inventing one would be a false claim.
 */

export type LearnBlock =
  | string
  | { readonly list: readonly string[] }
  | { readonly steps: readonly string[] };

export interface LearnSection {
  readonly heading: string;
  readonly blocks: readonly LearnBlock[];
}

export interface LearnArticle {
  /** URL segment: /learn/{slug}. */
  readonly slug: string;
  /** The page's H1 and the link text everywhere else. */
  readonly title: string;
  /** Meta description: plain text, no link tokens. */
  readonly description: string;
  /** One or two plain sentences for the hub and home page. */
  readonly summary: string;
  /** Opening paragraph; may contain link tokens. */
  readonly intro: string;
  /** Registry slugs of the tools this guide is about, primary first. */
  readonly tools: readonly string[];
  /** Slugs of other guides to read next. */
  readonly related: readonly string[];
  /** Shown on the home page. */
  readonly featured?: boolean;
  readonly sections: readonly LearnSection[];
}

export const learnArticles: readonly LearnArticle[] = [
  {
    slug: "merge-pdfs-without-uploading",
    title: "How to merge PDFs without uploading them",
    description:
      "Join several PDFs into one document inside your browser, so the files never leave your device. What carries over, what does not, and how to check.",
    summary:
      "Join PDFs in the order you want without sending them anywhere, and see how to confirm that for yourself.",
    intro:
      "The documents people most often need to combine are the ones they least want to hand over: contracts, identity papers, invoices and medical letters. Joining PDFs does not require a stranger's server. Your browser can read the files you choose, copy their pages into a new document and give the result back as a download, without the files travelling anywhere.",
    tools: ["merge-pdf", "organize-pdf", "delete-pdf-pages", "compress-pdf"],
    related: [
      "make-a-pdf-smaller",
      "split-a-pdf-or-keep-some-pages",
      "what-processed-on-your-device-means",
    ],
    featured: true,
    sections: [
      {
        heading: "Why a merge can stay on your device",
        blocks: [
          "Merging is a copying job, not a conversion. Each page of a PDF already contains or points to everything it needs in order to display, so combining files means writing those pages one after another into a fresh document. That is light enough work for a browser tab, which is how {tool:merge-pdf} can join your files without sending them to a server.",
          "Because pages are copied instead of redrawn, text stays selectable and pictures keep the quality they had. A page that was landscape in its original file is still landscape in the result.",
        ],
      },
      {
        heading: "The steps",
        blocks: [
          {
            steps: [
              "Open {tool:merge-pdf} and choose your files, or drop them onto the page. Add PDFs lets you include more later.",
              "Arrange the list. Move earlier and Move later change where a file's pages land in the result, and Remove leaves a file out.",
              "Select Merge PDFs. Your browser builds the new document and reopens it to check it before offering a download.",
              "Download the result, merged.pdf, and page through it once before you share it.",
            ],
          },
        ],
      },
      {
        heading: "Get the order right, then tidy",
        blocks: [
          "Most merges go wrong in the order, not in the joining. Look at the first and last page of each part in the finished document, because a missing cover sheet or a page from the wrong file is easy to spot there.",
          "If a page ended up in the wrong place you do not need to start again. Use {tool:organize-pdf} on the merged file to move it, and {tool:delete-pdf-pages} to drop a blank or duplicate page.",
        ],
      },
      {
        heading: "What carries over, and what does not",
        blocks: [
          {
            list: [
              "Page content. Text, images and drawings come across as they are, and every page keeps its own size and rotation.",
              "Scans. A scanned file is made of page pictures, so it joins like any other, but it does not gain searchable text.",
              "Bookmarks and fillable form fields. These belong to the whole document rather than to a page, so they may not survive.",
              "Digital signatures. A signature vouches for one exact version of a file, and a merged file is a new document, so the signature will no longer validate.",
              "Password-protected files. Merging refuses them and says why, so open the original in its own program, save a copy without the password and add that copy.",
            ],
          },
          "Your originals are not modified, so keep them until you have checked the merged file.",
        ],
      },
      {
        heading: "Check for yourself that nothing was uploaded",
        blocks: [
          "You should not have to take a website's word for this. In Chrome, Edge and Firefox you can open the developer tools with F12, or with Cmd+Option+I on a Mac, and choose the Network tab. Safari needs its Develop menu switched on in Settings first. Run a merge and you will see requests for the page's own scripts and styles, but none that carries your PDFs.",
          "We test the same thing automatically. Our browser tests fail if, while a tool runs on your device, the page contacts another website, sends anything other than a GET or HEAD request, or calls an upload or processing address.",
          "Local processing is not magic, and it helps to be clear about what it asks of you. The page's code still comes from our server, so you are trusting that code, and the Network tab is how you confirm it behaves as described. {learn:what-processed-on-your-device-means|The guide on what “processed on your device” means} goes into more detail.",
        ],
      },
      {
        heading: "When the result is too big to send",
        blocks: [
          "Joining files adds their sizes together, and email and upload forms often have a size limit. If the merged file is over it, run {tool:compress-pdf} on the result: pictures are what make most PDFs heavy, and {learn:make-a-pdf-smaller|this guide} explains what can and cannot be shrunk. If you only need part of the document, {learn:split-a-pdf-or-keep-some-pages|splitting or extracting pages} may be quicker.",
        ],
      },
    ],
  },

  {
    slug: "make-a-pdf-smaller",
    title: "How to make a PDF smaller, and when you cannot",
    description:
      "Why PDFs get large, what shrinking one really changes, and why some files are already as small as they will go. Includes how to use Compress PDF.",
    summary:
      "Find out where a PDF's size comes from, what shrinking it changes, and why some files refuse to get smaller.",
    intro:
      "A large PDF is almost always a PDF full of pictures. Text and simple drawings are stored as short instructions and cost very little, while photographs and scans are stored as grids of pixels. Knowing which kind you have tells you whether a file can be made smaller at all.",
    tools: ["compress-pdf", "delete-pdf-pages", "split-pdf"],
    related: [
      "merge-pdfs-without-uploading",
      "photos-and-scans-into-one-pdf",
      "split-a-pdf-or-keep-some-pages",
    ],
    featured: true,
    sections: [
      {
        heading: "Where the size comes from",
        blocks: [
          "An A4 page scanned at 300 dots per inch holds about 2,480 by 3,508 pixels, which is roughly 8.7 million of them. Scan the same page at 150 dots per inch and it holds about a quarter as many. Halving the resolution in both directions removes three quarters of the pixels, which is why resolution is the biggest lever on how heavy a picture is.",
          "A report made only of typed text has no pixels to speak of, so even a long one can be small. A short scan can be larger than a long typed document.",
        ],
      },
      {
        heading: "Two ways to shrink a file",
        blocks: [
          "Lossless methods repack the same content more efficiently, so nothing about the pages changes. Lossy methods store a picture with less detail than before, accepting a small visible loss in return for a much smaller file.",
          "Repacking only helps when a file was packed carelessly to begin with, for example when its producer left parts uncompressed. Photos and scans are usually stored in a compressed image format already, so repacking has little left to squeeze. When we tested ways of shrinking synthetic photo and scan PDFs while building {tool:compress-pdf}, repacking alone saved nothing on those files, and reducing their images saved most of the size.",
        ],
      },
      {
        heading: "What Compress PDF changes",
        blocks: [
          "{tool:compress-pdf} works on the images only. It lowers the resolution of an image that holds more pixels than the chosen strength needs, then saves the image again as a JPEG. Text, fonts, drawings and the layout of every page are not touched, so searching and selecting text still works afterwards.",
          "Three strengths trade detail for size. Light keeps the most detail and shrinks the least, Balanced is the default and suits email and screens, and Strong produces the smallest file with the softest pictures.",
          "Some images are deliberately left alone. Screenshots and flat-colour diagrams stay as they are, because JPEG would smear their sharp edges. Images in print colour modes such as CMYK and images that rely on transparency masks are left alone too, as are images the tool skips because of size, time or browser limits. After a run, the result lists what was left unchanged and why.",
        ],
      },
      {
        heading: "When a PDF cannot get smaller",
        blocks: [
          {
            list: [
              "It is mostly text or line art. There are no heavy pictures to reduce, so there is little or nothing to save.",
              "Its pictures are already efficient. An image that uses few pixels, or is already compressed hard, gains too little to be worth saving again.",
              "Its pictures are of a kind the tool leaves alone, such as screenshots, CMYK images or images with masks.",
              "Nothing worth offering was found. A new file is created only when it is smaller than the original; otherwise you are told, and no download appears.",
            ],
          },
        ],
      },
      {
        heading: "Other ways to get under a size limit",
        blocks: [
          {
            list: [
              "Remove pages you do not need with {tool:delete-pdf-pages}. Cover sheets, blank scans and duplicates add up.",
              "Send the document in parts. {tool:split-pdf} cuts it into several files, and each one is smaller than the whole.",
              "Rescan at a lower resolution if you still have the paper. Scanners often default to far more resolution than reading on a screen needs, and fixing that at the source beats shrinking the file afterwards.",
              "Share a link instead of an attachment when the recipient can open one.",
            ],
          },
        ],
      },
      {
        heading: "Before you rely on the smaller file",
        blocks: [
          "Open the compressed copy and zoom in on the pages that matter, especially pages with small print or fine detail. Keep the original, because shrinking is a one-way change and the lost detail cannot be recovered from the smaller file.",
          "Two warnings apply to any compressed PDF. A digital signature stops validating, because the document has changed, and conformance to archival standards such as PDF/A may be lost.",
        ],
      },
    ],
  },

  {
    slug: "split-a-pdf-or-keep-some-pages",
    title: "How to split a PDF, or keep only some pages",
    description:
      "Choose between splitting, extracting and deleting pages, and learn how to write page ranges that do what you mean, with worked examples.",
    summary:
      "Choose between splitting, extracting and deleting pages, and learn to write page ranges that do what you mean.",
    intro:
      "Three tools here take pages out of a PDF, and they differ in a way that is easy to miss: what you end up with. One produces many files, one produces a single new file, and one produces your document minus the pages you marked. Picking the right one is mostly a question of which pages are fewer to select.",
    tools: [
      "split-pdf",
      "extract-pdf-pages",
      "delete-pdf-pages",
      "organize-pdf",
      "rotate-pdf",
    ],
    related: [
      "merge-pdfs-without-uploading",
      "make-a-pdf-smaller",
      "whats-hidden-in-a-pdf",
    ],
    sections: [
      {
        heading: "Which tool for which job",
        blocks: [
          {
            list: [
              "{tool:split-pdf} makes several files from one document. Use it for chapters, one file per page, or a cover page repeated in every part.",
              "{tool:extract-pdf-pages} makes one new file from the pages you tick. Use it when you want a handful of pages from a long document.",
              "{tool:delete-pdf-pages} makes one new file from everything you did not mark. Use it when only a few pages are unwanted, such as a blank sheet or a scan that went wrong.",
            ],
          },
          "Extracting and deleting reach the same result from opposite sides. To keep three pages out of forty, extract them; to lose three pages out of forty, delete them. Selecting the smaller set is faster and leaves less room for a mistake.",
        ],
      },
      {
        heading: "Writing page ranges in Split PDF",
        blocks: [
          "Range groups use a short notation. A single page is written as its number, a range is two numbers joined by a hyphen, and several of either are separated by commas. So 1-3 means the first three pages, and 2, 5, 8-10 means page 2, page 5 and pages 8 to 10.",
          "Every group becomes its own PDF, so three groups give you three files.",
          "The numbers refer to a page's position in the file, counted from one, and not to the number printed on the page. A report whose first numbered page is the third sheet is still addressed by its position in the file.",
          "One rule applies inside a group: listing the same page twice, as in 2-4, 3, is rejected because it is ambiguous. Different groups are independent, so the same cover page or appendix can open or close several parts.",
        ],
      },
      {
        heading: "Worked examples",
        blocks: [
          {
            list: [
              "Split a twelve-page file into three equal parts: use three groups, 1-4, 5-8 and 9-12.",
              "Put the cover page in front of two chapters: use 1, 2-5 for the first file and 1, 6-9 for the second.",
              "Send only the signature page: select page 12 in Extract PDF Pages.",
              "Remove a blank seventh page: mark it in Delete PDF Pages and export the rest.",
              "Turn selected pages into separate files: choose Individual selected pages in Split PDF and select the pages you want.",
            ],
          },
        ],
      },
      {
        heading: "What you download",
        blocks: [
          "One result arrives as a plain PDF. Two or more arrive together in a single ZIP file, numbered in order from split-01.pdf. Nothing is offered until every file has been built and checked, so a failed split never leaves you with half a set.",
          "Extract and Delete always give you one PDF, named extracted-pages.pdf and pages-removed.pdf.",
        ],
      },
      {
        heading: "What does not travel with the pages",
        blocks: [
          "Pages are copied into new files, but features that belong to the document as a whole, such as bookmarks, form fields and digital signatures, stay behind. Open the result and test anything you depend on. When pages arrive in the wrong order or a page is sideways, {tool:organize-pdf} reorders them and {tool:rotate-pdf} turns them.",
        ],
      },
      {
        heading: "Deleting a page does not erase it",
        blocks: [
          "A file without a page is a new file. Your original still contains the page, and so does every copy you have already shared. If a page holds something that must not be seen, do not send the original alongside the trimmed copy, and read {learn:whats-hidden-in-a-pdf|what else can hide inside a PDF}.",
        ],
      },
    ],
  },

  {
    slug: "photos-and-scans-into-one-pdf",
    title: "How to turn photos or scans into one PDF",
    description:
      "Turn photos or scanned pages into one tidy PDF. Take better pictures, set the order, page size and fit, and know what the finished file can and cannot do.",
    summary:
      "Turn a pile of photos or scanned pages into one tidy PDF, with the order, page size and fit you choose.",
    intro:
      "A phone camera works well as a scanner for most paperwork. The only trouble is that ten separate pictures are awkward to send and easy to lose, while one PDF travels as a single, ordered file. A good result depends on two things: how you take the pictures, and how you lay them out.",
    tools: ["jpg-to-pdf", "merge-pdf", "compress-pdf"],
    related: [
      "copy-text-from-a-pdf",
      "make-a-pdf-smaller",
      "whats-hidden-in-a-pdf",
    ],
    sections: [
      {
        heading: "Take better pictures first",
        blocks: [
          {
            list: [
              "Put the page on a flat surface and hold the phone parallel to it. An angled shot makes one edge look larger and leaves the text slanted.",
              "Use even light and keep your own shadow off the page. Soft daylight beside a window works better than a lamp directly overhead.",
              "Fill the frame with the page but keep all four edges visible, so nothing near the margin is cut off.",
              "Take one picture per page, in reading order, and zoom in to check that the text is sharp.",
            ],
          },
        ],
      },
      {
        heading: "Build the PDF",
        blocks: [
          {
            steps: [
              "Open {tool:jpg-to-pdf} and choose your JPEG or PNG files. You can mix both formats.",
              "Put the pictures in page order with Move earlier and Move later on each one.",
              "Choose a page size, an image fit and a page orientation. The next section explains the choices.",
              "Select Create PDF, then download images-to-pdf.pdf. Every picture becomes one page.",
            ],
          },
        ],
      },
      {
        heading: "Choosing the layout",
        blocks: [
          "Page size decides the paper. Auto gives each page the shape of its picture, which suits reading on a screen. A4 and Letter place every picture on a standard sheet, which suits printing and formal submissions.",
          "Fit decides what happens when a picture and a sheet have different shapes. Contain shows the whole picture with blank margins where needed, while Cover fills the sheet and crops the overflow.",
          "For documents, Contain is the safer choice. Cover can slice off the lines nearest a picture's edge, and a cropped signature or total is hard to notice until someone else does.",
          "Page orientation is Auto by default, which follows each picture, or you can force portrait or landscape. Auto is the better choice when your pictures are a mix of upright and sideways.",
        ],
      },
      {
        heading: "Sideways photos, transparent images and hidden details",
        blocks: [
          "Phones record which way they were held. The tool reads that and turns a sideways photo upright before placing it, so you do not need to rotate pictures by hand first.",
          "A PNG with transparent areas is placed on a white page, so those areas print white and not black.",
          "Photos also carry hidden information, such as the camera model and often the place they were taken. Only the picture goes into the PDF and that information stays behind. Your original photo files still contain it, so remember that before you send them on directly.",
        ],
      },
      {
        heading: "A PDF of pictures is still pictures",
        blocks: [
          "The result looks like a document, but each page is an image. You cannot select or search the words on it, and copying from it returns nothing. {learn:copy-text-from-a-pdf|The guide on copying text from a PDF} explains why, and what to do if you need the words.",
        ],
      },
      {
        heading: "Joining and shrinking the result",
        blocks: [
          "Pictures you take later can be turned into a second PDF and joined to the first with {tool:merge-pdf}. If the finished file is too heavy to send, {tool:compress-pdf} can reduce the pictures, as {learn:make-a-pdf-smaller|this guide} describes.",
          "One thing the tool does not do is place several pictures on a single page. Build that kind of layout in another program first and bring in the finished page as one picture.",
        ],
      },
    ],
  },

  {
    slug: "save-pdf-pages-as-images",
    title: "How to save PDF pages as images",
    description:
      "Turn PDF pages into JPG pictures at 96, 150 or 300 DPI. How resolution works, what you gain and lose by leaving the PDF format, and when to avoid it.",
    summary:
      "Turn PDF pages into JPG pictures at the resolution you need, and know what you gain and lose by doing it.",
    intro:
      "Sometimes a PDF is the wrong container. A page you want to drop into a chat, a slide or a social post is easier to handle as a picture, because everything can open a picture. Turning pages into images is simple; choosing the resolution and understanding the trade-offs is where the thinking is.",
    tools: ["pdf-to-jpg", "extract-pdf-pages", "pdf-to-text"],
    related: [
      "copy-text-from-a-pdf",
      "photos-and-scans-into-one-pdf",
      "make-a-pdf-smaller",
    ],
    sections: [
      {
        heading: "When an image is the right output",
        blocks: [
          "Pictures of pages work for chat messages, slides, web pages and anywhere a PDF would not preview. They are the wrong choice when you need the words, because an image of a page cannot be searched or selected. For the words, use {tool:pdf-to-text}. For a page that should stay a document, pull it out as a PDF with {tool:extract-pdf-pages}.",
        ],
      },
      {
        heading: "How resolution works",
        blocks: [
          "A PDF page has a physical size measured in points, and 72 points make an inch. The resolution you choose says how many pixels to use for each inch, so a picture's width is the page width in points times the resolution, divided by 72.",
          "An A4 page is about 595 by 842 points. At 96 DPI that gives roughly 794 by 1,123 pixels. At 300 DPI the same page is about three times as wide and as tall, which is nearly ten times the pixels. Doubling the resolution quadruples the number of pixels, and the file grows with them.",
          "Match the resolution to where the picture will be seen. A quick share on a screen rarely needs more than 96 DPI, while printing and close reading reward 300 DPI. If you are unsure, start at 150 DPI and convert again if the result looks soft.",
        ],
      },
      {
        heading: "Converting pages",
        blocks: [
          {
            steps: [
              "Open {tool:pdf-to-jpg} and choose a PDF. A preview of each page appears.",
              "Pick All pages, or Selected pages and tick the ones you need. Converting fewer pages gives a smaller download.",
              "Choose 96, 150 or 300 DPI. The pixel size of each page updates to match.",
              "Select Create JPG images, then download. A single page arrives as one picture, and several pages arrive together in a ZIP file.",
            ],
          },
        ],
      },
      {
        heading: "What to expect from the pictures",
        blocks: [
          {
            list: [
              "JPG is a lossy format. Flat colour and sharp text edges can show faint blur or speckles, more noticeably at low resolutions.",
              "Every page is drawn on white, and JPG has no transparency, so transparent areas of a page appear white.",
              "A page that is rotated in the PDF is drawn the way a viewer shows it, with the rotation applied.",
              "The words in the picture are no longer text. They cannot be searched, selected or read aloud by a screen reader.",
              "Several pages arrive in pdf-pages-jpg.zip, with one numbered picture for each page. If any page cannot be drawn, nothing is offered, so you never get an incomplete set.",
            ],
          },
        ],
      },
      {
        heading: "Treat the pictures like the pages",
        blocks: [
          "An image of a page shows everything the page shows. If the document was private, so is the picture, and image files are easy to copy and forward. Share them with the same care you would give the original.",
        ],
      },
    ],
  },

  {
    slug: "copy-text-from-a-pdf",
    title: "How to copy text out of a PDF, and what to do with scans",
    description:
      "Tell a text PDF from a scanned one, pull the words out of the first kind, and learn your options for the second, including what OCR is and when you need it.",
    summary:
      "Tell a text PDF from a scanned one, pull the words out of the first kind, and know your options for the second.",
    intro:
      "Two PDFs can look identical on screen and be completely different underneath. One stores the characters you read, and the other stores a photograph of them. Which kind you have decides whether copying the text takes a second or needs extra software.",
    tools: ["pdf-to-text", "jpg-to-pdf"],
    related: [
      "photos-and-scans-into-one-pdf",
      "save-pdf-pages-as-images",
      "whats-hidden-in-a-pdf",
    ],
    sections: [
      {
        heading: "Text or picture? A quick test",
        blocks: [
          {
            list: [
              "Drag across a sentence with your cursor. If the words highlight one by one, they are text. If a whole block or the whole page highlights, or nothing does, the page is a picture.",
              "Search for a word you can see on the page. A text page finds it, while a picture page finds nothing.",
              "Zoom in a long way. Text stays crisp at any size, but a picture of text turns blocky or blurry.",
            ],
          },
          "Scans, photographs saved as PDF and many faxes are pictures. Documents exported from word processors, web pages and most reports are text.",
        ],
      },
      {
        heading: "Pulling the text out",
        blocks: [
          {
            steps: [
              "Open {tool:pdf-to-text} and choose the PDF.",
              "Wait while the words are gathered page by page. Extraction starts as soon as the file opens, and there is nothing to press.",
              "Read the preview to see whether the result is what you expected.",
              "Select Copy text to put it on your clipboard, or Download TXT to save extracted-text.txt, a plain UTF-8 file that opens in any editor.",
            ],
          },
          "The preview may be shortened for a very long document. Copy and Download still give you everything.",
        ],
      },
      {
        heading: "Why the result can look messy",
        blocks: [
          "The tool returns text in the order the PDF stores it, and that is not always the order you read. Two-column pages, sidebars and tables can come out interleaved, because a PDF positions each piece of text separately and has no built-in notion of a column.",
          "Tables keep their words but lose their grid, and bold, italics, fonts and images are dropped. If the layout matters, copy the text first and rebuild the structure in a document or spreadsheet yourself.",
          "The download is UTF-8, so characters from other languages are saved as they were extracted.",
        ],
      },
      {
        heading: "When only some pages are pictures",
        blocks: [
          "Mixed documents are common: a typed contract with a scanned signature page, or a report with a pasted screenshot. The tool extracts the pages that have text and lists the pages that had none, so you know exactly which ones to treat differently. If no page has any text, it says so and produces no file.",
        ],
      },
      {
        heading: "Scans: what OCR is, and what to do",
        blocks: [
          "Getting words out of a picture of words takes optical character recognition, or OCR: software that studies the shapes in an image and works out which letters they are. This site does not do OCR and the tool does not pretend to, so a scanned page returns no text.",
          "If you need the words from a scan, use a dedicated OCR program or the OCR option in your scanner's software, and expect to proofread the result. Accuracy depends heavily on the scan. Sharp, straight, evenly lit pages give far better results than skewed or shadowed ones, which is one more reason to follow the advice in {learn:photos-and-scans-into-one-pdf|the guide on turning photos into a PDF}.",
        ],
      },
      {
        heading: "Where the text goes",
        blocks: [
          "While you read the result, the text lives only in the page you have open, and copying or saving it is your choice. Nothing is uploaded, so the tool is suitable for documents you would not send to a stranger, although a downloaded text file is only as private as the place you save it.",
          "If you want a Word document instead, that tool is not available yet. Plain text is what this site produces for now.",
        ],
      },
    ],
  },

  {
    slug: "whats-hidden-in-a-pdf",
    title: "What is hidden in a PDF, and what removing it does not do",
    description:
      "A PDF can reveal more than its pages: author names, software, dates, covered text and photo details. What Remove PDF Metadata clears and what it leaves.",
    summary:
      "See what a PDF can reveal beyond its pages, what Remove PDF Metadata clears, and what you must still check yourself.",
    intro:
      "A PDF shows you its pages, but the file holds more than the pages. Before you post a document publicly or send it to someone you do not know, it is worth understanding what else is in there, because a page that looks clean and a file that is clean are not the same thing.",
    tools: ["remove-pdf-metadata", "jpg-to-pdf", "delete-pdf-pages"],
    related: [
      "split-a-pdf-or-keep-some-pages",
      "photos-and-scans-into-one-pdf",
      "what-processed-on-your-device-means",
    ],
    featured: true,
    sections: [
      {
        heading: "Three kinds of hidden information",
        blocks: [
          {
            list: [
              "Descriptive fields. Many PDFs record who made them and with what: the title, author, subject and keywords, the program that created the document, the program that produced the PDF, and the dates it was made and last changed. Authoring tools may add custom fields of their own. A second record called XMP can hold similar details, and a file identifier lets software tell one document from another.",
              "Content that is in the file but not obvious on the page. Comments, attached files, form entries, hidden layers and earlier saved versions can all travel inside a PDF. A familiar example is a black box drawn over text: it hides the words from view, but the words underneath often remain and can be selected and copied.",
              "Information inside pictures. Photos placed in a PDF can carry their own details, such as the camera model and where the picture was taken.",
            ],
          },
        ],
      },
      {
        heading: "What Remove PDF Metadata does",
        blocks: [
          "{tool:remove-pdf-metadata} clears the descriptive fields, the XMP record and, where it can, the file identifier. It then checks the cleaned file, shows what was removed, and says so when it could not suppress the file identifier. Nothing leaves your device while it works.",
        ],
      },
      {
        heading: "What it does not do",
        blocks: [
          {
            list: [
              "It does not redact. The words and pictures on the pages are left exactly as they were, so a name printed on a page is still there.",
              "It makes no promise about attachments, signature data or earlier saved versions of the document.",
              "It does not change images inside the pages, so a photo's own camera details can survive.",
              "It is one pass over one file, and it never claims that a document is anonymous afterwards.",
            ],
          },
        ],
      },
      {
        heading: "A short check before you share",
        blocks: [
          {
            steps: [
              "Open the file's properties in your PDF viewer and read the author, title and software fields.",
              "Drag over any black boxes or highlighted areas, copy, and paste into a text editor. If words appear, the text was covered and not removed.",
              "Look through your viewer's panels for comments, attachments and layers.",
              "Run {tool:remove-pdf-metadata}, then open the cleaned copy to confirm it still looks right.",
              "If something must not be seen at all, remove it from the source document and export a fresh PDF. Covering it up is not the same as taking it out.",
            ],
          },
        ],
      },
      {
        heading: "Photos you add to a PDF",
        blocks: [
          "{tool:jpg-to-pdf} leaves the camera details and location stored in your photos out of the PDF, so building a PDF from pictures does not carry them along. A photo that was already inside a PDF made elsewhere is a different matter, because no tool here promises to clean the pictures inside an existing PDF.",
        ],
      },
      {
        heading: "Removing pages is not removing information",
        blocks: [
          "Deleting a page produces a new file without it, while the original and any copies you already shared still contain the page. {learn:split-a-pdf-or-keep-some-pages|The page-removal guide} covers how to use {tool:delete-pdf-pages} with that in mind.",
        ],
      },
    ],
  },

  {
    slug: "what-processed-on-your-device-means",
    title: "What “processed on your device” means, and when a tool uploads",
    description:
      "What the privacy labels on each tool mean, how to confirm them yourself, what on-device processing does not protect, and the one tool that uploads a file.",
    summary:
      "What the privacy labels on each tool mean, how to check them yourself, and the one tool that sends a file to our server.",
    intro:
      "Every tool here carries a label saying where the work happens. The labels are short on purpose, so this guide fills in what they mean in practice, what they do not promise, and how to confirm them without taking our word for it.",
    tools: ["word-to-pdf", "merge-pdf"],
    related: [
      "merge-pdfs-without-uploading",
      "whats-hidden-in-a-pdf",
      "copy-text-from-a-pdf",
    ],
    sections: [
      {
        heading: "The labels",
        blocks: [
          {
            list: [
              "“Processed on your device” means the work happens in your browser. The file is read into your browser's memory, code running in the browser does the job, and the result is handed back as a download. The file is not sent to our server or to anyone else.",
              "“Secure server processing” means the file is uploaded, converted on our server and sent back. Today that applies to {tool:word-to-pdf} only.",
              "A label that starts with “Planned” belongs to a tool that is not available yet, including any tool whose location would depend on the operation chosen. It describes an intention, and no document can be sent to that tool.",
            ],
          },
        ],
      },
      {
        heading: "What happens on your device",
        blocks: [
          "When you pick a file, your browser reads it, but the page does not save it or its result for a later visit. Start over, or leave the page, and the page lets go of the files and results it was holding.",
          "That is a release of references and not a secure wipe of memory. Your browser decides when memory is actually reused, so do not treat it as shredding.",
          "The work is limited by what a single browser tab can handle, so on-device tools have size and page limits. They are shown beside each tool and they exist to keep the work reliable.",
        ],
      },
      {
        heading: "How to check it yourself",
        blocks: [
          "Open your browser's developer tools, choose the Network tab and use a tool as you normally would. A tool that works on your device loads its own scripts and then stays quiet: no request carries your file. Run the same test on Word to PDF and you will see an upload, which is exactly how it should look for a tool that uses a server.",
          "The same automated check runs for every on-device tool, as {learn:merge-pdfs-without-uploading|the merging guide} describes.",
        ],
      },
      {
        heading: "What on-device processing does not cover",
        blocks: [
          {
            list: [
              "The page's code. Your browser downloaded this site's scripts from us, so you are trusting them to behave as described, and the Network tab is how you verify it.",
              "Your device. A browser extension, malware or a shared computer can see what you do on it, and local processing does not change that.",
              "Where you save the result. If your Downloads folder syncs to cloud storage, a downloaded file will be copied there.",
              "What you do next. Sending a result by email or posting it online is a separate decision with its own risks.",
            ],
          },
        ],
      },
      {
        heading: "The tool that uploads",
        blocks: [
          "{tool:word-to-pdf} is the one exception. Converting a Word document faithfully needs a full word-processing engine, and ours is LibreOffice running on our server, so the file goes there to be converted.",
          "Word to PDF tells you about the upload before anything is sent. Your file is encrypted on its way to our server, converted there and deleted once the PDF has reached your browser. An abandoned conversion, for instance one left behind when the tab is closed, is cleared out by an automatic cleanup after a short time. The file is not shared with third parties.",
          "Word to PDF deserves the same care as any other upload, so if a document is too sensitive to send anywhere, convert it on a computer you control instead.",
        ],
      },
      {
        heading: "What this guide is not",
        blocks: [
          "This is an explanation and not a legal policy. The {page:/privacy|Privacy page} states our current position, including the details that are still undecided, such as the exact retention period for abandoned conversions.",
        ],
      },
    ],
  },
];

export function getLearnArticle(slug: string): LearnArticle | undefined {
  return learnArticles.find((article) => article.slug === slug);
}

/** Guides that are about this tool, for the "Learn more" list on its page. */
export function getLearnArticlesForTool(toolSlug: string): LearnArticle[] {
  return learnArticles.filter((article) => article.tools.includes(toolSlug));
}
