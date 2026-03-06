import { createPdfViewer } from "./pdf-viewer.js";
import {
  initStorage,
  getRecentDocuments,
  getAllProgress,
  getNotes,
  getSessions,
  getStats,
  getSetting,
  saveSetting,
  deleteSetting,
  getGoal,
  saveGoal,
  saveDocument,
  saveProgress,
  saveNote,
  deleteNote as deleteStoredNote,
  saveSession,
  saveStat,
  exportAppData,
  importAppData,
} from "./storage.js";
import { NOTE_TYPES, createNoteRecord, filterNotes } from "./notes.js";
import { createTimerController, formatDuration } from "./sessions.js";
import {
  DAILY_GOAL_ID,
  DEFAULT_DAILY_GOAL,
  normalizeGoal,
  dayStamp,
  calculateGoalProgress,
  buildStudyStats,
} from "./goals.js";
import { buildNotesMarkdown, downloadTextFile, downloadBackupJson, sanitizeFilename } from "./export.js";
import { buildFlashcards, buildGlossary } from "./revision.js";
import * as ui from "./ui.js";

const elements = ui.getElements();

const state = {
  theme: "light",
  helperDismissed: false,
  activeTab: "notes",
  currentDocument: null,
  currentPage: 1,
  totalPages: 0,
  zoomPercent: 100,
  documents: [],
  progressRecords: [],
  notes: [],
  sessions: [],
  pageVisits: [],
  goal: normalizeGoal({ targetPages: DEFAULT_DAILY_GOAL }),
  noteFilters: {
    search: "",
    type: "all",
  },
  glossaryQuery: "",
  flashcardIndex: 0,
  flashcardBackVisible: false,
  commandPaletteOpen: false,
  commandQuery: "",
  commandHighlightIndex: 0,
  lastVisitedToken: null,
};

let noteDraftTimeout = 0;

const viewer = createPdfViewer({
  canvas: elements.pdfCanvas,
  container: elements.canvasViewport,
  onRenderStateChange: handleViewerRender,
  onError: (error) => {
    handleError(error, "Could not render this PDF.");
  },
});

const timer = createTimerController({
  onTick: handleTimerUpdate,
  onStateChange: handleTimerUpdate,
});

function sortByRecent(left, right) {
  return new Date(right.lastOpened ?? 0) - new Date(left.lastOpened ?? 0);
}

function upsertRecord(list, record, key = "id") {
  const next = [...list];
  const index = next.findIndex((item) => item[key] === record[key]);

  if (index === -1) {
    next.push(record);
  } else {
    next[index] = {
      ...next[index],
      ...record,
    };
  }

  return next;
}

