import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class PdfViewer {
  constructor({
    canvas,
    frame,
    placeholder,
    canvasWrap,
    page,
    textLayer,
    highlightLayer,
    onDocumentLoaded,
    onPageRendered,
    onError,
    onTextSelection,
  }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.frame = frame;
    this.placeholder = placeholder;
    this.canvasWrap = canvasWrap;
    this.page = page;
    this.textLayer = textLayer;
    this.highlightLayer = highlightLayer;
    this.onDocumentLoaded = onDocumentLoaded;
    this.onPageRendered = onPageRendered;
    this.onError = onError;
    this.onTextSelection = onTextSelection;
    this.pdfDocument = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.zoomFactor = 1;
    this.renderTask = null;
    this.renderId = 0;
    this.highlights = [];
    this.selection = null;
    this.measureCanvas = document.createElement("canvas");
    this.measureContext = this.measureCanvas.getContext("2d");
    this.captureSelectionDeferred = () => {
      window.clearTimeout(this.selectionTimer);
      this.selectionTimer = window.setTimeout(() => {
        this.captureSelection();
      }, 0);
    };

    this.textLayer.addEventListener("mouseup", this.captureSelectionDeferred);
    this.textLayer.addEventListener("keyup", this.captureSelectionDeferred);
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

  setPageDimensions(viewport) {
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const pageStyle = {
      width: `${width}px`,
      height: `${height}px`,
    };

    this.page.style.width = pageStyle.width;
    this.page.style.height = pageStyle.height;
    this.textLayer.style.width = pageStyle.width;
    this.textLayer.style.height = pageStyle.height;
    this.highlightLayer.style.width = pageStyle.width;
    this.highlightLayer.style.height = pageStyle.height;
    this.canvas.style.width = pageStyle.width;
    this.canvas.style.height = pageStyle.height;
  }

  async renderTextLayer(page, viewport, renderId) {
    const textContent = await page.getTextContent();
    if (renderId !== this.renderId) {
      return;
    }
    const styles = textContent.styles || {};
    const layer = this.textLayer;
    layer.textContent = "";

    for (const item of textContent.items) {
      if (renderId !== this.renderId) {
        return;
      }
      if (!item.str) {
        continue;
      }

      const style = styles[item.fontName] || {};
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      let angle = Math.atan2(tx[1], tx[0]);
      const fontHeight = Math.hypot(tx[2], tx[3]);

      if (style.vertical) {
        angle += Math.PI / 2;
      }

      let fontAscent = fontHeight;
      if (style.ascent) {
        fontAscent = style.ascent * fontHeight;
      } else if (style.descent) {
        fontAscent = (1 + style.descent) * fontHeight;
      }

      let left = tx[4];
      let top = tx[5] - fontAscent;

      if (angle !== 0) {
        left = tx[4] + fontAscent * Math.sin(angle);
        top = tx[5] - fontAscent * Math.cos(angle);
      }

      const span = document.createElement("span");
      span.className = "pdf-text-item";
      span.dir = item.dir || "ltr";
      span.textContent = item.str;
      span.style.left = `${left}px`;
      span.style.top = `${top}px`;
      span.style.fontSize = `${fontHeight}px`;
      span.style.fontFamily = style.fontFamily || "sans-serif";

      const transformParts = [];
      this.measureContext.font = `${fontHeight}px ${style.fontFamily || "sans-serif"}`;
      const measuredWidth = this.measureContext.measureText(item.str).width || 1;
      const targetWidth = item.width * viewport.scale;
      const scaleX = targetWidth / measuredWidth;

      if (angle !== 0) {
        transformParts.push(`rotate(${angle}rad)`);
      }
      if (Number.isFinite(scaleX) && Math.abs(scaleX - 1) > 0.04) {
        transformParts.push(`scaleX(${scaleX})`);
      }
      if (transformParts.length) {
        span.style.transform = transformParts.join(" ");
      }

      layer.append(span);
    }
  }

  renderHighlights() {
    this.highlightLayer.textContent = "";

    const currentHighlights = this.highlights.filter(
      (highlight) => highlight.page === this.currentPage && Array.isArray(highlight.selectionRects) && highlight.selectionRects.length,
    );

    currentHighlights.forEach((highlight) => {
      highlight.selectionRects.forEach((rect) => {
        const node = document.createElement("div");
        node.className = `pdf-highlight pdf-highlight--${highlight.type || "definition"}`;
        node.style.left = `${rect.left * 100}%`;
        node.style.top = `${rect.top * 100}%`;
        node.style.width = `${rect.width * 100}%`;
        node.style.height = `${rect.height * 100}%`;
        this.highlightLayer.append(node);
      });
    });
  }

  captureSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      this.selection = null;
      this.onTextSelection?.(null);
      return;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !this.textLayer.contains(anchorNode) || !this.textLayer.contains(focusNode)) {
      return;
    }

    const range = selection.getRangeAt(0);
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      this.selection = null;
      this.onTextSelection?.(null);
      return;
    }

    const layerRect = this.textLayer.getBoundingClientRect();
    const domRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
    const rects = domRects
      .map((rect) => ({
        left: clamp((rect.left - layerRect.left) / layerRect.width, 0, 1),
        top: clamp((rect.top - layerRect.top) / layerRect.height, 0, 1),
        width: clamp(rect.width / layerRect.width, 0, 1),
        height: clamp(rect.height / layerRect.height, 0, 1),
      }))
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (!rects.length) {
      this.selection = null;
      this.onTextSelection?.(null);
      return;
    }

    const firstRect = rects[0];
    this.selection = {
      page: this.currentPage,
      text,
      rects,
      toolbar: {
        left: clamp(firstRect.left + firstRect.width / 2, 0.14, 0.86),
        top: clamp(firstRect.top, 0.08, 0.9),
      },
    };
    this.onTextSelection?.(this.selection);
  }

  clearSelection(clearBrowserSelection = false) {
    if (clearBrowserSelection) {
      window.getSelection()?.removeAllRanges();
    }
    this.selection = null;
    this.onTextSelection?.(null);
  }

  setHighlights(highlights = []) {
    this.highlights = highlights;
    this.renderHighlights();
  }

  async renderPage(pageNumber) {
    if (!this.pdfDocument) {
      return null;
    }

    const clampedPage = Math.min(Math.max(1, pageNumber), this.totalPages);
    this.currentPage = clampedPage;
    this.clearSelection(true);

    if (this.renderTask) {
      this.renderTask.cancel();
    }

    const page = await this.pdfDocument.getPage(clampedPage);
    const renderId = ++this.renderId;
    const frameWidth = Math.max(320, this.frame.clientWidth - 96);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const fitScale = frameWidth / unscaledViewport.width;
    const scale = fitScale * this.zoomFactor;
    const viewport = page.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(viewport.width * pixelRatio);
    this.canvas.height = Math.floor(viewport.height * pixelRatio);
    this.setPageDimensions(viewport);

    const renderContext = {
      canvasContext: this.context,
      viewport,
      transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null,
    };

    const renderTask = page.render(renderContext);
    this.renderTask = renderTask;
    await Promise.all([
      renderTask.promise.catch((error) => {
        if (error?.name !== "RenderingCancelledException") {
          throw error;
        }
        return null;
      }),
      this.renderTextLayer(page, viewport, renderId),
    ]);

    if (this.renderTask !== renderTask) {
      return null;
    }
    this.renderHighlights();

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
