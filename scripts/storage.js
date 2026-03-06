const DB_NAME = "pdf-reading-companion";
const DB_VERSION = 1;

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction, result) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function createStore(database, name, options, indexes = []) {
  if (database.objectStoreNames.contains(name)) {
    return null;
  }

  const store = database.createObjectStore(name, options);
  indexes.forEach(([indexName, keyPath, config]) => store.createIndex(indexName, keyPath, config));
  return store;
}

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      createStore(database, "documents", { keyPath: "id" }, [
        ["byFingerprint", "fingerprint", { unique: true }],
        ["byLastOpened", "lastOpened", { unique: false }],
      ]);
      createStore(database, "progress", { keyPath: "documentId" }, [["byUpdatedAt", "updatedAt", { unique: false }]]);
      createStore(database, "notes", { keyPath: "id" }, [
        ["byDocumentId", "documentId", { unique: false }],
        ["byCreatedAt", "createdAt", { unique: false }],
        ["byType", "type", { unique: false }],
      ]);
      createStore(database, "settings", { keyPath: "key" });
      createStore(database, "sessions", { keyPath: "id" }, [
        ["byDocumentId", "documentId", { unique: false }],
        ["byStartedAt", "startedAt", { unique: false }],
        ["byDay", "dayKey", { unique: false }],
      ]);
      createStore(database, "goals", { keyPath: "id" });
      createStore(database, "stats", { keyPath: "date" });
      createStore(database, "flashcards", { keyPath: "id" }, [
        ["byNoteId", "noteId", { unique: true }],
        ["byDueAt", "dueAt", { unique: false }],
      ]);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

async function withTransaction(storeNames, mode, callback) {
  const database = await openDatabase();
  const transaction = database.transaction(storeNames, mode);
  const stores = Object.fromEntries(
    storeNames.map((storeName) => [storeName, transaction.objectStore(storeName)]),
  );
  const result = await callback(stores, transaction);
  return transactionDone(transaction, result);
}

async function getAll(storeName) {
  return withTransaction([storeName], "readonly", ({ [storeName]: store }) => requestToPromise(store.getAll()));
}

async function getByKey(storeName, key) {
  return withTransaction([storeName], "readonly", ({ [storeName]: store }) => requestToPromise(store.get(key)));
}

async function putRecord(storeName, value) {
  return withTransaction([storeName], "readwrite", ({ [storeName]: store }) => requestToPromise(store.put(value)));
}

async function deleteRecord(storeName, key) {
  return withTransaction([storeName], "readwrite", ({ [storeName]: store }) => requestToPromise(store.delete(key)));
}

async function clearStore(storeName) {
  return withTransaction([storeName], "readwrite", ({ [storeName]: store }) => requestToPromise(store.clear()));
}

async function getFromIndex(storeName, indexName, value) {
  return withTransaction([storeName], "readonly", ({ [storeName]: store }) =>
    requestToPromise(store.index(indexName).get(value)),
  );
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const [, base64] = String(reader.result).split(",", 2);
      resolve(base64 || null);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to convert blob to base64"));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type = "application/pdf") {
  if (!base64) {
    return null;
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type });
}

export async function loadAllData() {
  const [documents, progress, notes, settingsRecords, sessions, goals, stats, flashcards] = await Promise.all([
    getAll("documents"),
    getAll("progress"),
    getAll("notes"),
    getAll("settings"),
    getAll("sessions"),
    getAll("goals"),
    getAll("stats"),
    getAll("flashcards"),
  ]);

  const settings = settingsRecords.reduce((accumulator, record) => {
    accumulator[record.key] = record.value;
    return accumulator;
  }, {});

  return { documents, progress, notes, settings, sessions, goals, stats, flashcards };
}

export async function getDocumentById(documentId) {
  return getByKey("documents", documentId);
}

export async function getDocumentByFingerprint(fingerprint) {
  return getFromIndex("documents", "byFingerprint", fingerprint);
}

export async function saveDocument(documentRecord) {
  await putRecord("documents", documentRecord);
  return documentRecord;
}

export async function deleteDocument(documentId) {
  await withTransaction(["documents", "progress", "notes", "sessions", "flashcards"], "readwrite", async (stores) => {
    stores.documents.delete(documentId);
    stores.progress.delete(documentId);

    const notesIndex = stores.notes.index("byDocumentId");
    const sessionsIndex = stores.sessions.index("byDocumentId");
    const notes = await requestToPromise(notesIndex.getAll(documentId));
    const sessions = await requestToPromise(sessionsIndex.getAll(documentId));

    notes.forEach((note) => {
      stores.notes.delete(note.id);
      stores.flashcards.delete(`flashcard:${note.id}`);
    });

    sessions.forEach((session) => stores.sessions.delete(session.id));
  });
}

export async function getRecentDocuments(limit = 8) {
  const documents = await getAll("documents");
  return documents.sort((left, right) => right.lastOpened - left.lastOpened).slice(0, limit);
}

