// Course QA Assistant - Text Extractor
// Stage 4: Extract visible text from the active slide DOM.
// Runs as a content script. Exports window.CourseQATextExtractor.

(function () {
  /**
   * TAGS whose text content should NEVER be extracted, even if visible.
   * Covers scripts, styles, and the QA assistant host element.
   */
  const BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "HEAD"]);

  /**
   * CSS selectors for elements that are considered hidden or irrelevant.
   * [aria-hidden], [hidden], display:none, visibility:hidden, opacity:0
   * are handled at node level by isVisible().
   */
  const QA_HOST_ID = "course-qa-assistant-host";

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Returns true when the element carries visible, meaningful text.
   * Uses computed styles to exclude invisible elements.
   */
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.id === QA_HOST_ID) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) < 0.05) return false;
    if (el.hasAttribute("hidden")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;

    const rect = el.getBoundingClientRect();
    // Accept zero-size containers – they may have visible children
    return true;
  }

  /**
   * Returns true when the node is inside the QA widget host element.
   */
  function isInsideQAWidget(node) {
    let cur = node;
    while (cur) {
      if (cur.id === QA_HOST_ID) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  /**
   * Determines whether a slide container is a known canvas / image-only slide.
   */
  function isCanvasOrImageSlide(container) {
    const children = Array.from(container?.children || []);
    if (!children.length) return false;
    return children.every(
      (c) => c.tagName === "CANVAS" || c.tagName === "IMG" || c.tagName === "VIDEO"
    );
  }

  // ----------------------------------------------------------------
  // DOM Text Extraction
  // ----------------------------------------------------------------

  /**
   * Walk a DOM subtree and collect text from visible leaf nodes.
   * Skips the QA widget, invisible elements, and blocked tag types.
   * Returns an ordered array of text segments.
   */
  function collectTextFromNode(root, segments = []) {
    if (!root) return segments;
    if (isInsideQAWidget(root)) return segments;
    if (BLOCKED_TAGS.has(root.nodeName)) return segments;

    if (root.nodeType === Node.TEXT_NODE) {
      const text = root.textContent.trim();
      if (text.length > 0) segments.push(text);
      return segments;
    }

    if (root.nodeType !== Node.ELEMENT_NODE) return segments;
    if (!isVisible(root)) return segments;

    for (const child of root.childNodes) {
      collectTextFromNode(child, segments);
    }
    return segments;
  }

  /**
   * Find the active slide container using a prioritised list of selectors.
   * Returns null if no match is found (fallback to full-page extraction).
   */
  function findActiveSlideContainer() {
    const selectors = [
      // Demo course + common patterns
      ".slide.active",
      "[data-slide].active",
      ".active-slide",
      // Reveal.js
      ".reveal .slides section.present",
      // Impress.js
      ".impress-on-step.step",
      // Swiper
      ".swiper-slide-active",
      // ARIA-based
      "[role='main']",
      // Generic fallback containers
      "main",
      "#slide-stage",
      ".slide-stage",
      "#course-content",
      ".course-content"
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && !isInsideQAWidget(el)) {
          console.log(`[TextExtractor] Active slide container found via selector: '${sel}'`);
          return el;
        }
      } catch (_) {}
    }
    console.log("[TextExtractor] No active slide container matched any selector; will fall back to body.");
    return null;
  }

  // ----------------------------------------------------------------
  // OCR Integration Point
  // ----------------------------------------------------------------

  /**
   * OCR stub – returns a structured result indicating OCR is not yet
   * connected.  Replace the body of this function with a real OCR call
   * (e.g. Tesseract.js WASM, or a backend endpoint) when Stage 5 needs it.
   *
   * @param {string} dataUrl  - PNG data URL from IndexedDB
   * @returns {Promise<{text: string, confidence: number}>}
   */
  async function performOCR(dataUrl) {
    // Integration point: swap with Tesseract.js or backend OCR
    console.log("[TextExtractor] OCR integration point called – not yet connected.");
    return { text: "", confidence: 0, note: "OCR not connected in Stage 4" };
  }

  // ----------------------------------------------------------------
  // Public Interface
  // ----------------------------------------------------------------

  /**
   * Extract visible text from the current slide.
   *
   * Strategy (in priority order):
   *   1. Active slide container via known CSS selectors → DOM walk
   *   2. Body-level DOM walk (filtered, excluding widget)
   *   3. OCR integration point (canvas / image-only slides)
   *
   * @param {object} opts
   * @param {string} opts.captureId    - Associated screenshot captureId
   * @param {number} opts.slideNumber  - Slide number for context
   * @param {string} [opts.dataUrl]    - PNG data URL for OCR fallback
   * @returns {Promise<object>}        - Extraction result record
   */
  async function extractText({ captureId, slideNumber, dataUrl }) {
    console.log(`[TextExtractor] extractText called: captureId=${captureId} slideNumber=${slideNumber}`);
    const timestamp = new Date().toISOString();
    let method = "dom-active-slide";
    let status = "pending";
    let extractedText = "";
    let wordCount = 0;
    let confidence = null;
    let notes = [];

    try {
      // 1. Try to find the active slide container
      const slideContainer = findActiveSlideContainer();

      if (slideContainer) {
        // Check if it's a canvas / image-only slide → fall through to OCR
        if (isCanvasOrImageSlide(slideContainer)) {
          method = "ocr-fallback";
          notes.push("Slide is canvas/image-only; DOM text extraction not applicable.");
          console.log("[TextExtractor] Canvas/image-only slide detected; OCR integration point.");

          if (dataUrl) {
            status = "extracting";
            const ocrResult = await performOCR(dataUrl);
            extractedText = ocrResult.text || "";
            confidence = ocrResult.confidence;
            notes.push(ocrResult.note || "OCR completed.");
            status = extractedText.length > 0 ? "completed" : "partially-completed";
          } else {
            status = "partially-completed";
            notes.push("No dataUrl provided for OCR fallback.");
          }
        } else {
          // DOM extraction from active slide container
          method = "dom-active-slide";
          const segments = collectTextFromNode(slideContainer);
          console.log(`[TextExtractor] DOM walk yielded ${segments.length} text segment(s) from active slide.`);
          extractedText = segments.join(" ").replace(/\s+/g, " ").trim();
          wordCount = extractedText.split(/\s+/).filter(Boolean).length;
          status = extractedText.length > 0 ? "completed" : "partially-completed";
          if (extractedText.length === 0) {
            notes.push("No visible text found in active slide container.");
          }
        }
      } else {
        // Fallback: full body walk (less precise)
        method = "dom-full-body";
        notes.push("No active slide container identified; falling back to full-body DOM extraction.");
        const segments = collectTextFromNode(document.body);
        console.log(`[TextExtractor] Full-body DOM walk yielded ${segments.length} segment(s).`);
        extractedText = segments.join(" ").replace(/\s+/g, " ").trim();
        wordCount = extractedText.split(/\s+/).filter(Boolean).length;
        status = extractedText.length > 0 ? "completed" : "partially-completed";
      }
    } catch (err) {
      status = "failed";
      const errText = err?.message || (typeof err === "string" ? err : String(err || "Unknown extraction error"));
      notes.push(`Extraction error: ${errText}`);
      console.error("[TextExtractor] Extraction failed:", errText);
    }

    const record = {
      captureId,
      slideNumber: slideNumber || null,
      method,
      status,
      extractedText,
      wordCount,
      confidence,
      notes: notes.join("; ") || null,
      extractionTimestamp: timestamp
    };
    console.log(`[TextExtractor] Result: status=${record.status} method=${record.method} words=${record.wordCount}`);
    return record;
  }

  // Expose on window for use by content.js
  window.CourseQATextExtractor = { extractText };
})();
