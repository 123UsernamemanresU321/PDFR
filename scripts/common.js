import {
  getAllFromStore,
  getDocument,
  getAllProgress,
  getNotes,
  getSessions,
  getStats,
  getSetting,
  saveSetting,
  getGoal,
  saveDocument,
} from "./storage.js";
import { DAILY_GOAL_ID, DEFAULT_DAILY_GOAL, normalizeGoal } from "./goals.js";
import { sanitizeFilename } from "./export.js";

export const SETTING_KEYS = {
  theme: "theme",
  activeDocumentId: "active-document-id",
  activeTimer: "active-timer",
  readerHelperDismissed: "reader-helper-dismissed",
  studyTab: "study-tab",
};

export function sortByRecent(left, right) {
  return new Date(right.lastOpened ?? 0) - new Date(left.lastOpened ?? 0);
}

export function upsertRecord(list, record, key = "id") {
  const next = [...list];
  const index = next.findIndex((item) => item[key] === record[key]);

  if (index === -1) {
    next.push(record);
  } else {
    next[index] = {
      ...next[index],
      ...record,
    };
  }

  return next;
}

export function removeRecord(list, recordId, key = "id") {
  return list.filter((item) => item[key] !== recordId);
}

export function applyTheme(theme, themeButtons = []) {
  document.documentElement.setAttribute("data-theme", theme);

  for (const button of themeButtons) {
    button.classList.toggle("is-active", button.dataset.themeChoice === theme);
  }
}

export async function persistTheme(theme) {
  await saveSetting(SETTING_KEYS.theme, theme);
}

export async function persistActiveDocumentId(documentId) {
  await saveSetting(SETTING_KEYS.activeDocumentId, documentId);
}

export function formatBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function formatTimestamp(value) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

export function showToast(message, toastRegion) {
  if (!toastRegion) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function computeFingerprint(arrayBuffer, file) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch (_error) {
    return `${sanitizeFilename(file.name)}-${file.size}-${file.lastModified ?? 0}`;
  }
}

export async function cachePdfFile(file, documents = []) {
  if (!file) {
    throw new Error("No file selected.");
  }

  if (
    file.type &&
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Please select a PDF file.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const documentId = await computeFingerprint(arrayBuffer, file);
  const existingRecord = documents.find((documentRecord) => documentRecord.id === documentId);
  const nowIso = new Date().toISOString();

  const documentRecord = {
    id: documentId,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified ?? null,
    fingerprint: documentId,
    totalPages: existingRecord?.totalPages ?? 0,
    lastOpened: nowIso,
    cachedPdfBase64: bytesToBase64(bytes),
    cachedAt: nowIso,
  };

  await saveDocument(documentRecord);

  return {
    documentRecord,
    bytes,
  };
}

export function getCachedDocumentBytes(documentRecord) {
  if (!documentRecord?.cachedPdfBase64) {
    return null;
  }

  return base64ToBytes(documentRecord.cachedPdfBase64);
}

export async function loadAppModel() {
  const [
    documents,
    progressRecords,
    notes,
    sessions,
    stats,
    themeSetting,
    goalRecord,
    activeDocumentSetting,
    activeTimerSetting,
    readerHelperSetting,
    studyTabSetting,
  ] = await Promise.all([
    getAllFromStore("documents"),
    getAllProgress(),
    getNotes(),
    getSessions(),
    getStats(),
    getSetting(SETTING_KEYS.theme),
    getGoal(DAILY_GOAL_ID),
    getSetting(SETTING_KEYS.activeDocumentId),
    getSetting(SETTING_KEYS.activeTimer),
    getSetting(SETTING_KEYS.readerHelperDismissed),
    getSetting(SETTING_KEYS.studyTab),
  ]);

  return {
    documents: documents.sort(sortByRecent),
    progressRecords,
    notes,
    sessions: sessions.sort(
      (left, right) =>
        new Date(right.endedAt ?? right.startedAt ?? 0) -
        new Date(left.endedAt ?? left.startedAt ?? 0),
    ),
    pageVisits: stats.filter((record) => record.type === "page-visit"),
    theme: themeSetting?.value ?? "light",
    goal: normalizeGoal(goalRecord ?? { targetPages: DEFAULT_DAILY_GOAL }),
    activeDocumentId: activeDocumentSetting?.value ?? documents.sort(sortByRecent)[0]?.id ?? null,
    activeTimerState: activeTimerSetting?.value ?? null,
    readerHelperDismissed: Boolean(readerHelperSetting?.value),
    studyTab: studyTabSetting?.value ?? "notes",
  };
}

export async function loadDocumentById(documentId) {
  if (!documentId) {
    return null;
  }

  return getDocument(documentId);
}

export function getProgressRecord(progressRecords, documentId) {
  return progressRecords.find((record) => record.documentId === documentId) ?? null;
}

export function getNotesForDocument(notes, documentId) {
  return notes.filter((note) => note.documentId === documentId);
}

export function buildRecentDocumentSummaries(documents, progressRecords, notes, limit = 8) {
  const noteCountByDocument = new Map();

  for (const note of notes) {
    noteCountByDocument.set(note.documentId, (noteCountByDocument.get(note.documentId) ?? 0) + 1);
  }

  return [...documents]
    .sort(sortByRecent)
    .slice(0, limit)
    .map((documentRecord) => ({
      ...documentRecord,
      noteCount: noteCountByDocument.get(documentRecord.id) ?? 0,
      lastPage: getProgressRecord(progressRecords, documentRecord.id)?.currentPage ?? 1,
    }));
}

export function setStatus(target, message) {
  if (target) {
    target.textContent = message;
  }
}

export function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

export function setReaderUrl(documentId, page = null) {
  const url = new URL("./reader.html", window.location.href);

  if (documentId) {
    url.searchParams.set("doc", documentId);
  }

  if (page) {
    url.searchParams.set("page", String(page));
  }

  window.history.replaceState({}, "", url);
}

export function readerHref(documentId, page = null) {
  const url = new URL("./reader.html", window.location.href);
  url.searchParams.set("doc", documentId);

  if (page) {
    url.searchParams.set("page", String(page));
  }

  return url.pathname + url.search;
}

export function studyHref(documentId = null) {
  const url = new URL("./study.html", window.location.href);

  if (documentId) {
    url.searchParams.set("doc", documentId);
  }

  return url.pathname + url.search;
}
