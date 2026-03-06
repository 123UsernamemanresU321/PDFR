import { filterNotes, NOTE_TYPE_META } from "./notes.js";
import { buildFlashcards, buildGlossary } from "./revision.js";
import { buildNotesMarkdown, downloadBackupJson, downloadTextFile, sanitizeFilename } from "./export.js";
import { buildStudyStats, calculateGoalProgress, dayStamp, DEFAULT_DAILY_GOAL, normalizeGoal } from "./goals.js";
import {
  deleteNote,
  exportAppData,
  importAppData,
  initStorage,
  saveGoal,
  saveSetting,
} from "./storage.js";
import {
  SETTING_KEYS,
  applyTheme,
  buildRecentDocumentSummaries,
  cachePdfFile,
  formatBytes,
  formatTimestamp,
  getNotesForDocument,
  getQueryParam,
  loadAppModel,
  persistActiveDocumentId,
  persistTheme,
  readerHref,
  removeRecord,
  setStatus,
  showToast,
  studyHref,
} from "./common.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderNotesList(target, notes) {
  if (!notes.length) {
    target.innerHTML = `
      <div class="revision-empty">No notes match the current view.</div>
    `;
    return;
  }

  target.innerHTML = notes
    .map(
      (note) => `
        <article class="note-card">
          <div class="note-meta">
            <span class="pill">${escapeHtml(NOTE_TYPE_META[note.type]?.label ?? note.type)}</span>
            <span class="subtle-copy">Page ${note.page}</span>
            <span class="subtle-copy">${escapeHtml(formatTimestamp(note.createdAt))}</span>
          </div>
          ${note.selectedText ? `<div class="note-snippet">${escapeHtml(note.selectedText)}</div>` : ""}
          <div>${escapeHtml(note.content)}</div>
          <div class="note-actions">
            <a class="action-link" href="${readerHref(note.documentId, note.page)}">Open in reader</a>
            <button class="action-link" type="button" data-delete-note="${note.id}">Delete</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderGlossary(target, entries) {
  if (!entries.length) {
    target.innerHTML = `
      <div class="revision-empty">No definition notes match this glossary query.</div>
    `;
    return;
  }

  target.innerHTML = entries
    .map(
      (entry) => `
        <article class="glossary-item">
          <div class="note-meta">
            <strong>${escapeHtml(entry.term)}</strong>
            <span class="subtle-copy">Page ${entry.page}</span>
          </div>
          <p>${escapeHtml(entry.definition)}</p>
        </article>
      `,
    )
    .join("");
}

function renderFlashcard(elements, cards, index, showBack) {
  if (!cards.length) {
    elements.revisionEmptyState.hidden = false;
    elements.flashcard.hidden = true;
    elements.flashcardBackPanel.hidden = true;
    elements.flashcardFlipButton.disabled = true;
    elements.flashcardPreviousButton.disabled = true;
    elements.flashcardNextButton.disabled = true;
    return;
  }

  const card = cards[index];
  elements.revisionEmptyState.hidden = true;
  elements.flashcard.hidden = false;
  elements.flashcardCounter.textContent = `Card ${index + 1} of ${cards.length}`;
  elements.flashcardTag.textContent = NOTE_TYPE_META[card.type]?.label ?? card.type;
  elements.flashcardFront.textContent = card.front;
  elements.flashcardBack.textContent = `${card.back} (page ${card.page})`;
  elements.flashcardBackPanel.hidden = !showBack;
  elements.flashcardFlipButton.disabled = false;
  elements.flashcardPreviousButton.disabled = cards.length < 2;
  elements.flashcardNextButton.disabled = cards.length < 2;
  elements.flashcardFlipButton.textContent = showBack ? "Hide answer" : "Flip";
}

function renderStats(targetGrid, targetBreakdown, stats) {
  targetGrid.innerHTML = `
    <article class="stats-card">
      <span class="metric-label">Pages read</span>
      <strong>${stats.totalPagesRead}</strong>
      <span class="subtle-copy">Unique page visits across all documents.</span>
    </article>
    <article class="stats-card">
      <span class="metric-label">Sessions</span>
      <strong>${stats.totalSessions}</strong>
      <span class="subtle-copy">Completed timer sessions.</span>
    </article>
    <article class="stats-card">
      <span class="metric-label">Streak</span>
      <strong>${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}</strong>
      <span class="subtle-copy">Consecutive active study days.</span>
    </article>
    <article class="stats-card">
      <span class="metric-label">Notes</span>
      <strong>${stats.totalNotes}</strong>
      <span class="subtle-copy">All note records saved locally.</span>
    </article>
  `;

  targetBreakdown.innerHTML = `
    <article class="stats-card">
      <span class="metric-label">Note breakdown</span>
      <strong>
        ${Object.entries(stats.noteCounts)
          .map(([type, count]) => `${NOTE_TYPE_META[type]?.label ?? type}: ${count}`)
          .join(" • ")}
      </strong>
      <span class="subtle-copy">${stats.activeDays} active day${stats.activeDays === 1 ? "" : "s"} recorded.</span>
    </article>
  `;
}

function renderRecentDocuments(target, documents) {
  if (!documents.length) {
    target.innerHTML = `
      <div class="revision-empty">No recent documents yet.</div>
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

export async function init() {
  const elements = {
    pdfInput: document.querySelector("#pdfFileInput"),
    backupImportInput: document.querySelector("#backupImportInput"),
    openPdfButton: document.querySelector("#openPdfButton"),
    openReaderButton: document.querySelector("#openReaderButton"),
    themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
    documentSelect: document.querySelector("#documentSelect"),
    documentSummary: document.querySelector("#documentSummary"),
    goalForm: document.querySelector("#goalForm"),
    dailyGoalInput: document.querySelector("#dailyGoalInput"),
    goalFeedback: document.querySelector("#goalFeedback"),
    goalProgressBar: document.querySelector("#goalProgressBar"),
    exportNotesButton: document.querySelector("#exportNotesButton"),
    exportBackupButton: document.querySelector("#exportBackupButton"),
    importBackupButton: document.querySelector("#importBackupButton"),
    recentDocumentsList: document.querySelector("#recentDocumentsList"),
    summaryCards: document.querySelector("#summaryCards"),
    tabButtons: [...document.querySelectorAll("[data-tab]")],
    notesPanel: document.querySelector("#notesPanel"),
    glossaryPanel: document.querySelector("#glossaryPanel"),
    revisionPanel: document.querySelector("#revisionPanel"),
    statsPanel: document.querySelector("#statsPanel"),
    noteSearchInput: document.querySelector("#noteSearchInput"),
    noteFilterSelect: document.querySelector("#noteFilterSelect"),
    notesSummary: document.querySelector("#notesSummary"),
    notesList: document.querySelector("#notesList"),
    glossarySearchInput: document.querySelector("#glossarySearchInput"),
    glossaryList: document.querySelector("#glossaryList"),
    revisionEmptyState: document.querySelector("#revisionEmptyState"),
    flashcard: document.querySelector("#flashcard"),
    flashcardCounter: document.querySelector("#flashcardCounter"),
    flashcardTag: document.querySelector("#flashcardTag"),
    flashcardFront: document.querySelector("#flashcardFront"),
    flashcardBackPanel: document.querySelector("#flashcardBackPanel"),
    flashcardBack: document.querySelector("#flashcardBack"),
    flashcardPreviousButton: document.querySelector("#flashcardPreviousButton"),
    flashcardFlipButton: document.querySelector("#flashcardFlipButton"),
    flashcardNextButton: document.querySelector("#flashcardNextButton"),
    statsGrid: document.querySelector("#statsGrid"),
    statsBreakdown: document.querySelector("#statsBreakdown"),
    appStatus: document.querySelector("#appStatus"),
    toastRegion: document.querySelector("#toastRegion"),
  };

  const state = {
    documents: [],
    progressRecords: [],
    notes: [],
    sessions: [],
    pageVisits: [],
    goal: normalizeGoal({ targetPages: DEFAULT_DAILY_GOAL }),
    theme: "light",
    activeDocumentId: null,
    activeTab: "notes",
    noteFilters: {
      search: "",
      type: "all",
    },
    glossaryQuery: "",
    flashcardIndex: 0,
    flashcardBackVisible: false,
  };

  function setActiveTab(tabName) {
    state.activeTab = tabName;

    for (const button of elements.tabButtons) {
      button.classList.toggle("is-active", button.dataset.tab === tabName);
    }

    elements.notesPanel.hidden = tabName !== "notes";
    elements.glossaryPanel.hidden = tabName !== "glossary";
    elements.revisionPanel.hidden = tabName !== "revision";
    elements.statsPanel.hidden = tabName !== "stats";
    void saveSetting(SETTING_KEYS.studyTab, tabName);
  }

  function currentDocument() {
    return state.documents.find((documentRecord) => documentRecord.id === state.activeDocumentId) ?? null;
  }

  function currentDocumentNotes() {
    return state.activeDocumentId ? getNotesForDocument(state.notes, state.activeDocumentId) : [];
  }

  function renderDocumentSelect() {
    if (!state.documents.length) {
      elements.documentSelect.innerHTML = `<option value="">No cached documents yet</option>`;
      elements.documentSelect.disabled = true;
      elements.documentSummary.textContent = "Open a PDF to start reading and reviewing.";
      return;
    }

    elements.documentSelect.disabled = false;
    elements.documentSelect.innerHTML = state.documents
      .map(
        (documentRecord) => `
          <option value="${documentRecord.id}" ${documentRecord.id === state.activeDocumentId ? "selected" : ""}>
            ${escapeHtml(documentRecord.name)}
          </option>
        `,
      )
      .join("");

    const doc = currentDocument();
    if (doc) {
      const progress = state.progressRecords.find((record) => record.documentId === doc.id);
      elements.documentSummary.textContent = `${formatBytes(doc.size)} • ${
        doc.totalPages || "?"
      } pages • last page ${progress?.currentPage ?? 1}`;
      elements.openReaderButton.href = readerHref(doc.id);
      elements.exportNotesButton.disabled = false;
    } else {
      elements.documentSummary.textContent = "Choose a document to inspect notes and exports.";
      elements.openReaderButton.href = "./reader.html";
      elements.exportNotesButton.disabled = true;
    }
  }

  function renderSummaryCards() {
    const stats = buildStudyStats({
      pageVisits: state.pageVisits,
      sessions: state.sessions,
      notes: state.notes,
    });
    const goal = calculateGoalProgress(
      state.goal.targetPages,
      state.pageVisits.filter((record) => record.date === dayStamp()).length,
    );

    elements.summaryCards.innerHTML = `
      <article class="metric-chip">
        <span class="metric-label">Today</span>
        <strong>${goal.pagesToday} / ${goal.target} pages</strong>
        <span>${goal.copy}</span>
      </article>
      <article class="metric-chip">
        <span class="metric-label">Streak</span>
        <strong>${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}</strong>
        <span>${stats.totalSessions} saved session${stats.totalSessions === 1 ? "" : "s"}.</span>
      </article>
      <article class="metric-chip">
        <span class="metric-label">Notes</span>
        <strong>${stats.totalNotes}</strong>
        <span>All searchable in this space.</span>
      </article>
    `;
  }

  function renderPanels() {
    const notesForDocument = currentDocumentNotes();
    const filteredNotes = filterNotes(notesForDocument, state.noteFilters);
    const glossaryEntries = buildGlossary(notesForDocument, state.glossaryQuery);
    const flashcards = buildFlashcards(notesForDocument);
    const stats = buildStudyStats({
      pageVisits: state.pageVisits,
      sessions: state.sessions,
      notes: state.notes,
    });
    const recentDocuments = buildRecentDocumentSummaries(
      state.documents,
      state.progressRecords,
      state.notes,
      7,
    );

    elements.notesSummary.textContent = state.activeDocumentId
      ? `${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"} shown for the selected document`
      : "Choose a document to review notes.";

    renderNotesList(elements.notesList, filteredNotes);
    renderGlossary(elements.glossaryList, glossaryEntries);

    if (state.flashcardIndex >= flashcards.length) {
      state.flashcardIndex = 0;
      state.flashcardBackVisible = false;
    }

    renderFlashcard(elements, flashcards, state.flashcardIndex, state.flashcardBackVisible);
    renderStats(elements.statsGrid, elements.statsBreakdown, stats);
    renderRecentDocuments(elements.recentDocumentsList, recentDocuments);
    renderDocumentSelect();
    renderSummaryCards();

    const goal = calculateGoalProgress(
      state.goal.targetPages,
      state.pageVisits.filter((record) => record.date === dayStamp()).length,
    );
    elements.goalFeedback.textContent = goal.copy;
    elements.goalProgressBar.style.width = `${goal.percent}%`;
    elements.dailyGoalInput.value = String(state.goal.targetPages);
  }

  async function openPdf(file) {
    if (!file) {
      return;
    }

    try {
      setStatus(elements.appStatus, `Caching ${file.name} locally…`);
      const { documentRecord } = await cachePdfFile(file, state.documents);
      state.documents = [documentRecord, ...state.documents.filter((item) => item.id !== documentRecord.id)];
      state.activeDocumentId = documentRecord.id;
      await persistActiveDocumentId(documentRecord.id);
      window.location.href = readerHref(documentRecord.id);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not open that PDF.", elements.toastRegion);
      setStatus(elements.appStatus, "Could not open that PDF.");
    } finally {
      elements.pdfInput.value = "";
    }
  }

  async function exportNotes() {
    const doc = currentDocument();

    if (!doc) {
      return;
    }

    const markdown = buildNotesMarkdown(doc, currentDocumentNotes());
    downloadTextFile(
      `${sanitizeFilename(doc.name)}-notes.md`,
      markdown,
      "text/markdown;charset=utf-8",
    );
    showToast("Notes exported to Markdown.", elements.toastRegion);
  }

  async function importBackup(file) {
    if (!file) {
      return;
    }

    try {
      const confirmed = window.confirm(
        "Import this JSON backup into local browser storage? Matching record IDs will be updated.",
      );

      if (!confirmed) {
        return;
      }

      const text = await file.text();
      const payload = JSON.parse(text);
      await importAppData(payload, { replace: false });
      const model = await loadAppModel();
      state.documents = model.documents;
      state.progressRecords = model.progressRecords;
      state.notes = model.notes;
      state.sessions = model.sessions;
      state.pageVisits = model.pageVisits;
      state.goal = model.goal;
      state.theme = model.theme;
      state.activeDocumentId = getQueryParam("doc") ?? model.activeDocumentId;
      state.activeTab = model.studyTab;
      renderPanels();
      setActiveTab(state.activeTab);
      showToast("Backup imported into local storage.", elements.toastRegion);
    } catch (error) {
      console.error(error);
      showToast("Could not import that JSON backup.", elements.toastRegion);
    } finally {
      elements.backupImportInput.value = "";
    }
  }

  elements.openPdfButton.addEventListener("click", () => elements.pdfInput.click());
  elements.pdfInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void openPdf(file);
  });
  elements.exportNotesButton.addEventListener("click", () => {
    void exportNotes();
  });
  elements.exportBackupButton.addEventListener("click", async () => {
    const payload = await exportAppData();
    downloadBackupJson(payload);
    showToast("Full JSON backup downloaded.", elements.toastRegion);
  });
  elements.importBackupButton.addEventListener("click", () => elements.backupImportInput.click());
  elements.backupImportInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void importBackup(file);
  });
  elements.documentSelect.addEventListener("change", async (event) => {
    state.activeDocumentId = event.target.value || null;
    await persistActiveDocumentId(state.activeDocumentId);
    renderPanels();
  });
  elements.noteSearchInput.addEventListener("input", (event) => {
    state.noteFilters.search = event.target.value;
    renderPanels();
  });
  elements.noteFilterSelect.addEventListener("change", (event) => {
    state.noteFilters.type = event.target.value;
    renderPanels();
  });
  elements.glossarySearchInput.addEventListener("input", (event) => {
    state.glossaryQuery = event.target.value;
    renderPanels();
  });
  elements.goalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const targetPages = Math.max(1, Number(elements.dailyGoalInput.value) || DEFAULT_DAILY_GOAL);
    state.goal = normalizeGoal({
      id: "pages-per-day",
      targetPages,
      updatedAt: new Date().toISOString(),
    });
    await saveGoal(state.goal);
    renderPanels();
    showToast(`Daily goal set to ${targetPages} pages.`, elements.toastRegion);
  });

  elements.notesList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-delete-note]");

    if (!trigger) {
      return;
    }

    const noteId = trigger.dataset.deleteNote;
    const confirmed = window.confirm("Delete this note from local storage?");

    if (!confirmed) {
      return;
    }

    void deleteNote(noteId).then(() => {
      state.notes = removeRecord(state.notes, noteId);
      renderPanels();
      showToast("Note deleted.", elements.toastRegion);
    });
  });

  elements.recentDocumentsList.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-open-document]");

    if (!trigger) {
      return;
    }

    state.activeDocumentId = trigger.dataset.openDocument;
    await persistActiveDocumentId(state.activeDocumentId);
    renderPanels();
  });

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  }

  elements.flashcardPreviousButton.addEventListener("click", () => {
    const cards = buildFlashcards(currentDocumentNotes());

    if (!cards.length) {
      return;
    }

    state.flashcardIndex = (state.flashcardIndex - 1 + cards.length) % cards.length;
    state.flashcardBackVisible = false;
    renderPanels();
  });
  elements.flashcardNextButton.addEventListener("click", () => {
    const cards = buildFlashcards(currentDocumentNotes());

    if (!cards.length) {
      return;
    }

    state.flashcardIndex = (state.flashcardIndex + 1) % cards.length;
    state.flashcardBackVisible = false;
    renderPanels();
  });
  elements.flashcardFlipButton.addEventListener("click", () => {
    state.flashcardBackVisible = !state.flashcardBackVisible;
    renderPanels();
  });

  for (const button of elements.themeButtons) {
    button.addEventListener("click", async () => {
      state.theme = button.dataset.themeChoice;
      applyTheme(state.theme, elements.themeButtons);
      await persistTheme(state.theme);
    });
  }

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
  state.activeTab = model.studyTab;

  applyTheme(state.theme, elements.themeButtons);
  setActiveTab(state.activeTab);
  renderPanels();
  setStatus(elements.appStatus, "Ready.");
}