function removeRecord(list, recordId, key = "id") {
  return list.filter((item) => item[key] !== recordId);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function clampPage(page) {
  return Math.min(Math.max(1, Number(page) || 1), Math.max(1, state.totalPages || 1));
}

function getNoteDraftKey(documentId) {
  return `note-draft:${documentId}`;
}

function getCurrentDocumentNotes() {
  if (!state.currentDocument) {
    return [];
  }

  return state.notes.filter((note) => note.documentId === state.currentDocument.id);
}

function getCurrentProgress() {
  if (!state.currentDocument) {
    return null;
  }

  return (
    state.progressRecords.find((record) => record.documentId === state.currentDocument.id) ?? null
  );
}

function getPagesReadToday() {
  const today = dayStamp();
  return state.pageVisits.filter((record) => record.date === today).length;
}

function getVisibleCommands() {
  const commands = [
    {
      id: "open-pdf",
      label: "Open PDF",
      description: "Choose a local PDF file from your device.",
      shortcut: "O",
      disabled: false,
      action: () => elements.pdfInput.click(),
    },
    {
      id: "new-note",
      label: "Focus note composer",
      description: "Jump straight into note capture for the current page.",
      shortcut: "N",
      disabled: !state.currentDocument,
      action: () => focusNoteComposer(),
    },
    {
      id: "jump-page",
      label: "Jump to page",
      description: "Focus the page number input.",
      shortcut: "G",
      disabled: !state.currentDocument,
      action: () => {
        elements.pageNumberInput.focus();
        elements.pageNumberInput.select();
      },
    },
    {
      id: "toggle-theme",
      label: "Cycle theme",
      description: "Rotate through light, dark, and sepia themes.",
      shortcut: "Theme",
      disabled: false,
      action: () => cycleTheme(),
    },
    {
      id: "timer",
      label: timer.getState().running ? "Pause timer" : "Start timer",
      description: "Control the local reading session timer.",
      shortcut: "Timer",
      disabled: false,
      action: () => {
        void toggleTimer();
      },
    },
    {
      id: "export-notes",
      label: "Export notes to Markdown",
      description: "Download notes for the open document as a Markdown file.",
      shortcut: "MD",
      disabled: !state.currentDocument,
      action: () => {
        void exportNotesForCurrentDocument();
      },
    },
    {
      id: "backup-json",
      label: "Export full backup",
      description: "Download a JSON backup of all local app data.",
      shortcut: "JSON",
      disabled: false,
      action: () => {
        void exportBackup();
      },
    },
    {
      id: "import-json",
      label: "Import backup",
      description: "Merge a backup JSON file into local browser storage.",
      shortcut: "Import",
      disabled: false,
      action: () => elements.backupImportInput.click(),
    },
    {
      id: "tab-notes",
      label: "Open notes panel",
      description: "Switch to the notes sidebar.",
      shortcut: "Notes",
      disabled: false,
      action: () => setActiveTab("notes"),
    },
    {
      id: "tab-glossary",
      label: "Open glossary panel",
      description: "Review definition notes as a glossary.",
      shortcut: "Glossary",
      disabled: false,
      action: () => setActiveTab("glossary"),
    },
    {
      id: "tab-revision",
      label: "Open revision mode",
      description: "Flip through flashcards made from your notes.",
      shortcut: "Revision",
      disabled: false,
      action: () => setActiveTab("revision"),
    },
    {
      id: "tab-stats",
      label: "Open study stats",
      description: "See your pages, notes, sessions, and streak.",
      shortcut: "Stats",
      disabled: false,
      action: () => setActiveTab("stats"),
    },
  ];

  const query = state.commandQuery.trim().toLowerCase();

  if (!query) {
    return commands;
  }

  return commands.filter((command) =>
    `${command.label} ${command.description} ${command.shortcut}`.toLowerCase().includes(query),
  );
}

function buildRecentDocumentsView() {
  const noteCounts = new Map();

  for (const note of state.notes) {
    noteCounts.set(note.documentId, (noteCounts.get(note.documentId) ?? 0) + 1);
  }

  const progressByDocument = new Map();

  for (const progressRecord of state.progressRecords) {
    progressByDocument.set(progressRecord.documentId, progressRecord);
  }

  return [...state.documents]
    .sort(sortByRecent)
    .slice(0, 8)
    .map((documentRecord) => ({
      ...documentRecord,
      noteCount: noteCounts.get(documentRecord.id) ?? 0,
      lastPage: progressByDocument.get(documentRecord.id)?.currentPage ?? 1,
    }));
}

async function computeFingerprint(arrayBuffer, file) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch (_error) {
    return `${sanitizeFilename(file.name)}-${file.size}-${file.lastModified ?? 0}`;
  }
}

async function hydrateFromStorage() {
  const [
    documents,
    progressRecords,
    notes,
    sessions,
    stats,
    themeSetting,
    helperSetting,
    activeTabSetting,
    goalRecord,
    activeTimerSetting,
  ] = await Promise.all([
    getRecentDocuments(48),
    getAllProgress(),
    getNotes(),
    getSessions(),
    getStats(),
    getSetting("theme"),
    getSetting("helper-dismissed"),
    getSetting("active-tab"),
    getGoal(DAILY_GOAL_ID),
    getSetting("active-timer"),
  ]);

  state.documents = documents.sort(sortByRecent);
  state.progressRecords = progressRecords;
  state.notes = notes;
  state.sessions = sessions.sort(
    (left, right) =>
      new Date(right.endedAt ?? right.startedAt ?? 0) -
      new Date(left.endedAt ?? left.startedAt ?? 0),
  );
  state.pageVisits = stats.filter((record) => record.type === "page-visit");
  state.theme = themeSetting?.value ?? "light";
  state.helperDismissed = Boolean(helperSetting?.value);
  state.activeTab = activeTabSetting?.value ?? "notes";
  state.goal = normalizeGoal(goalRecord);

  ui.setTheme(elements, state.theme);
  ui.setSidebarTab(elements, state.activeTab);
  elements.dailyGoalInput.value = String(state.goal.targetPages);
  timer.restore(activeTimerSetting?.value ?? null);
}

