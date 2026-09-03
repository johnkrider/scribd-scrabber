const $ = (s) => document.querySelector(s);

const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const fileInfo = $("#fileInfo");
const fileName = $("#fileName");
const pageCount = $("#pageCount");
const previewCount = $("#previewCount");
const startBtn = $("#startBtn");
const progressBar = $("#progressBar");
const progressText = $("#progressText");
const statusEl = $("#status");
const mainCanvas = $("#mainCanvas");
const viewerEmpty = $("#viewerEmpty");
const viewerLoading = $("#viewerLoading");

let selectedFile = null;
let sourceText = "";
let pageDefinitions = [];
let frame = null;
let doc = null;
let nodes = [];
let currentPage = 0;
let zoom = 1;

const PAGE_RE =
  /docManager\.addPage\(\{.*?pageNum:\s*(\d+).*?origWidth:\s*([\d.]+).*?origHeight:\s*([\d.]+).*?contentUrl:\s*"([^"]+)"/gs;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function setProgress(value, text) {
  value = Math.max(0, Math.min(100, value));
  progressBar.style.width = value + "%";
  progressText.textContent = Math.round(value) + "%";
  if (text) statusEl.textContent = text;
}

function parsePages(text) {
  const result = [];
  const seen = new Set();
  PAGE_RE.lastIndex = 0;

  let m;
  while ((m = PAGE_RE.exec(text))) {
    const number = Number(m[1]);
    if (seen.has(number)) continue;

    seen.add(number);
    result.push({
      number,
      width: Number(m[2]),
      height: Number(m[3]),
      url: m[4]
    });
  }

  return result.sort((a, b) => a.number - b.number);
}

/*
 * The selected HTML is NEVER navigated to.
 *
 * It is inserted into an off-screen iframe only so the browser can execute
 * the viewer's own JavaScript and render the document pages. The iframe is
 * never displayed as the preview. The visible preview is a canvas snapshot.
 */
function createHiddenRenderer() {
  const f = document.createElement("iframe");

  f.setAttribute("aria-hidden", "true");
  f.style.position = "fixed";
  f.style.left = "-100000px";
  f.style.top = "0";
  f.style.width = "1600px";
  f.style.height = "1200px";
  f.style.border = "0";
  f.style.opacity = "0";
  f.style.pointerEvents = "none";

  document.body.appendChild(f);
  return f;
}

