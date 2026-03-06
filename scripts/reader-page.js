import { createPdfViewer } from "./pdf-viewer.js";
import { createNoteRecord, sortNotes } from "./notes.js";
import { buildNotesMarkdown, downloadTextFile, sanitizeFilename } from "./export.js";
import { createTimerController, formatDuration } from "./sessions.js";
import { calculateGoalProgress, dayStamp } from "./goals.js";
import {
  getSetting,
  deleteSetting,
  initStorage,
  saveDocument,
  saveNote,
  saveProgress,
  saveSession,
  saveSetting,
  saveStat,
} from "./storage.js";
import {
  SETTING_KEYS,
  applyTheme,
  buildRecentDocumentSummaries,
  cachePdfFile,
  clamp,
  formatBytes,
  formatTimestamp,
  getCachedDocumentBytes,
  getNotesForDocument,
  getProgressRecord,
  getQueryParam,
  loadAppModel,
  loadDocumentById,
  persistActiveDocumentId,
  persistTheme,
  readerHref,
  removeRecord,
  setReaderUrl,
  setStatus,
  showToast,
  studyHref,
  upsertRecord,
} from "./common.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getDraftKey(documentId) {
  return `reader-note-draft:${documentId}`;
}

function renderRecentDocuments(target, documents) {
  if (!documents.length) {
    target.innerHTML = `
      <div class="revision-empty">No cached PDFs yet. Open a local file to start.</div>
    `;
    return;
  }

  target.innerHTML = documents
    .map(
      (documentRecord) => `
        <article class="recent-card">
          <button type="button" data-open-document="${documentRecord.id}">
            <strong>${escapeHtml(documentRecord.name)}</strong>
            <div class="recent-meta">
              <span class="subtle-copy">Page ${documentRecord.lastPage}</span>
              <span class="subtle-copy">${documentRecord.noteCount} note${documentRecord.noteCount === 1 ? "" : "s"}</span>
            </div>
          </button>
        </article>
      `,
    )
    .join("");
}

function renderDrawerNotes(target, notes) {
  if (!notes.length) {
    target.innerHTML = `
      <div class="revision-empty">No notes for this document yet.</div>
    `;
    return;
  }

  target.innerHTML = notes
    .slice(0, 6)
    .map(
      (note) => `
        <article class="note-card">
          <div class="note-meta">
            <span class="pill">${escapeHtml(note.type)}</span>
            <span class="subtle-copy">Page ${note.page}</span>
          </div>
          <div>${escapeHtml(note.content)}</div>
          <div class="note-actions">
            <button class="action-link" type="button" data-jump-page="${note.page}">Go to page</button>
          </div>
        </article>
      `,
    )
    .join("");
}