function setNoteComposerDisabled(disabled) {
  const fields = [
    elements.notePageInput,
    elements.noteTypeSelect,
    elements.noteSnippetInput,
    elements.noteContentInput,
    elements.noteSearchInput,
    elements.noteFilterSelect,
  ];

  for (const field of fields) {
    field.disabled = disabled;
  }

  elements.newNoteButton.disabled = disabled;
}

async function loadDraftForCurrentDocument() {
  elements.notePageInput.value = String(state.currentPage || 1);
  elements.noteTypeSelect.value = NOTE_TYPES[0];
  elements.noteSnippetInput.value = "";
  elements.noteContentInput.value = "";
  elements.noteAutosaveHint.textContent = "Drafts save locally while you type.";

  if (!state.currentDocument) {
    return;
  }

  const draftRecord = await getSetting(getNoteDraftKey(state.currentDocument.id));
  const draft = draftRecord?.value;

  if (!draft) {
    return;
  }

  elements.notePageInput.value = String(clampPage(draft.page));
  elements.noteTypeSelect.value = NOTE_TYPES.includes(draft.type) ? draft.type : NOTE_TYPES[0];
  elements.noteSnippetInput.value = draft.selectedText ?? "";
  elements.noteContentInput.value = draft.content ?? "";
  elements.noteAutosaveHint.textContent = "Restored your local draft.";
}

async function persistDraftNow() {
  window.clearTimeout(noteDraftTimeout);

  if (!state.currentDocument) {
    return;
  }

  const draft = {
    page: clampPage(elements.notePageInput.value),
    type: elements.noteTypeSelect.value,
    selectedText: elements.noteSnippetInput.value.trim(),
    content: elements.noteContentInput.value.trim(),
  };

  const draftKey = getNoteDraftKey(state.currentDocument.id);

  if (!draft.content && !draft.selectedText) {
    await deleteSetting(draftKey);
    elements.noteAutosaveHint.textContent = "Drafts save locally while you type.";
    return;
  }

  await saveSetting(draftKey, draft);
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
  }, 240);
}

function renderReader() {
  const hasDocument = Boolean(state.currentDocument);
  const progressRecord = getCurrentProgress();
  const progressPercent =
    hasDocument && state.totalPages ? Math.round((state.currentPage / state.totalPages) * 100) : 0;

  elements.emptyState.hidden = hasDocument;
  elements.canvasViewport.hidden = !hasDocument;
  elements.exportNotesButton.disabled = !hasDocument;
  elements.previousPageButton.disabled = !hasDocument || state.currentPage <= 1;
  elements.nextPageButton.disabled = !hasDocument || state.currentPage >= state.totalPages;
  elements.pageNumberInput.disabled = !hasDocument;
  elements.zoomOutButton.disabled = !hasDocument;
  elements.zoomInButton.disabled = !hasDocument;
  elements.resetZoomButton.disabled = !hasDocument;
  elements.pageNumberInput.max = String(Math.max(1, state.totalPages || 1));
  elements.notePageInput.max = String(Math.max(1, state.totalPages || 1));
  elements.pageNumberInput.value = String(hasDocument ? state.currentPage : 1);
  elements.pageTotalLabel.textContent = `/ ${hasDocument ? state.totalPages : 0}`;
  elements.zoomLabel.textContent = `${Math.round(state.zoomPercent)}%`;

  if (!hasDocument) {
    elements.documentBadge.textContent = "No document open";
    elements.documentTitle.textContent = "Open a local PDF to begin";
    elements.documentMeta.textContent =
      "Your progress, notes, sessions, goals, and backups stay inside this browser.";
    elements.headerProgressValue.textContent = "0%";
    elements.headerProgressCopy.textContent = "Choose a PDF to start reading.";
    elements.progressLabel.textContent = "Reading progress will appear here";
    elements.progressSubLabel.textContent =
      "Open a PDF to start tracking pages and progress.";
    elements.progressBar.style.width = "0%";
    setNoteComposerDisabled(true);
    return;
  }

  elements.documentBadge.textContent = "Current document";
  elements.documentTitle.textContent = state.currentDocument.name;
  elements.documentMeta.textContent = `${formatBytes(state.currentDocument.size)} • ${
    state.totalPages
  } pages • local progress fingerprinted`;
  elements.headerProgressValue.textContent = `${progressPercent}%`;
  elements.headerProgressCopy.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
  elements.progressLabel.textContent = `${state.currentDocument.name} • page ${state.currentPage} of ${state.totalPages}`;
  elements.progressSubLabel.textContent = progressRecord
    ? `Resume is saved automatically for this file. Reopen the same PDF to continue from page ${progressRecord.currentPage}.`
    : "Progress updates automatically as you navigate.";
  elements.progressBar.style.width = `${progressPercent}%`;
  setNoteComposerDisabled(false);
}

