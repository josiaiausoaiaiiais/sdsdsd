# Looma Platform PRD / Handoff

## Original Problem Statement
User asked to start the task using both uploaded artifacts: the Looma source zip and `emergent_100_fix_prompt (2).md`. Goal: implement all requested fixes end-to-end so the Looma video hosting platform has real API-connected Wistia-parity features instead of static/mock pages.

## Architecture Decisions
- Full-stack React + FastAPI + MongoDB Looma app imported from uploaded zip into `/app`, preserving protected environment files.
- Backend uses FastAPI with Motor/MongoDB, httpOnly cookie auth with bearer compatibility, and CSRF double-submit support for SPA mutating requests.
- Frontend uses React Router dashboard pages, axios cookie auth, Tailwind/neobrutalist Looma design classes, and real API calls only.
- AI/object storage integrations use `EMERGENT_LLM_KEY`; no mocked APIs were added.

## Implemented
- Backend: channels, comments, CTAs, email capture leads, password unlock, private sharing tokens, domain restrictions, audit logs, transcript+heatmap clip suggestions, actual MP4 clip rendering for uploaded/storage-backed videos, advanced analytics leads, CRM CSV export, podcast RSS feed, public video CTAs/password protection, webinar/public recording flows.
- Frontend: upload modal with progress, bulk file selection, folders, thumbnails and Studio redirect; real Channels, Remix, Edit, Analytics lead scoring/watch time/CSV export/viewer histories, Studio brand/comments/share/password/RSS/CTAs/forms/chapters/security/audit controls, PublicViewer password/private gate, public CTA/email-gate overlays, SEO schema embed code, updated Features copy.
- Player: customizable player color, logo text and logo placement; in-player click-through CTAs and lead capture forms; heatmap timeline and public chapters/table of contents from transcripts.
- Testing/data quality: added required test IDs for key Studio/Comments/Conversion/Security interactions, documented QA credentials, removed hardcoded fallback test URLs, documented CSRF compatibility behavior.
- Validation: frontend compiles, landing page loads, manual API checklist passed, backend pytest suite passes 80/80, testing agent validated major backend/frontend flows.
- Code quality follow-up: removed hardcoded test passwords in priority test files, eliminated console statements in production frontend paths, fixed boolean identity assertions, simplified AuthContext memo complexity, memoized expensive analytics/channel render transforms, extracted backend helper logic for origin checks, Google auth, video updates, and clip rendering.

## Update (Feb 2026) — Audit v2 (94% → 100%) gap fixes
- Background music: `GET /api/videos/{id}/music-tracks` (4 royalty-free generated tracks) + `POST /api/videos/{id}/music` (FFmpeg sine-pad amix into a NEW video doc; fallback for videos without audio). Edit.jsx now has a functional music picker (track grid, volume slider, "Mix into new video").
- Real trimming: `POST /api/videos/{id}/trim` (keep-ranges → per-segment cut + concat via FFmpeg → NEW video doc). Edit.jsx `saveEdits` builds merged keep-ranges from non-deleted transcript segments and calls /trim for uploaded videos; shows a trim-success banner. Non-uploaded videos fall back to title patch.
- Studio remix export: Studio.jsx remix tab now loads `/videos/{id}/clips`, renders per-clip aspect-ratio Export buttons wired to `POST /videos/{id}/clips/render`, and downloads the rendered file. The dead "Export clip" button is removed.
- Verified end-to-end via external URL: trim of [1-3]+[5-7] → 4.0s video; music + clip render return new assets. FFmpeg helpers tested for both audio and no-audio sources.

## Update (Feb 2026) — UI/UX + verification pass
- Sidebar (DashboardLayout.jsx): compacted spacing (py-2, text-sm, gap-0.5) so all 8 menu items (Home..Brand) are fully visible without scrolling — verified at 1366x768 (Brand bottom y≈451 / 768).
- Video player fullscreen fix: useVideoPlayer now exposes containerRef and requestFullscreen targets the .player-shell container (NOT the bare <video>), so the custom branded controls/heatmap/CTA stay visible in fullscreen. Added .player-shell:fullscreen CSS (fills screen) and .player-ctrl branded control buttons (brand-color hover, nb-border, font-heading timecode). Applied to both VideoPlayer.jsx and PublicViewer.jsx.
- Create = single feature: RecordModal already combines upload + record in one modal; heading updated to "Upload or record a video".
- Verified (iteration_8, frontend-only): sidebar fit, fullscreen target, single Create modal, and all 4 Studio tabs (Transcript/Remix/Brand/Convert) functional with no UI bugs/crashes. Lint clean across all changed files.

## Known Notes
- Browser playback can show CORS console errors if a seeded video URL uses a third-party host like `example.com`; internal uploaded/storage-backed videos avoid this.
- Transcription errors in logs during tests are expected for fake random webm test files; real supported media files go through Whisper.

## Prioritized Backlog
### P0
- Keep testing new media flows with internal uploaded videos rather than external placeholder URLs.
- Maintain `/app/memory/test_credentials.md` whenever QA/auth credentials change.

### P1
- Add a dedicated public Channel viewer route for copied channel embed URLs (`/app/channels/:id` currently copies an iframe target but dashboard routing does not expose a public channel page).
- Add native CRM integrations after CSV export, starting with user-selected services and credentials.

### P2
- Improve analytics trend data from real event timestamps instead of static 7-day trend shape.
- Expand text-based editing beyond title-marker saves into persisted edit decision lists or rendered cut exports.
- Add stricter non-browser domain restriction enforcement if API clients without Origin/Referer should also be blocked.
