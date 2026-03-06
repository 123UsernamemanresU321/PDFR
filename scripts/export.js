import { NOTE_TYPE_META, sortNotes } from "./notes.js";

export function sanitizeFilename(name) {
  return String(name ?? "export")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "export";
}

export function downloadTextFile(filename, text, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function buildNotesMarkdown(documentRecord, notes) {
  const sortedNotes = [...notes].sort(sortNotes);
  const output = [];

  output.push(`# ${documentRecord?.name ?? "Untitled PDF"} Notes`);
  output.push("");
  output.push(`- Exported: ${new Date().toLocaleString()}`);
  output.push(`- Total notes: ${sortedNotes.length}`);
  output.push("");

  if (!sortedNotes.length) {
    output.push("_No notes have been saved for this document yet._");
    return output.join("\n");
  }

  const notesByPage = new Map();

  for (const note of sortedNotes) {
    if (!notesByPage.has(note.page)) {
      notesByPage.set(note.page, []);
    }

    notesByPage.get(note.page).push(note);
  }

  for (const [page, pageNotes] of notesByPage.entries()) {
    output.push(`## Page ${page}`);
    output.push("");

    const byType = new Map();

    for (const note of pageNotes) {
      if (!byType.has(note.type)) {
        byType.set(note.type, []);
      }

      byType.get(note.type).push(note);
    }

    for (const [type, typedNotes] of byType.entries()) {
      output.push(`### ${NOTE_TYPE_META[type]?.label ?? type}`);
      output.push("");

      for (const note of typedNotes) {
        output.push(`- ${note.content.trim()}`);

        if (note.term?.trim()) {
          output.push(`  - Term: ${note.term.trim()}`);
        }

        if (note.selectedText?.trim()) {
          output.push(`  - Snippet: "${note.selectedText.trim()}"`);
        }

        output.push(`  - Saved: ${new Date(note.createdAt).toLocaleString()}`);
        output.push("");
      }
    }
  }

  return output.join("\n");
}

export function buildBackupPayload(data) {
  return {
    app: "PDF Reading Companion",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function downloadBackupJson(data) {
  const payload = buildBackupPayload(data);
  const filename = `pdf-reading-companion-backup-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}