function renderStudyControls() {
  const timerState = timer.getState();
  const goalContext = calculateGoalProgress(state.goal.targetPages, getPagesReadToday());
  const formattedDuration = formatDuration(timerState.elapsedMs);

  elements.sessionTimerValue.textContent = formattedDuration;
  elements.headerSessionValue.textContent = formattedDuration;
  elements.timerStartPauseButton.textContent = timerState.running ? "Pause" : "Start";
  elements.sessionTimerMeta.textContent = timerState.running
    ? state.currentDocument
      ? `Running on ${state.currentDocument.name}.`
      : "Timer is running without a document attachment."
    : "Start a session and it will be saved locally when you reset it.";
  elements.headerSessionCopy.textContent = timerState.running
    ? "Focus session in progress."
    : "Start a session when you begin reading.";

  if (document.activeElement !== elements.dailyGoalInput) {
    elements.dailyGoalInput.value = String(state.goal.targetPages);
  }

  elements.goalFeedback.textContent = goalContext.copy;
  elements.goalProgressBar.style.width = `${goalContext.percent}%`;
  elements.headerGoalValue.textContent = `${goalContext.pagesToday} / ${goalContext.target} pages`;
  elements.headerGoalCopy.textContent = goalContext.copy;
}

function renderNotesPanel() {
  const hasDocument = Boolean(state.currentDocument);
  const currentNotes = getCurrentDocumentNotes();
  const filteredNotes = filterNotes(currentNotes, state.noteFilters);
  const notesOnCurrentPage = currentNotes.filter((note) => note.page === state.currentPage).length;

  elements.notesSummary.textContent = hasDocument
    ? `${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"} shown • ${notesOnCurrentPage} on this page`
    : "Open a document to start capturing notes.";

  ui.renderNotesList(elements, filteredNotes, {
    activePage: state.currentPage,
    hasDocument,
  });
}

function renderGlossaryPanel() {
  const glossaryEntries = buildGlossary(getCurrentDocumentNotes(), state.glossaryQuery);
  ui.renderGlossaryList(elements, glossaryEntries, Boolean(state.currentDocument));
}

function renderRevisionPanel() {
  const flashcards = buildFlashcards(getCurrentDocumentNotes());

  if (!flashcards.length) {
    state.flashcardIndex = 0;
    state.flashcardBackVisible = false;
  } else if (state.flashcardIndex >= flashcards.length) {
    state.flashcardIndex = 0;
  }

  ui.renderFlashcard(elements, {
    cards: flashcards,
    index: state.flashcardIndex,
    showBack: state.flashcardBackVisible,
  });

  const disableStep = flashcards.length < 2;
  elements.flashcardPreviousButton.disabled = disableStep;
  elements.flashcardNextButton.disabled = disableStep;
  elements.flashcardFlipButton.disabled = !flashcards.length;
}

function renderStatsPanel() {
  const stats = buildStudyStats({
    pageVisits: state.pageVisits,
    sessions: state.sessions,
    notes: state.notes,
  });

  ui.renderStats(elements, stats);
}

function renderRecentDocuments() {
  ui.renderRecentDocuments(elements, buildRecentDocumentsView());
}

function renderCommandPalette() {
  const commands = getVisibleCommands();

  if (state.commandHighlightIndex >= commands.length) {
    state.commandHighlightIndex = 0;
  }

  ui.renderCommandList(
    elements,
    commands,
    commands[state.commandHighlightIndex]?.id ?? null,
  );
}