export async function saveProgress(progressRecord) {
  await putRecord("progress", progressRecord);
  return progressRecord;
}

export async function getProgress(documentId) {
  return getByKey("progress", documentId);
}

export async function saveNote(note) {
  await putRecord("notes", note);
  return note;
}

export async function deleteNote(noteId) {
  await withTransaction(["notes", "flashcards"], "readwrite", ({ notes, flashcards }) => {
    notes.delete(noteId);
    flashcards.delete(`flashcard:${noteId}`);
  });
}

export async function saveSetting(key, value) {
  await putRecord("settings", { key, value, updatedAt: Date.now() });
}

export async function saveGoal(goalRecord) {
  await putRecord("goals", goalRecord);
  return goalRecord;
}

export async function getGoal(goalId) {
  return getByKey("goals", goalId);
}

export async function saveSession(sessionRecord) {
  await putRecord("sessions", sessionRecord);
  return sessionRecord;
}

export async function saveFlashcard(flashcard) {
  await putRecord("flashcards", flashcard);
  return flashcard;
}

export async function deleteFlashcard(flashcardId) {
  await deleteRecord("flashcards", flashcardId);
}

export async function getFlashcardByNoteId(noteId) {
  return getFromIndex("flashcards", "byNoteId", noteId);
}

export async function recordDailyPageVisit({ documentId, page, visitedAt = Date.now() }) {
  const date = new Date(visitedAt);
  const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  const pageKey = `${documentId}:${page}`;

  return withTransaction(["stats"], "readwrite", async ({ stats }) => {
    const existing = (await requestToPromise(stats.get(dayKey))) || {
      date: dayKey,
      pageKeys: [],
      documents: [],
      sessionCount: 0,
      totalSessionMs: 0,
    };

    if (!existing.pageKeys.includes(pageKey)) {
      existing.pageKeys = [...existing.pageKeys, pageKey];
    }

    if (!existing.documents.includes(documentId)) {
      existing.documents = [...existing.documents, documentId];
    }

    existing.updatedAt = Date.now();
    stats.put(existing);
    return existing;
  });
}

export async function recordSessionSummary(sessionRecord) {
  const dayKey = sessionRecord.dayKey;
  return withTransaction(["stats"], "readwrite", async ({ stats }) => {
    const existing = (await requestToPromise(stats.get(dayKey))) || {
      date: dayKey,
      pageKeys: [],
      documents: [],
      sessionCount: 0,
      totalSessionMs: 0,
    };

    existing.sessionCount += 1;
    existing.totalSessionMs += sessionRecord.durationMs || 0;
    if (sessionRecord.documentId && !existing.documents.includes(sessionRecord.documentId)) {
      existing.documents = [...existing.documents, sessionRecord.documentId];
    }
    existing.updatedAt = Date.now();
    stats.put(existing);
    return existing;
  });
}

export async function exportBackupBundle() {
  const snapshot = await loadAllData();
  const documents = await Promise.all(
    snapshot.documents.map(async (documentRecord) => ({
      ...documentRecord,
      fileData: await blobToBase64(documentRecord.fileData),
    })),
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      documents,
      progress: snapshot.progress,
      notes: snapshot.notes,
      settings: Object.entries(snapshot.settings).map(([key, value]) => ({ key, value })),
      sessions: snapshot.sessions,
      goals: snapshot.goals,
      stats: snapshot.stats,
      flashcards: snapshot.flashcards,
    },
  };
}

export async function importBackupBundle(bundle, { replaceExisting = true } = {}) {
  if (!bundle || typeof bundle !== "object" || !bundle.data) {
    throw new Error("Invalid backup format");
  }

  const documents = await Promise.all(
    (bundle.data.documents || []).map(async (documentRecord) => ({
      ...documentRecord,
      fileData: base64ToBlob(documentRecord.fileData, documentRecord.type || "application/pdf"),
    })),
  );

  if (replaceExisting) {
    await Promise.all(
      ["documents", "progress", "notes", "settings", "sessions", "goals", "stats", "flashcards"].map(clearStore),
    );
  }

  await withTransaction(
    ["documents", "progress", "notes", "settings", "sessions", "goals", "stats", "flashcards"],
    "readwrite",
    ({ documents: docsStore, progress, notes, settings, sessions, goals, stats, flashcards }) => {
      documents.forEach((record) => docsStore.put(record));
      (bundle.data.progress || []).forEach((record) => progress.put(record));
      (bundle.data.notes || []).forEach((record) => notes.put(record));
      (bundle.data.settings || []).forEach((record) => settings.put(record));
      (bundle.data.sessions || []).forEach((record) => sessions.put(record));
      (bundle.data.goals || []).forEach((record) => goals.put(record));
      (bundle.data.stats || []).forEach((record) => stats.put(record));
      (bundle.data.flashcards || []).forEach((record) => flashcards.put(record));
    },
  );
}

export async function clearAllData() {
  await Promise.all(
    ["documents", "progress", "notes", "settings", "sessions", "goals", "stats", "flashcards"].map(clearStore),
  );
}