export async function init() {
  const elements = {
    pdfInput: document.querySelector("#pdfFileInput"),
    openPdfButton: document.querySelector("#openPdfButton"),
    toggleNoteDrawerButton: document.querySelector("#toggleNoteDrawerButton"),
    closeNoteDrawerButton: document.querySelector("#closeNoteDrawerButton"),
    noteDrawer: document.querySelector("#noteDrawer"),
    noteDrawerBackdrop: document.querySelector("#noteDrawerBackdrop"),
    noteForm: document.querySelector("#noteForm"),
    notePageInput: document.querySelector("#notePageInput"),
    noteTypeSelect: document.querySelector("#noteTypeSelect"),
    noteSnippetInput: document.querySelector("#noteSnippetInput"),
    noteContentInput: document.querySelector("#noteContentInput"),
    noteAutosaveHint: document.querySelector("#noteAutosaveHint"),
    drawerNotesList: document.querySelector("#drawerNotesList"),
    drawerStudyLink: document.querySelector("#drawerStudyLink"),
    readerEmptyState: document.querySelector("#readerEmptyState"),
    readerCanvasShell: document.querySelector("#readerCanvasShell"),
    readerEmptyOpenButton: document.querySelector("#readerEmptyOpenButton"),
    recentDocumentsList: document.querySelector("#recentDocumentsList"),
    documentBadge: document.querySelector("#documentBadge"),
    documentTitle: document.querySelector("#documentTitle"),
    documentMeta: document.querySelector("#documentMeta"),
    studyLink: document.querySelector("#studyLink"),
    dismissReaderHelperButton: document.querySelector("#dismissReaderHelperButton"),
    readerHelperPanel: document.querySelector("#readerHelperPanel"),
    viewerLoading: document.querySelector("#viewerLoading"),
    canvasViewport: document.querySelector("#canvasViewport"),
    pdfCanvas: document.querySelector("#pdfCanvas"),
    previousPageButton: document.querySelector("#previousPageButton"),
    nextPageButton: document.querySelector("#nextPageButton"),
    pageNumberInput: document.querySelector("#pageNumberInput"),
    pageTotalLabel: document.querySelector("#pageTotalLabel"),
    zoomOutButton: document.querySelector("#zoomOutButton"),
    resetZoomButton: document.querySelector("#resetZoomButton"),
    zoomInButton: document.querySelector("#zoomInButton"),
    zoomLabel: document.querySelector("#zoomLabel"),
    sessionTimerValue: document.querySelector("#sessionTimerValue"),
    timerStartPauseButton: document.querySelector("#timerStartPauseButton"),
    timerResetButton: document.querySelector("#timerResetButton"),
    progressLabel: document.querySelector("#progressLabel"),
    progressSubLabel: document.querySelector("#progressSubLabel"),
    goalSummary: document.querySelector("#goalSummary"),
    progressBar: document.querySelector("#progressBar"),
    themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
    appStatus: document.querySelector("#appStatus"),
    toastRegion: document.querySelector("#toastRegion"),
  };

  const state = {
    documents: [],
    progressRecords: [],
    notes: [],
    sessions: [],
    pageVisits: [],
    goal: null,
    theme: "light",
    activeDocumentId: null,
    currentDocument: null,
    currentPage: 1,
    totalPages: 0,
    zoomPercent: 100,
    noteDrawerOpen: false,
    lastVisitedToken: null,
    helperDismissed: false,
  };

  let noteDraftTimeout = 0;

  const viewer = createPdfViewer({
    canvas: elements.pdfCanvas,
    container: elements.canvasViewport,
    onRenderStateChange: handleViewerRender,
    onError: (error) => {
      console.error(error);
      setStatus(elements.appStatus, "Could not render this PDF.");
      showToast("Could not render this PDF.", elements.toastRegion);
    },
  });

  const timer = createTimerController({
    onTick: persistTimerAndRender,
    onStateChange: persistTimerAndRender,
  });

  function currentDocumentNotes() {
    return state.currentDocument
      ? getNotesForDocument(state.notes, state.currentDocument.id).sort(sortNotes)
      : [];
  }

  function currentRecentNotes() {
    return state.currentDocument
      ? [...getNotesForDocument(state.notes, state.currentDocument.id)].sort(
          (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
        )
      : [];
  }

  function setNoteDrawerOpen(open) {
    state.noteDrawerOpen = open;
    elements.noteDrawer.hidden = !open;
    elements.noteDrawerBackdrop.hidden = !open;

    if (open) {
      elements.noteContentInput.focus();
    }
  }

  async function persistDraftNow() {
    window.clearTimeout(noteDraftTimeout);

    if (!state.currentDocument) {
      return;
    }

    const payload = {
      page: clamp(Number(elements.notePageInput.value) || 1, 1, Math.max(state.totalPages, 1)),
      type: elements.noteTypeSelect.value,
      selectedText: elements.noteSnippetInput.value.trim(),
      content: elements.noteContentInput.value.trim(),
    };

    const key = getDraftKey(state.currentDocument.id);

    if (!payload.selectedText && !payload.content) {
      await deleteSetting(key);
      elements.noteAutosaveHint.textContent = "Drafts save locally while you type.";
      return;
    }

    await saveSetting(key, payload);
    elements.noteAutosaveHint.textContent = "Draft saved locally.";
  }

  function scheduleDraftSave() {
    if (!state.currentDocument) {
      return;
    }

    elements.noteAutosaveHint.textContent = "Saving draft locally…";
    window.clearTimeout(noteDraftTimeout);
    noteDraftTimeout = window.setTimeout(() => {
      void persistDraftNow();
    }, 220);
  }

  async function restoreDraft() {
    elements.notePageInput.value = String(state.currentPage);
    elements.noteTypeSelect.value = "definition";
    elements.noteSnippetInput.value = "";
    elements.noteContentInput.value = "";
    elements.noteAutosaveHint.textContent = "Drafts save locally while you type.";

    if (!state.currentDocument) {
      return;
    }

    const draftRecord = await getSetting(getDraftKey(state.currentDocument.id));
    const draft = draftRecord?.value;

    if (!draft) {
      return;
    }

    elements.notePageInput.value = String(
      clamp(Number(draft.page) || state.currentPage, 1, Math.max(state.totalPages, 1)),
    );
    elements.noteTypeSelect.value = draft.type || "definition";
    elements.noteSnippetInput.value = draft.selectedText ?? "";
    elements.noteContentInput.value = draft.content ?? "";
    elements.noteAutosaveHint.textContent = "Draft restored locally.";
  }

  function render() {
    applyTheme(state.theme, elements.themeButtons);
    elements.readerEmptyState.hidden = Boolean(state.currentDocument);
    elements.readerCanvasShell.hidden = !state.currentDocument;
    elements.pageTotalLabel.textContent = `/ ${state.totalPages || 0}`;
    elements.pageNumberInput.disabled = !state.currentDocument;
    elements.previousPageButton.disabled = !state.currentDocument || state.currentPage <= 1;
    elements.nextPageButton.disabled = !state.currentDocument || state.currentPage >= state.totalPages;
    elements.zoomOutButton.disabled = !state.currentDocument;
    elements.zoomInButton.disabled = !state.currentDocument;
    elements.resetZoomButton.disabled = !state.currentDocument;
    elements.toggleNoteDrawerButton.disabled = !state.currentDocument;
    elements.pageNumberInput.max = String(Math.max(1, state.totalPages || 1));
    elements.notePageInput.max = String(Math.max(1, state.totalPages || 1));
    elements.zoomLabel.textContent = `${state.zoomPercent}%`;
    elements.pageNumberInput.value = String(state.currentPage);
    elements.studyLink.href = studyHref(state.currentDocument?.id ?? state.activeDocumentId);
    elements.drawerStudyLink.href = studyHref(state.currentDocument?.id ?? state.activeDocumentId);

    const recentDocuments = buildRecentDocumentSummaries(
      state.documents,
      state.progressRecords,
      state.notes,
      6,
    );
    renderRecentDocuments(elements.recentDocumentsList, recentDocuments);

    if (!state.currentDocument) {
      elements.documentBadge.textContent = "No document";
      elements.documentTitle.textContent = "Open a local PDF and read with fewer distractions";
      elements.documentMeta.textContent =
        "The reader keeps only page controls, timer, progress, and a quick note drawer.";
      elements.progressLabel.textContent = "Progress appears once a PDF is open";
      elements.progressSubLabel.textContent =
        "Choose a local file to enter the focused reader.";
      elements.goalSummary.textContent = `${state.pageVisits.filter((record) => record.date === dayStamp()).length} / ${state.goal.targetPages} pages today`;
      elements.progressBar.style.width = "0%";
      elements.readerHelperPanel.hidden = state.helperDismissed;
      renderDrawerNotes(elements.drawerNotesList, []);
    } else {
      const progressRecord = getProgressRecord(state.progressRecords, state.currentDocument.id);
      const progressPercent = state.totalPages
        ? Math.round((state.currentPage / state.totalPages) * 100)
        : 0;
      const noteCount = currentDocumentNotes().length;
      const goalProgress = calculateGoalProgress(
        state.goal.targetPages,
        state.pageVisits.filter((record) => record.date === dayStamp()).length,
      );

      elements.documentBadge.textContent = "Reading";
      elements.documentTitle.textContent = state.currentDocument.name;
      elements.documentMeta.textContent = `${formatBytes(state.currentDocument.size)} • ${
        state.totalPages
      } pages • ${noteCount} note${noteCount === 1 ? "" : "s"} saved`;
      elements.progressLabel.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
      elements.progressSubLabel.textContent = progressRecord
        ? `Resume is saved locally. Last recorded page: ${progressRecord.currentPage}.`
        : "Progress is tracked automatically while you read.";
      elements.goalSummary.textContent = `${goalProgress.pagesToday} / ${goalProgress.target} pages today`;
      elements.progressBar.style.width = `${progressPercent}%`;
      renderDrawerNotes(elements.drawerNotesList, currentRecentNotes());
      elements.readerHelperPanel.hidden = state.helperDismissed;
    }

    const timerState = timer.getState();
    elements.sessionTimerValue.textContent = formatDuration(timerState.elapsedMs);
    elements.timerStartPauseButton.textContent = timerState.running ? "Pause" : "Start";
  }

  async function openCachedDocument(documentId, pageOverride = null, maybeDocumentRecord = null, maybeBytes = null) {
    const documentRecord =
      maybeDocumentRecord ??
      state.documents.find((item) => item.id === documentId) ??
      (await loadDocumentById(documentId));

    if (!documentRecord) {
      state.currentDocument = null;
      render();
      return;
    }

    const bytes = maybeBytes ?? getCachedDocumentBytes(documentRecord);

    if (!bytes) {
      setStatus(elements.appStatus, "This cached document no longer has local PDF bytes.");
      showToast("That document is missing its cached PDF data.", elements.toastRegion);
      return;
    }

    try {
      elements.viewerLoading.hidden = false;
      elements.viewerLoading.textContent = `Loading ${documentRecord.name}…`;
      state.currentDocument = documentRecord;
      state.activeDocumentId = documentRecord.id;
      state.lastVisitedToken = null;
      await persistActiveDocumentId(documentRecord.id);
      timer.setDocumentId(documentRecord.id);

      const viewerState = await viewer.loadDocument({
        data: bytes,
        initialPage:
          pageOverride ??
          getProgressRecord(state.progressRecords, documentRecord.id)?.currentPage ??
          1,
      });

      state.currentDocument = {
        ...documentRecord,
        totalPages: viewerState.totalPages,
        lastOpened: new Date().toISOString(),
      };
      state.currentPage = viewerState.currentPage;
      state.totalPages = viewerState.totalPages;
      state.zoomPercent = viewerState.zoomPercent;
      state.documents = upsertRecord(state.documents, state.currentDocument).sort(
        (left, right) => new Date(right.lastOpened ?? 0) - new Date(left.lastOpened ?? 0),
      );
      await saveDocument(state.currentDocument);
      setReaderUrl(documentRecord.id, pageOverride);
      setStatus(elements.appStatus, `${documentRecord.name} is ready.`);
      await restoreDraft();
      render();
    } catch (error) {
      console.error(error);
      setStatus(elements.appStatus, `Could not load ${documentRecord.name}.`);
      showToast(`Could not load ${documentRecord.name}.`, elements.toastRegion);
    } finally {
      elements.viewerLoading.hidden = true;
    }
  }

  async function handleViewerRender(viewerState) {
    state.currentPage = viewerState.currentPage;
    state.totalPages = viewerState.totalPages;
    state.zoomPercent = viewerState.zoomPercent;

    if (!state.currentDocument) {
      render();
      return;
    }

    const nowIso = new Date().toISOString();
    const progressRecord = {
      documentId: state.currentDocument.id,
      currentPage: state.currentPage,
      totalPages: state.totalPages,
      percent: Math.round((state.currentPage / state.totalPages) * 100),
      lastOpened: nowIso,
    };

    state.currentDocument = {
      ...state.currentDocument,
      totalPages: state.totalPages,
      lastOpened: nowIso,
    };

    state.progressRecords = upsertRecord(state.progressRecords, progressRecord, "documentId");
    state.documents = upsertRecord(state.documents, state.currentDocument).sort(
      (left, right) => new Date(right.lastOpened ?? 0) - new Date(left.lastOpened ?? 0),
    );

    await Promise.all([saveProgress(progressRecord), saveDocument(state.currentDocument)]);

    const visitToken = `${state.currentDocument.id}:${dayStamp()}:${state.currentPage}`;

    if (state.lastVisitedToken !== visitToken) {
      state.lastVisitedToken = visitToken;
      const visitRecord = {
        id: `page-visit:${state.currentDocument.id}:${dayStamp()}:${state.currentPage}`,
        type: "page-visit",
        documentId: state.currentDocument.id,
        page: state.currentPage,
        date: dayStamp(),
        createdAt: nowIso,
      };
      state.pageVisits = upsertRecord(state.pageVisits, visitRecord);
      await saveStat(visitRecord);
    }

    if (!elements.noteContentInput.value.trim() && !elements.noteSnippetInput.value.trim()) {
      elements.notePageInput.value = String(state.currentPage);
    }

    render();
  }

  async function openPdf(file) {
    if (!file) {
      return;
    }

    try {
      const { documentRecord, bytes } = await cachePdfFile(file, state.documents);
      state.documents = upsertRecord(state.documents, documentRecord).sort(
        (left, right) => new Date(right.lastOpened ?? 0) - new Date(left.lastOpened ?? 0),
      );
      await openCachedDocument(documentRecord.id, null, documentRecord, bytes);
      showToast(`Opened ${documentRecord.name}.`, elements.toastRegion);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not open that PDF.", elements.toastRegion);
      setStatus(elements.appStatus, "Could not open that PDF.");
    } finally {
      elements.pdfInput.value = "";
    }
  }

  async function persistTimerAndRender() {
    await saveSetting(SETTING_KEYS.activeTimer, timer.getSerializableState());
    render();
  }

  async function resetTimer() {
    const currentTimerState = timer.getState();

    if (currentTimerState.elapsedMs < 1000) {
      timer.reset();
      return;
    }

    const confirmed = window.confirm(
      "Reset this reading session? The elapsed time will be saved locally.",
    );

    if (!confirmed) {
      return;
    }

    const sessionRecord = timer.reset();

    if (sessionRecord) {
      await saveSession(sessionRecord);
      state.sessions = upsertRecord(state.sessions, sessionRecord).sort(
        (left, right) =>
          new Date(right.endedAt ?? right.startedAt ?? 0) -
          new Date(left.endedAt ?? left.startedAt ?? 0),
      );
    }

    showToast("Session saved and timer reset.", elements.toastRegion);
  }

  async function handleNoteSubmit(event) {
    event.preventDefault();

    if (!state.currentDocument) {
      return;
    }

    const content = elements.noteContentInput.value.trim();

    if (!content) {
      elements.noteContentInput.focus();
      return;
    }

    const noteRecord = createNoteRecord({
      documentId: state.currentDocument.id,
      page: clamp(Number(elements.notePageInput.value) || state.currentPage, 1, state.totalPages),
      type: elements.noteTypeSelect.value,
      content,
      selectedText: elements.noteSnippetInput.value,
    });

    await saveNote(noteRecord);
    state.notes = upsertRecord(state.notes, noteRecord);
    await deleteSetting(getDraftKey(state.currentDocument.id));

    elements.notePageInput.value = String(state.currentPage);
    elements.noteTypeSelect.value = "definition";
    elements.noteSnippetInput.value = "";
    elements.noteContentInput.value = "";
    elements.noteAutosaveHint.textContent = "Note saved locally.";
    render();
    showToast(`Saved a note for page ${noteRecord.page}.`, elements.toastRegion);
  }

  function exportCurrentNotes() {
    if (!state.currentDocument) {
      return;
    }

    const markdown = buildNotesMarkdown(state.currentDocument, currentDocumentNotes());
    downloadTextFile(
      `${sanitizeFilename(state.currentDocument.name)}-notes.md`,
      markdown,
      "text/markdown;charset=utf-8",
    );
  }

  function handleGlobalShortcuts(event) {
    const isField =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement;

    if (event.key === "Escape" && state.noteDrawerOpen) {
      event.preventDefault();
      setNoteDrawerOpen(false);
      return;
    }

    if (!state.currentDocument || isField) {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      void viewer.nextPage();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      void viewer.previousPage();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      setNoteDrawerOpen(true);
    } else if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      elements.pageNumberInput.focus();
      elements.pageNumberInput.select();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportCurrentNotes();
    }
  }

  elements.openPdfButton.addEventListener("click", () => elements.pdfInput.click());
  elements.readerEmptyOpenButton.addEventListener("click", () => elements.pdfInput.click());
  elements.pdfInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void openPdf(file);
  });

  elements.toggleNoteDrawerButton.addEventListener("click", () => setNoteDrawerOpen(true));
  elements.closeNoteDrawerButton.addEventListener("click", () => setNoteDrawerOpen(false));
  elements.noteDrawerBackdrop.addEventListener("click", () => setNoteDrawerOpen(false));
  elements.noteForm.addEventListener("submit", (event) => {
    void handleNoteSubmit(event);
  });
  elements.notePageInput.addEventListener("input", scheduleDraftSave);
  elements.noteTypeSelect.addEventListener("change", scheduleDraftSave);
  elements.noteSnippetInput.addEventListener("input", scheduleDraftSave);
  elements.noteContentInput.addEventListener("input", scheduleDraftSave);

  elements.drawerNotesList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-jump-page]");

    if (!trigger) {
      return;
    }

    setNoteDrawerOpen(false);
    void viewer.goToPage(Number(trigger.dataset.jumpPage));
  });

  elements.recentDocumentsList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-document]");

    if (!trigger) {
      return;
    }

    void openCachedDocument(trigger.dataset.openDocument);
  });

  elements.previousPageButton.addEventListener("click", () => {
    void viewer.previousPage();
  });
  elements.nextPageButton.addEventListener("click", () => {
    void viewer.nextPage();
  });
  elements.pageNumberInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void viewer.goToPage(Number(elements.pageNumberInput.value));
    }
  });
  elements.pageNumberInput.addEventListener("change", () => {
    void viewer.goToPage(Number(elements.pageNumberInput.value));
  });
  elements.zoomOutButton.addEventListener("click", () => {
    void viewer.zoomOut();
  });
  elements.zoomInButton.addEventListener("click", () => {
    void viewer.zoomIn();
  });
  elements.resetZoomButton.addEventListener("click", () => {
    void viewer.resetZoom();
  });
  elements.timerStartPauseButton.addEventListener("click", () => {
    if (timer.getState().running) {
      timer.pause();
    } else {
      timer.start(state.currentDocument?.id ?? null);
    }
  });
  elements.timerResetButton.addEventListener("click", () => {
    void resetTimer();
  });
  elements.dismissReaderHelperButton.addEventListener("click", async () => {
    state.helperDismissed = true;
    elements.readerHelperPanel.hidden = true;
    await saveSetting(SETTING_KEYS.readerHelperDismissed, true);
  });

  for (const button of elements.themeButtons) {
    button.addEventListener("click", async () => {
      state.theme = button.dataset.themeChoice;
      applyTheme(state.theme, elements.themeButtons);
      await persistTheme(state.theme);
    });
  }

  document.addEventListener("keydown", handleGlobalShortcuts);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void persistDraftNow();
      void saveSetting(SETTING_KEYS.activeTimer, timer.getSerializableState());
    }
  });

  await initStorage();
  const model = await loadAppModel();
  state.documents = model.documents;
  state.progressRecords = model.progressRecords;
  state.notes = model.notes;
  state.sessions = model.sessions;
  state.pageVisits = model.pageVisits;
  state.goal = model.goal;
  state.theme = model.theme;
  state.activeDocumentId =
    getQueryParam("doc") ??
    model.activeDocumentId ??
    model.documents[0]?.id ??
    null;
  state.helperDismissed = model.readerHelperDismissed;

  applyTheme(state.theme, elements.themeButtons);
  timer.restore(model.activeTimerState);

  const queryPage = Number(getQueryParam("page")) || null;

  if (state.activeDocumentId) {
    await openCachedDocument(state.activeDocumentId, queryPage);
  } else {
    render();
  }

  setStatus(elements.appStatus, "Ready.");
}