function renderAll() {
  ui.setTheme(elements, state.theme);
  ui.setHelperVisibility(elements, !state.helperDismissed);
  ui.setSidebarTab(elements, state.activeTab);
  renderReader();
  renderStudyControls();
  renderNotesPanel();
  renderGlossaryPanel();
  renderRevisionPanel();
  renderStatsPanel();
  renderRecentDocuments();
  renderCommandPalette();
}

function handleTimerUpdate() {
  void saveSetting("active-timer", timer.getSerializableState());
  renderStudyControls();
  renderCommandPalette();
}

async function handleViewerRender(viewerState) {
  state.currentPage = viewerState.currentPage;
  state.totalPages = viewerState.totalPages;
  state.zoomPercent = viewerState.zoomPercent;

  if (state.currentDocument) {
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
    state.documents = upsertRecord(state.documents, state.currentDocument).sort(sortByRecent);

    try {
      await Promise.all([saveProgress(progressRecord), saveDocument(state.currentDocument)]);
    } catch (error) {
      console.error(error);
    }

    const visitToken = `${state.currentDocument.id}:${state.currentPage}`;

    if (state.lastVisitedToken !== visitToken) {
      state.lastVisitedToken = visitToken;
      const visitRecord = {
        id: `page-visit:${state.currentDocument.id}:${dayStamp()}:${state.currentPage}`,
        type: "page-visit",
        documentId: state.currentDocument.id,
        date: dayStamp(),
        page: state.currentPage,
        createdAt: nowIso,
      };

      state.pageVisits = upsertRecord(state.pageVisits, visitRecord);

      try {
        await saveStat(visitRecord);
      } catch (error) {
        console.error(error);
      }
    }
  }

  if (!elements.noteContentInput.value.trim() && !elements.noteSnippetInput.value.trim()) {
    elements.notePageInput.value = String(state.currentPage);
  }

  renderAll();
}

async function exportNotesForCurrentDocument() {
  if (!state.currentDocument) {
    return;
  }

  const markdown = buildNotesMarkdown(state.currentDocument, getCurrentDocumentNotes());
  const filename = `${sanitizeFilename(state.currentDocument.name)}-notes.md`;
  downloadTextFile(filename, markdown, "text/markdown;charset=utf-8");
  ui.showToast(elements, "Notes exported to Markdown.");
}

async function exportBackup() {
  const data = await exportAppData();
  downloadBackupJson(data);
  ui.showToast(elements, "Local JSON backup downloaded.");
}

async function openDocument(file) {
  if (!file) {
    return;
  }

  if (
    file.type &&
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    ui.showToast(elements, "Please choose a PDF file.");
    return;
  }

  await persistDraftNow();

  try {
    ui.setLoading(elements, true, `Loading ${file.name}…`);
    ui.setStatus(elements, `Loading ${file.name}.`);

    const arrayBuffer = await file.arrayBuffer();
    const documentId = await computeFingerprint(arrayBuffer, file);
    const existingDocument =
      state.documents.find((documentRecord) => documentRecord.id === documentId) ?? null;
    const existingProgress =
      state.progressRecords.find((record) => record.documentId === documentId) ?? null;

    state.currentDocument = {
      id: documentId,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified ?? null,
      lastOpened: new Date().toISOString(),
      fingerprint: documentId,
      totalPages: existingDocument?.totalPages ?? 0,
    };
    state.lastVisitedToken = null;
    state.flashcardIndex = 0;
    state.flashcardBackVisible = false;

    const viewerState = await viewer.loadDocument({
      data: new Uint8Array(arrayBuffer),
      initialPage: existingProgress?.currentPage ?? 1,
    });

    state.currentPage = viewerState.currentPage;
    state.totalPages = viewerState.totalPages;
    state.zoomPercent = viewerState.zoomPercent;
    state.currentDocument = {
      ...state.currentDocument,
      totalPages: viewerState.totalPages,
      lastOpened: new Date().toISOString(),
    };

    await saveDocument(state.currentDocument);
    state.documents = upsertRecord(state.documents, state.currentDocument).sort(sortByRecent);
    timer.setDocumentId(state.currentDocument.id);
    await loadDraftForCurrentDocument();
    renderAll();
    ui.setStatus(elements, `${file.name} is ready.`);
    ui.showToast(elements, `Opened ${file.name}.`);
  } catch (error) {
    state.currentDocument = null;
    state.currentPage = 1;
    state.totalPages = 0;
    state.zoomPercent = 100;
    await viewer.cleanup();
    renderAll();
    handleError(error, `Could not open ${file.name}.`);
  } finally {
    ui.setLoading(elements, false);
    elements.pdfInput.value = "";
  }
}

