import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";

export class PdfViewer {
  constructor({ canvas, frame, placeholder, canvasWrap, onDocumentLoaded, onPageRendered, onError }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.frame = frame;
    this.placeholder = placeholder;
    this.canvasWrap = canvasWrap;
    this.onDocumentLoaded = onDocumentLoaded;
    this.onPageRendered = onPageRendered;
    this.onError = onError;
    this.pdfDocument = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.zoomFactor = 1;
    this.renderTask = null;
  }

  async loadDocument(blob) {
    try {
      const buffer = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      this.pdfDocument = await loadingTask.promise;
      this.currentPage = 1;
      this.totalPages = this.pdfDocument.numPages;
      this.zoomFactor = 1;
      this.placeholder.classList.add("is-hidden");
      this.canvasWrap.classList.remove("is-hidden");
      await this.renderPage(1);
      this.onDocumentLoaded?.({ totalPages: this.totalPages });
      return this.pdfDocument;
    } catch (error) {
      this.onError?.(error);
      throw error;
    }
  }

  async renderPage(pageNumber) {
    if (!this.pdfDocument) {
      return null;
    }

    const clampedPage = Math.min(Math.max(1, pageNumber), this.totalPages);
    this.currentPage = clampedPage;

    if (this.renderTask) {
      this.renderTask.cancel();
    }

    const page = await this.pdfDocument.getPage(clampedPage);
    const frameWidth = Math.max(320, this.frame.clientWidth - 96);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const fitScale = frameWidth / unscaledViewport.width;
    const scale = fitScale * this.zoomFactor;
    const viewport = page.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(viewport.width * pixelRatio);
    this.canvas.height = Math.floor(viewport.height * pixelRatio);
    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderContext = {
      canvasContext: this.context,
      viewport,
      transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null,
    };

    this.renderTask = page.render(renderContext);
    await this.renderTask.promise;

    this.onPageRendered?.({
      page: this.currentPage,
      totalPages: this.totalPages,
      zoomPercent: Math.round(this.zoomFactor * 100),
    });

    return viewport;
  }

  async nextPage() {
    return this.renderPage(this.currentPage + 1);
  }

  async previousPage() {
    return this.renderPage(this.currentPage - 1);
  }

  async goToPage(pageNumber) {
    return this.renderPage(pageNumber);
  }

  async zoomIn() {
    this.zoomFactor = Math.min(2.4, this.zoomFactor + 0.1);
    return this.renderPage(this.currentPage);
  }

  async zoomOut() {
    this.zoomFactor = Math.max(0.6, this.zoomFactor - 0.1);
    return this.renderPage(this.currentPage);
  }

  getState() {
    return {
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      zoomPercent: Math.round(this.zoomFactor * 100),
      isLoaded: Boolean(this.pdfDocument),
    };
  }
}
