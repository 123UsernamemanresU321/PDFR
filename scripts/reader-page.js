import { createPdfViewer } from "./pdf-viewer.js";
import { createNoteRecord, getNotePreview, NOTE_TYPE_META, sortNotes } from "./notes.js";
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
  getCachedDocumentBytes,
  getNotesForDocument,
  getProgressRecord,
  getQueryParam,
  loadAppModel,
  loadDocumentById,
  persistActiveDocumentId,
  setReaderUrl,
  setStatus,
  showToast,
  studyHref,
  upsertRecord,
} from "./common.js";

const FILTER_TYPES = ["all", "definition", "highlight", "quote", "exam point", "question"];
const COMPOSER_TYPES = ["definition", "highlight", "quote", "exam point", "question"];

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

function getDraftKey(documentId) {
  return `reader-note-draft:${documentId}`;
}

function getNoteTerm(note) {
  if (note.term?.trim()) {
    return note.term.trim();
  }

  if (note.selectedText?.trim() && note.type === "definition") {
    return note.selectedText.trim();
  }

  const firstLine = String(note.content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "";
  }

  if (firstLine.includes(":")) {
    return firstLine.split(":")[0].trim();
  }

  return firstLine.split(/\s+/).slice(0, 6).join(" ");
}

function getNoteExcerpt(note) {
  if (note.selectedText?.trim() && note.type !== "definition") {
    return note.selectedText.trim();
  }

  if (note.type !== "highlight" && note.type !== "quote") {
    return "";
  }

  const lines = String(note.content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines[0];
  }

  return "";
}

function getNoteBody(note) {
  const raw = String(note.content ?? "").trim();

  if (!raw) {
    return "";
  }

  if (note.type === "definition" && raw.includes(":")) {
    return raw.split(":").slice(1).join(":").trim() || raw;
  }

  if ((note.type === "highlight" || note.type === "quote") && note.selectedText?.trim()) {
    const normalizedRaw = raw.replace(/\s+/g, " ").trim();
    const normalizedSelected = note.selectedText.trim().replace(/\s+/g, " ");

    if (normalizedRaw === normalizedSelected) {
      return "";
    }
  }

  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);

  if ((note.type === "highlight" || note.type === "quote") && lines.length > 1) {
    return lines.slice(1).join(" ");
  }

  return raw;
}

function parseDefinitionContent(term, content) {
  const safeTerm = term.trim();
  const safeContent = content.trim();

  if (safeTerm) {
    return {
      term: safeTerm,
      selectedText: safeTerm,
      content: safeContent,
    };
  }

  if (safeContent.includes(":")) {
    const [prefix, ...rest] = safeContent.split(":");

    return {
      term: prefix.trim(),
      selectedText: prefix.trim(),
      content: rest.join(":").trim(),
    };
  }

  return {
    term: "",
    selectedText: "",
    content: safeContent,
  };
}

function parseQuickNote(type, term, rawContent) {
  const content = rawContent.trim();

  if (type === "definition") {
    return parseDefinitionContent(term, content);
  }

  if (type === "highlight" || type === "quote") {
    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);

    if (lines.length > 1) {
      return {
        term: "",
        selectedText: lines[0],
        content: lines.slice(1).join(" "),
      };
    }

    return {
      term: "",
      selectedText: content,
      content,
    };
  }

  return {
    term: "",
    selectedText: "",
    content,
  };
}

function buildSaveStateLabel(savedAt) {
  if (!savedAt) {
    return "Local-only workspace";
  }

  const elapsed = Date.now() - savedAt;

  if (elapsed < 60_000) {
    return "Saved just now";
  }

  return `Saved ${new Date(savedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function sortSidebarNotes(notes, currentPage) {
  return [...notes].sort((left, right) => {
    const leftDistance = Math.abs(left.page - currentPage);
    const rightDistance = Math.abs(right.page - currentPage);

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    if (left.page !== right.page) {
      return right.page - left.page;
    }

    return new Date(right.createdAt) - new Date(left.createdAt);
  });
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
              <span class="subtle-copy">${documentRecord.noteCount} note${documentRecord.noteCount === 1 ? "" : "s"}</span>
            </div>
          </button>
        </article>
      `,
    )
    .join("");
}