async function handleBackupImport(event) {
  const [file] = event.target.files ?? [];

  if (!file) {
    return;
  }

  try {
    const confirmed = window.confirm(
      "Import this backup into local browser storage? Matching record IDs will be updated locally.",
    );

    if (!confirmed) {
      return;
    }

    const text = await file.text();
    const payload = JSON.parse(text);
    await importAppData(payload, { replace: false });
    await hydrateFromStorage();

    if (state.currentDocument) {
      const updatedCurrent = state.documents.find(
        (documentRecord) => documentRecord.id === state.currentDocument.id,
      );

      if (updatedCurrent) {
        state.currentDocument = {
          ...state.currentDocument,
          ...updatedCurrent,
          totalPages: state.totalPages || updatedCurrent.totalPages,
        };
      }
    }

    renderAll();
    ui.showToast(elements, "Backup imported into local storage.");
  } catch (error) {
    handleError(error, "Could not import that JSON backup.");
  } finally {
    elements.backupImportInput.value = "";
  }
}

async function handleNoteSubmit(event) {
  event.preventDefault();

  if (!state.currentDocument) {
    ui.showToast(elements, "Open a document before adding notes.");
    return;
  }

  const content = elements.noteContentInput.value.trim();

  if (!content) {
    elements.noteContentInput.focus();
    return;
  }

  const noteRecord = createNoteRecord({
    documentId: state.currentDocument.id,
    page: clampPage(elements.notePageInput.value),
    type: elements.noteTypeSelect.value,
    content,
    selectedText: elements.noteSnippetInput.value,
  });

  await saveNote(noteRecord);
  state.notes = upsertRecord(state.notes, noteRecord);

  elements.notePageInput.value = String(state.currentPage);
  elements.noteTypeSelect.value = NOTE_TYPES[0];
  elements.noteSnippetInput.value = "";
  elements.noteContentInput.value = "";
  state.flashcardIndex = 0;
  state.flashcardBackVisible = false;

  await deleteSetting(getNoteDraftKey(state.currentDocument.id));
  elements.noteAutosaveHint.textContent = "Note saved locally.";

  renderAll();
  ui.showToast(elements, `Saved a note for page ${noteRecord.page}.`);
}

async function deleteNoteById(noteId) {
  const note = state.notes.find((record) => record.id === noteId);

  if (!note) {
    return;
  }

  const confirmed = window.confirm("Delete this note from local storage?");

  if (!confirmed) {
    return;
  }

  await deleteStoredNote(noteId);
  state.notes = removeRecord(state.notes, noteId);
  renderAll();
  ui.showToast(elements, "Note deleted.");
}

function focusNoteComposer() {
  if (!state.currentDocument) {
    ui.showToast(elements, "Open a document first.");
    return;
  }

  setActiveTab("notes");
  elements.noteContentInput.focus();
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  ui.setSidebarTab(elements, tabName);
  void saveSetting("active-tab", tabName);
  renderCommandPalette();
}

function setTheme(theme) {
  state.theme = theme;
  ui.setTheme(elements, theme);
  void saveSetting("theme", theme);
}

function cycleTheme() {
  const themes = ["light", "dark", "sepia"];
  const nextIndex = (themes.indexOf(state.theme) + 1) % themes.length;
  setTheme(themes[nextIndex]);
}

async function toggleTimer() {
  if (timer.getState().running) {
    timer.pause();
    ui.showToast(elements, "Session paused.");
  } else {
    timer.start(state.currentDocument?.id ?? null);
    ui.showToast(elements, "Session started.");
  }
}

