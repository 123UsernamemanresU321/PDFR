import { downloadJson, downloadText, readJsonFile, slugify } from "./export.js";
import {
  DEFAULT_DAILY_GOAL,
  calculateGoalProgress,
  calculateStudyStreak,
  getTodayKey,
  sumTotalPagesRead,
  sumTotalSessionCount,
  sumTotalSessionHours,
} from "./goals.js";
import {
  buildGlossaryEntries,
  buildMarkdownExport,
  countNotesByType,
  createNote,
  DEFAULT_NOTE_TYPE,
  filterNotes,
  formatRelativeDate,
  groupNotesByDocumentAndPage,
  NOTE_TYPES,
} from "./notes.js";
import { PdfViewer } from "./pdf-viewer.js";
import { buildRevisionDeck, buildFlashcardFromNote, reviewFlashcard, synchronizeFlashcards } from "./revision.js";
import { createSessionManager, formatDuration } from "./sessions.js";
import * as storage from "./storage.js";
import {
  escapeHtml,
  renderCommandPalette,
  renderGlossaryDetail,
  renderGlossaryPreview,
  renderGlossaryTerms,
  renderNoteList,
  renderNotesManagerList,
  renderRecentDocuments,
  renderStats,
  renderTagChips,
  renderThemePicker,
  showToast,
} from "./ui.js";

const DAILY_GOAL_ID = "daily-reading";
const SETTINGS_DEFAULTS = {
  theme: "light",
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  highContrast: false,
  focusMode: false,
  lastDocumentId: null,
  lastNoteType: DEFAULT_NOTE_TYPE,
  activeSession: null,
};

const state = {
  activeView: "landing",
  currentDocumentId: null,
  currentPage: 1,
  totalPages: 1,
  zoomPercent: 100,
  documents: [],
  notes: [],
  progress: [],
  sessions: [],
  stats: [],
  flashcards: [],
  settings: { ...SETTINGS_DEFAULTS },
  pendingSettings: null,
  goal: { id: DAILY_GOAL_ID, targetPagesPerDay: DEFAULT_DAILY_GOAL },
  documentsById: new Map(),
  progressById: new Map(),
  sidebarFilter: "all",
  sidebarQuery: "",
  notesManagerType: "all",
  notesManagerDocument: "all",
  notesManagerQuery: "",
  glossaryQuery: "",
  selectedGlossaryId: null,
  snippetVisible: false,
  selection: null,
  commandQuery: "",
  commandActiveIndex: 0,
  commandActions: [],
  revision: {
    deck: [],
    index: 0,
    revealed: false,
  },
  confirmAction: null,
};