function renderSidebarNotes(target, notes, currentPage) {
  if (!notes.length) {
    target.innerHTML = `
      <div class="revision-empty">No saved notes match this view yet.</div>
    `;
    return;
  }

  target.innerHTML = notes
    .map((note) => {
      const typeLabel = NOTE_TYPE_META[note.type]?.label ?? note.type;
      const term = getNoteTerm(note);
      const excerpt = getNoteExcerpt(note);
      const body = getNoteBody(note);
      const pageBadge = `p. ${note.page}`;
      const isCurrentPage = note.page === currentPage;

      return `
        <button
          type="button"
          class="reader-note-card reader-note-card--${toTypeClass(note.type)} ${
            isCurrentPage ? "is-current-page" : ""
          }"
          data-open-note="${note.id}"
          data-note-page="${note.page}"
        >
          <div class="reader-note-card-head">
            <div class="reader-note-type">
              <span class="reader-chip-dot reader-chip-dot--${toTypeClass(note.type)}"></span>
              <span>${escapeHtml(typeLabel)}</span>
            </div>
            <span class="reader-note-page-badge">${escapeHtml(pageBadge)}</span>
          </div>
          ${
            term
              ? `<strong class="reader-note-title">${escapeHtml(term)}</strong>`
              : ""
          }
          ${
            excerpt
              ? `<div class="reader-note-excerpt">${escapeHtml(getNotePreview(excerpt, 120))}</div>`
              : ""
          }
          ${
            body
              ? `<p class="reader-note-body">${escapeHtml(getNotePreview(body, 220))}</p>`
              : ""
          }
        </button>
      `;
    })
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
        getNoteTerm(note) ||
        note.selectedText?.trim() ||
        getNoteBody(note) ||
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
    studyLink: document.querySelector("#studyLink"),
    saveStateLabel: document.querySelector("#saveStateLabel"),
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
    sessionTimerValue: document.querySelector("#sessionTimerValue"),
    sessionMeta: document.querySelector("#sessionMeta"),
    timerStartPauseButton: document.querySelector("#timerStartPauseButton"),
    timerResetButton: document.querySelector("#timerResetButton"),
    goalPercentLabel: document.querySelector("#goalPercentLabel"),
    progressLabel: document.querySelector("#progressLabel"),
    progressSubLabel: document.querySelector("#progressSubLabel"),
    goalSummary: document.querySelector("#goalSummary"),
    progressBar: document.querySelector("#progressBar"),
    noteFilterButtons: [...document.querySelectorAll("[data-note-filter]")],
    sidebarSummary: document.querySelector("#sidebarSummary"),
    documentNotesList: document.querySelector("#documentNotesList"),
    quickNoteForm: document.querySelector("#quickNoteForm"),
    notePageInput: document.querySelector("#notePageInput"),
    noteTypeSelect: document.querySelector("#noteTypeSelect"),
    noteTermWrap: document.querySelector("#noteTermWrap"),
    noteTermInput: document.querySelector("#noteTermInput"),
    noteContentInput: document.querySelector("#noteContentInput"),
    noteAutosaveHint: document.querySelector("#noteAutosaveHint"),
    composeTypeButtons: [...document.querySelectorAll("[data-compose-type]")],
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
    noteFilter: "all",
    composerType: "definition",
    lastVisitedToken: null,
    lastSavedAt: 0,
    pendingFocusNoteId: null,
  };

  let noteDraftTimeout = 0;
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

  function markSaved(timestamp = Date.now()) {
    state.lastSavedAt = timestamp;
  }

  function currentDocumentNotes() {
    return state.currentDocument
      ? getNotesForDocument(state.notes, state.currentDocument.id).sort(sortNotes)
      : [];
  }

  function filteredDocumentNotes() {
    const notes = currentDocumentNotes();

    if (state.noteFilter === "all") {
      return sortSidebarNotes(notes, state.currentPage);
    }

    return sortSidebarNotes(
      notes.filter((note) => note.type === state.noteFilter),
      state.currentPage,
    );
  }

  function currentPageNotes() {
    return currentDocumentNotes().filter((note) => note.page === state.currentPage);
  }

  function setComposerType(type) {
    state.composerType = COMPOSER_TYPES.includes(type) ? type : "definition";
    elements.noteTypeSelect.value = state.composerType;
    const hintText = elements.noteAutosaveHint.textContent.toLowerCase();
    const preserveHint =
      hintText.includes("saved") || hintText.includes("restored") || hintText.includes("saving");

    for (const button of elements.composeTypeButtons) {
      button.classList.toggle("is-active", button.dataset.composeType === state.composerType);
    }

    const isDefinition = state.composerType === "definition";
    elements.noteTermWrap.hidden = !isDefinition;

    if (isDefinition) {
      elements.noteContentInput.placeholder = "Write the definition or explanation for this page.";
      if (!preserveHint) {
        elements.noteAutosaveHint.textContent = "Definition notes become this PDF's glossary.";
      }
    } else if (!preserveHint) {
      elements.noteContentInput.placeholder = `Type a quick ${state.composerType} note for this page. Press Enter to save.`;
      elements.noteAutosaveHint.textContent = "Linking to current page.";
    }
  }

  function setNoteFilter(type) {
    state.noteFilter = FILTER_TYPES.includes(type) ? type : "all";

    for (const button of elements.noteFilterButtons) {
      button.classList.toggle("is-active", button.dataset.noteFilter === state.noteFilter);
    }
  }

  function setFormAvailability(hasDocument) {
    const controls = [
      elements.previousPageButton,
      elements.nextPageButton,
      elements.pageNumberInput,
      elements.zoomOutButton,
      elements.resetZoomButton,
      elements.zoomInButton,
      elements.timerStartPauseButton,
      elements.timerResetButton,
      elements.noteContentInput,
      elements.noteTermInput,
      ...elements.composeTypeButtons,
      ...elements.noteFilterButtons,
      ...elements.quickNoteForm.querySelectorAll("button"),
    ];

    for (const control of controls) {
      control.disabled = !hasDocument;
    }
  }

  async function persistDraftNow() {
    window.clearTimeout(noteDraftTimeout);

    if (!state.currentDocument) {
      return;
    }

    const payload = {
      type: state.composerType,
      page: clamp(Number(elements.notePageInput.value) || state.currentPage, 1, Math.max(1, state.totalPages)),
      term: elements.noteTermInput.value.trim(),
      content: elements.noteContentInput.value.trim(),
    };

    if (!payload.term && !payload.content) {
      await deleteSetting(getDraftKey(state.currentDocument.id));

      if (state.composerType === "definition") {
        elements.noteAutosaveHint.textContent = "Definition notes become this PDF's glossary.";
      } else {
        elements.noteAutosaveHint.textContent = "Linking to current page.";
      }
      return;
    }

    await saveSetting(getDraftKey(state.currentDocument.id), payload);
    elements.noteAutosaveHint.textContent = "Draft saved locally.";
    markSaved();
  }

  function scheduleDraftSave() {
    if (!state.currentDocument) {
      return;
    }

    elements.noteAutosaveHint.textContent = "Saving draft locally…";
    window.clearTimeout(noteDraftTimeout);
    noteDraftTimeout = window.setTimeout(() => {
      void persistDraftNow();
    }, 240);
  }

  async function restoreDraft() {
    elements.notePageInput.value = String(clamp(state.currentPage || 1, 1, Math.max(1, state.totalPages)));
    elements.noteTermInput.value = "";
    elements.noteContentInput.value = "";
    setComposerType("definition");

    if (!state.currentDocument) {
      return;
    }

    const draftRecord = await getSetting(getDraftKey(state.currentDocument.id));
    const draft = draftRecord?.value;

    if (!draft) {
      return;
    }

    setComposerType(draft.type || "definition");
    elements.notePageInput.value = String(
      clamp(Number(draft.page) || state.currentPage, 1, Math.max(1, state.totalPages)),
    );
    elements.noteTermInput.value = draft.term ?? "";
    elements.noteContentInput.value = draft.content ?? "";
    elements.noteAutosaveHint.textContent = "Draft restored locally.";
  }

  function pulseNote(noteId) {
    window.clearTimeout(focusPulseTimeout);

    for (const target of elements.pageAnnotationOverlay.querySelectorAll(".is-active")) {
      target.classList.remove("is-active");
    }

    for (const target of elements.documentNotesList.querySelectorAll(".is-emphasized")) {
      target.classList.remove("is-emphasized");
    }

    const overlayMarker = elements.pageAnnotationOverlay.querySelector(`[data-focus-note="${noteId}"]`);
    const sidebarCard = elements.documentNotesList.querySelector(`[data-open-note="${noteId}"]`);

    overlayMarker?.classList.add("is-active");
    sidebarCard?.classList.add("is-emphasized");
    sidebarCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    focusPulseTimeout = window.setTimeout(() => {
      overlayMarker?.classList.remove("is-active");
      sidebarCard?.classList.remove("is-emphasized");
    }, 2200);
  }

  function render() {
    const hasDocument = Boolean(state.currentDocument);
    const notesForDocument = currentDocumentNotes();
    const visibleNotes = filteredDocumentNotes();
    const pageNotes = currentPageNotes();
    const progressRecord = hasDocument ? getProgressRecord(state.progressRecords, state.currentDocument.id) : null;
    const pagesToday = state.pageVisits.filter((record) => record.date === dayStamp()).length;
    const goalProgress = calculateGoalProgress(state.goal?.targetPages ?? 12, pagesToday);
    const recentDocuments = buildRecentDocumentSummaries(
      state.documents,
      state.progressRecords,
      state.notes,
      6,
    );
    const definitionsCount = notesForDocument.filter((note) => note.type === "definition").length;
    const saveStateLabel = buildSaveStateLabel(state.lastSavedAt);
    const progressPercent = hasDocument && state.totalPages
      ? Math.round((state.currentPage / state.totalPages) * 100)
      : 0;
    const goalPercent = goalProgress.percent;
    const timerState = timer.getState();

    applyTheme(state.theme);
    setFormAvailability(hasDocument);
    setNoteFilter(state.noteFilter);
    setComposerType(state.composerType);
    renderRecentDocuments(elements.recentDocumentsList, recentDocuments);
    renderSidebarNotes(elements.documentNotesList, hasDocument ? visibleNotes : [], state.currentPage);
    renderPageOverlay(elements.pageAnnotationOverlay, hasDocument ? pageNotes : []);

    elements.readerEmptyState.hidden = hasDocument;
    elements.readerCanvasShell.hidden = !hasDocument;
    elements.readerHelperPanel.hidden = state.helperDismissed;
    elements.saveStateLabel.textContent = saveStateLabel;
    elements.pageNumberInput.value = String(state.currentPage || 1);
    elements.pageNumberInput.max = String(Math.max(1, state.totalPages || 1));
    elements.pageTotalLabel.textContent = String(state.totalPages || 0);
    elements.zoomLabel.textContent = `${state.zoomPercent}%`;
    elements.studyLink.href = studyHref(state.currentDocument?.id ?? state.activeDocumentId);
    elements.notePageInput.value = String(state.currentPage || 1);
    elements.sessionTimerValue.textContent = formatDuration(timerState.elapsedMs);
    elements.timerStartPauseButton.textContent = timerState.running ? "Pause" : "Start";
    elements.progressBar.style.width = `${goalPercent}%`;
    elements.goalPercentLabel.textContent = `${goalPercent}%`;

    if (!hasDocument) {
      elements.documentBadge.textContent = "Current document";
      elements.documentTitle.textContent = "Open a local PDF and keep the reading surface clear.";
      elements.documentMeta.textContent =
        "The reader restores progress automatically and keeps notes attached to each PDF in the browser.";
      elements.goalSummary.textContent = "Set a PDF to see today's target.";
      elements.progressLabel.textContent = "Page 0 of 0";
      elements.progressSubLabel.textContent = "The app restores your last page automatically for cached PDFs.";
      elements.sidebarSummary.textContent = "Definition notes double as this PDF's linked glossary.";
      elements.sessionMeta.textContent = "Timer and progress stay linked to the current PDF.";
      elements.previousPageButton.disabled = true;
      elements.nextPageButton.disabled = true;
      return;
    }

    elements.previousPageButton.disabled = state.currentPage <= 1;
    elements.nextPageButton.disabled = state.currentPage >= state.totalPages;
    elements.documentBadge.textContent = `Page ${state.currentPage}`;
    elements.documentTitle.textContent = state.currentDocument.name.replace(/\.pdf$/i, "");
    elements.documentMeta.textContent = `${formatBytes(state.currentDocument.size)} • ${
      state.totalPages
    } pages • ${notesForDocument.length} note${notesForDocument.length === 1 ? "" : "s"} • ${
      definitionsCount
    } glossary item${definitionsCount === 1 ? "" : "s"}`;
    elements.sessionMeta.textContent = timerState.running
      ? `Session running on ${state.currentDocument.name}. Reset saves this reading block locally.`
      : `Linked to ${state.currentDocument.name}. Timer resets save completed reading blocks locally.`;
    elements.goalSummary.textContent = goalProgress.copy;
    elements.progressLabel.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
    elements.progressSubLabel.textContent = progressRecord
      ? `Resume is saved locally. Last recorded page: ${progressRecord.currentPage}.`
      : "Progress is tracked automatically while you read.";

    if (state.noteFilter === "definition") {
      elements.sidebarSummary.textContent = `${
        visibleNotes.length
      } glossary entr${visibleNotes.length === 1 ? "y" : "ies"} for this PDF.`;
    } else {
      elements.sidebarSummary.textContent = `${
        visibleNotes.length
      } visible note${visibleNotes.length === 1 ? "" : "s"} for this PDF. ${
        pageNotes.length
      } appear on the current page.`;
    }
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
      markSaved();
      setReaderUrl(documentRecord.id, viewerState.currentPage);
      await restoreDraft();
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
    markSaved();

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

    if (!elements.noteContentInput.value.trim() && !elements.noteTermInput.value.trim()) {
      elements.notePageInput.value = String(state.currentPage);
    }

    setReaderUrl(state.currentDocument.id, state.currentPage);
    render();

    if (state.pendingFocusNoteId) {
      const noteId = state.pendingFocusNoteId;
      state.pendingFocusNoteId = null;
      pulseNote(noteId);
    }
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
    markSaved();
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
    markSaved();
    render();
    showToast("Reading session saved locally.", elements.toastRegion);
  }

  async function saveQuickNote(event) {
    event.preventDefault();

    if (!state.currentDocument) {
      return;
    }

    const parsed = parseQuickNote(
      state.composerType,
      elements.noteTermInput.value,
      elements.noteContentInput.value,
    );

    if (!parsed.content && !parsed.selectedText && !parsed.term) {
      showToast("Add a note before saving.", elements.toastRegion);
      return;
    }

    const noteRecord = createNoteRecord({
      documentId: state.currentDocument.id,
      page: clamp(Number(elements.notePageInput.value) || state.currentPage, 1, Math.max(1, state.totalPages)),
      type: state.composerType,
      selectedText: parsed.selectedText,
      term: parsed.term,
      content: parsed.content || parsed.selectedText || parsed.term,
    });

    await saveNote(noteRecord);
    state.notes = upsertRecord(state.notes, noteRecord).sort(sortNotes);
    await deleteSetting(getDraftKey(state.currentDocument.id));
    elements.noteTermInput.value = "";
    elements.noteContentInput.value = "";
    elements.noteAutosaveHint.textContent =
      state.composerType === "definition"
        ? "Definition saved to this PDF's glossary."
        : `Saved on page ${noteRecord.page}.`;
    markSaved();
    render();
    pulseNote(noteRecord.id);
    showToast(`Saved to page ${noteRecord.page}.`, elements.toastRegion);
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

  elements.zoomInButton.addEventListener("click", () => {
    void viewer.zoomIn();
  });
  elements.zoomOutButton.addEventListener("click", () => {
    void viewer.zoomOut();
  });
  elements.resetZoomButton.addEventListener("click", () => {
    void viewer.resetZoom();
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

  elements.noteFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setNoteFilter(button.dataset.noteFilter);
      render();
    });
  });

  elements.composeTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setComposerType(button.dataset.composeType);
      render();
      if (state.composerType === "definition") {
        elements.noteTermInput.focus();
      } else {
        elements.noteContentInput.focus();
      }
    });
  });

  elements.quickNoteForm.addEventListener("submit", (event) => {
    void saveQuickNote(event);
  });

  elements.noteTermInput.addEventListener("input", () => {
    scheduleDraftSave();
  });
  elements.noteContentInput.addEventListener("input", () => {
    scheduleDraftSave();
  });
  elements.noteContentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.quickNoteForm.requestSubmit();
    }
  });

  elements.documentNotesList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-note]");

    if (!trigger) {
      return;
    }

    const noteId = trigger.dataset.openNote;
    const page = Number(trigger.dataset.notePage);

    state.pendingFocusNoteId = noteId;

    if (page === state.currentPage) {
      state.pendingFocusNoteId = null;
      pulseNote(noteId);
      return;
    }

    void jumpToPage(page);
  });

  elements.pageAnnotationOverlay.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-focus-note]");

    if (trigger) {
      pulseNote(trigger.dataset.focusNote);
    }
  });

  elements.recentDocumentsList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-document]");

    if (!trigger) {
      return;
    }

    void openCachedDocument(trigger.dataset.openDocument);
  });

  elements.dismissReaderHelperButton.addEventListener("click", async () => {
    state.helperDismissed = true;
    elements.readerHelperPanel.hidden = true;
    await saveSetting(SETTING_KEYS.readerHelperDismissed, true);
    markSaved();
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

    applyTheme(state.theme);
    timer.restore(model.activeTimerState);

    const initialPage = Number(getQueryParam("page")) || null;

    if (state.activeDocumentId) {
      await openCachedDocument(state.activeDocumentId, initialPage);
    } else {
      await restoreDraft();
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
    void persistDraftNow();
    timer.destroy();
  });
}
