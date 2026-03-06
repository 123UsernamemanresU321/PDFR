# PDF Reading Companion

PDF Reading Companion is a local-first, GitHub Pages–deployable web app for reading PDFs, capturing page-linked notes, running focused study sessions, and exporting your work without ever uploading documents to a server.

## What the app does

- Opens local PDF files directly in the browser with PDF.js
- Remembers reading progress by document fingerprint
- Saves page-linked notes with tags such as `definition`, `quote`, `exam point`, and `question`
- Searches and filters notes by text and tag
- Exports notes to Markdown grouped by page and tag
- Backs up and restores app data as JSON
- Tracks timed reading sessions and a pages-per-day goal
- Builds a glossary from definition notes
- Generates revision flashcards from saved notes
- Shows study stats including pages read, sessions, streak days, and note counts
- Works entirely client-side with IndexedDB and no backend

## Project structure

```text
/index.html
/styles/
  base.css
  layout.css
  components.css
  themes.css
/scripts/
  app.js
  pdf-viewer.js
  storage.js
  notes.js
  sessions.js
  goals.js
  export.js
  ui.js
  revision.js
/assets/
/README.md
```

## Local development

This project is fully static. You only need a simple local web server so the ES modules load correctly.

### Option 1: Python

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

### Option 2: VS Code Live Server or any static file server

Any basic static server works as long as it serves the project root.

## GitHub Pages deployment

1. Push this project to a GitHub repository.
2. In GitHub, open `Settings` > `Pages`.
3. Under `Build and deployment`, choose `Deploy from a branch`.
4. Select your default branch and `/ (root)` as the folder.
5. Save the settings and wait for Pages to publish.

No build step is required.

## Storage behavior

- PDFs are not uploaded or stored remotely.
- Metadata, reading progress, notes, goals, sessions, theme, drafts, and stats are stored locally in IndexedDB.
- The app recognizes documents by a content-based fingerprint when feasible, so reopening the same file restores progress.
- Backup JSON exports all application stores for local archiving or migration to another browser.
- Importing a JSON backup merges records by ID and replaces matching IDs with the imported version.

## Keyboard shortcuts

- `Left Arrow`: previous page
- `Right Arrow`: next page
- `N`: focus the note composer
- `G`: focus the page jump input
- `/` or `Ctrl+K`: open quick actions
- `Escape`: close quick actions

## Feature overview

### Reader

- Single-page, distraction-free PDF canvas
- Previous/next navigation
- Jump to page
- Fit/zoom controls
- Progress bar and resume support

### Notes

- Notes linked to a page number
- Optional selected-text snippet
- Tag filters
- Full-text search
- Markdown export

### Study workflow

- Session timer with start, pause, and reset
- Daily reading goal with live progress
- Flashcard-style revision mode
- Glossary view for definition notes
- Stats dashboard and streak tracking

## Privacy model

Everything stays local in the browser unless you explicitly export a Markdown or JSON file. There is no authentication, no server, no cloud sync, and no third-party storage.

## Design notes

The interface is intentionally restrained: warm typography, spacious layout, keyboard-first navigation, subtle depth, and calm theme modes aimed at long-form study rather than generic document viewing.
