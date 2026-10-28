// Course QA Assistant - Screenshot Viewer Controller
// Stage 2: Screenshot loading and metadata display
// Stage 4: Extracted text display and status handling
// Multi-Slide Navigation: Session slide browsing, filmstrip gallery, Prev/Next buttons & keyboard arrows

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  let activeCaptureId = urlParams.get("id");

  const loadingView         = document.getElementById("loading-view");
  const imgEl               = document.getElementById("screenshot-img");
  const valCaptureId        = document.getElementById("val-capture-id");
  const valSessionId        = document.getElementById("val-session-id");
  const valCaptureNum       = document.getElementById("val-capture-num");
  const valCaptureType      = document.getElementById("val-capture-type");
  const valTimestamp        = document.getElementById("val-timestamp");
  const valResolution       = document.getElementById("val-resolution");
  const valSize             = document.getElementById("val-size");
  const valStatus           = document.getElementById("val-status");
  const pageSource          = document.getElementById("page-source");
  const btnDownload         = document.getElementById("btn-download");
  const btnCopyId           = document.getElementById("btn-copy-id");

  // Multi-Slide Navigation elements
  const slideNavGroup       = document.getElementById("slide-nav-group");
  const btnPrevSlide        = document.getElementById("btn-prev-slide");
  const btnNextSlide        = document.getElementById("btn-next-slide");
  const slideCounterBadge   = document.getElementById("slide-counter-badge");
  const slidesStripContainer = document.getElementById("slides-strip-container");
  const slidesStrip         = document.getElementById("slides-strip");
  const stripCount          = document.getElementById("strip-count");

  // Text panel elements (Stage 4)
  const textContentBody     = document.getElementById("text-content-body");
  const valWordCount        = document.getElementById("val-word-count");
  const valExtractMethod    = document.getElementById("val-extract-method");
  const valExtractStatus    = document.getElementById("val-extract-status");
  const valExtractTs        = document.getElementById("val-extract-ts");
  const valExtractNotes     = document.getElementById("val-extract-notes");

  // Analysis panel elements (Stage 6)
  const valAnalysisCount    = document.getElementById("val-analysis-count");
  const valAnalysisStatus   = document.getElementById("val-analysis-status");
  const analysisFindingsBody = document.getElementById("analysis-findings-body");
  const btnRetryAnalysis    = document.getElementById("btn-retry-analysis");

  let currentRecord = null;
  let sessionSlides = []; // List of all captures in this session

  console.log("[Viewer] Initialised. captureId from URL:", activeCaptureId);

  // ------------------------------------------------------------------
  // Initial Load
  // ------------------------------------------------------------------
  if (!activeCaptureId) {
    loadingView.className = "error-state";
    loadingView.textContent = "No capture ID in URL. Open the viewer via the QA widget or popup.";
    showTextPanelState("pending", "No capture ID supplied in viewer URL.");
    return;
  }

  loadScreenshot(activeCaptureId);

  // ------------------------------------------------------------------
  // Load screenshot record by captureId
  // ------------------------------------------------------------------
  function loadScreenshot(targetCaptureId) {
    activeCaptureId = targetCaptureId;
    loadingView.style.display = "block";
    loadingView.className = "loading-state";
    loadingView.textContent = "Loading high-resolution screenshot from IndexedDB…";
    imgEl.style.display = "none";

    try {
      chrome.runtime.sendMessage(
        { action: "GET_SCREENSHOT", captureId: targetCaptureId },
        (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "Extension runtime error";
            console.error("[Viewer] GET_SCREENSHOT runtime error:", msg);
            loadingView.className = "error-state";
            loadingView.textContent = `Extension error: ${msg}`;
            showTextPanelState("failed", `Extension error: ${msg}`);
            return;
          }

          if (!response || !response.success || !response.record) {
            const errMsg = response?.error || `Screenshot not found for ID: ${targetCaptureId}`;
            console.warn("[Viewer] GET_SCREENSHOT failed:", errMsg);
            loadingView.className = "error-state";
            loadingView.textContent = errMsg;
            showTextPanelState("failed", "Screenshot not found — cannot load text extraction.");
            return;
          }

          console.log("[Viewer] Screenshot loaded:", response.record.captureId);
          currentRecord = response.record;
          renderScreenshot(currentRecord);
          loadTextExtraction(currentRecord.captureId, /* retryCount= */ 0);
          loadAnalysisFindings(currentRecord.captureId, /* retryCount= */ 0);

          // Update URL without page reload
          const newUrl = `${window.location.pathname}?id=${encodeURIComponent(targetCaptureId)}`;
          window.history.replaceState(null, "", newUrl);

          // Fetch all captures for session to populate navigator & filmstrip
          if (currentRecord.sessionId && sessionSlides.length === 0) {
            loadSessionSlides(currentRecord.sessionId);
          } else {
            updateSlideNavState();
          }
        }
      );
    } catch (err) {
      const errMsg = err?.message || (typeof err === "string" ? err : String(err || "Unknown error"));
      console.error("[Viewer] sendMessage(GET_SCREENSHOT) threw:", errMsg);
      loadingView.className = "error-state";
      loadingView.textContent = `Failed to load screenshot: ${errMsg}`;
      showTextPanelState("failed", errMsg);
    }
  }

  // ------------------------------------------------------------------
  // Load all session screenshots for multi-slide browsing
  // ------------------------------------------------------------------
  function loadSessionSlides(sessionId) {
    chrome.runtime.sendMessage(
      { action: "GET_SESSION_SCREENSHOTS", sessionId },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.success || !res.screenshots) {
          console.warn("[Viewer] Could not fetch session screenshots list.");
          return;
        }

        sessionSlides = res.screenshots || [];
        console.log(`[Viewer] Loaded ${sessionSlides.length} screenshots for session ${sessionId}`);

        if (sessionSlides.length > 1) {
          renderSlidesFilmstrip();
          updateSlideNavState();
        }
      }
    );
  }

  function renderSlidesFilmstrip() {
    slidesStripContainer.style.display = "block";
    slideNavGroup.style.display = "inline-flex";
    stripCount.textContent = sessionSlides.length;
    slidesStrip.innerHTML = "";

    sessionSlides.forEach((slide, idx) => {
      const isCurrent = slide.captureId === activeCaptureId;
      const tab = document.createElement("div");
      tab.className = `slide-tab ${isCurrent ? "active" : ""}`;
      tab.dataset.id = slide.captureId;
      tab.title = `Click to view Slide #${slide.captureNumber}`;

      const title = slide.pageTitle || `Slide #${slide.captureNumber}`;
      const type = (slide.captureType || "auto").toUpperCase();
      const time = slide.timestamp ? new Date(slide.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "";

      tab.innerHTML = `
        <span class="slide-tab-num">#${slide.captureNumber}</span>
        <div class="slide-tab-info">
          <span class="slide-tab-title">${title}</span>
          <span class="slide-tab-meta"><span>${type}</span> • <span>${time}</span></span>
        </div>
      `;

      tab.addEventListener("click", () => {
        if (slide.captureId !== activeCaptureId) {
          loadScreenshot(slide.captureId);
        }
      });

      slidesStrip.appendChild(tab);
    });
  }

  function updateSlideNavState() {
    if (!sessionSlides.length) return;

    const currentIndex = sessionSlides.findIndex((s) => s.captureId === activeCaptureId);
    const total = sessionSlides.length;

    if (currentIndex >= 0) {
      slideCounterBadge.textContent = `Slide ${currentIndex + 1} of ${total}`;
      btnPrevSlide.disabled = currentIndex <= 0;
      btnNextSlide.disabled = currentIndex >= total - 1;

      // Update active highlight in filmstrip
      const tabs = slidesStrip.querySelectorAll(".slide-tab");
      tabs.forEach((tab) => {
        if (tab.dataset.id === activeCaptureId) {
          tab.classList.add("active");
          tab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        } else {
          tab.classList.remove("active");
        }
      });
    }
  }

  // ------------------------------------------------------------------
  // Previous & Next Navigation Handlers
  // ------------------------------------------------------------------
  btnPrevSlide.addEventListener("click", () => {
    const currentIndex = sessionSlides.findIndex((s) => s.captureId === activeCaptureId);
    if (currentIndex > 0) {
      loadScreenshot(sessionSlides[currentIndex - 1].captureId);
    }
  });

  btnNextSlide.addEventListener("click", () => {
    const currentIndex = sessionSlides.findIndex((s) => s.captureId === activeCaptureId);
    if (currentIndex >= 0 && currentIndex < sessionSlides.length - 1) {
      loadScreenshot(sessionSlides[currentIndex + 1].captureId);
    }
  });

  // Keyboard navigation: Left Arrow (←) / Right Arrow (→)
  window.addEventListener("keydown", (e) => {
    // Avoid interfering if user is inside an input
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "ArrowLeft") {
      const currentIndex = sessionSlides.findIndex((s) => s.captureId === activeCaptureId);
      if (currentIndex > 0) {
        loadScreenshot(sessionSlides[currentIndex - 1].captureId);
      }
    } else if (e.key === "ArrowRight") {
      const currentIndex = sessionSlides.findIndex((s) => s.captureId === activeCaptureId);
      if (currentIndex >= 0 && currentIndex < sessionSlides.length - 1) {
        loadScreenshot(sessionSlides[currentIndex + 1].captureId);
      }
    }
  });

  // ------------------------------------------------------------------
  // Render screenshot metadata + image
  // ------------------------------------------------------------------
  function renderScreenshot(record) {
    valCaptureId.textContent  = record.captureId;
    valSessionId.textContent  = record.sessionId;
    valCaptureNum.textContent = `#${record.captureNumber}`;

    const capType = (record.captureType || "manual").toLowerCase();
    valCaptureType.innerHTML = `<span class="type-badge ${capType}">${capType.toUpperCase()}</span>`;

    valTimestamp.textContent = new Date(record.timestamp).toLocaleTimeString();
    valStatus.textContent    = record.textExtractionStatus || record.analysisStatus || "pending";

    if (record.pageTitle) {
      pageSource.textContent = `${record.pageTitle} • ${record.pageUrl || ""}`;
    }

    const kb = Math.round((record.sizeBytes || record.dataUrl.length) / 1024);
    valSize.textContent = `${kb} KB`;

    imgEl.src = record.dataUrl;
    imgEl.onload = () => {
      valResolution.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight} px`;
      loadingView.style.display = "none";
      imgEl.style.display = "block";
    };
  }

  // ------------------------------------------------------------------
  // Load and render extracted text (Stage 4)
  // Distinguishes "not yet available" from confirmed errors.
  // Retries once after 1.5 seconds if record is not yet present.
  // ------------------------------------------------------------------
  function loadTextExtraction(cId, retryCount = 0) {
    console.log(`[Viewer] loadTextExtraction attempt ${retryCount + 1} for captureId=${cId}`);

    if (retryCount === 0) {
      showTextPanelState("pending", "Loading extracted text…");
    } else {
      showTextPanelState("pending", "Retrying text extraction retrieval…");
    }

    chrome.runtime.sendMessage(
      { action: "GET_TEXT_EXTRACTION", captureId: cId },
      (response) => {
        // If user already navigated to another slide while request was inflight, ignore
        if (cId !== activeCaptureId) return;

        // Check for extension runtime error
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "Extension runtime error";
          console.error(`[Viewer] Failed to retrieve text extraction for ${cId}:`, msg);
          showTextPanelState("failed", `Extension error: ${msg}`);
          return;
        }

        console.log(`[Viewer] GET_TEXT_EXTRACTION response for ${cId}:`, response?.success ? "success" : response?.error);

        // Success: extraction record exists
        if (response && response.success && response.record) {
          renderTextExtraction(response.record);
          return;
        }

        // Record is missing / not yet available (async extraction in progress)
        if (response?.notYetAvailable) {
          if (retryCount < 1) {
            console.log(`[Viewer] Extraction not yet available for ${cId}; scheduling retry in 1.5 seconds…`);
            showTextPanelState(
              "pending",
              "Text extraction is still processing… retrying in 1.5 seconds."
            );
            setTimeout(() => {
              if (cId === activeCaptureId) {
                loadTextExtraction(cId, retryCount + 1);
              }
            }, 1500);
            return;
          }

          // If still missing after retry, show neutral state explaining extraction may still be running or no result was saved
          console.log(`[Viewer] Extraction record still not available after retry for ${cId}.`);
          showTextPanelState(
            "not-yet-available",
            "Text extraction is not yet available. Extraction may still be running or no result was saved for this slide."
          );
          return;
        }

        // Actual confirmed failure from service worker (e.g., database error or invalid ID)
        const errMsg = response?.error || "Failed to retrieve text extraction.";
        console.error(`[Viewer] Failed to retrieve text extraction for ${cId}:`, errMsg);
        showTextPanelState("failed", errMsg);
      }
    );
  }

  function renderTextExtraction(ex) {
    console.log(`[Viewer] renderTextExtraction for ${ex.captureId || activeCaptureId}: status=${ex.status}, words=${ex.wordCount || 0}`);

    const status = ex.status || "pending";
    const statusKey = status.toLowerCase().replace(/\s+/g, "-");
    valExtractStatus.textContent = status.toUpperCase();
    valExtractStatus.className   = `text-status-badge ${statusKey}`;

    valWordCount.textContent     = `${ex.wordCount !== undefined ? ex.wordCount : 0} words`;
    valExtractMethod.textContent = ex.method || "unknown";

    if (ex.extractionTimestamp) {
      valExtractTs.textContent = `Extracted: ${new Date(ex.extractionTimestamp).toLocaleTimeString()}`;
    }

    if (ex.notes) {
      valExtractNotes.textContent = ex.notes;
    }

    if (status === "failed") {
      textContentBody.textContent = ex.notes || "Text extraction failed for this slide.";
      textContentBody.className   = "text-content empty";
      return;
    }

    if (ex.extractedText && ex.extractedText.trim().length > 0) {
      textContentBody.textContent = ex.extractedText;
      textContentBody.className   = "text-content";
    } else {
      textContentBody.textContent = "No text was extracted from this slide.";
      textContentBody.className   = "text-content empty";
    }
  }

  /**
   * Updates text extraction panel state.
   * "pending" or "not-yet-available" renders neutral badge (grey).
   * "failed" renders red badge.
   */
  function showTextPanelState(status, msg) {
    const statusKey = (status || "pending").toLowerCase().replace(/\s+/g, "-");
    const displayLabel = status === "not-yet-available" ? "NOT YET AVAILABLE" : (status || "PENDING").toUpperCase();
    valExtractStatus.textContent = displayLabel;
    valExtractStatus.className   = `text-status-badge ${statusKey}`;
    textContentBody.textContent  = msg || "No details available.";
    textContentBody.className    = "text-content empty";
    valWordCount.textContent     = "–";
    valExtractMethod.textContent = "–";
  }

  // ------------------------------------------------------------------
  // Stage 6: Load and render Language Analysis Findings
  // ------------------------------------------------------------------
  function loadAnalysisFindings(cId, retryCount = 0) {
    console.log(`[Viewer] loadAnalysisFindings attempt ${retryCount + 1} for captureId=${cId}`);

    if (retryCount === 0) {
      valAnalysisStatus.textContent = "LOADING…";
      valAnalysisStatus.className = "analysis-status-badge pending";
      valAnalysisCount.textContent = "–";
      analysisFindingsBody.innerHTML = '<div class="analysis-empty">Loading analysis findings…</div>';
    }

    chrome.runtime.sendMessage(
      { action: "GET_ANALYSIS_FINDINGS", captureId: cId },
      (res) => {
        if (cId !== activeCaptureId) return;

        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "Runtime error";
          console.error(`[Viewer] GET_ANALYSIS_FINDINGS runtime error:`, msg);
          valAnalysisStatus.textContent = "FAILED";
          valAnalysisStatus.className = "analysis-status-badge failed";
          analysisFindingsBody.innerHTML = `<div class="analysis-empty" style="color: #f87171;">Extension error: ${msg}</div>`;
          return;
        }

        if (!res || !res.success) {
          const errMsg = res?.error || "Could not retrieve analysis findings.";
          console.warn(`[Viewer] GET_ANALYSIS_FINDINGS failed:`, errMsg);
          valAnalysisStatus.textContent = "FAILED";
          valAnalysisStatus.className = "analysis-status-badge failed";
          analysisFindingsBody.innerHTML = `<div class="analysis-empty" style="color: #f87171;">${errMsg}</div>`;
          return;
        }

        const status = (res.analysisStatus || "pending").toLowerCase();

        // If analyzing or pending, retry up to 4 times after 1.5 seconds to await background completion
        if ((status === "analyzing" || status === "pending") && retryCount < 4) {
          valAnalysisStatus.textContent = "ANALYZING…";
          valAnalysisStatus.className = "analysis-status-badge analyzing";
          valAnalysisCount.textContent = "in progress";
          analysisFindingsBody.innerHTML = '<div class="analysis-empty">Language analysis is currently running… checking for updates.</div>';
          setTimeout(() => {
            if (cId === activeCaptureId) {
              loadAnalysisFindings(cId, retryCount + 1);
            }
          }, 1500);
          return;
        }

        renderAnalysisFindings(res);
      }
    );
  }

  function renderAnalysisFindings(data) {
    const status = (data.analysisStatus || "completed").toLowerCase();
    const findings = Array.isArray(data.findings) ? data.findings : [];

    valAnalysisStatus.textContent = status.toUpperCase();
    valAnalysisStatus.className = `analysis-status-badge ${status}`;

    valAnalysisCount.textContent = `${findings.length} issue${findings.length === 1 ? "" : "s"}`;

    if (status === "failed") {
      analysisFindingsBody.innerHTML = `
        <div class="analysis-empty" style="color: #f87171;">
          <strong>Analysis Failed:</strong> ${data.analysisError || "Language service encountered an error."}
          <div style="margin-top: 8px;">
            <button class="btn btn-sm btn-retry-analysis" id="btn-inline-retry">Try Again</button>
          </div>
        </div>
      `;
      const inlineRetry = document.getElementById("btn-inline-retry");
      if (inlineRetry) {
        inlineRetry.addEventListener("click", () => btnRetryAnalysis.click());
      }
      return;
    }

    if (status === "skipped") {
      analysisFindingsBody.innerHTML = `
        <div class="analysis-empty">
          Analysis skipped: ${data.analysisError || "No usable text was detected on this slide."}
        </div>
      `;
      return;
    }

    if (findings.length === 0) {
      analysisFindingsBody.innerHTML = `
        <div class="analysis-clean-state">
          <span>✓ No grammar, spelling, or punctuation issues detected.</span>
          <span style="font-size: 11px; color: #64748b; font-weight: normal;">This slide passed automated language checks.</span>
        </div>
      `;
      return;
    }

    analysisFindingsBody.innerHTML = "";

    findings.forEach((finding) => {
      const card = document.createElement("div");
      card.className = "finding-card";

      const cat = finding.category || "grammar";
      const sev = (finding.severity || "medium").toUpperCase();

      let suggestionsHtml = "";
      if (Array.isArray(finding.suggestions) && finding.suggestions.length > 0) {
        suggestionsHtml = `
          <div class="finding-suggestions">
            <span class="suggestion-label">Suggestions:</span>
            ${finding.suggestions.map((s) => `<span class="suggestion-pill">→ ${s}</span>`).join(" ")}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="finding-header">
          <span class="finding-cat-badge ${cat}">${cat.replace("-", " ").toUpperCase()}</span>
          <span class="finding-severity">${sev}</span>
        </div>
        <div class="finding-content">
          ${finding.originalText ? `<span class="finding-original">"${finding.originalText}"</span>` : ""}
          <span class="finding-message">${finding.message}</span>
        </div>
        ${suggestionsHtml}
      `;

      analysisFindingsBody.appendChild(card);
    });
  }

  // Re-run language analysis
  btnRetryAnalysis.addEventListener("click", () => {
    if (!activeCaptureId) return;
    valAnalysisStatus.textContent = "ANALYZING…";
    valAnalysisStatus.className = "analysis-status-badge analyzing";
    chrome.runtime.sendMessage(
      { action: "ANALYZE_CAPTURE_TEXT", captureId: activeCaptureId },
      () => {
        setTimeout(() => {
          loadAnalysisFindings(activeCaptureId, 0);
        }, 800);
      }
    );
  });

  // ------------------------------------------------------------------
  // Download screenshot
  // ------------------------------------------------------------------
  btnDownload.addEventListener("click", () => {
    if (!currentRecord || !currentRecord.dataUrl) return;

    const filename = `${currentRecord.sessionId}_slide_${String(currentRecord.captureNumber).padStart(3, "0")}.png`;
    const a = document.createElement("a");
    a.href = currentRecord.dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // ------------------------------------------------------------------
  // Copy capture ID
  // ------------------------------------------------------------------
  btnCopyId.addEventListener("click", () => {
    if (!currentRecord) return;
    navigator.clipboard.writeText(currentRecord.captureId);
    btnCopyId.textContent = "✓ Copied!";
    setTimeout(() => {
      btnCopyId.textContent = "📋 Copy ID";
    }, 1500);
  });
});
