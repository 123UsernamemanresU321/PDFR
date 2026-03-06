export const NOTE_TYPES = ["definition", "highlight", "quote", "exam point", "question"];

export const NOTE_TYPE_META = {
  definition: {
    label: "Definition",
  },
  highlight: {
    label: "Highlight",
  },
  quote: {
    label: "Quote",
  },
  "exam point": {
    label: "Exam point",
  },
  question: {
    label: "Question",
  },
};

export function createNoteRecord({
  documentId,
  page,
  type,
  content,
  selectedText = "",
  term = "",
  color = "",
}) {
  return {
    id: crypto.randomUUID(),
    documentId,
    page: Math.max(1, Number(page) || 1),
    type: NOTE_TYPES.includes(type) ? type : NOTE_TYPES[0],
    content: content.trim(),
    createdAt: new Date().toISOString(),
    selectedText: selectedText.trim(),
    term: term.trim(),
    color,
  };
}

export function sortNotes(left, right) {
  if (left.page !== right.page) {
    return left.page - right.page;
  }

  return new Date(right.createdAt) - new Date(left.createdAt);
}

export function getNotePreview(text, length = 140) {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim();

  if (trimmed.length <= length) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(24, length - 1)).trim()}…`;
}

export function filterNotes(notes, filters = {}) {
  const search = String(filters.search ?? "").trim().toLowerCase();
  const type = filters.type ?? "all";

  return [...notes]
    .filter((note) => {
      if (type !== "all" && note.type !== type) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = [note.content, note.selectedText, note.term, note.type, String(note.page)]
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    })
    .sort(sortNotes);
}

export function countNotesByType(notes) {
  return NOTE_TYPES.reduce((counts, type) => {
    counts[type] = notes.filter((note) => note.type === type).length;
    return counts;
  }, {});
}
