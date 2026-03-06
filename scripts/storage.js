const DB_NAME = "pdf-reading-companion";
const DB_VERSION = 1;

export const STORE_NAMES = [
  "documents",
  "progress",
  "notes",
  "settings",
  "sessions",
  "goals",
  "stats",
];

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
  });
}

function createStores(database) {
  if (!database.objectStoreNames.contains("documents")) {
    const store = database.createObjectStore("documents", { keyPath: "id" });
    store.createIndex("lastOpened", "lastOpened", { unique: false });
    store.createIndex("name", "name", { unique: false });
  }

  if (!database.objectStoreNames.contains("progress")) {
    const store = database.createObjectStore("progress", { keyPath: "documentId" });
    store.createIndex("lastOpened", "lastOpened", { unique: false });
  }

  if (!database.objectStoreNames.contains("notes")) {
    const store = database.createObjectStore("notes", { keyPath: "id" });
    store.createIndex("documentId", "documentId", { unique: false });
    store.createIndex("page", "page", { unique: false });
    store.createIndex("type", "type", { unique: false });
    store.createIndex("createdAt", "createdAt", { unique: false });
  }

  if (!database.objectStoreNames.contains("settings")) {
    database.createObjectStore("settings", { keyPath: "id" });
  }

  if (!database.objectStoreNames.contains("sessions")) {
    const store = database.createObjectStore("sessions", { keyPath: "id" });
    store.createIndex("documentId", "documentId", { unique: false });
    store.createIndex("startedAt", "startedAt", { unique: false });
  }

  if (!database.objectStoreNames.contains("goals")) {
    database.createObjectStore("goals", { keyPath: "id" });
  }

  if (!database.objectStoreNames.contains("stats")) {
    const store = database.createObjectStore("stats", { keyPath: "id" });
    store.createIndex("type", "type", { unique: false });
    store.createIndex("date", "date", { unique: false });
    store.createIndex("documentId", "documentId", { unique: false });
  }
}

export function initStorage() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support IndexedDB."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      createStores(request.result);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
  });

  return dbPromise;
}

async function getDatabase() {
  return initStorage();
}

async function getAllRecords(storeName) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const records = await requestToPromise(store.getAll());
  await transactionDone(transaction);
  return records;
}

async function getRecord(storeName, key) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const record = await requestToPromise(store.get(key));
  await transactionDone(transaction);
  return record;
}

async function putRecord(storeName, value) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  await requestToPromise(store.put(value));
  await transactionDone(transaction);
  return value;
}

async function deleteRecord(storeName, key) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  await requestToPromise(store.delete(key));
  await transactionDone(transaction);
}

async function clearStore(storeName) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  await requestToPromise(store.clear());
  await transactionDone(transaction);
}

async function getRecordsByIndex(storeName, indexName, value) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const records = await requestToPromise(store.index(indexName).getAll(value));
  await transactionDone(transaction);
  return records;
}

export function getAllFromStore(storeName) {
  return getAllRecords(storeName);
}

export function getDocument(id) {
  return getRecord("documents", id);
}

export function saveDocument(documentRecord) {
  return putRecord("documents", documentRecord);
}

export async function getRecentDocuments(limit = 12) {
  const documents = await getAllRecords("documents");
  return documents
    .sort((left, right) => new Date(right.lastOpened ?? 0) - new Date(left.lastOpened ?? 0))
    .slice(0, limit);
}

export function getProgress(documentId) {
  return getRecord("progress", documentId);
}

export function getAllProgress() {
  return getAllRecords("progress");
}

export function saveProgress(progressRecord) {
  return putRecord("progress", progressRecord);
}

export function getNotes(documentId = null) {
  if (documentId) {
    return getRecordsByIndex("notes", "documentId", documentId);
  }

  return getAllRecords("notes");
}

export function saveNote(noteRecord) {
  return putRecord("notes", noteRecord);
}

export function deleteNote(noteId) {
  return deleteRecord("notes", noteId);
}

export function getSetting(settingId) {
  return getRecord("settings", settingId);
}

export function getAllSettings() {
  return getAllRecords("settings");
}

export function saveSetting(settingId, value) {
  return putRecord("settings", {
    id: settingId,
    value,
    updatedAt: new Date().toISOString(),
  });
}

export function deleteSetting(settingId) {
  return deleteRecord("settings", settingId);
}

export function getGoal(goalId) {
  return getRecord("goals", goalId);
}

export function getGoals() {
  return getAllRecords("goals");
}

export function saveGoal(goalRecord) {
  return putRecord("goals", goalRecord);
}

export function getSessions(documentId = null) {
  if (documentId) {
    return getRecordsByIndex("sessions", "documentId", documentId);
  }

  return getAllRecords("sessions");
}

export function saveSession(sessionRecord) {
  return putRecord("sessions", sessionRecord);
}

export function getStats() {
  return getAllRecords("stats");
}

export function saveStat(statRecord) {
  return putRecord("stats", statRecord);
}

export async function clearAllData() {
  for (const storeName of STORE_NAMES) {
    await clearStore(storeName);
  }
}

export async function exportAppData() {
  const data = {};

  for (const storeName of STORE_NAMES) {
    data[storeName] = await getAllRecords(storeName);
  }

  return data;
}

export async function importAppData(payload, options = {}) {
  const source = payload?.data ?? payload;
  const replace = Boolean(options.replace);

  if (!source || typeof source !== "object") {
    throw new Error("Backup data is missing or invalid.");
  }

  for (const storeName of STORE_NAMES) {
    if (replace) {
      await clearStore(storeName);
    }

    const records = Array.isArray(source[storeName]) ? source[storeName] : [];

    for (const record of records) {
      await putRecord(storeName, record);
    }
  }
}
