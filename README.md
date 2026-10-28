# AI-Powered Course QA Assistant

An intelligent, real-time Quality Assurance assistant for e-learning courses and slide decks.

## Project Overview

This project consists of 5 main components:
1. **Frontend (Browser Extension)**: Floating QA widget and capture controls for Edge/Chrome.
2. **Slide Detection & Screenshot Capture**: Observes navigation transitions and snapshots slides automatically.
3. **Backend API (FastAPI)**: Coordinates sessions, slide records, and analysis jobs.
4. **Analysis Engine**: Independent checks for text (grammar/spelling), alignment/layout, and typography standards.
5. **Report Generator**: Generates comprehensive PDF audit reports.

---

## Completed Stages

### Stage 1: Floating Browser Widget
* **Shadow DOM Isolation**: Injected via open Shadow Root so host course styles cannot conflict with or break widget UI.
* **Modern Glassmorphic Dark UI**: Custom typography, status badges, and live counters.
* **Draggable & Minimizable**: Position the widget anywhere on screen or minimize to a compact pill.

### Stage 2: Real Screenshot Capture
* **Actual Viewport Capture**: Background service worker coordinates `chrome.tabs.captureVisibleTab(targetWindowId, { format: "png" })` to capture the real course viewport as a full-resolution PNG image.
* **Auto-Hiding Widget During Capture**: The floating widget temporarily sets `host.style.visibility = "hidden"` and awaits render cycles before triggering capture. As a result, **the QA widget does not appear in the captured screenshot**.
* **IndexedDB Local Storage (`CourseQA_DB`)**: Real PNG images are saved locally as data URLs in an IndexedDB object store (`screenshots`), completely avoiding `chrome.storage.local` quota limitations.
* **Comprehensive Metadata Tracking**: Stores `sessionId`, `captureId`, `captureNumber`, `slideNumber`, `timestamp`, `captureType` (`manual` or `automatic`), `storageRef`, `analysisStatus`, and page details.
* **Inspection Viewer Tab**: Click `[ ↗ View Screenshot ]` in the widget or popup to open `viewer/viewer.html?id=...`, which loads the image from IndexedDB, displays full metadata (resolution, file size, timestamp), and provides a `Download PNG` button.

### Stage 3: Automatic Slide Detection & Capture
* **Multi-Heuristic Transition Detection**:
  1. **Course Events**: Observes custom events (`course:slideChanged`, `slideChanged`, etc.).
  2. **MutationObserver**: Monitors structural changes in slide containers (`.slide.active`, `[data-slide]`, `#slide-indicator`, `[aria-current]`).
  3. **URL/Hash Monitoring**: Detects route changes on `hashchange` and `popstate`.
* **Deterministic Content Fingerprinting**:
  Each slide evaluates to a unique fingerprint `num:[id]|ind:[text]|h:[heading]|url:[hash]`. Navigating to consecutive slides or previous slides changes the fingerprint and triggers capture, while internal element mutations on the same slide maintain the same fingerprint and are ignored.
* **Self-Mutation Filtering**:
  Mutations originating from `#course-qa-assistant-host` or inside the QA widget's Shadow DOM are explicitly filtered out so widget counter updates never trigger false captures.
* **Settle Delay & Transition Smoothing**:
  A 450ms debounce delay ensures slide animations, fade-ins, and typography rendering complete before the camera captures the viewport.
* **Cooldown Guard**:
  A 900ms minimum interval prevents rapid-fire button clicking from creating duplicate captures.
* **Full Manual Capture Preservation**:
  Manual `[ 📸 Capture ]` button continues working at any time and captures the slide marked as `manual`.
* **Session Lifecycle Integration**:
  Automatic monitoring starts only after clicking **Start QA Session**, pauses when **End QA** is clicked, and automatically resumes if the browser tab or service worker reloads during an active session.

### Stage 4: Text Extraction from Captured Slides
* **Priority-Based DOM Extraction Strategy**:
  1. **Active Slide Container** — scans known selectors (`.slide.active`, `.reveal .slides section.present`, `[role='main']`, `main`, etc.) to locate the active slide, then walks its visible DOM subtree.
  2. **Full-Body Fallback** — if no container is identified, extracts from `document.body` with widget, hidden-element, and invisible-element filtering.
  3. **OCR Integration Point** — canvas/image-only slides trigger a stub (`performOCR`) ready to accept Tesseract.js WASM or a backend OCR endpoint in a future stage.
