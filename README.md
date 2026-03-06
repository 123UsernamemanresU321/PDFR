# PDF Reading Companion

PDF Reading Companion is a local-first study web app for reading PDFs, capturing page-linked notes, tracking progress, and revising from your notes as flashcards. It is designed for static hosting and runs entirely in the browser with no backend, no account system, and no cloud upload.

## What it does

- Opens local PDF files directly in-browser with PDF.js
- Saves each document locally in IndexedDB so it can be reopened later
- Restores last-read page per document
- Lets you create notes tied to the current page
- Supports note tags: `definition`, `quote`, `exam point`, `question`
- Exports notes to Markdown
- Exports and imports full local app data as JSON
- Runs a focus session timer with local history
- Tracks a daily reading goal in pages per day
- Builds a glossary from definition notes automatically
- Generates revision flashcards from notes
- Includes theme modes: light, dark, sepia
- Supports keyboard-first reading and note capture
- Shows recent documents and study stats

## Feature overview

### Phase 1

- Figma-inspired landing view with onboarding, upload zone, and recent documents
- PDF viewer with next/previous page, jump to page, and zoom controls
- Per-document progress saving
- Page-linked notes sidebar
- Markdown export for the current document or full note set

### Phase 2

- Session timer with start, pause, reset, and document attachment
- Daily reading goal with live progress
- Note search and tag filtering
- Theme switching and accessibility preferences
- Full JSON backup import/export

### Phase 3

- Revision mode with flashcards derived from notes
- Glossary panel for definition notes
- Stats dashboard with totals, streak, and tag breakdown
- Quick actions palette and keyboard shortcuts

## Tech stack

- Static HTML, CSS, and vanilla JavaScript modules
- [PDF.js](https://mozilla.github.io/pdf.js/) loaded from CDN
- IndexedDB for local persistence
- No framework
- No server
- No authentication

## Project structure

```text
/
├── assets/
│   └── app-icon.svg
├── scripts/
│   ├── app.js
│   ├── export.js
│   ├── goals.js
│   ├── notes.js
│   ├── pdf-viewer.js
│   ├── revision.js
│   ├── sessions.js
│   ├── storage.js
│   └── ui.js
├── styles/
│   ├── base.css
│   ├── components.css
│   ├── layout.css
│   └── themes.css
├── index.html
├── package.json
└── README.md
```

## Local development

No build step is required.

### Option 1: Python

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

### Option 2: Any static file server

Serve the repository root with any static server. The app uses browser-native ES modules, so it should be served over HTTP rather than opened directly as a `file://` page.

## GitHub Pages deployment

1. Push this repository to GitHub.
2. In the repository, open `Settings` → `Pages`.
3. Under `Build and deployment`, choose `Deploy from a branch`.
4. Select the branch to publish and choose the repository root as the folder.
5. Save the settings and wait for GitHub Pages to publish the site.

There is no build command. GitHub Pages can deploy the files exactly as they are.

## Storage behavior

All data stays in the browser:

- PDFs are stored locally as blobs in IndexedDB
- Reading progress is stored per document
- Notes, goals, flashcards, settings, and session history are stored locally
- JSON backups include the locally stored documents and all app data
- Nothing is uploaded unless you manually export a file yourself

If you clear browser site storage, the local library is removed. Use JSON export for backups.

## Keyboard shortcuts

- `Left Arrow`: previous page
- `Right Arrow`: next page
- `G`: focus page jump input
- `N`: focus quick note
- `/` or `Ctrl+K`: open quick actions
- `F`: toggle focus mode
- `Space`: reveal revision answer
- `1`, `2`, `3`: rate flashcards in revision mode

## Notes on design and implementation

- The interface follows the provided Figma direction for onboarding, reading workspace, notes manager, glossary, revision mode, and settings.
- The UI is optimized for desktop and tablet first, with responsive fallback for smaller screens.
- The app intentionally favors a robust local-first workflow over any external service integration.

## Verification used during implementation

- `node --check scripts/storage.js`
- `node --check scripts/notes.js`
- `node --check scripts/goals.js`
- `node --check scripts/sessions.js`
- `node --check scripts/revision.js`
- `node --check scripts/export.js`
- `node --check scripts/ui.js`
- `node --check scripts/app.js`
- `node --check scripts/pdf-viewer.js`
- Local static server smoke test with `python3 -m http.server 4173`

