import { NOTE_TYPES, formatRelativeDate, getNoteType } from "./notes.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emptyStateMarkup(title, message) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function renderTagChips(
  container,
  activeId,
  onSelect,
  { includeAll = true, allLabel = "All notes" } = {},
) {
  const items = includeAll ? [{ id: "all", label: allLabel, color: "transparent" }, ...NOTE_TYPES] : NOTE_TYPES;

  container.innerHTML = items
    .map(
      (item) => `
        <button class="chip ${item.id === activeId ? "is-active" : ""}" type="button" data-chip-id="${item.id}">
          ${item.color !== "transparent" ? `<span class="chip__dot" style="background:${item.color}"></span>` : ""}
          <span>${escapeHtml(item.label)}</span>
        </button>
      `,
    )
    .join("");

  container.querySelectorAll("[data-chip-id]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.chipId));
  });
}

export function renderRecentDocuments(container, documents, progressById, { onOpen, onDelete }) {
  if (!documents.length) {
    container.innerHTML = emptyStateMarkup(
      "No documents yet",
      "Open your first PDF to build a private reading library with stored progress and notes.",
    );
    return;
  }

  container.innerHTML = documents
    .map((documentRecord) => {
      const progress = progressById.get(documentRecord.id);
      const percent = progress?.percent ?? 0;
      return `
        <article class="recent-document">
          <div class="recent-document__header">
            <div>
              <h3 class="recent-document__title">${escapeHtml(documentRecord.name)}</h3>
              <p class="recent-document__meta">
                ${escapeHtml(
                  `${documentRecord.totalPages || "?"} pages · ${Math.round((documentRecord.size || 0) / 1024)} KB`,
                )}
              </p>
            </div>
            <span class="recent-document__meta">${escapeHtml(formatRelativeDate(documentRecord.lastOpened))}</span>
          </div>
          <div class="progress-bar" aria-hidden="true">
            <div class="progress-bar__fill" style="width:${percent}%"></div>
          </div>
          <div class="recent-document__footer">
            <span class="recent-document__meta">
              ${escapeHtml(`Page ${progress?.currentPage || 1} of ${documentRecord.totalPages || "?"}`)}
            </span>
            <div class="recent-document__actions">
              <button class="pill-button pill-button--secondary" type="button" data-open-document="${documentRecord.id}">
                Reopen
              </button>
              <button class="pill-button pill-button--secondary" type="button" data-delete-document="${documentRecord.id}">
                Remove
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-open-document]").forEach((button) =>
    button.addEventListener("click", () => onOpen(button.dataset.openDocument)),
  );
  container.querySelectorAll("[data-delete-document]").forEach((button) =>
    button.addEventListener("click", () => onDelete(button.dataset.deleteDocument)),
  );
}

function noteCardMarkup(note, { documentsById, showDocumentName = false, manager = false }) {
  const noteType = getNoteType(note.type);
  const noteLabel = note.type === "quote" && note.selectedText ? "Highlight" : noteType.label;
  const rootClass = manager ? "notes-manager-card" : "note-card";
  const createdAt = formatRelativeDate(note.createdAt);
  const documentLabel = showDocumentName ? documentsById.get(note.documentId)?.name || "Untitled document" : "";

  return `
    <article class="${rootClass} ${rootClass}--${escapeHtml(note.type)}">
      <div class="${rootClass}__header">
        <div>
          <div class="${rootClass}__type" style="color:${noteType.color}">
            <span class="chip__dot" style="background:${noteType.color}"></span>
            <span>${escapeHtml(noteLabel)}</span>
          </div>
          ${documentLabel ? `<div class="recent-document__meta" style="margin-top:0.35rem">${escapeHtml(documentLabel)}</div>` : ""}
        </div>
        <span class="${rootClass}__page">p. ${escapeHtml(note.page)}</span>
      </div>
      ${note.selectedText ? `<div class="${rootClass}__selected">${escapeHtml(note.selectedText)}</div>` : ""}
      <div class="${rootClass}__content">${escapeHtml(note.content).replace(/\n/g, "<br />")}</div>
      <div class="${rootClass}__footer">
        <span>${escapeHtml(createdAt)}</span>
        <div class="${rootClass}__actions">
          <button class="text-button" type="button" data-delete-note="${note.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

export function renderNoteList(
  container,
  notes,
  documentsById,
  { emptyTitle = "No notes yet", emptyMessage = "Start capturing ideas from the current page.", showDocumentName = false, onDelete },
) {
  if (!notes.length) {
    container.innerHTML = emptyStateMarkup(emptyTitle, emptyMessage);
    return;
  }

  container.innerHTML = notes
    .map((note) => noteCardMarkup(note, { documentsById, showDocumentName }))
    .join("");

  container.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", () => onDelete(button.dataset.deleteNote));
  });
}

export function renderNotesManagerList(container, groups, documentsById, { onDelete }) {
  if (!groups.length) {
    container.innerHTML = emptyStateMarkup("No notes match this filter", "Try another tag or search term.");
    return;
  }

  container.innerHTML = groups
    .map(
      (group) => `
        <section class="notes-manager-group">
          <div class="notes-manager-group__title">
            <h3>${escapeHtml(group.title)}</h3>
            <span class="recent-document__meta">${escapeHtml(group.subtitle)}</span>
          </div>
          ${group.notes.map((note) => noteCardMarkup(note, { documentsById, manager: true })).join("")}
        </section>
      `,
    )
    .join("");

  container.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", () => onDelete(button.dataset.deleteNote));
  });
}

