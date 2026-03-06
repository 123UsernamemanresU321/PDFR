export const NOTE_TYPES = [
  { id: "definition", label: "Definition", color: "#3b82f6" },
  { id: "quote", label: "Quote", color: "#eab308" },
  { id: "exam-point", label: "Exam Point", color: "#ef4444" },
  { id: "question", label: "Question", color: "#a855f7" },
];

export const DEFAULT_NOTE_TYPE = "definition";

export function getNoteType(typeId) {
  return NOTE_TYPES.find((type) => type.id === typeId) || NOTE_TYPES[0];
}

export function createNote({
  documentId,
  page,
  type,
  content,
  selectedText = "",
  selectionRects = [],
  color = "",
}) {
  return {
    id: crypto.randomUUID(),
    documentId,
    page,
    type,
    content: content.trim(),
    selectedText: selectedText.trim(),
    selectionRects: Array.isArray(selectionRects) ? selectionRects : [],
    color,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function sortNotes(notes) {
  return [...notes].sort((left, right) => right.createdAt - left.createdAt);
}

export function filterNotes(notes, { documentId = "all", type = "all", query = "" } = {}) {
  const normalizedQuery = query.trim().toLowerCase();

  return sortNotes(notes).filter((note) => {
    if (documentId !== "all" && note.documentId !== documentId) {
      return false;
    }

    if (type !== "all" && note.type !== type) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [note.content, note.selectedText, String(note.page), note.type]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

export function groupNotesByDocumentAndPage(notes, documentsById) {
  const groups = new Map();

  sortNotes(notes)
    .slice()
    .sort((left, right) => left.page - right.page || right.createdAt - left.createdAt)
    .forEach((note) => {
      const documentName = documentsById.get(note.documentId)?.name || "Untitled document";
      const key = `${documentName}::${note.page}`;
      if (!groups.has(key)) {
        groups.set(key, { title: `Page ${note.page}`, subtitle: documentName, notes: [] });
      }
      groups.get(key).notes.push(note);
    });

  return [...groups.values()];
}

export function countNotesByType(notes) {
  const counts = NOTE_TYPES.reduce((accumulator, type) => {
    accumulator[type.id] = 0;
    return accumulator;
  }, {});

  notes.forEach((note) => {
    counts[note.type] = (counts[note.type] || 0) + 1;
  });

  return counts;
}

export function formatRelativeDate(timestamp) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function extractDefinitionTerm(note) {
  if (note.selectedText?.trim()) {
    return note.selectedText.trim().replace(/^["“”]+|["“”]+$/g, "");
  }

  const firstLine = note.content.split(/\n+/)[0].trim();
  if (!firstLine) {
    return `Page ${note.page}`;
  }

  const shortMatch = firstLine.match(/^([A-Za-z0-9\- ]{2,40})(?:[:\-]|$)/);
  if (shortMatch) {
    return shortMatch[1].trim();
  }

  return firstLine.split(/\s+/).slice(0, 5).join(" ");
}

export function buildGlossaryEntries(notes, documentsById) {
  return notes
    .filter((note) => note.type === "definition")
    .map((note) => ({
      id: note.id,
      term: extractDefinitionTerm(note),
      definition: note.content,
      page: note.page,
      documentId: note.documentId,
      documentName: documentsById.get(note.documentId)?.name || "Untitled document",
      sourceSnippet: note.selectedText,
      createdAt: note.createdAt,
    }))
    .sort((left, right) => left.term.localeCompare(right.term));
}

function escapeMarkdown(value) {
  return String(value).replace(/[\\`*_{}[\]()#+-.!|>]/g, "\\$&");
}

export function buildMarkdownExport(documentsById, notes, { documentId = "all" } = {}) {
  const filtered = filterNotes(notes, { documentId, type: "all", query: "" }).sort(
    (left, right) => left.page - right.page || left.createdAt - right.createdAt,
  );

  if (!filtered.length) {
    return "# PDF Reading Companion Notes\n\nNo notes available.\n";
  }

  const documentGroups = new Map();
  filtered.forEach((note) => {
    if (!documentGroups.has(note.documentId)) {
      documentGroups.set(note.documentId, []);
    }
    documentGroups.get(note.documentId).push(note);
  });

  const lines = ["# PDF Reading Companion Notes", "", `Generated: ${new Date().toISOString()}`, ""];

  documentGroups.forEach((documentNotes, currentDocumentId) => {
    const documentRecord = documentsById.get(currentDocumentId);
    lines.push(`## ${escapeMarkdown(documentRecord?.name || "Untitled document")}`);
    lines.push("");

    const pageGroups = new Map();
    documentNotes.forEach((note) => {
      if (!pageGroups.has(note.page)) {
        pageGroups.set(note.page, []);
      }
      pageGroups.get(note.page).push(note);
    });

    [...pageGroups.entries()].forEach(([page, pageNotes]) => {
      lines.push(`### Page ${page}`);
      lines.push("");

      pageNotes.forEach((note) => {
        const type = getNoteType(note.type);
        lines.push(`#### ${type.label}`);
        lines.push("");
        if (note.selectedText) {
          lines.push(`> ${note.selectedText.split("\n").join("\n> ")}`);
          lines.push("");
        }
        lines.push(note.content);
        lines.push("");
        lines.push(`_Saved ${formatRelativeDate(note.createdAt)}_`);
        lines.push("");
      });
    });
  });

  return lines.join("\n");
}
