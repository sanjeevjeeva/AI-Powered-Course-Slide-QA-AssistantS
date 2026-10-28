// Course QA Assistant - Content Script
// Injects the isolated floating widget into the host page via Shadow DOM.
// Stage 2: Coordinates real visible tab capture, widget auto-hiding during snapshot,
// and screenshot inspection links.

(function () {
  // Prevent duplicate injection
  if (window.__COURSE_QA_ASSISTANT_INJECTED__) return;
  window.__COURSE_QA_ASSISTANT_INJECTED__ = true;

  console.log("[Course QA Assistant] Injected into page:", window.location.href);

  // Create host element
  const host = document.createElement("div");
  host.id = "course-qa-assistant-host";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647"; // Max z-index
  host.style.top = "24px";
  host.style.right = "24px";
  host.style.pointerEvents = "none"; // allow click-through around widget
  document.documentElement.appendChild(host);

  // Attach shadow root for CSS style isolation
  const shadow = host.attachShadow({ mode: "open" });

  // Stylesheet for the widget
  const style = document.createElement("style");
  style.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .widget-container {
      pointer-events: auto;
      width: 290px;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      box-shadow: 0 20px 40px -8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      color: #f8fafc;
      overflow: hidden;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }

    .widget-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(30, 41, 59, 0.75);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: grab;
    }

    .widget-header:active {
      cursor: grabbing;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .brand-icon {
      width: 18px;
      height: 18px;
      border-radius: 6px;
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 800;
      color: white;
    }

    .brand-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #e2e8f0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: background 0.15s, color 0.15s;
    }

    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    .widget-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Collapsed state */
    .widget-container.collapsed .widget-body {
      display: none;
    }
    .widget-container.collapsed {
      width: auto;
      border-radius: 20px;
    }
    .widget-container.collapsed .widget-header {
      padding: 8px 14px;
      border-bottom: none;
    }

    /* Status badge */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      width: fit-content;
      transition: all 0.3s ease;
    }

    .status-badge.inactive {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }

    .status-badge.active {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }

    .status-badge.completed {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.35);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-badge.active .status-dot {
      box-shadow: 0 0 10px #34d399;
      animation: pulse 1.8s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.7; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.7; }
    }

    /* Stats Grid */
    .stats-card {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      text-align: center;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-label {
      font-size: 10px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: #f1f5f9;
      font-variant-numeric: tabular-nums;
    }

    .stat-value.captured { color: #60a5fa; }
    .stat-value.analyzing { color: #fbbf24; }
    .stat-value.issues { color: #f87171; }

    /* Flash / tactile feedback on capture */
    .flash-pulse {
      animation: captureFlash 0.35s ease;
    }

    @keyframes captureFlash {
      0% { transform: scale(1); filter: brightness(1.7); }
      50% { transform: scale(1.02); filter: brightness(2); }
      100% { transform: scale(1); filter: brightness(1); }
    }

    /* Buttons */
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 11px 16px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .btn:active:not(:disabled) {
      transform: scale(0.97);
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none !important;
    }

    .btn-primary {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
    }

    .btn-capture {
      background: linear-gradient(135deg, #059669, #047857);
      color: #ffffff;
      border: 1px solid rgba(52, 211, 153, 0.3);
    }
    .btn-capture:hover:not(:disabled) {
      background: linear-gradient(135deg, #10b981, #059669);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.14);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .btn-danger:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.24);
      color: #ffffff;
      border-color: rgba(239, 68, 68, 0.5);
    }

    .btn-sm {
      padding: 7px 12px;
      font-size: 11px;
      border-radius: 8px;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }

    /* Activity footer message */
    .activity-log {
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 23, 42, 0.6);
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      min-height: 32px;
      transition: all 0.2s ease;
    }

    .activity-log.success {
      background: rgba(16, 185, 129, 0.12);
      border-color: rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
    }

    .activity-log.error {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }

    .activity-log-icon {
      font-size: 13px;
      flex-shrink: 0;
    }

    .activity-text {
      white-space: normal;
      word-break: break-word;
      line-height: 1.3;
    }

    /* Last capture pill / preview bar */
    .capture-preview-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 8px;
      font-size: 11px;
    }

    .capture-preview-bar span {
      color: #93c5fd;
      font-weight: 500;
    }

    .link-btn {
      background: transparent;
      border: none;
      color: #38bdf8;
      cursor: pointer;
      font-weight: 600;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-decoration: underline;
      padding: 2px 4px;
    }
    .link-btn:hover {
      color: #93c5fd;
    }

    /* Screen capture indicator ring */
    .capture-shutter-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.28);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.12s ease-out;
      z-index: 2147483646;
    }
    .capture-shutter-overlay.flash {
      opacity: 1;
    }
  `;

  // Root container DOM
  const container = document.createElement("div");
  container.className = "widget-container";
  container.id = "qa-widget";

  container.innerHTML = `
    <div class="widget-header" id="drag-handle">
      <div class="brand">
        <div class="brand-icon">QA</div>
        <div class="brand-title">Course QA Assistant</div>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="btn-minimize" title="Minimize / Expand">−</button>
      </div>
    </div>

    <div class="widget-body" id="widget-body">
      <!-- Status Badge -->
      <div class="status-badge inactive" id="status-badge">
        <span class="status-dot"></span>
        <span id="status-text">Ready to Start</span>
      </div>

      <!-- Stats Grid -->
      <div class="stats-card">
        <div class="stat-item">
          <div class="stat-label">Captured</div>
          <div class="stat-value captured" id="stat-captured">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Analyzing</div>
          <div class="stat-value analyzing" id="stat-analyzing">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Issues</div>
          <div class="stat-value issues" id="stat-issues">0</div>
        </div>
      </div>

      <!-- Last Capture Action Bar (hidden until first capture) -->
      <div class="capture-preview-bar" id="preview-bar" style="display: none;">
        <span id="preview-text">Slide #1</span>
        <button class="link-btn" id="btn-view-preview" title="Open screenshot viewer to browse all captures in session">↗ View All</button>
      </div>

      <!-- Action Buttons -->
      <div class="btn-group" id="btn-group">
        <button class="btn btn-primary" id="btn-start-qa">
          <span>▶</span> Start QA Session
        </button>
      </div>

      <!-- Activity Feedback -->
      <div class="activity-log" id="activity-log">
        <span class="activity-log-icon" id="activity-icon">ℹ</span>
        <span class="activity-text" id="activity-text">Open course slide and click Start QA</span>
      </div>
    </div>
  `;

  // Shutter flash overlay for screen capture feedback
  const shutterOverlay = document.createElement("div");
  shutterOverlay.className = "capture-shutter-overlay";

  shadow.appendChild(style);
  shadow.appendChild(container);
  document.body.appendChild(shutterOverlay);

  // State variables
  let currentSession = null;
  let isCollapsed = false;
  let isCapturing = false;
  let lastCaptureId = null;

  // DOM references inside shadow DOM
  const dragHandle = shadow.getElementById("drag-handle");
  const btnMinimize = shadow.getElementById("btn-minimize");
  const statusBadge = shadow.getElementById("status-badge");
  const statusText = shadow.getElementById("status-text");
  const statCaptured = shadow.getElementById("stat-captured");
  const statAnalyzing = shadow.getElementById("stat-analyzing");
  const statIssues = shadow.getElementById("stat-issues");
  const btnGroup = shadow.getElementById("btn-group");
  const activityLog = shadow.getElementById("activity-log");
  const activityIcon = shadow.getElementById("activity-icon");
  const activityText = shadow.getElementById("activity-text");
  const previewBar = shadow.getElementById("preview-bar");
  const previewText = shadow.getElementById("preview-text");
  const btnViewPreview = shadow.getElementById("btn-view-preview");

  // Draggable window positioning
  let isDragging = false;
  let startX = 0, startY = 0;
  let currentTop = 24, currentRight = 24;

  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.closest(".icon-btn")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = host.getBoundingClientRect();
    currentTop = rect.top;
    currentRight = window.innerWidth - rect.right;

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;

      const newTop = Math.max(10, Math.min(window.innerHeight - 80, currentTop + deltaY));
      const newRight = Math.max(10, Math.min(window.innerWidth - 100, currentRight - deltaX));

      host.style.top = `${newTop}px`;
      host.style.right = `${newRight}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Minimize / Expand logic
  btnMinimize.addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    container.classList.toggle("collapsed", isCollapsed);
    btnMinimize.textContent = isCollapsed ? "+" : "−";
  });

  // Shutter flash animation helper
  function triggerShutterFlash() {
    shutterOverlay.classList.add("flash");
    container.classList.add("flash-pulse");
    setTimeout(() => {
      shutterOverlay.classList.remove("flash");
      container.classList.remove("flash-pulse");
    }, 220);
  }

  // Set activity status with type styling
  function setActivity(message, type = "info") {
    activityLog.className = "activity-log";
    if (type === "success") {
      activityLog.classList.add("success");
      activityIcon.textContent = "✓";
    } else if (type === "error") {
      activityLog.classList.add("error");
      activityIcon.textContent = "✕";
    } else {
      activityIcon.textContent = "ℹ";
    }
    activityText.textContent = message;
  }

  // Render widget according to current session status
  function renderWidgetState() {
    if (!currentSession || currentSession.status !== "ACTIVE") {
      if (currentSession && currentSession.status === "COMPLETED") {
        statusBadge.className = "status-badge completed";
        statusText.textContent = "✓ QA Ended";
        setActivity(`QA Completed. ${currentSession.capturedCount} screenshots stored.`);

        let buttonsHtml = `
          <button class="btn btn-primary" id="btn-restart-qa">
            <span>🔄</span> Start New Session
          </button>
        `;
        if (lastCaptureId) {
          buttonsHtml += `
            <button class="btn btn-secondary btn-sm" id="btn-view-all">
              <span>↗</span> View Last Capture
            </button>
          `;
        }
        btnGroup.innerHTML = buttonsHtml;

        shadow.getElementById("btn-restart-qa")?.addEventListener("click", handleStartQA);
        shadow.getElementById("btn-view-all")?.addEventListener("click", () => openViewer(lastCaptureId));
      } else {
        statusBadge.className = "status-badge inactive";
        statusText.textContent = "QA Inactive";
        setActivity("Click 'Start QA' when course is open.");
        previewBar.style.display = "none";
        btnGroup.innerHTML = `
          <button class="btn btn-primary" id="btn-start-qa">
            <span>▶</span> Start QA Session
          </button>
        `;
        shadow.getElementById("btn-start-qa")?.addEventListener("click", handleStartQA);
      }
    } else {
      // Active state
      statusBadge.className = "status-badge active";
      statusText.textContent = "● QA Session Active";
      btnGroup.innerHTML = `
        <button class="btn btn-capture" id="btn-capture">
          <span>📸</span> Capture
        </button>
        <button class="btn btn-danger" id="btn-end-qa">
          <span>⏹</span> End QA
        </button>
      `;

      shadow.getElementById("btn-capture")?.addEventListener("click", handleManualCapture);
      shadow.getElementById("btn-end-qa")?.addEventListener("click", handleEndQA);
    }

    // Update metrics
    statCaptured.textContent = currentSession ? currentSession.capturedCount : "0";
    statAnalyzing.textContent = currentSession ? currentSession.analyzingCount : "0";
    statIssues.textContent = currentSession ? currentSession.issuesCount : "0";
  }

  // Action: Start QA
  function handleStartQA() {
    const courseTitle = document.title || "Course Review";
    setActivity("Starting new QA session...");
    lastCaptureId = null;
    previewBar.style.display = "none";

    chrome.runtime.sendMessage(
      { action: "START_QA_SESSION", courseName: courseTitle },
      (res) => {
        if (res && res.success) {
          currentSession = res.session;
          setActivity(`Session ${res.session.sessionId} started. Ready to capture.`, "success");
          renderWidgetState();
        } else {
          setActivity("Failed to initialize session.", "error");
        }
      }
    );
  }

  // Slide Detection Engine instance
  const slideDetector = new (window.CourseQASlideDetector || Object)();

  // Unified capture function for both manual and automatic triggers
  async function performCapture({ captureType = "manual", slideInfo = null }) {
    if (isCapturing) {
      console.log("[Content] Capture in progress, ignoring request.");
      return;
    }
    isCapturing = true;

    const captureBtn = shadow.getElementById("btn-capture");
    if (captureBtn && captureType === "manual") {
      captureBtn.disabled = true;
      captureBtn.innerHTML = `<span>⏳</span> Capturing...`;
    }

    setActivity(captureType === "automatic" ? "Capturing slide automatically..." : "Capturing slide viewport...", "info");

    try {
      // 1. Temporarily hide widget to avoid appearing in screenshot
      host.style.visibility = "hidden";

      // 2. Allow compositor to paint frame without widget
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });

      // 3. Request capture from background service worker
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "CAPTURE_SLIDE",
            captureType: captureType,
            slideNumber: slideInfo?.slideNumber || null,
            pageTitle: document.title,
            pageUrl: window.location.href
          },
          resolve
        );
      });

      // 4. Restore widget visibility
      host.style.visibility = "visible";

      if (response && response.success) {
        currentSession = response.session;
        lastCaptureId = response.captureId;

        // Mark fingerprint as captured in detector to prevent duplicate captures
        const currentFingerprint = slideInfo ? slideInfo.fingerprint : slideDetector.getSlideInfo().fingerprint;
        if (slideDetector.markCaptured) {
          slideDetector.markCaptured(currentFingerprint);
        }

        // Shutter flash animation
        triggerShutterFlash();

        // Update preview bar
        const totalCount = response.session?.capturedCount || response.session?.slides?.length || response.slide.captureNumber;
        previewText.textContent = totalCount > 1
          ? `Captured #${response.slide.captureNumber} (${totalCount} in session)`
          : `Captured #${response.slide.captureNumber} (${captureType})`;
        previewBar.style.display = "flex";

        const typeLabel = captureType === "automatic" ? "Captured Automatically" : "Captured (Manual)";
        setActivity(`✓ ${typeLabel}: Slide #${response.slide.captureNumber}`, "success");
        renderWidgetState();

        // Stage 4: trigger text extraction asynchronously – does not block capture
        scheduleTextExtraction({
          captureId: response.captureId,
          slideNumber: response.slide.slideNumber || response.slide.captureNumber,
          sessionId: response.session.sessionId
        });
      } else {
        const errorMsg = response?.error || "Capture request failed.";
        setActivity(`Capture Failed: ${errorMsg}`, "error");
      }
    } catch (err) {
      host.style.visibility = "visible";
      const errMsg = err?.message || (typeof err === "string" ? err : String(err || "Unknown error"));
      setActivity(`Capture error: ${errMsg}`, "error");
    } finally {
      host.style.visibility = "visible";
      isCapturing = false;
      const restoredBtn = shadow.getElementById("btn-capture");
      if (restoredBtn) {
        restoredBtn.disabled = false;
        restoredBtn.innerHTML = `<span>📸</span> Capture`;
      }
    }
  }

  /**
   * Stage 4: Asynchronously extract text from the current DOM state and
   * persist the result via the background service worker.
   * Runs entirely in the background – never blocks navigation or capture.
   */
  async function scheduleTextExtraction({ captureId, slideNumber, sessionId }) {
    console.log(`[Content] scheduleTextExtraction start: captureId=${captureId} slideNumber=${slideNumber}`);

    if (!window.CourseQATextExtractor) {
      console.warn("[Content] CourseQATextExtractor not available on window – text-extractor.js may not have loaded yet.");
      return;
    }

    // Give the slide one additional render cycle before reading DOM text
    await new Promise((r) => setTimeout(r, 150));

    let result;
    try {
      result = await window.CourseQATextExtractor.extractText({
        captureId,
        slideNumber
      });
      console.log(`[Content] Extraction complete: method=${result.method} status=${result.status} words=${result.wordCount}`);
    } catch (err) {
      console.error("[Content] CourseQATextExtractor.extractText threw:", err);
      return;
    }

    // Attach session ID before persisting
    result.sessionId = sessionId;

    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: "SAVE_TEXT_EXTRACTION", record: result },
          (res) => {
            // Must check lastError FIRST – Chrome logs an unchecked error if skipped
            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || "runtime error";
              console.error(`[Content] chrome.runtime.lastError in SAVE_TEXT_EXTRACTION: ${msg}`);
              reject(new Error(msg));
              return;
            }
            if (res && res.success) {
              console.log(`[Content] SAVE_TEXT_EXTRACTION succeeded for ${captureId}.`);
              resolve();
            } else {
              const errMsg = res?.error || "unknown service-worker error";
              console.warn(`[Content] SAVE_TEXT_EXTRACTION failed: ${errMsg}`);
              reject(new Error(errMsg));
            }
          }
        );
      });
    } catch (sendErr) {
      console.error("[Content] sendMessage(SAVE_TEXT_EXTRACTION) error:", sendErr);
    }
  }

  // Action: Start QA
  function handleStartQA() {
    const courseTitle = document.title || "Course Review";
    setActivity("Starting new QA session...");
    lastCaptureId = null;
    previewBar.style.display = "none";

    chrome.runtime.sendMessage(
      { action: "START_QA_SESSION", courseName: courseTitle },
      (res) => {
        if (res && res.success) {
          currentSession = res.session;
          setActivity(`QA Session Active (${res.session.sessionId})`, "success");
          renderWidgetState();

          // Initialize automatic slide detector
          if (slideDetector.start) {
            slideDetector.reset();
            slideDetector.start(
              (detectedSlide) => {
                console.log("[Content] Automatic slide detection callback:", detectedSlide);
                performCapture({ captureType: "automatic", slideInfo: detectedSlide });
              },
              (statusText) => {
                setActivity(statusText, "info");
              }
            );

            // Capture initial slide automatically on start
            const initialSlide = slideDetector.getSlideInfo();
            setTimeout(() => {
              if (currentSession && currentSession.status === "ACTIVE" && currentSession.capturedCount === 0) {
                performCapture({ captureType: "automatic", slideInfo: initialSlide });
              }
            }, 300);
          }
        } else {
          setActivity("Failed to initialize session.", "error");
        }
      }
    );
  }

  // Action: Manual Capture
  function handleManualCapture() {
    const currentSlide = slideDetector.getSlideInfo ? slideDetector.getSlideInfo() : null;
    performCapture({ captureType: "manual", slideInfo: currentSlide });
  }

  // Action: End QA
  function handleEndQA() {
    setActivity("Ending QA session and saving records...");

    // Stop automatic slide monitoring immediately
    if (slideDetector.stop) {
      slideDetector.stop();
    }

    chrome.runtime.sendMessage({ action: "END_QA_SESSION" }, (res) => {
      if (res && res.success) {
        currentSession = res.session;
        renderWidgetState();
        setActivity(`QA Ended. ${res.session.capturedCount} screenshots stored.`);
      } else {
        setActivity(res?.error || "Could not end session.", "error");
      }
    });
  }

  // Open Screenshot Viewer
  function openViewer(captureId) {
    chrome.runtime.sendMessage({
      action: "OPEN_VIEWER_TAB",
      captureId: captureId || "latest"
    });
  }

  btnViewPreview.addEventListener("click", () => {
    openViewer(lastCaptureId);
  });

  // Listen for broadcast messages from service worker or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "QA_SESSION_UPDATED") {
      currentSession = message.session;
      if (currentSession?.slides?.length > 0) {
        const lastSlide = currentSession.slides[currentSession.slides.length - 1];
        lastCaptureId = lastSlide.captureId;
        const totalCount = currentSession.capturedCount || currentSession.slides.length;
        previewText.textContent = totalCount > 1
          ? `Captured #${lastSlide.captureNumber} (${totalCount} in session)`
          : `Captured #${lastSlide.captureNumber} (${lastSlide.captureType || "manual"})`;
        previewBar.style.display = "flex";
      }

      // Sync detector lifecycle with session status
      if (currentSession && currentSession.status === "ACTIVE" && !slideDetector.isActive && slideDetector.start) {
        slideDetector.start(
          (detectedSlide) => performCapture({ captureType: "automatic", slideInfo: detectedSlide }),
          (statusText) => setActivity(statusText, "info")
        );
      } else if ((!currentSession || currentSession.status !== "ACTIVE") && slideDetector.isActive && slideDetector.stop) {
        slideDetector.stop();
      }

      renderWidgetState();
    } else if (message.action === "SET_WIDGET_VISIBILITY") {
      host.style.display = message.visible ? "block" : "none";
    }
  });

  // Initial status check upon injection
  chrome.runtime.sendMessage({ action: "GET_QA_STATUS" }, (response) => {
    if (response) {
      if (response.activeSession) {
        currentSession = response.activeSession;
        if (currentSession?.slides?.length > 0) {
          const lastSlide = currentSession.slides[currentSession.slides.length - 1];
          lastCaptureId = lastSlide.captureId;
          previewText.textContent = `Captured #${lastSlide.captureNumber} (${lastSlide.captureType || "manual"})`;
          previewBar.style.display = "flex";
        }

        // Resume automatic monitoring if session was already active
        if (currentSession.status === "ACTIVE" && !slideDetector.isActive && slideDetector.start) {
          slideDetector.start(
            (detectedSlide) => performCapture({ captureType: "automatic", slideInfo: detectedSlide }),
            (statusText) => setActivity(statusText, "info")
          );
        }
      } else if (response.lastCompletedSession) {
        currentSession = response.lastCompletedSession;
      }
      if (response.widgetVisible === false) {
        host.style.display = "none";
      }
      renderWidgetState();
    }
  });

  // Initial start button handler
  shadow.getElementById("btn-start-qa")?.addEventListener("click", handleStartQA);
})();
