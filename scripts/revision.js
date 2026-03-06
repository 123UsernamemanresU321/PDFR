import { extractDefinitionTerm, getNoteType } from "./notes.js";

export function createFlashcardId(noteId) {
  return `flashcard:${noteId}`;
}

export function shouldCreateFlashcard(note) {
  return Boolean(note?.content?.trim());
}

export function buildFlashcardFromNote(note, documentsById) {
  const documentName = documentsById.get(note.documentId)?.name || "Untitled document";
  const type = getNoteType(note.type);
  let front = "";
  let back = note.content;

  if (note.type === "definition") {
    front = `What does "${extractDefinitionTerm(note)}" mean?`;
    back = note.content;
  } else if (note.type === "question") {
    front = note.content;
    back = note.selectedText || `Return to page ${note.page} in ${documentName}.`;
  } else if (note.type === "quote") {
    front = note.selectedText || note.content.slice(0, 140);
    back = note.content;
  } else {
    front = note.selectedText || `Why is this exam point important on page ${note.page}?`;
    back = note.content;
  }

  return {
    id: createFlashcardId(note.id),
    noteId: note.id,
    documentId: note.documentId,
    type: type.id,
    title: type.label,
    front,
    back,
    page: note.page,
    documentName,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    dueAt: new Date().toISOString(),
    intervalMs: 0,
    repetitions: 0,
    lastGrade: null,
    lastReviewedAt: null,
  };
}

export function synchronizeFlashcards(notes, flashcards, documentsById) {
  const existingByNoteId = new Map(flashcards.map((flashcard) => [flashcard.noteId, flashcard]));
  const upserts = [];

  notes.filter(shouldCreateFlashcard).forEach((note) => {
    const next = buildFlashcardFromNote(note, documentsById);
    const existing = existingByNoteId.get(note.id);

    if (!existing) {
      upserts.push(next);
      return;
    }

    if (existing.front !== next.front || existing.back !== next.back || existing.page !== next.page) {
      upserts.push({
        ...existing,
        ...next,
        dueAt: existing.dueAt,
        intervalMs: existing.intervalMs,
        repetitions: existing.repetitions,
        lastGrade: existing.lastGrade,
        lastReviewedAt: existing.lastReviewedAt,
      });
    }
  });

  return upserts;
}

export function buildRevisionDeck(notes, flashcards) {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const now = Date.now();

  const available = flashcards
    .filter((flashcard) => notesById.has(flashcard.noteId))
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());

  const due = available.filter((flashcard) => new Date(flashcard.dueAt).getTime() <= now);
  return due.length ? due : available;
}

export function reviewFlashcard(flashcard, grade) {
  const now = Date.now();
  const intervals = {
    hard: 60_000,
    good: Math.max(10 * 60_000, flashcard.intervalMs ? flashcard.intervalMs * 2 : 0),
    easy: Math.max(4 * 24 * 60 * 60_000, flashcard.intervalMs ? flashcard.intervalMs * 4 : 0),
  };

  const intervalMs = intervals[grade] ?? intervals.good;
  return {
    ...flashcard,
    intervalMs,
    repetitions: (flashcard.repetitions || 0) + 1,
    lastGrade: grade,
    lastReviewedAt: new Date(now).toISOString(),
    dueAt: new Date(now + intervalMs).toISOString(),
  };
}