* **Comprehensive Filtering** — `SCRIPT`, `STYLE`, `NOSCRIPT`, `HEAD` tags, elements with `display:none`, `visibility:hidden`, `opacity < 5%`, `aria-hidden=true`, `[hidden]`, and the QA widget host (`#course-qa-assistant-host`) are all excluded automatically.
* **Non-Blocking Pipeline** — text extraction runs asynchronously after capture completes (120 ms post-render delay); it never blocks slide navigation or the widget UI.
* **Extraction Status Lifecycle** — each extraction record progresses through `pending → extracting → completed | partially-completed | failed`, stored in a new `textExtractions` IndexedDB object store (`CourseQA_DB` v2).
* **Viewer Panel** — `viewer/viewer.html` now shows an **Extracted Text** panel below the screenshot with the full extracted text, word count, extraction method, status badge, timestamp, and any notes.
* **Screenshot Record Patching** — after extraction, the associated screenshot record gains a `textExtractionStatus` field so the session overview always reflects the latest text-extraction state.

### Stage 6: Grammar & Spelling Analysis Engine
* **Language Analysis Service**:
  Integrates with **LanguageTool** via its documented HTTP API (`POST /v2/check`) with full support for custom/self-hosted endpoints and optional API credentials.
* **Standardized Finding Schema**:
  Findings are normalized into a unified structure:
  ```json
  {
    "issueId": "iss_cap_xxx_1_abc",
    "sessionId": "session-id",
    "captureId": "capture-id",
    "slideNumber": 1,
    "category": "spelling" | "grammar" | "punctuation" | "capitalization" | "repeated-word",
    "ruleId": "PERS_PRONOUN_VERB_AGREEMENT",
    "message": "The plural noun 'Products' requires a plural verb.",
    "originalText": "provides",
    "suggestions": ["provide"],
    "startOffset": 14,
    "endOffset": 22,
    "severity": "high" | "medium" | "low",
    "source": "languagetool" | "internal-regex",
    "status": "open",
    "createdAt": "2026-10-17T09:00:00.000Z"
  }
  ```
* **5 Detected Issue Types**:
  1. **Spelling**: Misspelled words, typographical errors, and phonetic confusions.
  2. **Grammar**: Subject–verb agreement, incorrect verb forms, invalid articles, preposition errors.
  3. **Punctuation**: Missing commas, unnecessary punctuation, sentence boundaries.
  4. **Capitalization**: Lowercase sentence starters, incorrect casing.
  5. **Repeated Words**: Adjacent duplicate words (e.g. *"the the"*, *"is is"*), detected via both LanguageTool rules and an internal regex safeguard.
* **Technical Term & Acronym Allowlist**:
  Suppresses false-positive spelling errors on domain jargon (e.g., `SQL`, `ETL`, `Kafka`, `Kubernetes`, `Snowflake`, `SLA`, `APIs`, `JSON`, `Microservices`).
* **Safe IndexedDB v3 Schema Upgrade**:
  Upgrades `CourseQA_DB` to version 3, adding an `analysisFindings` object store with indexes on `captureId`, `sessionId`, `category`, and `createdAt` without modifying or deleting existing `screenshots` or `textExtractions` stores.
* **Asynchronous, Non-Blocking Pipeline**:
  Analysis runs automatically in the background after text extraction completes. It never blocks navigation or screenshot capture.
* **Duplicate Prevention**:
  Re-analyzing the same slide/capture safely replaces previous findings for that `captureId` rather than duplicating entries.
* **Empty Slide Handling**:
  Slides with no usable text are marked as `skipped` rather than generating artificial errors.
* **Viewer UI & Interactive Retry**:
  `viewer/viewer.html` displays categorized finding cards with color-coded badges, error messages, original strike-through text, and suggestion pills. Includes automatic polling (up to 4 attempts at 1.5s intervals) and a **[ ⚡ Re-analyze Grammar ]** manual retry button.
* **Strict Privacy Guarantees**:
  **Screenshots and image data are NEVER sent to the grammar service.** Only raw extracted slide text is transmitted.

---

## Project Structure

```
course-qa-assistant/
├── browser-extension/
│   ├── manifest.json            # Manifest V3 (Edge & Chrome)
│   ├── background/
│   │   ├── service-worker.js    # captureVisibleTab, IndexedDB v3 (screenshots, textExtractions, analysisFindings)
│   │   └── grammar-analyzer.js  # Stage 6: Language analysis engine & normalizer
│   ├── content/
│   │   ├── slide-detector.js    # Multi-heuristic slide detection engine
│   │   ├── text-extractor.js    # Stage 4: DOM text extraction & OCR integration point
│   │   └── content.js           # Shadow DOM widget, capture coordinator & extraction trigger
│   ├── viewer/
│   │   ├── viewer.html          # Screenshot viewer + Extracted Text panel + Analysis Findings panel
│   │   └── viewer.js            # Image, text, and grammar findings retrieval & retry controller
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── demo-course/
│   └── index.html               # 5-slide interactive test course
├── tests/
│   ├── test_slide_detector.js   # Stage 3: Slide detection unit tests
│   ├── test_text_extractor.js   # Stage 4: DOM text extraction & IDB v2 tests (63 assertions)
│   └── test_grammar_analyzer.js # Stage 6: Language analysis engine & IDB v3 tests (75 assertions)
└── README.md
```

