import { createPdfViewer } from "./pdf-viewer.js";
import { createNoteRecord, getNotePreview, NOTE_TYPE_META, sortNotes } from "./notes.js";
import { buildGlossary } from "./revision.js";
import { createTimerController, formatDuration } from "./sessions.js";
import { calculateGoalProgress, dayStamp } from "./goals.js";
import {
  deleteSetting,
  getSetting,
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
  setReaderUrl,
  setStatus,
  showToast,
  studyHref,
  upsertRecord,
} from "./common.js";

const READER_TABS = ["annotations", "glossary"];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toTypeClass(type) {
  return String(type ?? "note")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAnnotationDraftKey(documentId) {
  return `reader-annotation-draft:${documentId}`;
}

function getGlossaryDraftKey(documentId) {
  return `reader-glossary-draft:${documentId}`;
}

function renderRecentDocuments(target, documents) {
  if (!documents.length) {
    target.innerHTML = `
      <div class="revision-empty">No cached PDFs yet. Open a local file to begin.</div>
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
              <span class="subtle-copy">${documentRecord.noteCount} mark${documentRecord.noteCount === 1 ? "" : "s"}</span>
            </div>
          </button>
        </article>
      `,
    )
    .join("");
}

function renderCurrentPageNotes(target, notes) {
  if (!notes.length) {
    target.innerHTML = `
      <div class="revision-empty">No notes, highlights, or glossary items are pinned to this page yet.</div>
    `;
    return;
  }

  target.innerHTML = notes
    .map((note) => {
      const preview = note.content?.trim()
        ? escapeHtml(note.content)
        : `<span class="subtle-copy">Saved without extra note text.</span>`;
      const snippet = note.selectedText?.trim()
        ? `<div class="note-snippet">${escapeHtml(note.selectedText)}</div>`
        : "";
      const term = note.term?.trim()
        ? `<strong class="annotation-card-term">${escapeHtml(note.term)}</strong>`
        : "";

      return `
        <article
          id="sidebar-note-${note.id}"
          class="annotation-card annotation-card--${toTypeClass(note.type)}"
          data-note-card="${note.id}"
        >
          <div class="note-meta">
            <span class="pill">${escapeHtml(NOTE_TYPE_META[note.type]?.label ?? note.type)}</span>
            <span class="subtle-copy">${escapeHtml(formatTimestamp(note.createdAt))}</span>
          </div>
          ${term}
          ${snippet}
          <p>${preview}</p>
          <div class="note-actions">
            <button class="action-link" type="button" data-focus-note="${note.id}">Reveal on page</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderGlossaryList(target, entries) {
  if (!entries.length) {
    target.innerHTML = `
      <div class="revision-empty">No glossary entries match this PDF yet.</div>
    `;
    return;
  }

  target.innerHTML = entries
    .map(
      (entry) => `
        <article class="glossary-item glossary-entry-card">
          <div class="note-meta">
            <strong>${escapeHtml(entry.term)}</strong>
            <button class="action-link" type="button" data-jump-page="${entry.page}">Page ${entry.page}</button>
          </div>
          <p>${escapeHtml(entry.definition)}</p>
        </article>
      `,
    )
    .join("");
}

function renderPageOverlay(target, notes) {
  if (!notes.length) {
    target.innerHTML = "";
    return;
  }

  target.innerHTML = notes
    .map((note, index, allNotes) => {
      const total = allNotes.length;
      const top = total === 1 ? 24 : 12 + (index * 72) / Math.max(total - 1, 1);
      const previewSource =
        note.term?.trim() ||
        note.selectedText?.trim() ||
        note.content?.trim() ||
        NOTE_TYPE_META[note.type]?.label ||
        note.type;
      const preview = escapeHtml(getNotePreview(previewSource, note.type === "highlight" ? 72 : 48));
      const alignmentClass =
        note.type === "definition" || note.type === "question" ? "is-right" : "is-left";
      const bandClass = note.type === "highlight" ? "annotation-marker--band" : "";

      return `
        <button
          type="button"
          class="annotation-marker annotation-marker--${toTypeClass(note.type)} ${alignmentClass} ${bandClass}"
          style="top: ${top}%"
          data-focus-note="${note.id}"
        >
          <span class="annotation-marker-accent" aria-hidden="true"></span>
          <span class="annotation-marker-body">
            <span class="annotation-marker-type">${escapeHtml(
              NOTE_TYPE_META[note.type]?.label ?? note.type,
            )}</span>
            <span class="annotation-marker-text">${preview}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function getFocusableTag(target) {
  const element = target instanceof Element ? target : null;
  return element?.closest("input, textarea, select, button, [contenteditable='true'], a");
}

export async function init() {
  const elements = {
    pdfInput: document.querySelector("#pdfFileInput"),
    openPdfButton: document.querySelector("#openPdfButton"),
    readerEmptyOpenButton: document.querySelector("#readerEmptyOpenButton"),
    themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
    readerTabButtons: [...document.querySelectorAll("[data-reader-tab]")],
    studyLink: document.querySelector("#studyLink"),
    annotationStudyLink: document.querySelector("#annotationStudyLink"),
    readerEmptyState: document.querySelector("#readerEmptyState"),
    readerCanvasShell: document.querySelector("#readerCanvasShell"),
    recentDocumentsList: document.querySelector("#recentDocumentsList"),
    readerHelperPanel: document.querySelector("#readerHelperPanel"),
    dismissReaderHelperButton: document.querySelector("#dismissReaderHelperButton"),
    documentBadge: document.querySelector("#documentBadge"),
    documentTitle: document.querySelector("#documentTitle"),
    documentMeta: document.querySelector("#documentMeta"),
    viewerLoading: document.querySelector("#viewerLoading"),
    canvasViewport: document.querySelector("#canvasViewport"),
    pdfCanvas: document.querySelector("#pdfCanvas"),
    pageAnnotationOverlay: document.querySelector("#pageAnnotationOverlay"),
    previousPageButton: document.querySelector("#previousPageButton"),
    nextPageButton: document.querySelector("#nextPageButton"),
    pageNumberInput: document.querySelector("#pageNumberInput"),
    pageTotalLabel: document.querySelector("#pageTotalLabel"),
    zoomOutButton: document.querySelector("#zoomOutButton"),
    resetZoomButton: document.querySelector("#resetZoomButton"),
    zoomInButton: document.querySelector("#zoomInButton"),
    zoomLabel: document.querySelector("#zoomLabel"),
    progressLabel: document.querySelector("#progressLabel"),
    progressSubLabel: document.querySelector("#progressSubLabel"),
    goalSummary: document.querySelector("#goalSummary"),
    progressBar: document.querySelector("#progressBar"),
    sessionTimerValue: document.querySelector("#sessionTimerValue"),
    sessionMeta: document.querySelector("#sessionMeta"),
    timerStartPauseButton: document.querySelector("#timerStartPauseButton"),
    timerResetButton: document.querySelector("#timerResetButton"),
    sidebarSummary: document.querySelector("#sidebarSummary"),
    currentPageNotesList: document.querySelector("#currentPageNotesList"),
    annotationsPanel: document.querySelector("#annotationsPanel"),
    annotationForm: document.querySelector("#annotationForm"),
    notePageInput: document.querySelector("#notePageInput"),
    noteTypeSelect: document.querySelector("#noteTypeSelect"),
    noteSnippetInput: document.querySelector("#noteSnippetInput"),
    noteContentInput: document.querySelector("#noteContentInput"),
    noteAutosaveHint: document.querySelector("#noteAutosaveHint"),
    glossaryPanel: document.querySelector("#glossaryPanel"),
    glossaryForm: document.querySelector("#glossaryForm"),
    glossaryTermInput: document.querySelector("#glossaryTermInput"),
    glossaryDefinitionInput: document.querySelector("#glossaryDefinitionInput"),
    glossarySearchInput: document.querySelector("#glossarySearchInput"),
    sidebarGlossaryList: document.querySelector("#sidebarGlossaryList"),
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
    helperDismissed: false,
    activeReaderTab: "annotations",
    lastVisitedToken: null,
  };

  let annotationDraftTimeout = 0;
  let glossaryDraftTimeout = 0;
  let focusPulseTimeout = 0;

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

  function currentPageNotes() {
    return currentDocumentNotes().filter((note) => note.page === state.currentPage);
  }

  function glossaryEntries() {
    return buildGlossary(currentDocumentNotes(), elements.glossarySearchInput.value);
  }

  function setReaderTab(tabName) {
    state.activeReaderTab = READER_TABS.includes(tabName) ? tabName : "annotations";

    for (const button of elements.readerTabButtons) {
      button.classList.toggle("is-active", button.dataset.readerTab === state.activeReaderTab);
    }

    elements.annotationsPanel.hidden = state.activeReaderTab !== "annotations";
    elements.glossaryPanel.hidden = state.activeReaderTab !== "glossary";
  }

  function setFormAvailability(hasDocument) {
    const annotationControls = [
      elements.notePageInput,
      elements.noteTypeSelect,
      elements.noteSnippetInput,
      elements.noteContentInput,
      ...elements.annotationForm.querySelectorAll("button"),
    ];
    const glossaryControls = [
      elements.glossaryTermInput,
      elements.glossaryDefinitionInput,
      elements.glossarySearchInput,
      ...elements.glossaryForm.querySelectorAll("button"),
    ];

    for (const control of [...annotationControls, ...glossaryControls]) {
      control.disabled = !hasDocument;
    }
  }

  async function persistAnnotationDraftNow() {
    window.clearTimeout(annotationDraftTimeout);

    if (!state.currentDocument) {
      return;
    }

    const payload = {
      page: clamp(Number(elements.notePageInput.value) || state.currentPage, 1, Math.max(1, state.totalPages)),
      type: elements.noteTypeSelect.value,
      selectedText: elements.noteSnippetInput.value.trim(),
      content: elements.noteContentInput.value.trim(),
    };
    const draftKey = getAnnotationDraftKey(state.currentDocument.id);

    if (!payload.selectedText && !payload.content) {
      await deleteSetting(draftKey);
      elements.noteAutosaveHint.textContent = "Drafts save locally while you type.";
      return;
    }

    await saveSetting(draftKey, payload);
    elements.noteAutosaveHint.textContent = "Annotation draft saved locally.";
  }

  function scheduleAnnotationDraftSave() {
    if (!state.currentDocument) {
      return;
    }

    elements.noteAutosaveHint.textContent = "Saving draft locally…";
    window.clearTimeout(annotationDraftTimeout);
    annotationDraftTimeout = window.setTimeout(() => {
      void persistAnnotationDraftNow();
    }, 240);
  }

  async function persistGlossaryDraftNow() {
    window.clearTimeout(glossaryDraftTimeout);

    if (!state.currentDocument) {
      return;
    }

    const payload = {
      term: elements.glossaryTermInput.value.trim(),
      definition: elements.glossaryDefinitionInput.value.trim(),
    };
    const draftKey = getGlossaryDraftKey(state.currentDocument.id);

    if (!payload.term && !payload.definition) {
      await deleteSetting(draftKey);
      return;
    }

    await saveSetting(draftKey, payload);
  }

  function scheduleGlossaryDraftSave() {
    if (!state.currentDocument) {
      return;
    }

    window.clearTimeout(glossaryDraftTimeout);
    glossaryDraftTimeout = window.setTimeout(() => {
      void persistGlossaryDraftNow();
    }, 240);
  }

  async function restoreDrafts() {
    const defaultAnnotationType = "highlight";

    elements.notePageInput.value = String(clamp(state.currentPage || 1, 1, Math.max(1, state.totalPages)));
    elements.noteTypeSelect.value = defaultAnnotationType;
    elements.noteSnippetInput.value = "";
    elements.noteContentInput.value = "";
    elements.noteAutosaveHint.textContent = "Drafts save locally while you type.";
    elements.glossaryTermInput.value = "";
    elements.glossaryDefinitionInput.value = "";

    if (!state.currentDocument) {
      return;
    }

    const [annotationDraftRecord, glossaryDraftRecord] = await Promise.all([
      getSetting(getAnnotationDraftKey(state.currentDocument.id)),
      getSetting(getGlossaryDraftKey(state.currentDocument.id)),
    ]);

    const annotationDraft = annotationDraftRecord?.value;
    const glossaryDraft = glossaryDraftRecord?.value;
    const availableTypes = [...elements.noteTypeSelect.options].map((option) => option.value);

    if (annotationDraft) {
      elements.notePageInput.value = String(
        clamp(Number(annotationDraft.page) || state.currentPage, 1, Math.max(1, state.totalPages)),
      );
      elements.noteTypeSelect.value = availableTypes.includes(annotationDraft.type)
        ? annotationDraft.type
        : defaultAnnotationType;
      elements.noteSnippetInput.value = annotationDraft.selectedText ?? "";
      elements.noteContentInput.value = annotationDraft.content ?? "";
      elements.noteAutosaveHint.textContent = "Annotation draft restored locally.";
    }

    if (glossaryDraft) {
      elements.glossaryTermInput.value = glossaryDraft.term ?? "";
      elements.glossaryDefinitionInput.value = glossaryDraft.definition ?? "";
    }
  }

  function pulseNote(noteId) {
    window.clearTimeout(focusPulseTimeout);

    for (const target of document.querySelectorAll(".is-active, .is-emphasized")) {
      target.classList.remove("is-active", "is-emphasized");
    }

    const overlayMarker = elements.pageAnnotationOverlay.querySelector(`[data-focus-note="${noteId}"]`);
    const sidebarCard = elements.currentPageNotesList.querySelector(`[data-note-card="${noteId}"]`);

    overlayMarker?.classList.add("is-active");
    sidebarCard?.classList.add("is-emphasized");
    sidebarCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    focusPulseTimeout = window.setTimeout(() => {
      overlayMarker?.classList.remove("is-active");
      sidebarCard?.classList.remove("is-emphasized");
    }, 2400);
  }

  function render() {
    const hasDocument = Boolean(state.currentDocument);
    const notesForDocument = currentDocumentNotes();
    const pageNotes = currentPageNotes();
    const glossary = glossaryEntries();
    const progressRecord = hasDocument ? getProgressRecord(state.progressRecords, state.currentDocument.id) : null;
    const pagesToday = state.pageVisits.filter((record) => record.date === dayStamp()).length;
    const goalProgress = calculateGoalProgress(state.goal.targetPages, pagesToday);
    const recentDocuments = buildRecentDocumentSummaries(
      state.documents,
      state.progressRecords,
      state.notes,
      6,
    );
    const documentGlossaryCount = notesForDocument.filter((note) => note.type === "definition").length;
    const pageGlossaryCount = pageNotes.filter((note) => note.type === "definition").length;
    const progressPercent = hasDocument && state.totalPages
      ? Math.round((state.currentPage / state.totalPages) * 100)
      : 0;
    const timerState = timer.getState();

    applyTheme(state.theme, elements.themeButtons);
    setReaderTab(state.activeReaderTab);
    setFormAvailability(hasDocument);
    renderRecentDocuments(elements.recentDocumentsList, recentDocuments);
    renderCurrentPageNotes(elements.currentPageNotesList, hasDocument ? pageNotes : []);
    renderGlossaryList(elements.sidebarGlossaryList, hasDocument ? glossary : []);
    renderPageOverlay(elements.pageAnnotationOverlay, hasDocument ? pageNotes : []);

    elements.readerEmptyState.hidden = hasDocument;
    elements.readerCanvasShell.hidden = !hasDocument;
    elements.readerHelperPanel.hidden = state.helperDismissed;
    elements.pageNumberInput.disabled = !hasDocument;
    elements.pageNumberInput.max = String(Math.max(1, state.totalPages || 1));
    elements.pageTotalLabel.textContent = `/ ${state.totalPages || 0}`;
    elements.pageNumberInput.value = String(state.currentPage || 1);
    elements.previousPageButton.disabled = !hasDocument || state.currentPage <= 1;
    elements.nextPageButton.disabled = !hasDocument || state.currentPage >= state.totalPages;
    elements.zoomOutButton.disabled = !hasDocument;
    elements.zoomInButton.disabled = !hasDocument;
    elements.resetZoomButton.disabled = !hasDocument;
    elements.notePageInput.max = String(Math.max(1, state.totalPages || 1));
    elements.zoomLabel.textContent = `${state.zoomPercent}%`;
    elements.studyLink.href = studyHref(state.currentDocument?.id ?? state.activeDocumentId);
    elements.annotationStudyLink.href = studyHref(state.currentDocument?.id ?? state.activeDocumentId);
    elements.progressBar.style.width = `${progressPercent}%`;
    elements.goalSummary.textContent = `${goalProgress.pagesToday} / ${goalProgress.target} pages today`;
    elements.sessionTimerValue.textContent = formatDuration(timerState.elapsedMs);
    elements.timerStartPauseButton.textContent = timerState.running ? "Pause" : "Start";
    elements.readerEmptyOpenButton.textContent = hasDocument ? "Replace PDF" : "Open a PDF";

    if (!hasDocument) {
      elements.documentBadge.textContent = "No document";
      elements.documentTitle.textContent = "Open a local PDF and keep the page in front of you";
      elements.documentMeta.textContent =
        "The PDF stays dominant on the left. Notes, glossary, and sessions stay tucked into the right sidebar.";
      elements.progressLabel.textContent = "Progress appears once a PDF is open";
      elements.progressSubLabel.textContent = "The app restores your last page automatically for cached PDFs.";
      elements.sidebarSummary.textContent = "Open a PDF to begin collecting notes and glossary entries.";
      elements.sessionMeta.textContent = "Sessions attach to the current PDF and stay local.";
      return;
    }

    elements.documentBadge.textContent = "Reading";
    elements.documentTitle.textContent = state.currentDocument.name;
    elements.documentMeta.textContent = `${formatBytes(state.currentDocument.size)} • ${
      state.totalPages
    } pages • ${notesForDocument.length} saved mark${notesForDocument.length === 1 ? "" : "s"} • ${
      documentGlossaryCount
    } glossary term${documentGlossaryCount === 1 ? "" : "s"}`;
    elements.progressLabel.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
    elements.progressSubLabel.textContent = progressRecord
      ? `Resume is saved locally. Last recorded page: ${progressRecord.currentPage}.`
      : "Progress is tracked automatically while you read.";
    elements.sessionMeta.textContent = timerState.running
      ? `Timer is running on ${state.currentDocument.name}. Reset saves this session locally.`
      : `Attached to ${state.currentDocument.name}. Reset saves this reading block as a session.`;
    elements.sidebarSummary.textContent = pageNotes.length
      ? `Page ${state.currentPage} has ${pageNotes.length} saved mark${
          pageNotes.length === 1 ? "" : "s"
        }, including ${pageGlossaryCount} glossary term${pageGlossaryCount === 1 ? "" : "s"}.`
      : `Page ${state.currentPage} is clear. Add a highlight, note, or glossary term without leaving the reader.`;
  }

  async function openCachedDocument(documentId, pageOverride = null, maybeDocumentRecord = null, maybeBytes = null) {
    const documentRecord =
      maybeDocumentRecord ??
      state.documents.find((item) => item.id === documentId) ??
      (await loadDocumentById(documentId));

    if (!documentRecord) {
      state.currentDocument = null;
      state.activeDocumentId = null;
      render();
      return;
    }

    const bytes = maybeBytes ?? getCachedDocumentBytes(documentRecord);

    if (!bytes) {
      setStatus(elements.appStatus, "This cached document no longer has local PDF bytes.");
      showToast("That document is missing its locally cached PDF.", elements.toastRegion);
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
      setReaderUrl(documentRecord.id, viewerState.currentPage);
      await restoreDrafts();
      setStatus(elements.appStatus, `${documentRecord.name} is ready.`);
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

    if (!elements.noteSnippetInput.value.trim() && !elements.noteContentInput.value.trim()) {
      elements.notePageInput.value = String(state.currentPage);
    }

    setReaderUrl(state.currentDocument.id, state.currentPage);
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
      setStatus(elements.appStatus, "Could not open that PDF.");
      showToast(error.message || "Could not open that PDF.", elements.toastRegion);
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

    if (!sessionRecord) {
      return;
    }

    await saveSession(sessionRecord);
    state.sessions = upsertRecord(state.sessions, sessionRecord).sort(
      (left, right) =>
        new Date(right.endedAt ?? right.startedAt ?? 0) -
        new Date(left.endedAt ?? left.startedAt ?? 0),
    );
    showToast("Reading session saved locally.", elements.toastRegion);
  }

  async function saveAnnotation(event) {
    event.preventDefault();

    if (!state.currentDocument) {
      return;
    }

    const selectedText = elements.noteSnippetInput.value.trim();
    const content = elements.noteContentInput.value.trim();

    if (!selectedText && !content) {
      showToast("Add a snippet, a note, or both before saving.", elements.toastRegion);
      return;
    }

    const noteRecord = createNoteRecord({
      documentId: state.currentDocument.id,
      page: clamp(Number(elements.notePageInput.value) || state.currentPage, 1, Math.max(1, state.totalPages)),
      type: elements.noteTypeSelect.value,
      selectedText,
      content,
    });

    await saveNote(noteRecord);
    state.notes = upsertRecord(state.notes, noteRecord).sort(sortNotes);
    await deleteSetting(getAnnotationDraftKey(state.currentDocument.id));
    elements.notePageInput.value = String(state.currentPage);
    elements.noteSnippetInput.value = "";
    elements.noteContentInput.value = "";
    elements.noteAutosaveHint.textContent = "Annotation saved locally.";
    render();
    pulseNote(noteRecord.id);
    showToast(`Annotation saved to page ${noteRecord.page}.`, elements.toastRegion);
  }

  async function saveGlossaryEntry(event) {
    event.preventDefault();

    if (!state.currentDocument) {
      return;
    }

    const term = elements.glossaryTermInput.value.trim();
    const definition = elements.glossaryDefinitionInput.value.trim();

    if (!term || !definition) {
      showToast("Add both a term and a definition.", elements.toastRegion);
      return;
    }

    const noteRecord = createNoteRecord({
      documentId: state.currentDocument.id,
      page: state.currentPage,
      type: "definition",
      selectedText: term,
      term,
      content: definition,
    });

    await saveNote(noteRecord);
    state.notes = upsertRecord(state.notes, noteRecord).sort(sortNotes);
    await deleteSetting(getGlossaryDraftKey(state.currentDocument.id));
    elements.glossaryTermInput.value = "";
    elements.glossaryDefinitionInput.value = "";
    setReaderTab("glossary");
    render();
    pulseNote(noteRecord.id);
    showToast("Glossary entry saved for this PDF.", elements.toastRegion);
  }

  async function jumpToPage(pageNumber) {
    if (!state.currentDocument) {
      return;
    }

    const targetPage = clamp(Number(pageNumber) || state.currentPage, 1, Math.max(1, state.totalPages));

    try {
      await viewer.goToPage(targetPage);
    } catch (error) {
      console.error(error);
      showToast("Could not change pages.", elements.toastRegion);
    }
  }

  elements.openPdfButton.addEventListener("click", () => elements.pdfInput.click());
  elements.readerEmptyOpenButton.addEventListener("click", () => elements.pdfInput.click());
  elements.pdfInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void openPdf(file);
  });

  elements.readerTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setReaderTab(button.dataset.readerTab);
    });
  });

  elements.previousPageButton.addEventListener("click", () => {
    void viewer.previousPage();
  });
  elements.nextPageButton.addEventListener("click", () => {
    void viewer.nextPage();
  });
  elements.pageNumberInput.addEventListener("change", () => {
    void jumpToPage(elements.pageNumberInput.value);
  });
  elements.pageNumberInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void jumpToPage(elements.pageNumberInput.value);
    }
  });
  elements.zoomOutButton.addEventListener("click", () => {
    void viewer.zoomOut();
  });
  elements.resetZoomButton.addEventListener("click", () => {
    void viewer.resetZoom();
  });
  elements.zoomInButton.addEventListener("click", () => {
    void viewer.zoomIn();
  });

  elements.annotationForm.addEventListener("submit", (event) => {
    void saveAnnotation(event);
  });
  [elements.notePageInput, elements.noteTypeSelect, elements.noteSnippetInput, elements.noteContentInput].forEach(
    (field) => {
      field.addEventListener("input", () => {
        scheduleAnnotationDraftSave();
      });
    },
  );

  elements.glossaryForm.addEventListener("submit", (event) => {
    void saveGlossaryEntry(event);
  });
  [elements.glossaryTermInput, elements.glossaryDefinitionInput].forEach((field) => {
    field.addEventListener("input", () => {
      scheduleGlossaryDraftSave();
    });
  });
  elements.glossarySearchInput.addEventListener("input", () => {
    render();
  });

  elements.currentPageNotesList.addEventListener("click", (event) => {
    const focusTrigger = event.target.closest("[data-focus-note]");

    if (focusTrigger) {
      pulseNote(focusTrigger.dataset.focusNote);
    }
  });

  elements.pageAnnotationOverlay.addEventListener("click", (event) => {
    const focusTrigger = event.target.closest("[data-focus-note]");

    if (focusTrigger) {
      pulseNote(focusTrigger.dataset.focusNote);
    }
  });

  elements.sidebarGlossaryList.addEventListener("click", (event) => {
    const jumpTrigger = event.target.closest("[data-jump-page]");

    if (jumpTrigger) {
      void jumpToPage(jumpTrigger.dataset.jumpPage);
    }
  });

  elements.recentDocumentsList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-document]");

    if (!trigger) {
      return;
    }

    void openCachedDocument(trigger.dataset.openDocument);
  });

  elements.timerStartPauseButton.addEventListener("click", () => {
    const timerState = timer.getState();

    if (timerState.running) {
      timer.pause();
      return;
    }

    timer.start(state.currentDocument?.id ?? null);
  });
  elements.timerResetButton.addEventListener("click", () => {
    void resetTimer();
  });

  elements.dismissReaderHelperButton.addEventListener("click", async () => {
    state.helperDismissed = true;
    elements.readerHelperPanel.hidden = true;
    await saveSetting(SETTING_KEYS.readerHelperDismissed, true);
  });

  elements.themeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      state.theme = button.dataset.themeChoice;
      applyTheme(state.theme, elements.themeButtons);
      await persistTheme(state.theme);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (!state.currentDocument) {
      return;
    }

    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const activeControl = getFocusableTag(event.target);
    const isTypingContext = activeControl?.matches("input, textarea, select, [contenteditable='true']");

    if (!activeControl && event.key === "ArrowLeft") {
      event.preventDefault();
      void viewer.previousPage();
      return;
    }

    if (!activeControl && event.key === "ArrowRight") {
      event.preventDefault();
      void viewer.nextPage();
      return;
    }

    if (isTypingContext) {
      return;
    }

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      setReaderTab("annotations");
      elements.noteContentInput.focus();
      return;
    }

    if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      elements.pageNumberInput.focus();
      elements.pageNumberInput.select();
    }
  });

  try {
    await initStorage();
    const model = await loadAppModel();

    state.documents = model.documents;
    state.progressRecords = model.progressRecords;
    state.notes = model.notes;
    state.sessions = model.sessions;
    state.pageVisits = model.pageVisits;
    state.goal = model.goal;
    state.theme = model.theme;
    state.activeDocumentId = getQueryParam("doc") ?? model.activeDocumentId;
    state.helperDismissed = model.readerHelperDismissed;

    applyTheme(state.theme, elements.themeButtons);
    timer.restore(model.activeTimerState);

    const initialPage = Number(getQueryParam("page")) || null;

    if (state.activeDocumentId) {
      await openCachedDocument(state.activeDocumentId, initialPage);
    } else {
      await restoreDrafts();
      render();
    }

    if (!state.activeDocumentId) {
      setStatus(elements.appStatus, "Ready.");
    }
  } catch (error) {
    console.error(error);
    setStatus(elements.appStatus, error.message || "Could not initialize the reader.");
    showToast("The reader could not initialize local storage.", elements.toastRegion);
  }

  window.addEventListener("beforeunload", () => {
    void persistAnnotationDraftNow();
    void persistGlossaryDraftNow();
    timer.destroy();
  });
}
