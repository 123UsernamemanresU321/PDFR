# PDF Reading Companion

PDF Reading Companion is a static, local-first web app for reading PDFs with as little distraction as possible. The product is split across dedicated pages so the actual reading surface stays quiet:

- `Home`: open a PDF, resume recent work, see a light summary
- `Reader`: focused PDF reading with only core controls, timer, progress, and a quick note drawer
- `Study`: notes review, glossary, revision cards, stats, goals, and local backup tools

Everything runs client-side. There is no backend, no login, no upload, and no cloud storage.

## Features

- Open local PDFs in the browser with PDF.js
- Cache PDFs locally in IndexedDB for quick reopening from Recent Documents
- Save reading progress per document
- Navigate with previous/next, jump to page, and zoom controls
- Capture page-linked notes with tags:
  - `definition`
  - `quote`
  - `exam point`
  - `question`
- Autosave note drafts locally while typing
- Search and filter notes on the Study page
- Export notes to Markdown
- Export or import the full local app state as JSON
- Track timed reading sessions
- Set and monitor a pages-per-day goal
- Build a glossary from definition notes
- Review flashcards generated from notes
- Track local stats such as pages read, streak days, sessions, and note counts
- Switch between light, dark, and sepia themes

## Project structure

```text
/index.html
/reader.html
/study.html
/styles/
  base.css
  layout.css
  components.css
  themes.css
/scripts/
  app.js
  common.js
  home-page.js
  reader-page.js
  study-page.js
  pdf-viewer.js
  storage.js
  notes.js
  sessions.js
  goals.js
  export.js
  revision.js
/assets/
/README.md
```

## Local development

This is a fully static app. Serve the project root with any simple web server.

### Python

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

### Any other static server

VS Code Live Server, `npx serve`, or any equivalent static server works.

## GitHub Pages deployment

1. Push the repository to GitHub.
2. Open `Settings` > `Pages`.
3. Under `Build and deployment`, choose `Deploy from a branch`.
4. Select your branch and the root folder.
5. Save.

There is no build step.

## Storage model

The app uses IndexedDB with these stores:

- `documents`
- `progress`
- `notes`
- `settings`
- `sessions`
- `goals`
- `stats`

### Document records

Each document record includes:

- `id`
- `name`
- `size`
- `lastOpened`
- `fingerprint`
- `totalPages`
- cached PDF data for local reopening and JSON backup

### Note records

Each note record includes:

- `id`
- `documentId`
- `page`
- `type`
- `content`
- `createdAt`
- optional `selectedText`

## Privacy and backup behavior

- PDFs and notes stay local in the browser.
- Cached PDFs are stored only in IndexedDB on that browser profile.
- JSON backup exports include cached PDFs, notes, progress, sessions, goals, stats, and settings.
- Import merges records by ID into the current local browser state.

## Keyboard shortcuts

Reader page shortcuts:

- `Left Arrow`: previous page
- `Right Arrow`: next page
- `N`: open the quick note drawer
- `G`: focus the page jump field
- `Escape`: close the note drawer
- `Ctrl+E` or `Cmd+E`: export current document notes to Markdown

## Product flow

### Home

Use Home to:

- open a new local PDF
- resume a recent document
- see a light daily summary
- keep the first-run explanation out of the reader

### Reader

Use Reader for:

- the PDF canvas
- page controls
- session timer
- progress
- quick note capture

The reader intentionally excludes the heavier management features.

### Study

Use Study for:

- note search and filtering
- glossary view
- revision flashcards
- study stats
- reading goal management
- Markdown export
- JSON backup import and export

## Notes on constraints

- The app is static and GitHub Pages compatible.
- It uses vanilla JavaScript modules.
- It does not require any server capability.
- It is designed for desktop and tablet first, with a workable mobile fallback.