export function renderGlossaryPreview(container, entries, { onOpen }) {
  const previewEntries = entries.slice(0, 4);

  if (!previewEntries.length) {
    container.innerHTML = emptyStateMarkup(
      "Definitions appear here",
      "Save a definition note and it will automatically join the glossary.",
    );
    return;
  }

  container.innerHTML = previewEntries
    .map(
      (entry) => `
        <button class="glossary-preview__item term-pill" type="button" data-open-term="${entry.id}">
          <div>
            <strong>${escapeHtml(entry.term)}</strong>
            <div class="recent-document__meta">${escapeHtml(`${entry.documentName} · p. ${entry.page}`)}</div>
          </div>
          <span class="recent-document__meta">View</span>
        </button>
      `,
    )
    .join("");

  container.querySelectorAll("[data-open-term]").forEach((button) => {
    button.addEventListener("click", () => onOpen(button.dataset.openTerm));
  });
}

export function renderGlossaryTerms(container, entries, selectedId, { onSelect }) {
  if (!entries.length) {
    container.innerHTML = emptyStateMarkup("Glossary is empty", "Definition notes will appear here automatically.");
    return;
  }

  container.innerHTML = entries
    .map(
      (entry) => `
        <button
          class="term-pill ${entry.id === selectedId ? "is-active" : ""}"
          type="button"
          data-glossary-id="${entry.id}"
        >
          <div>
            <strong>${escapeHtml(entry.term)}</strong>
            <div class="recent-document__meta">${escapeHtml(`p. ${entry.page}`)}</div>
          </div>
          <span class="recent-document__meta">${escapeHtml(entry.documentName)}</span>
        </button>
      `,
    )
    .join("");

  container.querySelectorAll("[data-glossary-id]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.glossaryId));
  });
}

export function renderGlossaryDetail(container, entry) {
  if (!entry) {
    container.innerHTML = emptyStateMarkup("Choose a term", "Select a definition from the glossary to inspect it.");
    return;
  }

  container.innerHTML = `
    <article class="glossary-detail">
      <div>
        <h2>${escapeHtml(entry.term)}</h2>
        <p class="glossary-detail__meta">${escapeHtml(`${entry.documentName} · Page ${entry.page}`)}</p>
      </div>
      <section>
        <p class="eyebrow">Definition</p>
        <div class="glossary-preview__item" style="margin-top:0.75rem">
          ${escapeHtml(entry.definition)}
        </div>
      </section>
      <section>
        <p class="eyebrow">Source snippet</p>
        <div class="glossary-detail__snippet" style="margin-top:0.75rem">
          ${escapeHtml(entry.sourceSnippet || "No quoted snippet captured for this note.")}
        </div>
      </section>
    </article>
  `;
}

export function renderThemePicker(container, activeTheme, onSelect) {
  const themes = [
    { id: "light", label: "Light", icon: "☀" },
    { id: "dark", label: "Dark", icon: "☾" },
    { id: "sepia", label: "Sepia", icon: "⌘" },
  ];

  container.innerHTML = themes
    .map(
      (theme) => `
        <button
          class="theme-option ${theme.id === activeTheme ? "is-active" : ""}"
          type="button"
          data-theme-id="${theme.id}"
        >
          <span class="theme-option__icon" aria-hidden="true">${theme.icon}</span>
          <span>${theme.label}</span>
        </button>
      `,
    )
    .join("");

  container.querySelectorAll("[data-theme-id]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.themeId));
  });
}

export function renderStats(gridEl, noteBreakdownEl, sessionListEl, statsSummary) {
  gridEl.innerHTML = statsSummary.cards
    .map(
      (card) => `
        <article class="stats-card">
          <span class="eyebrow">${escapeHtml(card.label)}</span>
          <div class="stats-card__value">${escapeHtml(card.value)}</div>
          <p class="stats-card__label">${escapeHtml(card.meta)}</p>
        </article>
      `,
    )
    .join("");

  noteBreakdownEl.innerHTML = `
    <div class="stats-bar">
      ${statsSummary.noteRows
        .map(
          (row) => `
            <div class="stats-row">
              <div class="stats-row__label">
                <strong>${escapeHtml(row.label)}</strong>
                <span class="stats-row__meta">${escapeHtml(row.value)}</span>
              </div>
              <div class="stats-row__track">
                <div class="stats-row__fill" style="width:${row.percent}%;background:${row.color}"></div>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;

  if (!statsSummary.sessions.length) {
    sessionListEl.innerHTML = emptyStateMarkup("No sessions yet", "Start the focus timer and finished sessions will appear here.");
    return;
  }

  sessionListEl.innerHTML = statsSummary.sessions
    .map(
      (session) => `
        <article class="glossary-preview__item">
          <strong>${escapeHtml(session.title)}</strong>
          <div class="recent-document__meta">${escapeHtml(session.meta)}</div>
        </article>
      `,
    )
    .join("");
}

export function renderCommandPalette(container, actions, activeIndex) {
  if (!actions.length) {
    container.innerHTML = emptyStateMarkup("No actions found", "Try a different keyword.");
    return;
  }

  container.innerHTML = actions
    .map(
      (action, index) => `
        <button class="command-item ${index === activeIndex ? "is-active" : ""}" type="button" data-command-id="${action.id}">
          <span class="command-item__title">${escapeHtml(action.title)}</span>
          <span class="command-item__description">${escapeHtml(action.description)}</span>
        </button>
      `,
    )
    .join("");
}

export function showToast(region, message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    window.setTimeout(() => toast.remove(), 180);
  }, 2600);
}