---

## Automated Verification Tests

### Stage 3 — Slide Detector

```bash
node tests/test_slide_detector.js
```

**Results (8/8 PASSED)**:
* `Test 1`: Slide info extraction and deterministic fingerprinting — PASSED
* `Test 2`: Baseline detector initialization and activation — PASSED
* `Test 3`: QA widget self-mutation filtering — PASSED
* `Test 4`: Genuine slide transition detection (Slide 1 → Slide 2) — PASSED
* `Test 5`: Duplicate capture suppression on same slide — PASSED
* `Test 6`: Navigation to previous slide (Slide 2 → Slide 1) — PASSED
* `Test 7`: Manual screenshot capture record generation — PASSED
* `Test 8`: Detector teardown on End QA — PASSED

### Stage 4 — Text Extractor & IndexedDB Storage

```bash
node tests/test_text_extractor.js
```

**Results (25 test suites, 63 assertions PASSED)**:
* `Section 1`: Core DOM extraction, script/style blocking, visibility rules, whitespace normalization (Tests 1–8) — PASSED
* `Section 2`: Fresh DB initialization, v1-to-v2 schema upgrades preserving screenshot records, versionchange lifecycle, error propagation (Tests 9–12) — PASSED
* `Section 3`: Saving/retrieving extractions, updating screenshot extraction status within atomic transaction, orphan handling, idempotency, commit ordering (Tests 13–17) — PASSED
* `Section 4`: Invalid captureId rejection, missing record handling with `notYetAvailable` flag, transaction abort/error rejection, request failure handling (Tests 18–21) — PASSED
* `Section 5`: Viewer pending state, 1.5s retry timing, neutral `not-yet-available` explanation, confirmed failure handling (Tests 22–25) — PASSED

### Stage 6 — Language Analysis Engine (LanguageTool)

```bash
node tests/test_grammar_analyzer.js
```

**Results (15 test sections, 75 assertions PASSED)**:
* `Test 1`: Spelling finding normalization, rule ID preservation, original text slicing, suggestions — PASSED
* `Test 2`: Grammar finding normalization (subject–verb agreement, verb forms) — PASSED
* `Test 3`: Punctuation and capitalization findings with appropriate severity ratings — PASSED
* `Test 4`: Adjacent repeated-word detection (regex safeguard + LanguageTool duplication rules) — PASSED
* `Test 5`: Multiple suggestions clamped to max 5 items and string-normalized — PASSED
* `Test 6`: Empty and whitespace-only text handling (marks `skipped` status with reason, 0 issues) — PASSED
* `Test 7`: Technical term and acronym filtering (`ETL`, `SQL`, `Kafka`, `Kubernetes`, `Snowflake`, `SLA`, `APIs`, `JSON`) — PASSED
* `Test 8`: Character offset accuracy (`startOffset`, `endOffset`, slice verification) — PASSED
* `Test 9`: Associating findings with `captureId`, `sessionId`, and `slideNumber` — PASSED
* `Test 10`: Duplicate prevention on repeated analysis (clearing previous records for `captureId`) — PASSED
* `Test 11`: IndexedDB v3 schema (`analysisFindings` store), safe retrieval and index queries — PASSED
* `Test 12`: Network failure (ECONNREFUSED), HTTP 500 error, and malformed JSON recovery — PASSED
* `Test 13`: Default endpoint fallback and automatic retry recovery — PASSED
* `Test 14`: Sequence validation guarding against un-extracted or missing text — PASSED
* `Test 15`: **LIVE INTEGRATION TEST** against public LanguageTool API (`https://api.languagetool.org/v2/check`) detecting live grammar, spelling, and repeated-word issues — PASSED

---

## Configuration & Privacy

### Language Engine Configuration
By default, the extension uses the public LanguageTool cloud endpoint:
* **Default URL**: `https://api.languagetool.org/v2/check`
* **Default Language**: `en-US`

