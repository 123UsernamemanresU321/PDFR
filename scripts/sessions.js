export function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function getDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function createSessionManager({ onTick, onChange } = {}) {
  let tickTimer = null;
  let state = {
    id: null,
    documentId: null,
    attachToDocument: true,
    isRunning: false,
    createdAt: null,
    startedAt: null,
    elapsedMs: 0,
  };

  function snapshot(now = Date.now()) {
    const runningExtra = state.isRunning && state.startedAt ? now - state.startedAt : 0;
    return {
      ...state,
      elapsedMs: state.elapsedMs + runningExtra,
    };
  }

  function emitTick() {
    if (onTick) {
      onTick(snapshot());
    }
  }

  function emitChange() {
    if (onChange) {
      onChange(snapshot());
    }
  }

  function startTicker() {
    clearInterval(tickTimer);
    tickTimer = window.setInterval(emitTick, 1000);
  }

  function stopTicker() {
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function start(documentId = null) {
    if (state.isRunning) {
      return snapshot();
    }

    const now = Date.now();
    state.id = state.id || crypto.randomUUID();
    state.createdAt = state.createdAt || now;
    state.startedAt = now;
    state.isRunning = true;
    if (state.attachToDocument && documentId) {
      state.documentId = documentId;
    }
    startTicker();
    emitTick();
    emitChange();
    return snapshot();
  }

  function pause() {
    if (!state.isRunning) {
      return snapshot();
    }

    const now = Date.now();
    state.elapsedMs += now - state.startedAt;
    state.startedAt = null;
    state.isRunning = false;
    stopTicker();
    emitTick();
    emitChange();
    return snapshot();
  }

  function reset() {
    const completed = snapshot();
    stopTicker();
    state = {
      id: null,
      documentId: null,
      attachToDocument: state.attachToDocument,
      isRunning: false,
      createdAt: null,
      startedAt: null,
      elapsedMs: 0,
    };
    emitTick();
    emitChange();

    if (!completed.id || completed.elapsedMs <= 0) {
      return null;
    }

    return {
      id: completed.id,
      documentId: completed.documentId,
      startedAt: completed.createdAt,
      endedAt: Date.now(),
      durationMs: completed.elapsedMs,
      dayKey: getDayKey(completed.createdAt || Date.now()),
    };
  }

  function setDocumentId(documentId) {
    if (state.attachToDocument) {
      state.documentId = documentId;
      emitChange();
    }
  }

  function setAttachToDocument(nextValue) {
    state.attachToDocument = Boolean(nextValue);
    emitChange();
  }

  function hydrate(savedState) {
    if (!savedState) {
      emitTick();
      return;
    }

    state = {
      ...state,
      ...savedState,
      attachToDocument: savedState.attachToDocument !== false,
      isRunning: Boolean(savedState.isRunning),
    };

    if (state.isRunning && state.startedAt) {
      startTicker();
    }

    emitTick();
    emitChange();
  }

  function getPersistedState() {
    return snapshot();
  }

  return {
    start,
    pause,
    reset,
    hydrate,
    setDocumentId,
    setAttachToDocument,
    getPersistedState,
    getSnapshot: snapshot,
  };
}
