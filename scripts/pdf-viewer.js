import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.mjs";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createPdfViewer({
  canvas,
  container,
  onRenderStateChange = () => {},
  onError = () => {},
}) {
  let pdfDocument = null;
  let currentPage = 1;
  let totalPages = 0;
  let zoomFactor = 1;
  let renderNonce = 0;
  let currentRenderTask = null;
  let resizeObserver = null;

  const context = canvas.getContext("2d", { alpha: false });

  function stateSnapshot() {
    return {
      currentPage,
      totalPages,
      zoomPercent: Math.round(zoomFactor * 100),
      hasDocument: Boolean(pdfDocument),
    };
  }

  function notify() {
    onRenderStateChange(stateSnapshot());
  }

  function calculateFitScale(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, container.clientWidth - 40);
    const availableHeight = Math.max(420, container.clientHeight - 40);
    const widthScale = availableWidth / baseViewport.width;
    const heightScale = availableHeight / baseViewport.height;
    return Math.max(0.35, Math.min(widthScale, heightScale));
  }

  async function cancelRender() {
    if (!currentRenderTask) {
      return;
    }

    currentRenderTask.cancel();

    try {
      await currentRenderTask.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") {
        throw error;
      }
    } finally {
      currentRenderTask = null;
    }
  }

  async function renderPage(pageNumber = currentPage) {
    if (!pdfDocument) {
      return stateSnapshot();
    }

    renderNonce += 1;
    const renderId = renderNonce;
    currentPage = clamp(pageNumber, 1, totalPages);

    try {
      await cancelRender();
      const page = await pdfDocument.getPage(currentPage);

      if (renderId !== renderNonce) {
        return stateSnapshot();
      }

      const fitScale = calculateFitScale(page);
      const viewport = page.getViewport({ scale: fitScale * zoomFactor });
      const devicePixelRatio = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * devicePixelRatio);
      canvas.height = Math.floor(viewport.height * devicePixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      currentRenderTask = page.render({
        canvasContext: context,
        viewport,
      });

      await currentRenderTask.promise;
      currentRenderTask = null;
      notify();
      return stateSnapshot();
    } catch (error) {
      if (error?.name === "RenderingCancelledException") {
        return stateSnapshot();
      }

      onError(error);
      throw error;
    }
  }

  async function loadDocument({ data, initialPage = 1 }) {
    await cleanup();

    const task = pdfjsLib.getDocument({ data });
    pdfDocument = await task.promise;
    totalPages = pdfDocument.numPages;
    currentPage = clamp(initialPage, 1, totalPages);
    zoomFactor = 1;

    if (!resizeObserver && "ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(() => {
        if (pdfDocument) {
          void renderPage(currentPage);
        }
      });
      resizeObserver.observe(container);
    }

    await renderPage(currentPage);

    return {
      ...stateSnapshot(),
      fingerprint: pdfDocument.fingerprints?.[0] ?? null,
    };
  }

  async function cleanup() {
    renderNonce += 1;
    await cancelRender();

    if (pdfDocument) {
      await pdfDocument.destroy();
      pdfDocument = null;
    }

    currentPage = 1;
    totalPages = 0;
  }

  function nextPage() {
    if (!pdfDocument || currentPage >= totalPages) {
      return stateSnapshot();
    }

    return renderPage(currentPage + 1);
  }

  function previousPage() {
    if (!pdfDocument || currentPage <= 1) {
      return stateSnapshot();
    }

    return renderPage(currentPage - 1);
  }

  function goToPage(pageNumber) {
    if (!pdfDocument) {
      return stateSnapshot();
    }

    return renderPage(pageNumber);
  }

  function zoomIn() {
    if (!pdfDocument) {
      return stateSnapshot();
    }

    zoomFactor = clamp(zoomFactor + 0.12, 0.6, 2.4);
    return renderPage(currentPage);
  }

  function zoomOut() {
    if (!pdfDocument) {
      return stateSnapshot();
    }

    zoomFactor = clamp(zoomFactor - 0.12, 0.6, 2.4);
    return renderPage(currentPage);
  }

  function resetZoom() {
    if (!pdfDocument) {
      return stateSnapshot();
    }

    zoomFactor = 1;
    return renderPage(currentPage);
  }

  return {
    loadDocument,
    cleanup,
    nextPage,
    previousPage,
    goToPage,
    zoomIn,
    zoomOut,
    resetZoom,
    getState: stateSnapshot,
  };
}