To use a custom, on-premise, or self-hosted LanguageTool server (e.g. running locally via Docker on `http://localhost:8010/v2/check`) or configure API credentials:
```javascript
// In Service Worker console or extension storage:
chrome.storage.local.set({
  languageToolEndpoint: "http://localhost:8010/v2/check", // Or your enterprise endpoint
  languageToolApiKey: "your-api-key",                     // Optional
  languageToolUsername: "your-username"                   // Optional
});
```

### Privacy & Network Permissions
1. **Host Permissions**: The extension's `manifest.json` uses `<all_urls>` host permissions, which permits outbound HTTPS requests to `https://api.languagetool.org/*` as well as any self-hosted or intranet endpoints without needing additional permissions.
2. **Data Minimization**:
   * **Screenshots are NEVER transmitted** to LanguageTool or any external service.
   * Only the plain text extracted from course slides is sent via standard URL-encoded POST payload (`text=...&language=en-US`).
   * No personally identifiable tester credentials, user cookies, or auth tokens are transmitted.
3. **Graceful Offline Fallback**: If the remote service is unreachable or network access is restricted, the analysis status is flagged as `failed` with a clear diagnostic message, and a **[ ⚡ Re-analyze Grammar ]** button allows retrying as soon as connectivity resumes.

### Known Limitations
* **Public LanguageTool Rate Limits**: The free public `api.languagetool.org` endpoint applies standard IP-based rate limiting (approximately 20 requests per minute or 75,000 characters per request). For high-volume automated testing, configure a self-hosted Docker container (`docker run -d -p 8010:8010 erikvl87/languagetool`).
* **Complex Multi-line Sentence Boundaries**: Slides with fragmented bullet points or diagram labels may occasionally produce false sentence-boundary suggestions; bullet points are best formatted with standard punctuation.
* **Canvas / Pure-Image Slides**: Slides consisting purely of rasterized graphics without DOM text will report `skipped` until OCR is fully activated in a subsequent stage.

---

## Manual Test Procedure in Microsoft Edge or Chrome

### Step 1: Reload Extension
1. Open **Microsoft Edge** and go to `edge://extensions` (or `chrome://extensions` in Google Chrome).
2. Enable **Developer mode**.
3. Click the **Reload (🔄)** icon on the **Course QA Assistant** card (or click **Load unpacked** and select `browser-extension`).
4. Ensure **"Allow access to file URLs"** is toggled **ON** under the extension's Details.

### Step 2: Open Demo Course
Open the 5-slide demo course:
```
file:///Users/sanjeevg/.gemini/antigravity-ide/scratch/course-qa-assistant/demo-course/index.html
```

### Step 3: Run the Verification Checklist

1. **Start QA Session**:
   * Click **[ ▶ Start QA Session ]** in the floating widget.
   * Status transitions to `● QA Session Active`.
   * Slide 1 is captured automatically on start. Counter shows `Captured: 1`.
   * Click `[ ↗ View Screenshot ]` to confirm Slide 1 was captured with `AUTOMATIC` badge.

2. **Test Automatic Forward Navigation (Slide 1 → Slide 2)**:
   * In the course, click **Next Slide →**.
   * Notice widget status updates: `Slide Change Detected` → `Capturing slide automatically...` → `✓ Captured Automatically: Slide #2`.
   * The **Captured** counter increments to `2`.
   * Click `[ ↗ View Screenshot ]` to verify the image contains Slide 2 ("Managing Data as a Shared Asset").

3. **Test Duplicate Suppression on Same Slide**:
   * Stay on Slide 2. Hover over buttons or click around inside the slide stage.
   * Confirm the counter **remains at 2** and does not capture repeatedly.

4. **Test Automatic Backward Navigation (Slide 2 → Slide 1)**:
   * In the course, click **← Previous**.
   * Notice widget detects the change back to Slide 1 and captures it as Slide #3.
   * Counter increments to `3`.

5. **Test Manual Capture Alongside Automatic Capture**:
   * On Slide 1, click the **[ 📸 Capture ]** button in the floating widget.
   * A manual snapshot is taken. Counter increments to `4`.
   * Click `[ ↗ View Screenshot ]` and verify `Capture Type` shows `MANUAL`.

6. **Test End QA Lifecycle**:
   * Click **[ ⏹ End QA ]**.
   * Status updates to `✓ QA Ended` showing 4 captures.
   * Now click **Next Slide →** in the course.
   * Confirm that **no capture occurs** because the session has ended.

7. **Test Session Reset**:
   * Click **[ 🔄 Start New Session ]**.
   * Verify counter resets cleanly to `0`, baseline resets, and a new Session ID is assigned.
