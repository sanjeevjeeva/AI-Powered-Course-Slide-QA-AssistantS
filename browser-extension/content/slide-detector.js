// Course QA Assistant - Slide Detection Engine
// Stage 3: Automatic Slide Detection & Multi-heuristic Transition Monitoring

(function () {
  class SlideDetector {
    constructor() {
      this.isActive = false;
      this.settleDelayMs = 450; // Rendering & transition settle delay
      this.cooldownMs = 900;    // Minimum time between automatic captures
      this.lastCapturedFingerprint = null;
      this.lastCaptureTimestamp = 0;
      this.settleTimer = null;
      this.observer = null;
      this.onSlideDetectedCallback = null;
      this.onStatusCallback = null;

      // Bound event listeners
      this._boundOnCourseEvent = this._onCourseEvent.bind(this);
      this._boundOnHistoryChange = this._onHistoryChange.bind(this);
      this._boundOnMutation = this._onMutation.bind(this);
    }

    /**
     * Inspects the DOM and returns structured information about the current slide.
     */
    getSlideInfo() {
      // 1. Look for active slide container (covers custom decks, SCORM, Reveal.js, Swiper, etc.)
      const activeSlide = document.querySelector(
        ".slide.active, [data-slide].active, .active-slide, .carousel-item.active, .swiper-slide-active, [aria-current='step'], [aria-current='true']"
      );

      // 2. Extract slide number / identifier
      let slideNumber = null;
      if (activeSlide && activeSlide.getAttribute("data-slide")) {
        slideNumber = activeSlide.getAttribute("data-slide");
      }

      // Check text indicator (e.g., "Slide 2 of 5" or "2 / 5")
      let indicatorText = "";
      const indicatorEl = document.querySelector(
        "#slide-indicator, .slide-indicator, .slide-counter, .progress-text, [data-slide-indicator]"
      );
      if (indicatorEl) {
        indicatorText = indicatorEl.textContent.trim();
        if (!slideNumber) {
          const match = indicatorText.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i) || indicatorText.match(/Slide\s*(\d+)/i);
          if (match) slideNumber = match[1];
        }
      }

      // 3. Extract slide title / heading
      let slideTitle = "";
      let headingEl = null;
      if (activeSlide) {
        headingEl = activeSlide.querySelector("h1, h2, h3, .slide-heading, .slide-title");
      }
      if (!headingEl) {
        headingEl = document.querySelector("h1, h2");
      }
      if (headingEl) {
        slideTitle = headingEl.textContent.trim().replace(/\s+/g, " ").slice(0, 80);
      }

      // 4. Extract URL route / hash
      const urlHash = window.location.hash || window.location.search || "";

      // 5. Compute distinct fingerprint
      // Incorporates slide number, indicator, heading, and URL hash
      const fingerprint = `num:${slideNumber || "auto"}|ind:${indicatorText}|h:${slideTitle}|url:${urlHash}`;

      return {
        slideNumber: slideNumber ? parseInt(slideNumber, 10) : null,
        indicatorText: indicatorText || (slideNumber ? `Slide ${slideNumber}` : "Unknown Slide"),
        slideTitle: slideTitle || "Untitled Slide",
        fingerprint: fingerprint
      };
    }

    /**
     * Starts listening for slide navigation events and DOM transitions.
     */
    start(onSlideDetected, onStatus) {
      if (this.isActive) return;
      this.isActive = true;
      this.onSlideDetectedCallback = onSlideDetected;
      this.onStatusCallback = onStatus;

      console.log("[SlideDetector] Started automatic slide monitoring.");

      // 1. Listen for custom course events (such as demo course's course:slideChanged)
      window.addEventListener("course:slideChanged", this._boundOnCourseEvent);
      window.addEventListener("slideChanged", this._boundOnCourseEvent);
      window.addEventListener("slidechange", this._boundOnCourseEvent);

      // 2. Listen for URL hash / history transitions
      window.addEventListener("hashchange", this._boundOnHistoryChange);
      window.addEventListener("popstate", this._boundOnHistoryChange);

      // 3. Attach MutationObserver to detect DOM modifications
      this._initMutationObserver();

      // Establish initial baseline fingerprint of currently loaded slide
      const initialInfo = this.getSlideInfo();
      console.log("[SlideDetector] Initial slide baseline:", initialInfo.fingerprint);
    }

    /**
     * Stops monitoring and cancels all pending settle timers.
     */
    stop() {
      this.isActive = false;
      if (this.settleTimer) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }

      window.removeEventListener("course:slideChanged", this._boundOnCourseEvent);
      window.removeEventListener("slideChanged", this._boundOnCourseEvent);
      window.removeEventListener("slidechange", this._boundOnCourseEvent);
      window.removeEventListener("hashchange", this._boundOnHistoryChange);
      window.removeEventListener("popstate", this._boundOnHistoryChange);

      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      this.onSlideDetectedCallback = null;
      this.onStatusCallback = null;
      console.log("[SlideDetector] Stopped slide monitoring.");
    }

    /**
     * Resets capture baseline when starting a brand new QA session.
     */
    reset() {
      this.lastCapturedFingerprint = null;
      this.lastCaptureTimestamp = 0;
      if (this.settleTimer) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
    }

    /**
     * Updates the last captured fingerprint to prevent duplicate capture.
     */
    markCaptured(fingerprint) {
      this.lastCapturedFingerprint = fingerprint;
      this.lastCaptureTimestamp = Date.now();
      console.log("[SlideDetector] Fingerprint marked as captured:", fingerprint);
    }

    // ---------------------------------------------------------
    // Private Event Handlers
    // ---------------------------------------------------------

    _initMutationObserver() {
      if (this.observer) this.observer.disconnect();

      this.observer = new MutationObserver(this._boundOnMutation);

      // Observe body for structural changes, class toggles, and attribute modifications
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-current", "data-slide", "style", "hidden"]
      });
    }

    _onMutation(mutations) {
      if (!this.isActive) return;

      // Filter out mutations occurring inside the QA assistant's own host element
      let relevantChange = false;
      for (const m of mutations) {
        const target = m.target;
        if (!target) continue;

        // Ignore our own QA widget host and shadow DOM
        if (target.id === "course-qa-assistant-host" || (target.closest && target.closest("#course-qa-assistant-host"))) {
          continue;
        }

        // Ignore script, style, meta elements
        if (target.nodeName === "SCRIPT" || target.nodeName === "STYLE" || target.nodeName === "LINK") {
          continue;
        }

        relevantChange = true;
        break;
      }

      if (relevantChange) {
        this._scheduleEvaluation("mutation");
      }
    }

    _onCourseEvent(event) {
      if (!this.isActive) return;
      console.log("[SlideDetector] Received course custom event:", event.type, event.detail);
      this._scheduleEvaluation("event", event.detail);
    }

    _onHistoryChange() {
      if (!this.isActive) return;
      this._scheduleEvaluation("url");
    }

    /**
     * Debounces slide evaluation to allow content rendering and CSS transitions to finish.
     */
    _scheduleEvaluation(source, eventDetail) {
      if (!this.isActive) return;

      // Notify widget of detection activity if waiting
      if (this.onStatusCallback) {
        this.onStatusCallback("Slide Change Detected");
      }

      // Reset settle timer on subsequent changes (debouncing)
      if (this.settleTimer) {
        clearTimeout(this.settleTimer);
      }

      this.settleTimer = setTimeout(() => {
        this._evaluateSlideTransition(source, eventDetail);
      }, this.settleDelayMs);
    }

    /**
     * Verifies whether the slide has genuinely changed from the last captured state.
     */
    _evaluateSlideTransition(source, eventDetail) {
      if (!this.isActive) return;

      const slideInfo = this.getSlideInfo();

      // If custom event provided explicit details, supplement slide info
      if (eventDetail) {
        if (eventDetail.slideNumber && !slideInfo.slideNumber) {
          slideInfo.slideNumber = eventDetail.slideNumber;
        }
        if (eventDetail.slideTitle && !slideInfo.slideTitle) {
          slideInfo.slideTitle = eventDetail.slideTitle;
        }
      }

      // Check if current slide fingerprint matches the last captured slide
      if (this.lastCapturedFingerprint && this.lastCapturedFingerprint === slideInfo.fingerprint) {
        console.log("[SlideDetector] Suppressed duplicate capture for existing fingerprint:", slideInfo.fingerprint);
        return;
      }

      // Respect minimum cooldown between captures to prevent rapid-fire triggers
      const now = Date.now();
      if (now - this.lastCaptureTimestamp < this.cooldownMs) {
        console.log("[SlideDetector] Suppressed capture due to cooldown lock.");
        return;
      }

      console.log("[SlideDetector] Genuine slide change detected via", source, ":", slideInfo);

      // Invoke the capture coordinator
      if (this.onSlideDetectedCallback) {
        this.onSlideDetectedCallback(slideInfo);
      }
    }
  }

  // Export to content script window scope
  window.CourseQASlideDetector = SlideDetector;
})();