function cacheDom() {
  return {
    body: document.body,
    pdfFileInput: document.getElementById("pdfFileInput"),
    jsonImportInput: document.getElementById("jsonImportInput"),
    landingView: document.getElementById("landingView"),
    workspaceView: document.getElementById("workspaceView"),
    homeBtn: document.getElementById("homeBtn"),
    openPdfBtn: document.getElementById("openPdfBtn"),
    heroOpenPdfBtn: document.getElementById("heroOpenPdfBtn"),
    viewerOpenPdfBtn: document.getElementById("viewerOpenPdfBtn"),
    selectFileBtn: document.getElementById("selectFileBtn"),
    heroImportJsonBtn: document.getElementById("heroImportJsonBtn"),
    landingImportJsonBtn: document.getElementById("landingImportJsonBtn"),
    landingExportJsonBtn: document.getElementById("landingExportJsonBtn"),
    landingExportMarkdownBtn: document.getElementById("landingExportMarkdownBtn"),
    dropZone: document.getElementById("dropZone"),
    recentDocsList: document.getElementById("recentDocsList"),
    saveStatusText: document.getElementById("saveStatusText"),
    topbarDocumentLabel: document.getElementById("topbarDocumentLabel"),
    toggleNotesManagerBtn: document.getElementById("toggleNotesManagerBtn"),
    openRevisionBtn: document.getElementById("openRevisionBtn"),
    openGlossaryBtn: document.getElementById("openGlossaryBtn"),
    openGlossaryPreviewBtn: document.getElementById("openGlossaryPreviewBtn"),
    openStatsBtn: document.getElementById("openStatsBtn"),
    openSettingsBtn: document.getElementById("openSettingsBtn"),
    commandPaletteBtn: document.getElementById("commandPaletteBtn"),
    prevPageBtn: document.getElementById("prevPageBtn"),
    nextPageBtn: document.getElementById("nextPageBtn"),
    pageInput: document.getElementById("pageInput"),
    pageJumpForm: document.getElementById("pageJumpForm"),
    pageTotalLabel: document.getElementById("pageTotalLabel"),
    documentSectionLabel: document.getElementById("documentSectionLabel"),
    documentTitle: document.getElementById("documentTitle"),
    documentMetaText: document.getElementById("documentMetaText"),
    progressChip: document.getElementById("progressChip"),
    goalChip: document.getElementById("goalChip"),
    zoomValue: document.getElementById("zoomValue"),
    zoomInBtn: document.getElementById("zoomInBtn"),
    zoomOutBtn: document.getElementById("zoomOutBtn"),
    viewerPlaceholder: document.getElementById("viewerPlaceholder"),
    viewerCanvasWrap: document.getElementById("viewerCanvasWrap"),
    viewerFrame: document.getElementById("viewerFrame"),
    viewerPaper: document.getElementById("viewerPaper"),
    viewerPage: document.getElementById("viewerPage"),
    pdfCanvas: document.getElementById("pdfCanvas"),
    pdfTextLayer: document.getElementById("pdfTextLayer"),
    pdfHighlightLayer: document.getElementById("pdfHighlightLayer"),
    selectionToolbar: document.getElementById("selectionToolbar"),
    selectionToolbarText: document.getElementById("selectionToolbarText"),
    selectionUseBtn: document.getElementById("selectionUseBtn"),
    selectionSaveBtn: document.getElementById("selectionSaveBtn"),
    focusModeBtn: document.getElementById("focusModeBtn"),
    exportMarkdownBtn: document.getElementById("exportMarkdownBtn"),
    sidebarExportBtn: document.getElementById("sidebarExportBtn"),
    sessionTimerDisplay: document.getElementById("sessionTimerDisplay"),
    startSessionBtn: document.getElementById("startSessionBtn"),
    pauseSessionBtn: document.getElementById("pauseSessionBtn"),
    resetSessionBtn: document.getElementById("resetSessionBtn"),
    attachSessionCheckbox: document.getElementById("attachSessionCheckbox"),
    goalForm: document.getElementById("goalForm"),
    goalInput: document.getElementById("goalInput"),
    goalPercentLabel: document.getElementById("goalPercentLabel"),
    goalProgressFill: document.getElementById("goalProgressFill"),
    goalStatusText: document.getElementById("goalStatusText"),
    noteSearchInput: document.getElementById("noteSearchInput"),
    tagFilterRow: document.getElementById("tagFilterRow"),
    noteList: document.getElementById("noteList"),
    quickNoteForm: document.getElementById("quickNoteForm"),
    quickNotePageLabel: document.getElementById("quickNotePageLabel"),
    quickNoteLinkLabel: document.getElementById("quickNoteLinkLabel"),
    quickNoteInput: document.getElementById("quickNoteInput"),
    selectedTextInput: document.getElementById("selectedTextInput"),
    toggleSnippetBtn: document.getElementById("toggleSnippetBtn"),
    quickNoteTypeGroup: document.getElementById("quickNoteTypeGroup"),
    glossaryPreviewList: document.getElementById("glossaryPreviewList"),
    notesManagerOverlay: document.getElementById("notesManagerOverlay"),
    notesManagerSearch: document.getElementById("notesManagerSearch"),
    notesManagerDocumentFilter: document.getElementById("notesManagerDocumentFilter"),
    notesManagerTagFilter: document.getElementById("notesManagerTagFilter"),
    notesManagerActiveFilters: document.getElementById("notesManagerActiveFilters"),
    notesManagerList: document.getElementById("notesManagerList"),
    notesManagerExportMarkdownBtn: document.getElementById("notesManagerExportMarkdownBtn"),
    notesManagerExportJsonBtn: document.getElementById("notesManagerExportJsonBtn"),
    notesManagerImportBtn: document.getElementById("notesManagerImportBtn"),
    glossaryOverlay: document.getElementById("glossaryOverlay"),
    glossarySearchInput: document.getElementById("glossarySearchInput"),
    glossaryTermList: document.getElementById("glossaryTermList"),
    glossaryDetail: document.getElementById("glossaryDetail"),
    revisionOverlay: document.getElementById("revisionOverlay"),
    revisionProgressLabel: document.getElementById("revisionProgressLabel"),
    revisionDeckMeta: document.getElementById("revisionDeckMeta"),
    flashcardCard: document.getElementById("flashcardCard"),
    flashcardHint: document.getElementById("flashcardHint"),
    flashcardAnswer: document.getElementById("flashcardAnswer"),
    gradeHardBtn: document.getElementById("gradeHardBtn"),
    gradeGoodBtn: document.getElementById("gradeGoodBtn"),
    gradeEasyBtn: document.getElementById("gradeEasyBtn"),
    revisionFooterText: document.getElementById("revisionFooterText"),
    statsOverlay: document.getElementById("statsOverlay"),
    statsGrid: document.getElementById("statsGrid"),
    statsNoteBreakdown: document.getElementById("statsNoteBreakdown"),
    statsSessionList: document.getElementById("statsSessionList"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    settingsForm: document.getElementById("settingsForm"),
    themePicker: document.getElementById("themePicker"),
    reducedMotionToggle: document.getElementById("reducedMotionToggle"),
    highContrastToggle: document.getElementById("highContrastToggle"),
    clearLocalDataBtn: document.getElementById("clearLocalDataBtn"),
    settingsCancelBtn: document.getElementById("settingsCancelBtn"),
    commandPaletteOverlay: document.getElementById("commandPaletteOverlay"),
    commandPaletteInput: document.getElementById("commandPaletteInput"),
    commandPaletteList: document.getElementById("commandPaletteList"),
    confirmOverlay: document.getElementById("confirmOverlay"),
    confirmTitle: document.getElementById("confirmTitle"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
    confirmAcceptBtn: document.getElementById("confirmAcceptBtn"),
    toastRegion: document.getElementById("toastRegion"),
  };
}

function rebuildMaps() {
  state.documentsById = new Map(state.documents.map((documentRecord) => [documentRecord.id, documentRecord]));
  state.progressById = new Map(state.progress.map((progress) => [progress.documentId, progress]));
}

function setSaveStatus(message) {
  refs.saveStatusText.textContent = message;
}

async function persistSetting(key, value) {
  state.settings[key] = value;
  await storage.saveSetting(key, value);
}

function applySettings() {
  refs.body.dataset.theme = state.settings.theme || "light";
  refs.body.dataset.reducedMotion = String(Boolean(state.settings.reducedMotion));
  refs.body.dataset.highContrast = String(Boolean(state.settings.highContrast));
  refs.body.dataset.focusMode = String(Boolean(state.settings.focusMode));
}

function getCurrentDocument() {
  return state.currentDocumentId ? state.documentsById.get(state.currentDocumentId) : null;
}

function getCurrentDocumentNotes() {
  return filterNotes(state.notes, {
    documentId: state.currentDocumentId || "all",
    type: state.sidebarFilter,
    query: state.sidebarQuery,
  });
}

function getTodayStats() {
  return state.stats.find((record) => record.date === getTodayKey());
}

function getDailyGoal() {
  return Math.max(1, Number(state.goal?.targetPagesPerDay) || DEFAULT_DAILY_GOAL);
}

function getQuickNotePage() {
  return state.selection?.page || state.currentPage;
}

function buildSelectionFallback(type, selectedText) {
  if (!selectedText) {
    return "";
  }

  const defaults = {
    definition: "Definition captured from highlighted text.",
    quote: "Highlighted passage.",
    "exam-point": "Highlighted for revision.",
    question: "Review this highlighted passage.",
  };

  return defaults[type] || "Highlighted passage.";
}

function hideSelectionToolbar() {
  refs.selectionToolbar.classList.add("is-hidden");
  refs.selectionToolbar.style.removeProperty("left");
  refs.selectionToolbar.style.removeProperty("top");
}

function renderSelectionToolbar() {
  const currentSelection = state.selection;
  if (!currentSelection || currentSelection.page !== state.currentPage) {
    hideSelectionToolbar();
    return;
  }

  refs.selectionToolbarText.textContent =
    currentSelection.text.length > 120 ? `${currentSelection.text.slice(0, 117)}...` : currentSelection.text;
  refs.selectionToolbar.style.left = `${currentSelection.toolbar.left * 100}%`;
  refs.selectionToolbar.style.top = `${currentSelection.toolbar.top * 100}%`;
  refs.selectionToolbar.classList.remove("is-hidden");
}

function clearSelectionState({ keepSnippet = false, clearBrowserSelection = false } = {}) {
  state.selection = null;
  hideSelectionToolbar();
  pdfViewer?.clearSelection(clearBrowserSelection);

  if (!keepSnippet) {
    refs.selectedTextInput.value = "";
    state.snippetVisible = false;
    refs.selectedTextInput.classList.add("is-hidden");
  }
}

function handlePdfSelection(selection) {
  if (!selection) {
    hideSelectionToolbar();
    return;
  }

  state.selection = selection;
  state.snippetVisible = true;
  refs.selectedTextInput.value = selection.text;
  refs.selectedTextInput.classList.remove("is-hidden");
  renderSelectionToolbar();
  renderWorkspace();
}

function syncViewerHighlights() {
  const currentDocument = getCurrentDocument();
  if (!currentDocument) {
    pdfViewer?.setHighlights([]);
    return;
  }

  pdfViewer?.setHighlights(
    state.notes.filter(
      (note) => note.documentId === currentDocument.id && note.page === state.currentPage && note.selectionRects?.length,
    ),
  );
}

function setActiveView(viewName) {
  state.activeView = viewName;
  refs.landingView.classList.toggle("is-hidden", viewName !== "landing");
  refs.workspaceView.classList.toggle("is-hidden", viewName !== "workspace");
  renderTopbar();
}

function setOverlayState(overlay, open) {
  overlay.classList.toggle("is-hidden", !open);
  overlay.setAttribute("aria-hidden", String(!open));
}

function closeAllOverlays() {
  [
    refs.notesManagerOverlay,
    refs.glossaryOverlay,
    refs.revisionOverlay,
    refs.statsOverlay,
    refs.settingsOverlay,
    refs.commandPaletteOverlay,
    refs.confirmOverlay,
  ].forEach((overlay) => setOverlayState(overlay, false));
}

function documentsForFilter() {
  return [{ id: "all", name: "All documents" }, ...state.documents];
}

function buildCommandActions() {
  const currentDocument = getCurrentDocument();
  const actions = [
    {
      id: "open-pdf",
      title: "Open PDF",
      description: "Import a local PDF into the reader",
      perform: () => refs.pdfFileInput.click(),
    },
    {
      id: "open-notes",
      title: "Open notes manager",
      description: "Search, export, and curate all notes",
      perform: () => openOverlay(refs.notesManagerOverlay),
    },
    {
      id: "open-glossary",
      title: "Open glossary",
      description: "Browse definition notes and their source pages",
      perform: () => openOverlay(refs.glossaryOverlay),
    },
    {
      id: "open-revision",
      title: "Start revision mode",
      description: "Review flashcards generated from saved notes",
      perform: () => openRevision(),
    },
    {
      id: "open-stats",
      title: "Open stats dashboard",
      description: "See streaks, note counts, and reading totals",
      perform: () => openOverlay(refs.statsOverlay),
    },
    {
      id: "open-settings",
      title: "Open settings",
      description: "Change theme, motion, and privacy controls",
      perform: () => openSettings(),
    },
  ];

  if (currentDocument) {
    actions.push(
      {
        id: "focus-note",
        title: "Focus quick note",
        description: `Start writing a note for page ${state.currentPage}`,
        perform: () => refs.quickNoteInput.focus(),
      },
      {
        id: "jump-page",
        title: "Jump to page",
        description: "Focus the page input to navigate quickly",
        perform: () => refs.pageInput.focus(),
      },
      {
        id: "export-markdown",
        title: "Export current notes to Markdown",
        description: "Download study notes for the active document",
        perform: () => exportMarkdown(false),
      },
    );
  }

  const query = state.commandQuery.trim().toLowerCase();
  if (/^\d+$/.test(query) && currentDocument) {
    const page = Math.min(Number(query), state.totalPages || 1);
    actions.unshift({
      id: `jump-to-${page}`,
      title: `Jump to page ${page}`,
      description: `Go directly to page ${page} in ${currentDocument.name}`,
      perform: () => void goToPage(page),
    });
  }

  return actions.filter((action) => {
    if (!query) {
      return true;
    }
    return `${action.title} ${action.description}`.toLowerCase().includes(query);
  });
}

function renderTopbar() {
  const currentDocument = getCurrentDocument();
  const inWorkspace = state.activeView === "workspace" && currentDocument;
  refs.topbarDocumentLabel.textContent = inWorkspace
    ? `${currentDocument.name} · page ${state.currentPage} of ${state.totalPages}`
    : "Local-only study workspace";
  refs.pageInput.value = String(state.currentPage || 1);
  refs.pageInput.disabled = !inWorkspace;
  refs.pageTotalLabel.textContent = `/ ${state.totalPages || 1}`;
  refs.prevPageBtn.disabled = !inWorkspace;
  refs.nextPageBtn.disabled = !inWorkspace;

  const actionButtons = [
    refs.toggleNotesManagerBtn,
    refs.openRevisionBtn,
    refs.openGlossaryBtn,
    refs.openStatsBtn,
  ];
  actionButtons.forEach((button) => {
    button.disabled = !state.documents.length && button !== refs.openStatsBtn;
  });
}

function renderLanding() {
  renderRecentDocuments(refs.recentDocsList, state.documents.slice().sort((a, b) => b.lastOpened - a.lastOpened), state.progressById, {
    onOpen: (documentId) => void openStoredDocument(documentId),
    onDelete: (documentId) => confirmDocumentDelete(documentId),
  });
}

function renderWorkspace() {
  const currentDocument = getCurrentDocument();
  const documentNotes = getCurrentDocumentNotes();
  const todayProgress = calculateGoalProgress(getDailyGoal(), getTodayStats());
  const quickNotePage = getQuickNotePage();

  refs.documentSectionLabel.textContent = currentDocument ? "Reader" : "No document";
  refs.documentTitle.textContent = currentDocument ? currentDocument.name : "Open a document to begin";
  refs.documentMetaText.textContent = currentDocument
    ? `${currentDocument.totalPages || state.totalPages} pages saved locally · Last opened ${formatRelativeDate(
        currentDocument.lastOpened,
      )}`
    : "PDF.js renders each page locally, then your progress and notes are saved into IndexedDB.";
  refs.progressChip.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
  refs.goalChip.textContent = `Today ${todayProgress.pagesRead} / ${todayProgress.targetPages} pages`;
  refs.zoomValue.textContent = `${state.zoomPercent}%`;
  refs.quickNotePageLabel.textContent = String(quickNotePage);
  refs.quickNoteLinkLabel.textContent =
    state.selection?.page && state.selection.page !== state.currentPage
      ? `Highlight selected from page ${state.selection.page}.`
      : `Linking to page ${quickNotePage}.`;
  refs.goalPercentLabel.textContent = `${todayProgress.percent}%`;
  refs.goalProgressFill.style.width = `${todayProgress.percent}%`;
  refs.goalStatusText.textContent = todayProgress.message;
  refs.goalInput.value = String(getDailyGoal());
  refs.attachSessionCheckbox.checked = sessionManager.getPersistedState().attachToDocument !== false;
  refs.viewerPlaceholder.classList.toggle("is-hidden", Boolean(currentDocument));
  refs.viewerCanvasWrap.classList.toggle("is-hidden", !currentDocument);
  refs.selectedTextInput.classList.toggle("is-hidden", !state.snippetVisible);
  refs.toggleSnippetBtn.textContent = state.snippetVisible ? "Hide selection" : "Selected text";
  refs.noteSearchInput.value = state.sidebarQuery;
  refs.quickNoteInput.disabled = !currentDocument;
  refs.selectedTextInput.disabled = !currentDocument;

  renderTagChips(refs.tagFilterRow, state.sidebarFilter, (value) => {
    state.sidebarFilter = value;
    renderWorkspace();
  });
  renderTagChips(refs.quickNoteTypeGroup, state.settings.lastNoteType || DEFAULT_NOTE_TYPE, (value) => {
    state.settings.lastNoteType = value;
    void persistSetting("lastNoteType", value);
    renderWorkspace();
  }, { includeAll: false });

  renderNoteList(refs.noteList, documentNotes, state.documentsById, {
    emptyTitle: "No notes for this document",
    emptyMessage: "Select text in the PDF or use the quick note form to capture something worth revisiting.",
    onDelete: (noteId) => confirmNoteDelete(noteId),
  });

  const glossaryEntries = buildGlossaryEntries(state.notes, state.documentsById).filter((entry) =>
    currentDocument ? entry.documentId === currentDocument.id : true,
  );
  renderGlossaryPreview(refs.glossaryPreviewList, glossaryEntries, { onOpen: openGlossaryTerm });
  renderSelectionToolbar();
  syncViewerHighlights();
}

function renderNotesManager() {
  refs.notesManagerSearch.value = state.notesManagerQuery;
  refs.notesManagerDocumentFilter.innerHTML = documentsForFilter()
    .map(
      (documentRecord) =>
        `<option value="${documentRecord.id}" ${documentRecord.id === state.notesManagerDocument ? "selected" : ""}>${documentRecord.name}</option>`,
    )
    .join("");
  refs.notesManagerTagFilter.innerHTML = [{ id: "all", label: "All tags" }, ...NOTE_TYPES]
    .map(
      (type) => `<option value="${type.id}" ${type.id === state.notesManagerType ? "selected" : ""}>${type.label}</option>`,
    )
    .join("");

  const filtered = filterNotes(state.notes, {
    documentId: state.notesManagerDocument,
    type: state.notesManagerType,
    query: state.notesManagerQuery,
  });
  const groups = groupNotesByDocumentAndPage(filtered, state.documentsById);
  renderNotesManagerList(refs.notesManagerList, groups, state.documentsById, {
    onDelete: (noteId) => confirmNoteDelete(noteId),
  });

  refs.notesManagerActiveFilters.innerHTML = [
    state.notesManagerDocument !== "all" ? state.documentsById.get(state.notesManagerDocument)?.name : null,
    state.notesManagerType !== "all" ? NOTE_TYPES.find((type) => type.id === state.notesManagerType)?.label : null,
    state.notesManagerQuery ? `Query: ${state.notesManagerQuery}` : null,
  ]
    .filter(Boolean)
    .map((label) => `<span class="chip">${label}</span>`)
    .join("");
}

function renderGlossary() {
  refs.glossarySearchInput.value = state.glossaryQuery;
  const entries = buildGlossaryEntries(state.notes, state.documentsById).filter((entry) =>
    `${entry.term} ${entry.definition} ${entry.documentName}`.toLowerCase().includes(state.glossaryQuery.toLowerCase()),
  );
  const selectedEntry = entries.find((entry) => entry.id === state.selectedGlossaryId) || entries[0] || null;
  state.selectedGlossaryId = selectedEntry?.id || null;
  renderGlossaryTerms(refs.glossaryTermList, entries, state.selectedGlossaryId, { onSelect: openGlossaryTerm });
  renderGlossaryDetail(refs.glossaryDetail, selectedEntry);
}

function renderRevision() {
  const deck = state.revision.deck;
  const currentCard = deck[state.revision.index] || null;
  const total = deck.length;

  refs.gradeHardBtn.disabled = !currentCard || !state.revision.revealed;
  refs.gradeGoodBtn.disabled = !currentCard || !state.revision.revealed;
  refs.gradeEasyBtn.disabled = !currentCard || !state.revision.revealed;

  if (!currentCard) {
    refs.revisionDeckMeta.textContent = "Revision mode";
    refs.revisionProgressLabel.textContent = "No flashcards due";
    refs.flashcardCard.querySelector("h2").textContent = "Your revision deck is clear";
    refs.flashcardHint.textContent = "Create notes or wait for a card to become due.";
    refs.flashcardAnswer.classList.add("is-hidden");
    refs.flashcardAnswer.innerHTML = "";
    refs.revisionFooterText.textContent = "Flashcards are generated from the notes you save.";
    return;
  }

  refs.revisionDeckMeta.textContent = `${currentCard.documentName} · Page ${currentCard.page}`;
  refs.revisionProgressLabel.textContent = `${state.revision.index + 1} of ${total}`;
  refs.flashcardCard.querySelector("h2").textContent = currentCard.front;
  refs.flashcardHint.textContent = state.revision.revealed
    ? "Rate your recall to schedule the next review."
    : "Press Space or click to reveal the answer.";
  refs.flashcardAnswer.classList.toggle("is-hidden", !state.revision.revealed);
  refs.flashcardAnswer.innerHTML = `<strong>${escapeHtml(currentCard.title)}</strong><p style="margin-top:0.75rem">${escapeHtml(
    currentCard.back,
  ).replace(/\n/g, "<br />")}</p>`;
  refs.revisionFooterText.textContent = `Card ${state.revision.index + 1} of ${total} in current deck`;
}

function renderStatsView() {
  const noteCounts = countNotesByType(state.notes);
  const noteMax = Math.max(1, ...Object.values(noteCounts));
  const recentSessions = [...state.sessions]
    .sort((left, right) => right.endedAt - left.endedAt)
    .slice(0, 5)
    .map((session) => ({
      title: state.documentsById.get(session.documentId)?.name || "Unassigned session",
      meta: `${formatDuration(session.durationMs)} · ${formatRelativeDate(session.endedAt)}`,
    }));

  renderStats(refs.statsGrid, refs.statsNoteBreakdown, refs.statsSessionList, {
    cards: [
      {
        label: "Total pages read",
        value: String(sumTotalPagesRead(state.stats)),
        meta: "Unique page visits logged across study days",
      },
      {
        label: "Finished sessions",
        value: String(sumTotalSessionCount(state.stats)),
        meta: `${sumTotalSessionHours(state.stats)} hours of focused reading`,
      },
      {
        label: "Current streak",
        value: String(calculateStudyStreak(state.stats)),
        meta: "Consecutive days with reading or timer activity",
      },
      {
        label: "Saved notes",
        value: String(state.notes.length),
        meta: "Definitions, quotes, exam points, and questions",
      },
    ],
    noteRows: NOTE_TYPES.map((type) => ({
      label: type.label,
      value: String(noteCounts[type.id] || 0),
      percent: Math.round(((noteCounts[type.id] || 0) / noteMax) * 100),
      color: type.color,
    })),
    sessions: recentSessions,
  });
}

function renderSettings() {
  state.pendingSettings = state.pendingSettings || { ...state.settings };
  renderThemePicker(refs.themePicker, state.pendingSettings.theme, (theme) => {
    state.pendingSettings = { ...state.pendingSettings, theme };
    renderSettings();
  });
  refs.reducedMotionToggle.checked = Boolean(state.pendingSettings.reducedMotion);
  refs.highContrastToggle.checked = Boolean(state.pendingSettings.highContrast);
}

function renderCommandPaletteView() {
  state.commandActions = buildCommandActions();
  state.commandActiveIndex = Math.min(state.commandActiveIndex, Math.max(0, state.commandActions.length - 1));
  renderCommandPalette(refs.commandPaletteList, state.commandActions, state.commandActiveIndex);
  refs.commandPaletteList.querySelectorAll("[data-command-id]").forEach((button) => {
    button.addEventListener("click", () => executeCommand(button.dataset.commandId));
  });
}

function renderApp() {
  rebuildMaps();
  renderTopbar();
  renderLanding();
  renderWorkspace();
  renderNotesManager();
  renderGlossary();
  renderRevision();
  renderStatsView();
  renderCommandPaletteView();
}

async function syncFlashcards() {
  const updates = synchronizeFlashcards(state.notes, state.flashcards, state.documentsById);
  if (!updates.length) {
    return;
  }

  await Promise.all(updates.map((flashcard) => storage.saveFlashcard(flashcard)));
  const byId = new Map(state.flashcards.map((flashcard) => [flashcard.id, flashcard]));
  updates.forEach((flashcard) => byId.set(flashcard.id, flashcard));
  state.flashcards = [...byId.values()];
}

async function restoreSnapshot() {
  const snapshot = await storage.loadAllData();
  state.documents = snapshot.documents.sort((left, right) => right.lastOpened - left.lastOpened);
  state.progress = snapshot.progress;
  state.notes = snapshot.notes;
  state.sessions = snapshot.sessions;
  state.stats = snapshot.stats;
  state.flashcards = snapshot.flashcards;
  state.settings = { ...SETTINGS_DEFAULTS, ...snapshot.settings };
  state.goal =
    snapshot.goals.find((goal) => goal.id === DAILY_GOAL_ID) || {
      id: DAILY_GOAL_ID,
      targetPagesPerDay: DEFAULT_DAILY_GOAL,
    };
  state.sidebarFilter = "all";
  state.sidebarQuery = "";
  state.notesManagerType = "all";
  state.notesManagerDocument = "all";
  state.notesManagerQuery = "";
  state.glossaryQuery = "";
  state.selectedGlossaryId = null;
  state.snippetVisible = false;
  state.selection = null;
  state.pendingSettings = null;
  applySettings();
  rebuildMaps();
  await syncFlashcards();
  renderApp();
}

async function openStoredDocument(documentId) {
  const documentRecord = state.documentsById.get(documentId);
  if (!documentRecord?.fileData) {
    showToast(refs.toastRegion, "This document is missing from local storage.");
    return;
  }

  state.currentDocumentId = documentId;
  clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
  state.activeView = "workspace";
  setActiveView("workspace");
  await pdfViewer.loadDocument(documentRecord.fileData);
  const savedProgress = state.progressById.get(documentId);
  if (savedProgress?.currentPage && savedProgress.currentPage !== 1) {
    await pdfViewer.goToPage(savedProgress.currentPage);
  }

  const updatedRecord = { ...documentRecord, lastOpened: Date.now() };
  await storage.saveDocument(updatedRecord);
  state.documents = state.documents.map((record) => (record.id === updatedRecord.id ? updatedRecord : record));
  sessionManager.setDocumentId(documentId);
  await persistSetting("lastDocumentId", documentId);
  renderApp();
  setSaveStatus("Document restored from local storage");
}

async function hashBuffer(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function importPdfFile(file) {
  const looksLikePdf = file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  if (!looksLikePdf) {
    showToast(refs.toastRegion, "Choose a valid PDF file.");
    return;
  }

  const arrayBuffer = await file.arrayBuffer();
  const fingerprint = await hashBuffer(arrayBuffer);
  const existing = await storage.getDocumentByFingerprint(fingerprint);
  const documentId = existing?.id || crypto.randomUUID();
  const blob = new Blob([arrayBuffer], { type: file.type || "application/pdf" });
  const nextRecord = {
    id: documentId,
    name: file.name,
    size: file.size,
    type: file.type || "application/pdf",
    fingerprint,
    createdAt: existing?.createdAt || Date.now(),
    lastOpened: Date.now(),
    totalPages: existing?.totalPages || 0,
    fileData: blob,
  };

  state.currentDocumentId = documentId;
  clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
  setActiveView("workspace");
  await pdfViewer.loadDocument(new Uint8Array(arrayBuffer));
  nextRecord.totalPages = pdfViewer.getState().totalPages;
  await storage.saveDocument(nextRecord);

  const otherDocuments = state.documents.filter((record) => record.id !== documentId);
  state.documents = [nextRecord, ...otherDocuments];
  rebuildMaps();

  const savedProgress = state.progressById.get(documentId);
  if (savedProgress?.currentPage && savedProgress.currentPage !== 1) {
    await pdfViewer.goToPage(savedProgress.currentPage);
  }

  sessionManager.setDocumentId(documentId);
  await persistSetting("lastDocumentId", documentId);
  renderApp();
  setSaveStatus(existing ? "Stored PDF refreshed locally" : "PDF saved locally");
}

async function persistCurrentProgress(pageNumber, totalPages) {
  const currentDocument = getCurrentDocument();
  if (!currentDocument) {
    return;
  }

  const percent = Math.round((pageNumber / totalPages) * 100);
  const progressRecord = {
    documentId: currentDocument.id,
    currentPage: pageNumber,
    totalPages,
    percent,
    updatedAt: Date.now(),
  };
  await storage.saveProgress(progressRecord);
  state.progress = [...state.progress.filter((record) => record.documentId !== currentDocument.id), progressRecord];
  rebuildMaps();
}

async function recordPageVisit(documentId, page) {
  if (!documentId) {
    return;
  }

  const updated = await storage.recordDailyPageVisit({ documentId, page });
  state.stats = [...state.stats.filter((record) => record.date !== updated.date), updated];
  renderWorkspace();
  renderTopbar();
}

async function goToPage(pageNumber) {
  if (!getCurrentDocument()) {
    return;
  }
  await pdfViewer.goToPage(pageNumber);
}

async function exportMarkdown(allNotes) {
  if (!state.notes.length) {
    showToast(refs.toastRegion, "There are no notes to export yet.");
    return;
  }

  const currentDocument = getCurrentDocument();
  const markdown = buildMarkdownExport(state.documentsById, state.notes, {
    documentId: allNotes ? "all" : currentDocument?.id || "all",
  });
  const stem = allNotes ? "pdf-reading-companion-notes" : slugify(currentDocument?.name || "notes");
  downloadText(`${stem}.md`, markdown, "text/markdown;charset=utf-8");
  setSaveStatus("Markdown exported");
}

async function exportJsonBackup() {
  const bundle = await storage.exportBackupBundle();
  downloadJson(`pdf-reading-companion-backup-${getTodayKey()}.json`, bundle);
  setSaveStatus("Backup exported");
}

async function finalizeSession() {
  const completed = sessionManager.reset();
  if (!completed) {
    return;
  }
  const record = {
    ...completed,
    title: getCurrentDocument()?.name || "Focused reading",
  };
  await storage.saveSession(record);
  await storage.recordSessionSummary(record);
  state.sessions = [record, ...state.sessions];
  state.stats = await storage.loadAllData().then((snapshot) => snapshot.stats);
  await persistSetting("activeSession", sessionManager.getPersistedState());
  renderApp();
  setSaveStatus("Session logged locally");
}

async function saveQuickNote({ allowSelectionOnly = false } = {}) {
  const currentDocument = getCurrentDocument();
  const content = refs.quickNoteInput.value.trim();
  const selectedText = refs.selectedTextInput.value.trim();
  const noteType = state.settings.lastNoteType || DEFAULT_NOTE_TYPE;
  const targetPage = getQuickNotePage();
  const noteContent = content || (allowSelectionOnly ? buildSelectionFallback(noteType, selectedText) : "");

  if (!currentDocument || !noteContent) {
    if (currentDocument) {
      showToast(refs.toastRegion, "Add a note or save a highlighted selection first.");
    }
    return;
  }

  const note = createNote({
    documentId: currentDocument.id,
    page: targetPage,
    type: noteType,
    content: noteContent,
    selectedText,
    selectionRects: state.selection?.page === targetPage && selectedText ? state.selection.rects : [],
  });

  await storage.saveNote(note);
  state.notes = [note, ...state.notes];
  const flashcard = buildFlashcardFromNote(note, state.documentsById);
  await storage.saveFlashcard(flashcard);
  state.flashcards = [flashcard, ...state.flashcards.filter((item) => item.id !== flashcard.id)];
  refs.quickNoteInput.value = "";
  clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
  renderApp();
  setSaveStatus(selectedText ? "Note and highlight saved locally" : "Note saved locally");
}

function openOverlay(overlay) {
  [
    refs.notesManagerOverlay,
    refs.glossaryOverlay,
    refs.revisionOverlay,
    refs.statsOverlay,
    refs.settingsOverlay,
    refs.commandPaletteOverlay,
    refs.confirmOverlay,
  ]
    .filter((currentOverlay) => currentOverlay !== overlay)
    .forEach((currentOverlay) => setOverlayState(currentOverlay, false));
  setOverlayState(overlay, true);
  if (overlay === refs.commandPaletteOverlay) {
    refs.commandPaletteInput.focus();
  }
}

function openSettings() {
  state.pendingSettings = { ...state.settings };
  renderSettings();
  openOverlay(refs.settingsOverlay);
}

function openGlossaryTerm(termId) {
  state.selectedGlossaryId = termId;
  renderGlossary();
  openOverlay(refs.glossaryOverlay);
}

function openRevision() {
  const sourceNotes = state.currentDocumentId
    ? state.notes.filter((note) => note.documentId === state.currentDocumentId)
    : state.notes;
  state.revision.deck = buildRevisionDeck(sourceNotes, state.flashcards);
  state.revision.index = 0;
  state.revision.revealed = false;
  renderRevision();
  openOverlay(refs.revisionOverlay);
}

async function gradeRevision(grade) {
  const currentCard = state.revision.deck[state.revision.index];
  if (!currentCard) {
    return;
  }

  const updated = reviewFlashcard(currentCard, grade);
  await storage.saveFlashcard(updated);
  state.flashcards = state.flashcards.map((flashcard) => (flashcard.id === updated.id ? updated : flashcard));
  openRevision();
  setSaveStatus("Flashcard reviewed");
}

function confirmDialog({ title, message, confirmLabel = "Confirm", onAccept }) {
  state.confirmAction = onAccept;
  refs.confirmTitle.textContent = title;
  refs.confirmMessage.textContent = message;
  refs.confirmAcceptBtn.textContent = confirmLabel;
  openOverlay(refs.confirmOverlay);
}

function confirmNoteDelete(noteId) {
  confirmDialog({
    title: "Delete note?",
    message: "This note will be removed from the sidebar, glossary, revision deck, and future exports.",
    confirmLabel: "Delete note",
    onAccept: async () => {
      await storage.deleteNote(noteId);
      state.notes = state.notes.filter((note) => note.id !== noteId);
      state.flashcards = state.flashcards.filter((flashcard) => flashcard.noteId !== noteId);
      setOverlayState(refs.confirmOverlay, false);
      renderApp();
      setSaveStatus("Note deleted");
    },
  });
}

function confirmDocumentDelete(documentId) {
  const documentRecord = state.documentsById.get(documentId);
  confirmDialog({
    title: "Remove document?",
    message: `Remove "${documentRecord?.name || "this document"}" and its saved progress, notes, and flashcards from local storage?`,
    confirmLabel: "Remove document",
    onAccept: async () => {
      if (state.currentDocumentId === documentId) {
        clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
      }
      await storage.deleteDocument(documentId);
      state.documents = state.documents.filter((document) => document.id !== documentId);
      state.progress = state.progress.filter((progress) => progress.documentId !== documentId);
      state.notes = state.notes.filter((note) => note.documentId !== documentId);
      state.sessions = state.sessions.filter((session) => session.documentId !== documentId);
      state.flashcards = state.flashcards.filter((flashcard) => flashcard.documentId !== documentId);
      if (state.currentDocumentId === documentId) {
        state.currentDocumentId = null;
        setActiveView("landing");
      }
      setOverlayState(refs.confirmOverlay, false);
      renderApp();
      setSaveStatus("Document removed from local storage");
    },
  });
}

async function handleJsonImport(file) {
  try {
    const bundle = await readJsonFile(file);
    confirmDialog({
      title: "Replace local data?",
      message: "Importing a backup will replace the current local library, notes, goals, sessions, and settings in this browser.",
      confirmLabel: "Import backup",
      onAccept: async () => {
        await storage.importBackupBundle(bundle, { replaceExisting: true });
        setOverlayState(refs.confirmOverlay, false);
        await restoreSnapshot();
        const lastDocumentId = state.settings.lastDocumentId;
        if (lastDocumentId && state.documentsById.has(lastDocumentId)) {
          await openStoredDocument(lastDocumentId);
        }
        setSaveStatus("Backup restored");
      },
    });
  } catch (_error) {
    showToast(refs.toastRegion, "That backup file could not be imported.");
  }
}

function updateCommandList() {
  renderCommandPaletteView();
}

function executeCommand(commandId) {
  const action = state.commandActions.find((item) => item.id === commandId);
  if (!action) {
    return;
  }
  setOverlayState(refs.commandPaletteOverlay, false);
  action.perform();
}

function handleShortcut(event) {
  const tagName = document.activeElement?.tagName?.toLowerCase();
  const isTypingField = ["input", "textarea", "select"].includes(tagName);

  if (refs.commandPaletteOverlay.getAttribute("aria-hidden") === "false") {
    if (event.key === "Escape") {
      setOverlayState(refs.commandPaletteOverlay, false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.commandActiveIndex = Math.min(state.commandActiveIndex + 1, Math.max(0, state.commandActions.length - 1));
      renderCommandPaletteView();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.commandActiveIndex = Math.max(0, state.commandActiveIndex - 1);
      renderCommandPaletteView();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      executeCommand(state.commandActions[state.commandActiveIndex]?.id);
      return;
    }
  }

  if (refs.revisionOverlay.getAttribute("aria-hidden") === "false") {
    if (event.key === " " && !state.revision.revealed) {
      event.preventDefault();
      state.revision.revealed = true;
      renderRevision();
      return;
    }
    if (state.revision.revealed && ["1", "2", "3"].includes(event.key)) {
      const grade = { 1: "hard", 2: "good", 3: "easy" }[event.key];
      void gradeRevision(grade);
      return;
    }
  }

  if (isTypingField) {
    return;
  }

  if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)))) {
    event.preventDefault();
    state.commandQuery = "";
    refs.commandPaletteInput.value = "";
    updateCommandList();
    openOverlay(refs.commandPaletteOverlay);
    return;
  }

  if (event.key.toLowerCase() === "n" && getCurrentDocument()) {
    event.preventDefault();
    refs.quickNoteInput.focus();
    return;
  }

  if (event.key.toLowerCase() === "g" && getCurrentDocument()) {
    event.preventDefault();
    refs.pageInput.focus();
    refs.pageInput.select();
    return;
  }

  if (event.key.toLowerCase() === "f" && getCurrentDocument()) {
    event.preventDefault();
    state.settings.focusMode = !state.settings.focusMode;
    applySettings();
    void persistSetting("focusMode", state.settings.focusMode);
    renderApp();
    return;
  }

  if (event.key === "ArrowRight" && getCurrentDocument()) {
    event.preventDefault();
    void pdfViewer.nextPage();
    return;
  }

  if (event.key === "ArrowLeft" && getCurrentDocument()) {
    event.preventDefault();
    void pdfViewer.previousPage();
  }
}

