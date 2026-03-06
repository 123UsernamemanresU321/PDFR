const TICK_INTERVAL_MS = 1000;

function normalizeState(savedState) {
  if (!savedState || typeof savedState !== "object") {
    return {
      elapsedMs: 0,
      startedAt: null,
      sessionStartedAt: null,
      running: false,
      documentId: null,
    };
  }

  return {
    elapsedMs: Math.max(0, Number(savedState.elapsedMs) || 0),
    startedAt: savedState.startedAt ?? null,
    sessionStartedAt: savedState.sessionStartedAt ?? null,
    running: Boolean(savedState.running),
    documentId: savedState.documentId ?? null,
  };
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function createTimerController({ onTick = () => {}, onStateChange = () => {} } = {}) {
  let intervalId = null;
  let state = normalizeState(null);

  function getElapsedNow() {
    if (!state.running || !state.startedAt) {
      return state.elapsedMs;
    }

    return state.elapsedMs + Math.max(0, Date.now() - new Date(state.startedAt).getTime());
  }

  function snapshot() {
    return {
      ...state,
      elapsedMs: getElapsedNow(),
    };
  }

  function stopInterval() {
    if (intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function startInterval() {
    stopInterval();
    intervalId = window.setInterval(() => {
      onTick(snapshot());
    }, TICK_INTERVAL_MS);
  }

  function emit() {
    onStateChange(snapshot());
  }

  function start(documentId = null) {
    if (state.running) {
      return snapshot();
    }

    const nowIso = new Date().toISOString();
    state = {
      ...state,
      running: true,
      startedAt: nowIso,
      sessionStartedAt: state.sessionStartedAt ?? nowIso,
      documentId: documentId ?? state.documentId ?? null,
    };

    startInterval();
    emit();
    return snapshot();
  }

  function pause() {
    if (!state.running) {
      return snapshot();
    }

    state = {
      ...state,
      elapsedMs: getElapsedNow(),
      running: false,
      startedAt: null,
    };

    stopInterval();
    emit();
    return snapshot();
  }

  function reset() {
    const previous = snapshot();

    if (state.running) {
      pause();
    }

    let sessionRecord = null;

    if (previous.elapsedMs >= TICK_INTERVAL_MS) {
      sessionRecord = {
        id: crypto.randomUUID(),
        documentId: previous.documentId ?? null,
        startedAt:
          previous.sessionStartedAt ??
          new Date(Date.now() - previous.elapsedMs).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: previous.elapsedMs,
      };
    }

    state = {
      elapsedMs: 0,
      startedAt: null,
      sessionStartedAt: null,
      running: false,
      documentId: previous.documentId ?? null,
    };

    stopInterval();
    emit();
    return sessionRecord;
  }

  function restore(savedState) {
    state = normalizeState(savedState);

    if (state.running && state.startedAt) {
      startInterval();
    } else {
      stopInterval();
    }

    emit();
    return snapshot();
  }

  function setDocumentId(documentId) {
    state = {
      ...state,
      documentId: documentId ?? null,
    };
    emit();
  }

  function getSerializableState() {
    const current = snapshot();

    if (!current.running) {
      return current;
    }

    return {
      ...current,
      elapsedMs: current.elapsedMs,
      startedAt: new Date().toISOString(),
    };
  }

  function destroy() {
    stopInterval();
  }

  return {
    start,
    pause,
    reset,
    restore,
    setDocumentId,
    getState: snapshot,
    getSerializableState,
    destroy,
  };
}