async function resetTimer() {
  const currentTimerState = timer.getState();

  if (currentTimerState.elapsedMs < 1000) {
    timer.reset();
    return;
  }

  const confirmed = window.confirm(
    "Reset this session? The elapsed time will be saved to local session history.",
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

  renderStudyControls();
  renderStatsPanel();
  renderCommandPalette();
  ui.showToast(elements, "Session saved and timer reset.");
}

async function handleGoalSubmit(event) {
  event.preventDefault();

  const targetPages = Math.max(1, Number(elements.dailyGoalInput.value) || DEFAULT_DAILY_GOAL);
  state.goal = normalizeGoal({
    id: DAILY_GOAL_ID,
    targetPages,
    updatedAt: new Date().toISOString(),
  });
  await saveGoal(state.goal);
  renderStudyControls();
  ui.showToast(elements, `Daily goal set to ${targetPages} pages.`);
}

function openCommandPalette() {
  state.commandPaletteOpen = true;
  state.commandQuery = "";
  state.commandHighlightIndex = 0;
  ui.toggleCommandPalette(elements, true);
  elements.commandSearchInput.value = "";
  renderCommandPalette();
  elements.commandSearchInput.focus();
}

function closeCommandPalette() {
  state.commandPaletteOpen = false;
  state.commandQuery = "";
  state.commandHighlightIndex = 0;
  ui.toggleCommandPalette(elements, false);
}

function executeHighlightedCommand() {
  const commands = getVisibleCommands();
  const command = commands[state.commandHighlightIndex];

  if (!command || command.disabled) {
    return;
  }

  closeCommandPalette();
  command.action();
}

function handleGlobalShortcuts(event) {
  const target = event.target;
  const isFormField =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  if (state.commandPaletteOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    }
    return;
  }

  if ((event.key === "/" || (event.ctrlKey && event.key.toLowerCase() === "k")) && !isFormField) {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (event.key === "ArrowRight" && !isFormField && state.currentDocument) {
    event.preventDefault();
    void viewer.nextPage();
    return;
  }

  if (event.key === "ArrowLeft" && !isFormField && state.currentDocument) {
    event.preventDefault();
    void viewer.previousPage();
    return;
  }

  if (event.key.toLowerCase() === "n" && !isFormField && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    focusNoteComposer();
    return;
  }

  if (event.key.toLowerCase() === "g" && !isFormField && state.currentDocument) {
    event.preventDefault();
    elements.pageNumberInput.focus();
    elements.pageNumberInput.select();
  }
}

function handleError(error, message) {
  console.error(error);
  ui.setStatus(elements, message);
  ui.showToast(elements, message);
}

function bindEvents() {
  elements.openPdfButton.addEventListener("click", () => elements.pdfInput.click());
  elements.openPdfEmptyButton.addEventListener("click", () => elements.pdfInput.click());
  elements.focusShortcutsButton.addEventListener("click", openCommandPalette);
  elements.commandPaletteButton.addEventListener("click", openCommandPalette);
  elements.closeCommandPaletteButton.addEventListener("click", closeCommandPalette);
  elements.exportNotesButton.addEventListener("click", () => {
    void exportNotesForCurrentDocument();
  });
  elements.exportBackupButton.addEventListener("click", () => {
    void exportBackup();
  });
  elements.importBackupButton.addEventListener("click", () => elements.backupImportInput.click());

  elements.pdfInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void openDocument(file);
  });

  elements.backupImportInput.addEventListener("change", (event) => {
    void handleBackupImport(event);
  });

  for (const button of elements.themeButtons) {
    button.addEventListener("click", () => {
      setTheme(button.dataset.themeChoice);
    });
  }

  elements.previousPageButton.addEventListener("click", () => {
    void viewer.previousPage();
  });

  elements.nextPageButton.addEventListener("click", () => {
    void viewer.nextPage();
  });

  elements.pageNumberInput.addEventListener("change", () => {
    void viewer.goToPage(clampPage(elements.pageNumberInput.value));
  });

  elements.pageNumberInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void viewer.goToPage(clampPage(elements.pageNumberInput.value));
    }
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

  elements.dismissHelperButton.addEventListener("click", () => {
    state.helperDismissed = true;
    ui.setHelperVisibility(elements, false);
    void saveSetting("helper-dismissed", true);
  });

  elements.noteForm.addEventListener("submit", (event) => {
    void handleNoteSubmit(event);
  });

  elements.newNoteButton.addEventListener("click", focusNoteComposer);

  const draftInputs = [
    elements.notePageInput,
    elements.noteTypeSelect,
    elements.noteSnippetInput,
    elements.noteContentInput,
  ];

  for (const field of draftInputs) {
    field.addEventListener("input", scheduleDraftSave);
    field.addEventListener("change", scheduleDraftSave);
  }

  elements.noteSearchInput.addEventListener("input", (event) => {
    state.noteFilters.search = event.target.value;
    renderNotesPanel();
  });

  elements.noteFilterSelect.addEventListener("change", (event) => {
    state.noteFilters.type = event.target.value;
    renderNotesPanel();
  });

  elements.notesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-note-action]");

    if (!button) {
      return;
    }

    const noteId = button.dataset.noteId;
    const note = state.notes.find((record) => record.id === noteId);

    if (!note) {
      return;
    }

    if (button.dataset.noteAction === "jump") {
      void viewer.goToPage(note.page);
      return;
    }

    if (button.dataset.noteAction === "delete") {
      void deleteNoteById(noteId);
    }
  });

  elements.glossarySearchInput.addEventListener("input", (event) => {
    state.glossaryQuery = event.target.value;
    renderGlossaryPanel();
  });

  elements.flashcardPreviousButton.addEventListener("click", () => {
    const cards = buildFlashcards(getCurrentDocumentNotes());

    if (!cards.length) {
      return;
    }

    state.flashcardIndex =
      (state.flashcardIndex - 1 + cards.length) % cards.length;
    state.flashcardBackVisible = false;
    renderRevisionPanel();
  });

  elements.flashcardNextButton.addEventListener("click", () => {
    const cards = buildFlashcards(getCurrentDocumentNotes());

    if (!cards.length) {
      return;
    }

    state.flashcardIndex = (state.flashcardIndex + 1) % cards.length;
    state.flashcardBackVisible = false;
    renderRevisionPanel();
  });

  elements.flashcardFlipButton.addEventListener("click", () => {
    state.flashcardBackVisible = !state.flashcardBackVisible;
    renderRevisionPanel();
  });

  elements.goalForm.addEventListener("submit", (event) => {
    void handleGoalSubmit(event);
  });

  elements.timerStartPauseButton.addEventListener("click", () => {
    void toggleTimer();
  });

  elements.timerResetButton.addEventListener("click", () => {
    void resetTimer();
  });

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  }

  elements.recentDocumentsList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-document-id]");

    if (!trigger) {
      return;
    }

    const documentRecord = buildRecentDocumentsView().find(
      (item) => item.id === trigger.dataset.documentId,
    );

    if (!documentRecord) {
      return;
    }

    ui.showToast(
      elements,
      `To resume ${documentRecord.name}, choose the same local file again. Last saved page: ${documentRecord.lastPage}.`,
    );
  });

  elements.commandSearchInput.addEventListener("input", (event) => {
    state.commandQuery = event.target.value;
    state.commandHighlightIndex = 0;
    renderCommandPalette();
  });

  elements.commandSearchInput.addEventListener("keydown", (event) => {
    const commands = getVisibleCommands();

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.commandHighlightIndex = Math.min(
        commands.length - 1,
        state.commandHighlightIndex + 1,
      );
      renderCommandPalette();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.commandHighlightIndex = Math.max(0, state.commandHighlightIndex - 1);
      renderCommandPalette();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      executeHighlightedCommand();
    }
  });

  elements.commandList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-command-id]");

    if (!trigger) {
      return;
    }

    const command = getVisibleCommands().find(
      (entry) => entry.id === trigger.dataset.commandId,
    );

    if (!command || command.disabled) {
      return;
    }

    closeCommandPalette();
    command.action();
  });

  document.addEventListener("keydown", handleGlobalShortcuts);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void persistDraftNow();
      void saveSetting("active-timer", timer.getSerializableState());
    }
  });
}

async function init() {
  bindEvents();

  try {
    await initStorage();
    await hydrateFromStorage();
    renderAll();
    await loadDraftForCurrentDocument();
    ui.setStatus(elements, "Ready.");
  } catch (error) {
    handleError(error, "Failed to initialize local storage.");
  }
}

void init();
