# Scribd HTML → PDF — Browser v3

## Fixes in v3

### 1. Real preview

The previous preview only showed:

`PAGE 1 — 902 × 507`

v3 creates real thumbnails from the first 8 rendered document pages.

### 2. Large PDF memory problem

The previous implementation used jsPDF and kept the growing PDF in browser
memory. Large documents (around 200+ pages, especially high-resolution pages)
can therefore exhaust browser memory and crash.

v3 uses a small streaming PDF writer:

- render one page
- convert that page to JPEG
- write the JPEG directly to the chosen PDF file
- release the canvas
- move to the next page
- write the PDF cross-reference table at the end

The PDF is never kept as one giant in-memory Blob.

### Browser

For large files, use current Microsoft Edge or Google Chrome. v3 uses the
File System Access API (`showSaveFilePicker`) to write the PDF progressively.

### Internet

The selected HTML is read locally and is not uploaded to an application
server. The page may still request remote resources referenced by the HTML,
and html2canvas is currently loaded from cdnjs.

### Local XAMPP

Put the project in:

`C:\xampp\htdocs\scribd-html-scraper\`

Start Apache and open:

`http://localhost/scribd-html-scraper/`

### Access note

Use only document content you are authorized to access. This project does
not bypass authentication, paywalls, DRM, or other access controls.
