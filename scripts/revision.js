import { NOTE_TYPE_META } from "./notes.js";

function extractTerm(note) {
  if (note.selectedText?.trim()) {
    return note.selectedText.trim();
  }

  const content = note.content.trim();
  const firstLine = content.split("\n").find(Boolean) ?? "";

  if (firstLine.includes(":")) {
    return firstLine.split(":")[0].trim();
  }

  const words = firstLine.split(/\s+/).slice(0, 8).join(" ");
  return words || `Page ${note.page} ${NOTE_TYPE_META[note.type]?.label ?? "Note"}`;
}

export function buildFlashcards(notes) {
  return notes
    .filter((note) => note.content?.trim())
    .map((note) => ({
      id: note.id,
      type: note.type,
      page: note.page,
      front:
        note.type === "question" && note.content.trim().endsWith("?")
          ? note.content.trim()
          : extractTerm(note),
      back: note.content.trim(),
    }));
}

export function buildGlossary(notes, query = "") {
  const normalizedQuery = query.trim().toLowerCase();

  return notes
    .filter((note) => note.type === "definition" && note.content.trim())
    .map((note) => ({
      id: note.id,
      term: extractTerm(note),
      definition: note.content.trim(),
      page: note.page,
    }))
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }

      return `${entry.term} ${entry.definition}`.toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => left.term.localeCompare(right.term));
}
