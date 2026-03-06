import { initStorage } from "./storage.js";
import { buildStudyStats, calculateGoalProgress, dayStamp } from "./goals.js";
import {
  applyTheme,
  buildRecentDocumentSummaries,
  cachePdfFile,
  formatTimestamp,
  loadAppModel,
  persistActiveDocumentId,
  persistTheme,
  readerHref,
  setStatus,
  showToast,
  studyHref,
} from "./common.js";

function renderRecentDocuments(target, documents) {
  if (!documents.length) {
    target.innerHTML = `
      <div class="revision-empty">No recent PDFs yet. Open one and it will be cached locally for quick return.</div>
    `;
    return;
  }

  target.innerHTML = documents
    .map(
      (documentRecord) => `
        <article class="recent-card">
          <button type="button" data-open-document="${documentRecord.id}">
            <strong>${documentRecord.name}</strong>
            <div class="recent-meta">
              <span class="subtle-copy">Page ${documentRecord.lastPage} / ${documentRecord.totalPages || "?"}</span>
              <span class="subtle-copy">${documentRecord.noteCount} note${documentRecord.noteCount === 1 ? "" : "s"}</span>
            </div>
            <span class="subtle-copy">Last opened ${formatTimestamp(documentRecord.lastOpened)}</span>
          </button>
        </article>
      `,
    )
    .join("");
}

export async function init() {
  const elements = {
    pdfInput: document.querySelector("#pdfFileInput"),
    openPdfButton: document.querySelector("#openPdfButton"),
    heroOpenPdfButton: document.querySelector("#heroOpenPdfButton"),
    continueReadingButton: document.querySelector("#continueReadingButton"),
    themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
    recentDocumentsList: document.querySelector("#recentDocumentsList"),
    heroStudyLink: document.querySelector("#heroStudyLink"),
    todayPagesValue: document.querySelector("#todayPagesValue"),
    todayPagesCopy: document.querySelector("#todayPagesCopy"),
    streakValue: document.querySelector("#streakValue"),
    streakCopy: document.querySelector("#streakCopy"),
    notesValue: document.querySelector("#notesValue"),
    notesCopy: document.querySelector("#notesCopy"),
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
  };

  function render() {
    applyTheme(state.theme, elements.themeButtons);

    const summaries = buildRecentDocumentSummaries(
      state.documents,
      state.progressRecords,
      state.notes,
      6,
    );
    renderRecentDocuments(elements.recentDocumentsList, summaries);

    const stats = buildStudyStats({
      pageVisits: state.pageVisits,
      sessions: state.sessions,
      notes: state.notes,
    });
    const goalProgress = calculateGoalProgress(
      state.goal.targetPages,
      state.pageVisits.filter((record) => record.date === dayStamp()).length,
    );

    elements.todayPagesValue.textContent = `${goalProgress.pagesToday} / ${goalProgress.target} pages`;
    elements.todayPagesCopy.textContent = goalProgress.copy;
    elements.streakValue.textContent = `${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`;
    elements.streakCopy.textContent = `${stats.totalSessions} session${stats.totalSessions === 1 ? "" : "s"} completed locally.`;
    elements.notesValue.textContent = `${stats.totalNotes} saved`;
    elements.notesCopy.textContent = "All note types remain searchable in the study page.";

    elements.heroStudyLink.href = studyHref(state.activeDocumentId);

    if (state.activeDocumentId) {
      elements.continueReadingButton.disabled = false;
      elements.continueReadingButton.textContent = "Continue";
    } else {
      elements.continueReadingButton.disabled = true;
      elements.continueReadingButton.textContent = "Continue";
    }
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
      setStatus(elements.appStatus, "Could not open that PDF.");
      showToast(error.message || "Could not open that PDF.", elements.toastRegion);
    } finally {
      elements.pdfInput.value = "";
    }
  }

  elements.openPdfButton.addEventListener("click", () => elements.pdfInput.click());
  elements.heroOpenPdfButton.addEventListener("click", () => elements.pdfInput.click());
  elements.continueReadingButton.addEventListener("click", () => {
    if (!state.activeDocumentId) {
      return;
    }

    window.location.href = readerHref(state.activeDocumentId);
  });
  elements.pdfInput.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void openPdf(file);
  });

  for (const button of elements.themeButtons) {
    button.addEventListener("click", async () => {
      state.theme = button.dataset.themeChoice;
      applyTheme(state.theme, elements.themeButtons);
      await persistTheme(state.theme);
    });
  }

  elements.recentDocumentsList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-document]");

    if (!trigger) {
      return;
    }

    const documentId = trigger.dataset.openDocument;
    window.location.href = readerHref(documentId);
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
  state.activeDocumentId = model.activeDocumentId;

  render();
  setStatus(elements.appStatus, "Ready.");
}
