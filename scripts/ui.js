import { NOTE_TYPE_META, getNotePreview } from "./notes.js";
import { formatStudyTime } from "./goals.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  return new Date(value).toLocaleString();
}

export function getElements() {
  return {
    root: document.documentElement,
    pdfInput: document.querySelector("#pdfFileInput"),
    backupImportInput: document.querySelector("#backupImportInput"),
    openPdfButton: document.querySelector("#openPdfButton"),
    openPdfEmptyButton: document.querySelector("#openPdfEmptyButton"),
    focusShortcutsButton: document.querySelector("#focusShortcutsButton"),
    commandPaletteButton: document.querySelector("#commandPaletteButton"),
    exportNotesButton: document.querySelector("#exportNotesButton"),
    exportBackupButton: document.querySelector("#exportBackupButton"),
    importBackupButton: document.querySelector("#importBackupButton"),
    themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
    documentBadge: document.querySelector("#documentBadge"),
    documentTitle: document.querySelector("#documentTitle"),
    documentMeta: document.querySelector("#documentMeta"),
    headerProgressValue: document.querySelector("#headerProgressValue"),
    headerProgressCopy: document.querySelector("#headerProgressCopy"),
    headerGoalValue: document.querySelector("#headerGoalValue"),
    headerGoalCopy: document.querySelector("#headerGoalCopy"),
    headerSessionValue: document.querySelector("#headerSessionValue"),
    headerSessionCopy: document.querySelector("#headerSessionCopy"),
    previousPageButton: document.querySelector("#previousPageButton"),
    nextPageButton: document.querySelector("#nextPageButton"),
    pageNumberInput: document.querySelector("#pageNumberInput"),
    pageTotalLabel: document.querySelector("#pageTotalLabel"),
    zoomOutButton: document.querySelector("#zoomOutButton"),
    resetZoomButton: document.querySelector("#resetZoomButton"),
    zoomInButton: document.querySelector("#zoomInButton"),
    zoomLabel: document.querySelector("#zoomLabel"),
    readerStage: document.querySelector(".reader-stage"),
    viewerLoading: document.querySelector("#viewerLoading"),
    emptyState: document.querySelector("#emptyState"),
    canvasViewport: document.querySelector("#canvasViewport"),
    pdfCanvas: document.querySelector("#pdfCanvas"),
    progressLabel: document.querySelector("#progressLabel"),
    progressSubLabel: document.querySelector("#progressSubLabel"),
    progressBar: document.querySelector("#progressBar"),
    helperPanel: document.querySelector("#helperPanel"),
    dismissHelperButton: document.querySelector("#dismissHelperButton"),
    sessionTimerValue: document.querySelector("#sessionTimerValue"),
    sessionTimerMeta: document.querySelector("#sessionTimerMeta"),
    timerStartPauseButton: document.querySelector("#timerStartPauseButton"),
    timerResetButton: document.querySelector("#timerResetButton"),
    goalForm: document.querySelector("#goalForm"),
    dailyGoalInput: document.querySelector("#dailyGoalInput"),
    goalFeedback: document.querySelector("#goalFeedback"),
    goalProgressBar: document.querySelector("#goalProgressBar"),
    tabButtons: [...document.querySelectorAll("[data-tab]")],
    notesPanel: document.querySelector("#notesPanel"),
    glossaryPanel: document.querySelector("#glossaryPanel"),
    revisionPanel: document.querySelector("#revisionPanel"),
    statsPanel: document.querySelector("#statsPanel"),
    newNoteButton: document.querySelector("#newNoteButton"),
    noteForm: document.querySelector("#noteForm"),
    notePageInput: document.querySelector("#notePageInput"),
    noteTypeSelect: document.querySelector("#noteTypeSelect"),
    noteSnippetInput: document.querySelector("#noteSnippetInput"),
    noteContentInput: document.querySelector("#noteContentInput"),
    noteAutosaveHint: document.querySelector("#noteAutosaveHint"),
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
    recentDocumentsList: document.querySelector("#recentDocumentsList"),
    commandPalette: document.querySelector("#commandPalette"),
    closeCommandPaletteButton: document.querySelector("#closeCommandPaletteButton"),
    commandSearchInput: document.querySelector("#commandSearchInput"),
    commandList: document.querySelector("#commandList"),
    toastRegion: document.querySelector("#toastRegion"),
    appStatus: document.querySelector("#appStatus"),
  };
}

