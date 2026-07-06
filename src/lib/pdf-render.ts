// Client-only PDF rasterizer using pdf.js.
// Renders each page to a JPEG data URL at target width.

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(async (mod) => {
      // Use the ESM worker shipped with pdfjs-dist v6.
      const workerUrl = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      mod.GlobalWorkerOptions.workerSrc = workerUrl;
      return mod;
    });
  }
  return pdfjsPromise;
}

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string; // image/jpeg;base64,...
  blob: Blob;
  width: number;
  height: number;
}

export async function renderPdfPages(
  file: File,
  opts: {
    targetWidth?: number;
    maxPages?: number;
    onPage?: (page: RenderedPage, total: number) => void;
  } = {},
): Promise<RenderedPage[]> {
  const targetWidth = opts.targetWidth ?? 1024;
  const maxPages = opts.maxPages ?? 30;
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const out: RenderedPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport1 = page.getViewport({ scale: 1 });
    const scale = targetWidth / viewport1.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.82),
    );
    const rendered: RenderedPage = {
      pageNumber: i,
      dataUrl,
      blob,
      width: canvas.width,
      height: canvas.height,
    };
    out.push(rendered);
    opts.onPage?.(rendered, total);
  }
  return out;
}