function cleanDocument(d) {
  const style = d.createElement("style");

  style.textContent = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
      overflow: visible !important;
    }

    header, nav, footer,
    [class*="cookie"], [id*="cookie"],
    [class*="consent"], [id*="consent"],
    [class*="toolbar"], [class*="sidebar"],
    [class*="topbar"], [class*="bottom-bar"],
    [class*="modal"], [class*="overlay"],
    [class*="popup"] {
      display: none !important;
    }
  `;

  (d.head || d.documentElement).appendChild(style);
}

async function loadViewerIntoMemory() {
  if (frame) frame.remove();

  frame = createHiddenRenderer();

  /*
   * srcdoc is used instead of navigating the browser to the chosen file.
   * This keeps the original HTML inside the application.
   */
  frame.srcdoc = sourceText;

  await new Promise(resolve => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    frame.addEventListener("load", finish, { once: true });
    setTimeout(finish, 15000);
  });

  doc = frame.contentDocument;

  if (!doc) {
    throw new Error("The browser could not access the local HTML viewer.");
  }

  cleanDocument(doc);

  await sleep(3500);

  nodes = Array.from(doc.querySelectorAll('[id^="outer_page_"]'));

  if (!nodes.length) {
    throw new Error("No document pages were rendered by the HTML viewer.");
  }
}

function hideAllPages() {
  for (const node of nodes) {
    node.style.setProperty("display", "none", "important");
  }
}

function preparePage(index) {
  hideAllPages();

  const node = nodes[index];
  if (!node) throw new Error("Document page was not found.");

  node.style.setProperty("display", "block", "important");
  node.style.setProperty("position", "relative", "important");
  node.style.setProperty("left", "auto", "important");
  node.style.setProperty("top", "auto", "important");
  node.style.setProperty("margin", "0 auto", "important");

  node.scrollIntoView({ block: "center" });

  return node;
}

async function waitForContent(node) {
  let previous = -1;
  let stable = 0;

  for (let i = 0; i < 40; i++) {
    const value =
      node.querySelectorAll("img,canvas,svg,[style*='background']").length +
      node.textContent.trim().length;

    if (value === previous) stable++;
    else stable = 0;

    previous = value;

    if (stable >= 3) return;
    await sleep(200);
  }
}

async function capturePage(index, scale) {
  const node = preparePage(index);
  await waitForContent(node);
  await sleep(Number($("#delay").value));

  return html2canvas(node, {
    scale,
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 20000
  });
}

function drawMainCanvas(sourceCanvas) {
  const def = pageDefinitions[currentPage];
  const canvas = mainCanvas;
  const stage = $("#viewerStage");

  const maxW = Math.max(100, stage.clientWidth - 120);
  const maxH = Math.max(100, stage.clientHeight - 50);

  let scale = Math.min(maxW / def.width, maxH / def.height);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  scale *= zoom;

  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  canvas.style.width = Math.round(def.width * scale) + "px";
  canvas.style.height = Math.round(def.height * scale) + "px";

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);

  viewerEmpty.classList.add("hidden");
  viewerLoading.classList.add("hidden");

  $("#zoomText").textContent =
    zoom === 1 ? "Fit" : Math.round(zoom * 100) + "%";
}

async function showMainPage(index) {
  if (!nodes.length) return;

  currentPage = Math.max(0, Math.min(nodes.length - 1, index));

  viewerLoading.classList.remove("hidden");
  viewerEmpty.classList.add("hidden");

  try {
    const canvas = await capturePage(currentPage, Number($("#quality").value));
    drawMainCanvas(canvas);
    updateNavigation();
    updateThumbs();
    $("#viewerTitle").textContent =
      `Page ${currentPage + 1} of ${nodes.length}`;
  } catch (e) {
    viewerLoading.classList.add("hidden");
    throw e;
  }
}

async function buildThumbs() {
  const strip = $("#thumbStrip");
  strip.innerHTML = "";

  const count = Math.min(8, nodes.length);

  for (let i = 0; i < count; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "viewer-thumb";
    button.innerHTML = `<canvas width="100" height="120"></canvas><span>${i + 1}</span>`;

    button.addEventListener("click", async () => {
      try {
        await showMainPage(i);
      } catch (e) {
        alert("Could not render this page.\n\n" + e.message);
      }
    });

    strip.appendChild(button);

    try {
      const canvas = await capturePage(i, 0.30);
      const target = button.querySelector("canvas");
      const ctx = target.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, target.width, target.height);

      const ratio = Math.min(
        target.width / canvas.width,
        target.height / canvas.height
      );

      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      ctx.drawImage(
        canvas,
        (target.width - w) / 2,
        (target.height - h) / 2,
        w,
        h
      );
    } catch (e) {
      const target = button.querySelector("canvas");
      const ctx = target.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.fillStyle = "#777";
      ctx.textAlign = "center";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("PAGE " + (i + 1), target.width / 2, target.height / 2);
    }

    setProgress(
      3 + ((i + 1) / count) * 8,
      `Building preview ${i + 1} of ${count}…`
    );
  }

  updateThumbs();
}

function updateNavigation() {
  $("#prevPage").disabled = currentPage <= 0;
  $("#nextPage").disabled = currentPage >= nodes.length - 1;

  $("#thumbStatus").textContent =
    `Page ${currentPage + 1} of ${nodes.length} · Use ← → to navigate`;
}

function updateThumbs() {
  document.querySelectorAll(".viewer-thumb").forEach((button, i) => {
    button.classList.toggle("active", i === currentPage);
  });
}

async function loadFile(file) {
  if (!file) return;

  const name = file.name.toLowerCase();

  if (!name.endsWith(".html") && !name.endsWith(".htm")) {
    alert("Please choose an HTML file.");
    return;
  }

  selectedFile = file;
  setProgress(0, "Reading HTML file…");

  try {
    sourceText = await file.text();
    pageDefinitions = parsePages(sourceText);

    fileName.textContent = file.name;
    pageCount.textContent =
      `${pageDefinitions.length} document pages detected`;

    previewCount.textContent = `${pageDefinitions.length} pages`;
    fileInfo.classList.remove("hidden");
    startBtn.disabled = pageDefinitions.length === 0;

    if (!pageDefinitions.length) {
      setProgress(0, "No compatible Scribd page definitions found.");
      return;
    }

    /*
     * The file is NOT opened in a browser tab/window.
     * It is rendered only inside an off-screen iframe owned by this app.
     */
    setProgress(2, "Rendering document inside the app…");

    await loadViewerIntoMemory();

    currentPage = 0;
    zoom = 1;

    await buildThumbs();
    await showMainPage(0);

    setProgress(12, `Ready — ${nodes.length} pages detected.`);
  } catch (e) {
    console.error(e);
    setProgress(0, "Preview could not be rendered.");
    alert("Preview failed.\n\n" + e.message);
  }
}

/* PDF writer ------------------------------------------------------------- */

const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);

class PdfStreamWriter {
  constructor(writable, totalPages) {
    this.writable = writable;
    this.offset = 0;
    this.offsets = [];
    this.totalPages = totalPages;
  }

  async write(data) {
    if (!this.writable ||
        typeof this.writable.write !== "function") {
      throw new Error(
        "The PDF writable stream is unavailable. Please refresh the page and try again."
      );
    }

    await this.writable.write(data);
    this.offset += data.byteLength;
  }

  pageObject(i) { return 3 + i * 3; }
  contentObject(i) { return 4 + i * 3; }
  imageObject(i) { return 5 + i * 3; }

  async object(id, parts) {
    this.offsets[id] = this.offset;
    await this.write(bytes(`${id} 0 obj\n`));

    for (const part of parts) {
      await this.write(typeof part === "string" ? bytes(part) : part);
    }

    await this.write(bytes("\nendobj\n"));
  }

  async start() {
    await this.write(
      new Uint8Array([
        37,80,68,70,45,49,46,52,10,
        37,226,227,207,211,10
      ])
    );

    const kids = Array.from(
      { length: this.totalPages },
      (_, i) => `${this.pageObject(i)} 0 R`
    ).join(" ");

    await this.object(1, [
      "<< /Type /Catalog /Pages 2 0 R >>"
    ]);

    await this.object(2, [
      `<< /Type /Pages /Count ${this.totalPages} /Kids [ ${kids} ] >>`
    ]);
  }

  async addPage(i, width, height, jpegBytes, imageWidth, imageHeight) {
    const page = this.pageObject(i);
    const content = this.contentObject(i);
    const image = this.imageObject(i);

    const stream =
      `q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ\n`;

    await this.object(page, [
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /XObject << /Im1 ${image} 0 R >> >> ` +
      `/Contents ${content} 0 R >>`
    ]);

    await this.object(content, [
      `<< /Length ${bytes(stream).length} >>\nstream\n`,
      stream,
      "endstream"
    ]);

    await this.object(image, [
      `<< /Type /XObject /Subtype /Image ` +
      `/Width ${imageWidth} /Height ${imageHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
      jpegBytes,
      "\nendstream"
    ]);
  }

  async finish() {
    const xref = this.offset;
    const count = 3 + this.totalPages * 3;

    await this.write(bytes(
      `xref\n0 ${count}\n` +
      `0000000000 65535 f \n`
    ));

    for (let i = 1; i < count; i++) {
      await this.write(
        bytes(String(this.offsets[i]).padStart(10, "0") +
              " 00000 n \n")
      );
    }

    await this.write(bytes(
      `trailer\n<< /Size ${count} /Root 1 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`
    ));

    await this.writable.close();
  }
}

async function canvasToJpegBytes(canvas) {
  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.97)
  );

  if (!blob) {
    throw new Error("Could not encode the page image.");
  }

  return new Uint8Array(await blob.arrayBuffer());
}

async function requestPdfWriter(name) {
  if (typeof window.showSaveFilePicker !== "function") {
    throw new Error(
      "This static GitHub Pages build needs a browser with the File System Access API, such as current Chrome or Edge."
    );
  }

  const fileHandle = await window.showSaveFilePicker({
    suggestedName: name,
    types: [{
      description: "PDF document",
      accept: { "application/pdf": [".pdf"] }
    }]
  });

  /*
   * IMPORTANT:
   * FileSystemFileHandle != FileSystemWritableFileStream.
   *
   * We explicitly call createWritable() and pass ONLY the resulting
   * writable stream to PdfStreamWriter.
   */
  const writable = await fileHandle.createWritable();

  if (!writable || typeof writable.write !== "function") {
    throw new Error("The browser returned an invalid writable PDF stream.");
  }

  return writable;
}

async function exportPDF() {
  if (!selectedFile || !pageDefinitions.length) return;

  startBtn.disabled = true;

  let writable = null;
  let frameForExport = null;

  try {
    const baseName = selectedFile.name.replace(/\.(html?|HTML?)$/, "");
    const quality = Number($("#quality").value);
    const delay = Number($("#delay").value);

    setProgress(8, "Choose where to save the PDF…");

    writable = await requestPdfWriter(`${baseName}.pdf`);

    const pdf = new PdfStreamWriter(
      writable,
      pageDefinitions.length
    );

    await pdf.start();

    setProgress(10, "Loading document for export…");

    /*
     * Use a separate hidden renderer for export so the visible preview
     * remains stable.
     */
    frameForExport = createHiddenRenderer();
    frameForExport.srcdoc = sourceText;

    await new Promise(resolve => {
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };

      frameForExport.addEventListener("load", finish, { once: true });
      setTimeout(finish, 15000);
    });

    const exportDoc = frameForExport.contentDocument;

    if (!exportDoc) {
      throw new Error("Could not access the HTML viewer for export.");
    }

    cleanDocument(exportDoc);
    await sleep(3500);

    const exportNodes =
      Array.from(exportDoc.querySelectorAll('[id^="outer_page_"]'));

    if (!exportNodes.length) {
      throw new Error("No document pages were rendered for export.");
    }

    for (let i = 0; i < exportNodes.length; i++) {
      const node = exportNodes[i];

      exportNodes.forEach(n =>
        n.style.setProperty("display", "none", "important")
      );

      node.style.setProperty("display", "block", "important");
      node.style.setProperty("position", "relative", "important");
      node.style.setProperty("left", "auto", "important");
      node.style.setProperty("top", "auto", "important");
      node.style.setProperty("margin", "0 auto", "important");
      node.scrollIntoView({ block: "center" });

      await sleep(delay);

      const canvas = await html2canvas(node, {
        scale: quality,
        backgroundColor: "#ffffff",
        useCORS: true,
        allowTaint: false,
        logging: false,
        imageTimeout: 20000
      });

      const jpeg = await canvasToJpegBytes(canvas);
      const def = pageDefinitions[i];

      await pdf.addPage(
        i,
        def.width,
        def.height,
        jpeg,
        canvas.width,
        canvas.height
      );

      /*
       * Release references to the large canvas/JPEG before the next page.
       */
      canvas.width = 1;
      canvas.height = 1;

      setProgress(
        10 + ((i + 1) / exportNodes.length) * 87,
        `Writing page ${i + 1} of ${exportNodes.length}…`
      );

      if (i % 2 === 0) await sleep(15);
    }

    await pdf.finish();
    writable = null;

    setProgress(
      100,
      `Done — ${exportNodes.length} pages saved.`
    );

    alert("PDF created successfully.");
  } catch (e) {
    console.error(e);

    setProgress(
      0,
      e.name === "AbortError" ? "Export cancelled." : "Export failed."
    );

    if (writable) {
      try {
        await writable.abort();
      } catch (_) {}
    }

    if (e.name !== "AbortError") {
      alert(
        "Export failed.\n\n" +
        e.message +
        "\n\n" +
        "If you just deployed a new version, use Ctrl+F5 once to clear the old JavaScript cache."
      );
    }
  } finally {
    if (frameForExport) frameForExport.remove();
    startBtn.disabled = false;
  }
}

/* Navigation ------------------------------------------------------------- */

$("#prevPage").addEventListener("click", async () => {
  if (currentPage <= 0) return;
  try { await showMainPage(currentPage - 1); }
  catch (e) { alert("Could not render page.\n\n" + e.message); }
});

$("#nextPage").addEventListener("click", async () => {
  if (currentPage >= nodes.length - 1) return;
  try { await showMainPage(currentPage + 1); }
  catch (e) { alert("Could not render page.\n\n" + e.message); }
});

$("#zoomIn").addEventListener("click", () => {
  zoom = Math.min(2.5, zoom + 0.1);
  if (nodes.length) showMainPage(currentPage).catch(console.error);
});

$("#zoomOut").addEventListener("click", () => {
  zoom = Math.max(0.5, zoom - 0.1);
  if (nodes.length) showMainPage(currentPage).catch(console.error);
});

$("#fitBtn").addEventListener("click", () => {
  zoom = 1;
  if (nodes.length) showMainPage(currentPage).catch(console.error);
});

$("#fullBtn").addEventListener("click", async () => {
  const el = $("#previewViewer");

  if (!document.fullscreenElement) {
    await el.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }

  if (nodes.length) {
    setTimeout(() => showMainPage(currentPage).catch(console.error), 100);
  }
});

$("#thumbPrev").addEventListener("click", async () => {
  try { await showMainPage(Math.max(0, currentPage - 8)); }
  catch (e) { alert("Could not render page.\n\n" + e.message); }
});

$("#thumbNext").addEventListener("click", async () => {
  try { await showMainPage(Math.min(nodes.length - 1, currentPage + 8)); }
  catch (e) { alert("Could not render page.\n\n" + e.message); }
});

document.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft" && currentPage > 0) {
    showMainPage(currentPage - 1).catch(console.error);
  }

  if (e.key === "ArrowRight" && currentPage < nodes.length - 1) {
    showMainPage(currentPage + 1).catch(console.error);
  }
});

/* File selection --------------------------------------------------------- */

fileInput.addEventListener("change", e => {
  e.stopPropagation();
  loadFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach(type => {
  dropZone.addEventListener(type, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach(type => {
  dropZone.addEventListener(type, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag");
  });
});

dropZone.addEventListener("drop", e => {
  e.preventDefault();
  e.stopPropagation();

  const files = e.dataTransfer?.files;
  if (files && files.length) loadFile(files[0]);
});

dropZone.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

$("#removeFile").addEventListener("click", () => {
  selectedFile = null;
  sourceText = "";
  pageDefinitions = [];
  nodes = [];
  currentPage = 0;

  if (frame) {
    frame.remove();
    frame = null;
  }

  fileInput.value = "";
  fileInfo.classList.add("hidden");
  startBtn.disabled = true;
  previewCount.textContent = "0 pages";
  $("#viewerTitle").textContent = "Choose a page";
  $("#thumbStrip").innerHTML = "";
  viewerEmpty.classList.remove("hidden");
  mainCanvas.width = 1;
  mainCanvas.height = 1;

  setProgress(0, "Waiting for an HTML file");
});

startBtn.addEventListener("click", exportPDF);

$("#themeBtn").addEventListener("click", () => {
  document.documentElement.classList.toggle("light");
  $("#themeBtn").textContent =
    document.documentElement.classList.contains("light")
      ? "☀"
      : "☾";
});

/* Make sure the selected file can never cause a browser navigation. */
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());