let refs;
let pdfViewer;
let sessionManager;

function bindEvents() {
  const openPdf = () => refs.pdfFileInput.click();
  const openJson = () => refs.jsonImportInput.click();

  refs.homeBtn.addEventListener("click", () => {
    clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
    setActiveView("landing");
  });
  refs.openPdfBtn.addEventListener("click", openPdf);
  refs.heroOpenPdfBtn.addEventListener("click", openPdf);
  refs.viewerOpenPdfBtn.addEventListener("click", openPdf);
  refs.selectFileBtn.addEventListener("click", openPdf);
  refs.heroImportJsonBtn.addEventListener("click", openJson);
  refs.landingImportJsonBtn.addEventListener("click", openJson);
  refs.landingExportJsonBtn.addEventListener("click", () => void exportJsonBackup());
  refs.landingExportMarkdownBtn.addEventListener("click", () => void exportMarkdown(true));
  refs.sidebarExportBtn.addEventListener("click", () => void exportMarkdown(false));
  refs.exportMarkdownBtn.addEventListener("click", () => void exportMarkdown(false));
  refs.toggleNotesManagerBtn.addEventListener("click", () => openOverlay(refs.notesManagerOverlay));
  refs.openGlossaryBtn.addEventListener("click", () => openOverlay(refs.glossaryOverlay));
  refs.openGlossaryPreviewBtn.addEventListener("click", () => openOverlay(refs.glossaryOverlay));
  refs.openRevisionBtn.addEventListener("click", openRevision);
  refs.openStatsBtn.addEventListener("click", () => openOverlay(refs.statsOverlay));
  refs.openSettingsBtn.addEventListener("click", openSettings);
  refs.commandPaletteBtn.addEventListener("click", () => {
    state.commandQuery = "";
    refs.commandPaletteInput.value = "";
    updateCommandList();
    openOverlay(refs.commandPaletteOverlay);
  });

  refs.pdfFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await importPdfFile(file);
      refs.pdfFileInput.value = "";
    }
  });

  refs.jsonImportInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleJsonImport(file);
      refs.jsonImportInput.value = "";
    }
  });

  ["dragenter", "dragover"].forEach((name) =>
    refs.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      refs.dropZone.classList.add("is-active");
    }),
  );
  ["dragleave", "drop"].forEach((name) =>
    refs.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      refs.dropZone.classList.remove("is-active");
    }),
  );
  refs.dropZone.addEventListener("drop", async (event) => {
    const file = [...(event.dataTransfer?.files || [])].find((entry) => entry.type === "application/pdf");
    if (file) {
      await importPdfFile(file);
    }
  });
  refs.dropZone.addEventListener("click", openPdf);
  refs.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPdf();
    }
  });

  refs.prevPageBtn.addEventListener("click", () => void pdfViewer.previousPage());
  refs.nextPageBtn.addEventListener("click", () => void pdfViewer.nextPage());
  refs.pageJumpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void goToPage(Number(refs.pageInput.value || state.currentPage));
  });
  refs.zoomInBtn.addEventListener("click", () => void pdfViewer.zoomIn());
  refs.zoomOutBtn.addEventListener("click", () => void pdfViewer.zoomOut());
  refs.focusModeBtn.addEventListener("click", async () => {
    state.settings.focusMode = !state.settings.focusMode;
    applySettings();
    await persistSetting("focusMode", state.settings.focusMode);
    renderApp();
  });

  refs.noteSearchInput.addEventListener("input", (event) => {
    state.sidebarQuery = event.target.value;
    renderWorkspace();
  });
  refs.quickNoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveQuickNote();
  });
  refs.quickNoteInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void saveQuickNote();
    }
  });
  refs.toggleSnippetBtn.addEventListener("click", () => {
    state.snippetVisible = !state.snippetVisible;
    refs.selectedTextInput.classList.toggle("is-hidden", !state.snippetVisible);
    if (!state.snippetVisible && !refs.selectedTextInput.value.trim()) {
      clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
    }
    renderWorkspace();
  });
  refs.selectedTextInput.addEventListener("input", (event) => {
    if (!event.target.value.trim()) {
      clearSelectionState({ keepSnippet: false, clearBrowserSelection: true });
      renderWorkspace();
      return;
    }
    state.snippetVisible = true;
    renderWorkspace();
  });
  refs.selectionUseBtn.addEventListener("click", () => {
    if (!state.selection) {
      return;
    }
    state.snippetVisible = true;
    refs.selectedTextInput.value = state.selection.text;
    refs.selectedTextInput.classList.remove("is-hidden");
    hideSelectionToolbar();
    refs.quickNoteInput.focus();
    setSaveStatus(`Selection linked to page ${state.selection.page}`);
  });
  refs.selectionSaveBtn.addEventListener("click", () => {
    void saveQuickNote({ allowSelectionOnly: true });
  });

  refs.goalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const targetPagesPerDay = Math.max(1, Number(refs.goalInput.value || DEFAULT_DAILY_GOAL));
    state.goal = { id: DAILY_GOAL_ID, targetPagesPerDay, updatedAt: Date.now() };
    await storage.saveGoal(state.goal);
    renderWorkspace();
    setSaveStatus("Daily goal saved");
  });

  refs.startSessionBtn.addEventListener("click", async () => {
    sessionManager.start(state.currentDocumentId);
    await persistSetting("activeSession", sessionManager.getPersistedState());
    setSaveStatus("Session started");
  });
  refs.pauseSessionBtn.addEventListener("click", async () => {
    sessionManager.pause();
    await persistSetting("activeSession", sessionManager.getPersistedState());
    setSaveStatus("Session paused");
  });
  refs.resetSessionBtn.addEventListener("click", () => void finalizeSession());
  refs.attachSessionCheckbox.addEventListener("change", async (event) => {
    sessionManager.setAttachToDocument(event.target.checked);
    await persistSetting("activeSession", sessionManager.getPersistedState());
  });

  refs.notesManagerSearch.addEventListener("input", (event) => {
    state.notesManagerQuery = event.target.value;
    renderNotesManager();
  });
  refs.notesManagerDocumentFilter.addEventListener("change", (event) => {
    state.notesManagerDocument = event.target.value;
    renderNotesManager();
  });
  refs.notesManagerTagFilter.addEventListener("change", (event) => {
    state.notesManagerType = event.target.value;
    renderNotesManager();
  });
  refs.notesManagerExportMarkdownBtn.addEventListener("click", () => void exportMarkdown(true));
  refs.notesManagerExportJsonBtn.addEventListener("click", () => void exportJsonBackup());
  refs.notesManagerImportBtn.addEventListener("click", openJson);

  refs.glossarySearchInput.addEventListener("input", (event) => {
    state.glossaryQuery = event.target.value;
    renderGlossary();
  });

  refs.gradeHardBtn.addEventListener("click", () => void gradeRevision("hard"));
  refs.gradeGoodBtn.addEventListener("click", () => void gradeRevision("good"));
  refs.gradeEasyBtn.addEventListener("click", () => void gradeRevision("easy"));
  refs.flashcardCard.addEventListener("click", () => {
    if (!state.revision.revealed && state.revision.deck.length) {
      state.revision.revealed = true;
      renderRevision();
    }
  });

  refs.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.settings = {
      ...state.settings,
      ...state.pendingSettings,
      reducedMotion: refs.reducedMotionToggle.checked,
      highContrast: refs.highContrastToggle.checked,
    };
    applySettings();
    await Promise.all(
      Object.entries({
        theme: state.settings.theme,
        reducedMotion: state.settings.reducedMotion,
        highContrast: state.settings.highContrast,
      }).map(([key, value]) => persistSetting(key, value)),
    );
    state.pendingSettings = null;
    setOverlayState(refs.settingsOverlay, false);
    renderApp();
    setSaveStatus("Preferences saved");
  });
  refs.reducedMotionToggle.addEventListener("change", (event) => {
    state.pendingSettings.reducedMotion = event.target.checked;
  });
  refs.highContrastToggle.addEventListener("change", (event) => {
    state.pendingSettings.highContrast = event.target.checked;
  });
  refs.settingsCancelBtn.addEventListener("click", () => {
    state.pendingSettings = null;
    setOverlayState(refs.settingsOverlay, false);
  });
  refs.clearLocalDataBtn.addEventListener("click", () => {
    confirmDialog({
      title: "Clear local data?",
      message: "This removes every saved PDF, note, session, goal, flashcard, and preference from this browser.",
      confirmLabel: "Clear local data",
      onAccept: async () => {
        await storage.clearAllData();
        setOverlayState(refs.confirmOverlay, false);
        closeAllOverlays();
        state.currentDocumentId = null;
        await restoreSnapshot();
        setActiveView("landing");
        setSaveStatus("Local data cleared");
      },
    });
  });

  refs.commandPaletteInput.addEventListener("input", (event) => {
    state.commandQuery = event.target.value;
    state.commandActiveIndex = 0;
    updateCommandList();
  });

  refs.confirmCancelBtn.addEventListener("click", () => {
    state.confirmAction = null;
    setOverlayState(refs.confirmOverlay, false);
  });
  refs.confirmAcceptBtn.addEventListener("click", async () => {
    const action = state.confirmAction;
    state.confirmAction = null;
    if (action) {
      await action();
    }
  });

  document.querySelectorAll("[data-close-overlay]").forEach((button) => {
    button.addEventListener("click", () => {
      const overlay = document.getElementById(button.dataset.closeOverlay);
      if (overlay) {
        setOverlayState(overlay, false);
      }
    });
  });

  document.addEventListener("keydown", handleShortcut);
}