export function setTheme(elements, theme) {
  elements.root.setAttribute("data-theme", theme);

  for (const button of elements.themeButtons) {
    button.classList.toggle("is-active", button.dataset.themeChoice === theme);
  }
}

export function setSidebarTab(elements, tabName) {
  for (const button of elements.tabButtons) {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  }

  elements.notesPanel.hidden = tabName !== "notes";
  elements.glossaryPanel.hidden = tabName !== "glossary";
  elements.revisionPanel.hidden = tabName !== "revision";
  elements.statsPanel.hidden = tabName !== "stats";
}

export function setLoading(elements, isLoading, message = "Loading…") {
  elements.viewerLoading.hidden = !isLoading;
  elements.viewerLoading.textContent = message;
}

export function setHelperVisibility(elements, visible) {
  elements.helperPanel.hidden = !visible;
}

export function setStatus(elements, message) {
  elements.appStatus.textContent = message;
}

export function toggleCommandPalette(elements, isOpen) {
  elements.commandPalette.hidden = !isOpen;
  document.body.style.overflow = isOpen ? "hidden" : "";
}

export function showToast(elements, message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

export function renderNotesList(elements, notes, { activePage, hasDocument }) {
  if (!hasDocument) {
    elements.notesList.innerHTML = `
      <div class="revision-empty">Open a PDF to create page-linked notes.</div>
    `;
    return;
  }

  if (!notes.length) {
    elements.notesList.innerHTML = `
      <div class="revision-empty">No notes match the current filters yet.</div>
    `;
    return;
  }

  elements.notesList.innerHTML = notes
    .map((note) => {
      const isCurrentPage = note.page === activePage ? " is-current-page" : "";
      const snippet = note.selectedText?.trim()
        ? `<div class="note-snippet">${escapeHtml(note.selectedText)}</div>`
        : "";

      return `
        <article class="note-card${isCurrentPage}">
          <div class="note-meta">
            <span class="pill">${escapeHtml(NOTE_TYPE_META[note.type]?.label ?? note.type)}</span>
            <span class="subtle-copy">Page ${note.page}</span>
            <span class="subtle-copy">${escapeHtml(formatTimestamp(note.createdAt))}</span>
          </div>
          ${snippet}
          <div>${escapeHtml(getNotePreview(note.content, 220))}</div>
          <div class="note-actions">
            <button class="action-link" data-note-action="jump" data-note-id="${note.id}" type="button">Go to page</button>
            <button class="action-link" data-note-action="delete" data-note-id="${note.id}" type="button">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderGlossaryList(elements, entries, hasDocument) {
  if (!hasDocument) {
    elements.glossaryList.innerHTML = `
      <div class="revision-empty">Open a document to build a glossary from definition notes.</div>
    `;
    return;
  }

  if (!entries.length) {
    elements.glossaryList.innerHTML = `
      <div class="revision-empty">No definition notes match your glossary search.</div>
    `;
    return;
  }

  elements.glossaryList.innerHTML = entries
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

export function renderFlashcard(elements, payload) {
  const { cards, index, showBack } = payload;

  if (!cards.length) {
    elements.revisionEmptyState.hidden = false;
    elements.flashcard.hidden = true;
    elements.flashcardBackPanel.hidden = true;
    return;
  }

  const card = cards[index] ?? cards[0];
  elements.revisionEmptyState.hidden = true;
  elements.flashcard.hidden = false;
  elements.flashcardCounter.textContent = `Card ${index + 1} of ${cards.length}`;
  elements.flashcardTag.textContent = NOTE_TYPE_META[card.type]?.label ?? card.type;
  elements.flashcardFront.textContent = card.front;
  elements.flashcardBack.textContent = `${card.back} (page ${card.page})`;
  elements.flashcardBackPanel.hidden = !showBack;
  elements.flashcardFlipButton.textContent = showBack ? "Hide answer" : "Flip";
}

export function renderStats(elements, stats) {
  elements.statsGrid.innerHTML = `
    <article class="stats-card">
      <span class="metric-label">Pages read</span>
      <strong>${stats.totalPagesRead}</strong>
      <span class="subtle-copy">Unique page visits logged locally.</span>
    </article>
    <article class="stats-card">
      <span class="metric-label">Sessions</span>
      <strong>${stats.totalSessions}</strong>
      <span class="subtle-copy">Completed timer runs.</span>
    </article>
    <article class="stats-card">
      <span class="metric-label">Streak</span>
      <strong>${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}</strong>
      <span class="subtle-copy">Consecutive study days including today.</span>
    </article>
    <article class="stats-card">
      <span class="metric-label">Notes</span>
      <strong>${stats.totalNotes}</strong>
      <span class="subtle-copy">All saved notes across documents.</span>
    </article>
  `;

  const noteBreakdown = Object.entries(stats.noteCounts)
    .map(([type, count]) => `${NOTE_TYPE_META[type]?.label ?? type}: ${count}`)
    .join(" • ");

  elements.statsBreakdown.innerHTML = `
    <div class="stats-card">
      <span class="metric-label">Study time</span>
      <strong>${formatStudyTime(stats.totalStudyTimeMs)}</strong>
      <span class="subtle-copy">${stats.activeDays} active day${stats.activeDays === 1 ? "" : "s"} recorded.</span>
    </div>
    <div class="stats-card">
      <span class="metric-label">Notes by tag</span>
      <strong>${escapeHtml(noteBreakdown || "No notes yet")}</strong>
      <span class="subtle-copy">Useful for seeing what kind of thinking you capture most often.</span>
    </div>
  `;
}

export function renderRecentDocuments(elements, documents) {
  if (!documents.length) {
    elements.recentDocumentsList.innerHTML = `
      <div class="revision-empty">No recent documents yet. Open a PDF and it will appear here.</div>
    `;
    return;
  }

  elements.recentDocumentsList.innerHTML = documents
    .map(
      (documentRecord) => `
        <article class="recent-card">
          <button type="button" data-document-id="${documentRecord.id}">
            <strong>${escapeHtml(documentRecord.name)}</strong>
            <div class="recent-meta">
              <span class="subtle-copy">Page ${documentRecord.lastPage || 1} / ${documentRecord.totalPages || "?"}</span>
              <span class="subtle-copy">${documentRecord.noteCount} note${documentRecord.noteCount === 1 ? "" : "s"}</span>
            </div>
            <span class="subtle-copy">Last opened ${escapeHtml(formatTimestamp(documentRecord.lastOpened))}</span>
          </button>
        </article>
      `,
    )
    .join("");
}

export function renderCommandList(elements, commands, highlightedId = null) {
  if (!commands.length) {
    elements.commandList.innerHTML = `
      <div class="revision-empty">No matching quick actions.</div>
    `;
    return;
  }

  elements.commandList.innerHTML = commands
    .map(
      (command) => `
        <button
          class="command-item${command.id === highlightedId ? " is-highlighted" : ""}"
          type="button"
          data-command-id="${command.id}"
          ${command.disabled ? "disabled" : ""}
        >
          <span>
            <strong>${escapeHtml(command.label)}</strong><br>
            <span class="subtle-copy">${escapeHtml(command.description)}</span>
          </span>
          <span class="command-key">${escapeHtml(command.shortcut ?? "")}</span>
        </button>
      `,
    )
    .join("");
}
