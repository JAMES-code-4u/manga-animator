# Manga PDF → Anime (MVP)

A pipeline that turns a manga PDF into a narrated motion comic (Ken Burns pan/zoom on each page) with AI-generated voiceover and burned-in subtitles.

## User flow

1. Upload PDF (max ~30 pages for MVP).
2. Backend renders each page to an image via pdf.js in the browser, uploads to Lovable Cloud storage.
3. For each page, backend calls Gemini Flash with the page image → returns `{ narration, subtitle }` (OCR + tight anime-style narrator line, ≤ 20 words).
4. Backend calls Lovable AI TTS (`openai/gpt-4o-mini-tts`, voice `alloy`) per page → MP3 in storage.
5. Browser renders the "video" live: `<canvas>` pans/zooms the page image while the MP3 plays and subtitles animate in. A "Record MP4" button captures the canvas + audio via `MediaRecorder` into a downloadable `.webm`.

## Tech

- Storage: Lovable Cloud, one bucket `manga` (private, signed URLs).
- DB tables: `projects(id, user_id, title, status)`, `pages(id, project_id, page_number, image_path, narration, subtitle, audio_path)`.
- pdf.js in browser to rasterize pages at 1280px wide.
- Server functions:
  - `createProject({ title })`
  - `uploadPage({ projectId, pageNumber, imageBase64 })` — stores image, calls Gemini for narration, calls TTS, stores audio, returns row.
  - `getProject({ projectId })` — returns pages with signed URLs.
- Frontend routes:
  - `/` — hero + upload dropzone.
  - `/project/$id` — player + record button.
  - `/library` — user's projects (requires auth).
- Auth: Lovable Cloud email/password. Library and creation require sign-in.

## Design direction

- Aesthetic: cinematic dark, red-ink accent (like a manga inkstain).
- BG `oklch(0.15 0.02 20)`, accent `oklch(0.55 0.22 25)` (crimson), text off-white.
- Fonts: Bebas Neue (display, panels/titles) + Inter (body). Bold uppercase headers, tight tracking.
- Motion: fade-in on load, subtle grain overlay, Ken Burns pan on hero panel preview.

## Out of scope (explicit)

- Panel-within-page detection (one page = one panel per user choice).
- Per-character voices / lip sync.
- True MP4 mux (browser produces `.webm`; converting to `.mp4` server-side isn't possible on Workers).
- Right-to-left manga reading order handling beyond page order in the PDF.

## Deliverable this turn

Full working MVP: auth, upload, backend processing pipeline, live player, record-to-webm button.