async function initialize() {
  refs = cacheDom();
  pdfViewer = new PdfViewer({
    canvas: refs.pdfCanvas,
    frame: refs.viewerFrame,
    placeholder: refs.viewerPlaceholder,
    canvasWrap: refs.viewerCanvasWrap,
    page: refs.viewerPage,
    textLayer: refs.pdfTextLayer,
    highlightLayer: refs.pdfHighlightLayer,
    onPageRendered: ({ page, totalPages, zoomPercent }) => {
      state.currentPage = page;
      state.totalPages = totalPages;
      state.zoomPercent = zoomPercent;
      refs.pageInput.value = String(page);
      void persistCurrentProgress(page, totalPages);
      void recordPageVisit(state.currentDocumentId, page);
      renderWorkspace();
      renderTopbar();
    },
    onTextSelection: handlePdfSelection,
    onError: () => showToast(refs.toastRegion, "This PDF could not be rendered in the browser."),
  });

  sessionManager = createSessionManager({
    onTick: (sessionState) => {
      refs.sessionTimerDisplay.textContent = formatDuration(sessionState.elapsedMs);
    },
    onChange: (sessionState) => {
      void persistSetting("activeSession", sessionState);
    },
  });

  bindEvents();
  await restoreSnapshot();
  sessionManager.hydrate(state.settings.activeSession);
  refs.sessionTimerDisplay.textContent = formatDuration(sessionManager.getPersistedState().elapsedMs || 0);

  if (state.settings.lastDocumentId && state.documentsById.has(state.settings.lastDocumentId)) {
    await openStoredDocument(state.settings.lastDocumentId);
  } else {
    setActiveView("landing");
  }

  renderApp();
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    void initialize().catch((error) => {
      console.error("PDF Reading Companion failed to initialize", error);
      if (refs?.toastRegion) {
        showToast(refs.toastRegion, "Local storage failed to initialize. Refresh once after the update.");
      }
    });
  });
}
