// Course QA Assistant - Background Service Worker
// Stage 4: Text Extraction results stored in IndexedDB alongside screenshots
// Stage 6: Grammar, spelling, punctuation, capitalization, and repeated-word analysis

try {
  importScripts("grammar-analyzer.js");
} catch (e) {
  console.warn("[Service Worker] importScripts(grammar-analyzer.js) error:", e);
}

let currentSession = null;
let isCaptureInProgress = false;

// -------------------------------------------------------------
// IndexedDB Local Storage Helper (CourseQA_DB)
// v1: screenshots store
// v2: textExtractions store
// v3: analysisFindings store
// -------------------------------------------------------------
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("CourseQA_DB", 3);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log(`[Service Worker] IndexedDB upgrade: v${event.oldVersion} → v${event.newVersion}`);

      // Create screenshots store (v1) if it does not exist yet
      if (!db.objectStoreNames.contains("screenshots")) {
        const store = db.createObjectStore("screenshots", { keyPath: "captureId" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("captureNumber", "captureNumber", { unique: false });
        console.log("[Service Worker] Created 'screenshots' object store.");
      }

      // Create textExtractions store (v2) if it does not exist yet
      if (!db.objectStoreNames.contains("textExtractions")) {
        const textStore = db.createObjectStore("textExtractions", { keyPath: "captureId" });
        textStore.createIndex("sessionId", "sessionId", { unique: false });
        textStore.createIndex("extractionTimestamp", "extractionTimestamp", { unique: false });
        console.log("[Service Worker] Created 'textExtractions' object store.");
      }

      // Create analysisFindings store (v3) if it does not exist yet
      if (!db.objectStoreNames.contains("analysisFindings")) {
        const findingsStore = db.createObjectStore("analysisFindings", { keyPath: "issueId" });
        findingsStore.createIndex("captureId", "captureId", { unique: false });
        findingsStore.createIndex("sessionId", "sessionId", { unique: false });
        findingsStore.createIndex("category", "category", { unique: false });
        findingsStore.createIndex("createdAt", "createdAt", { unique: false });
        console.log("[Service Worker] Created 'analysisFindings' object store.");
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      console.log(`[Service Worker] IndexedDB opened successfully (v${db.version}).`);

      // Handle database connection lifecycle and version-change events safely
      db.onversionchange = () => {
        console.warn("[Service Worker] IndexedDB version change detected – closing connection.");
        db.close();
      };

      resolve(db);
    };

    // Valid Error object on open failure
    request.onerror = () => {
      const err = request.error instanceof Error
        ? request.error
        : new Error(request.error ? String(request.error) : "IndexedDB open failed");
      console.error("[Service Worker] IndexedDB open error:", err);
      reject(err);
    };

    request.onblocked = (event) => {
      console.warn("[Service Worker] IndexedDB upgrade blocked – another connection is open.", event);
    };
  });
}


async function saveScreenshotRecord(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("screenshots", "readwrite");
    const store = tx.objectStore("screenshots");
    // Register completion and error handlers before queuing requests
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "screenshots transaction failed")));
    tx.onabort = () => reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "screenshots transaction aborted")));
    store.put(record);
  });
}

async function getScreenshotRecord(captureId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("screenshots", "readonly");
    const store = tx.objectStore("screenshots");

    if (captureId && captureId !== "latest") {
      const req = store.get(captureId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    } else {
      // Fetch latest screenshot
      const index = store.index("timestamp");
      const cursorReq = index.openCursor(null, "prev");
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        resolve(cursor ? cursor.value : null);
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    }
  });
}

async function getSessionScreenshots(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("screenshots", "readonly");
    const store = tx.objectStore("screenshots");
    let req;
    if (sessionId) {
      const index = store.index("sessionId");
      req = index.getAll(sessionId);
    } else {
      req = store.getAll();
    }
    req.onsuccess = () => {
      const list = (req.result || []).map((s) => ({
        captureId: s.captureId,
        sessionId: s.sessionId,
        captureNumber: s.captureNumber,
        slideNumber: s.slideNumber,
        captureType: s.captureType,
        timestamp: s.timestamp,
        pageTitle: s.pageTitle,
        analysisStatus: s.analysisStatus,
        textExtractionStatus: s.textExtractionStatus
      }));
      list.sort((a, b) => (a.captureNumber || 0) - (b.captureNumber || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error || "Failed to retrieve session screenshots")));
  });
}

// -------------------------------------------------------------
// Stage 6: Language Analysis Storage Helpers & Workflow
// -------------------------------------------------------------
async function saveAnalysisFindings(captureId, sessionId, findings, analysisStatus, errorMessage = null) {
  if (!captureId || typeof captureId !== "string" || !captureId.trim()) {
    throw new Error("saveAnalysisFindings: Valid captureId is required.");
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["analysisFindings", "screenshots"], "readwrite");

    tx.oncomplete = () => {
      console.log(`[Service Worker] Saved ${findings.length} finding(s) for ${captureId} (status: ${analysisStatus})`);
      resolve(true);
    };

    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "Save findings transaction failed")));
    tx.onabort = () => reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "Save findings transaction aborted")));

    const findingsStore = tx.objectStore("analysisFindings");
    const index = findingsStore.index("captureId");

    // Remove existing findings for this captureId to prevent duplicates when re-analyzing
    const cursorReq = index.openCursor(IDBKeyRange.only(captureId));
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        // Insert new normalized findings
        findings.forEach((finding) => {
          findingsStore.put(finding);
        });
      }
    };
    cursorReq.onerror = () => {
      findings.forEach((finding) => {
        findingsStore.put(finding);
      });
    };

    // Update screenshot record with latest analysis status and issue count
    const screenshotStore = tx.objectStore("screenshots");
    const shotReq = screenshotStore.get(captureId);
    shotReq.onsuccess = () => {
      if (shotReq.result) {
        const updated = {
          ...shotReq.result,
          analysisStatus,
          issuesCount: findings.length,
          analysisError: errorMessage || null
        };
        screenshotStore.put(updated);
      }
    };
  });
}

async function getAnalysisFindings(captureId) {
  if (!captureId || typeof captureId !== "string" || !captureId.trim()) {
    throw new Error("getAnalysisFindings: Valid captureId is required.");
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["analysisFindings", "screenshots"], "readonly");
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "Get findings transaction failed")));

    const findingsStore = tx.objectStore("analysisFindings");
    const index = findingsStore.index("captureId");
    const req = index.getAll(captureId);

    const screenshotStore = tx.objectStore("screenshots");
    const shotReq = screenshotStore.get(captureId);

    let findings = [];
    let screenshot = null;

    req.onsuccess = () => {
      findings = req.result || [];
    };

    shotReq.onsuccess = () => {
      screenshot = shotReq.result || null;
    };

    tx.oncomplete = () => {
      resolve({
        captureId,
        findings,
        totalIssues: findings.length,
        analysisStatus: screenshot?.analysisStatus || (findings.length > 0 ? "completed" : "pending"),
        analysisError: screenshot?.analysisError || null
      });
    };
  });
}

async function runLanguageAnalysisForCapture(captureId) {
  if (!captureId || typeof captureId !== "string") return;

  console.log(`[Service Worker] Starting Language Analysis for captureId=${captureId}`);

  try {
    const db = await openDB();

    // 1. Fetch text extraction record
    const extractionRecord = await new Promise((resolve, reject) => {
      const tx = db.transaction("textExtractions", "readonly");
      const req = tx.objectStore("textExtractions").get(captureId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!extractionRecord) {
      console.warn(`[Service Worker] Cannot analyze captureId=${captureId} before text extraction is saved.`);
      return;
    }

    // Mark status as 'analyzing' in screenshot record and update active session
    await new Promise((resolve) => {
      const tx = db.transaction("screenshots", "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      const store = tx.objectStore("screenshots");
      const req = store.get(captureId);
      req.onsuccess = () => {
        if (req.result) {
          store.put({ ...req.result, analysisStatus: "analyzing" });
        }
      };
    });

    if (currentSession) {
      currentSession.analyzingCount = (currentSession.analyzingCount || 0) + 1;
      chrome.storage.local.set({ activeSession: currentSession });
      broadcastSessionUpdate(currentSession);
    }

    // 2. Fetch analysis endpoint configuration from storage
    const config = await new Promise((resolve) => {
      chrome.storage.local.get([
        "languageToolEndpoint",
        "languageToolLanguage",
        "languageToolApiKey",
        "languageToolUsername"
      ], (items) => {
        const analyzer = (typeof CourseQAGrammarAnalyzer !== "undefined")
          ? CourseQAGrammarAnalyzer
          : (typeof self !== "undefined" && self.CourseQAGrammarAnalyzer);

        resolve({
          endpoint: items.languageToolEndpoint || analyzer?.DEFAULT_ENDPOINT || "https://api.languagetool.org/v2/check",
          language: items.languageToolLanguage || analyzer?.DEFAULT_LANGUAGE || "en-US",
          apiKey: items.languageToolApiKey || null,
          username: items.languageToolUsername || null
        });
      });
    });

    const analyzer = (typeof CourseQAGrammarAnalyzer !== "undefined")
      ? CourseQAGrammarAnalyzer
      : (typeof self !== "undefined" && self.CourseQAGrammarAnalyzer);

    if (!analyzer) {
      throw new Error("CourseQAGrammarAnalyzer is not available.");
    }

    // 3. Execute analysis
    const result = await analyzer.analyzeText({
      text: extractionRecord.extractedText,
      captureId,
      sessionId: extractionRecord.sessionId,
      slideNumber: extractionRecord.slideNumber,
      endpoint: config.endpoint,
      language: config.language,
      apiKey: config.apiKey,
      username: config.username
    });

    console.log(`[Service Worker] Analysis result for ${captureId}: status=${result.status}, issues=${result.findings?.length || 0}`);

    // 4. Save findings and update screenshot status
    await saveAnalysisFindings(
      captureId,
      extractionRecord.sessionId,
      result.findings || [],
      result.status,
      result.error || null
    );

    // 5. Update session metrics
    if (currentSession && currentSession.sessionId === extractionRecord.sessionId) {
      // Tally total issues for session
      const allFindings = await new Promise((resolve) => {
        const tx = db.transaction("analysisFindings", "readonly");
        const req = tx.objectStore("analysisFindings").index("sessionId").getAll(currentSession.sessionId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

      currentSession.issuesCount = allFindings.length;
      currentSession.analyzingCount = Math.max(0, (currentSession.analyzingCount || 1) - 1);
      chrome.storage.local.set({ activeSession: currentSession });
      broadcastSessionUpdate(currentSession);
    }
  } catch (err) {
    const errMsg = err?.message || String(err || "Language analysis failed unexpectedly");
    console.error(`[Service Worker] Language analysis error for ${captureId}:`, errMsg);
    try {
      await saveAnalysisFindings(captureId, null, [], "failed", errMsg);
      if (currentSession) {
        currentSession.analyzingCount = Math.max(0, (currentSession.analyzingCount || 1) - 1);
        chrome.storage.local.set({ activeSession: currentSession });
        broadcastSessionUpdate(currentSession);
      }
    } catch (_) {}
  }
}

// -------------------------------------------------------------
// Lifecycle & Storage Initialization
// -------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Course QA Assistant] Service worker initialized with Real Screenshot Capture capability.");
  chrome.storage.local.set({
    widgetVisible: true,
    activeSession: null,
    sessionsHistory: []
  });
});

// Restore active session state from storage on service worker start
chrome.storage.local.get(["activeSession"], (data) => {
  if (data.activeSession && data.activeSession.status === "ACTIVE") {
    currentSession = data.activeSession;
    console.log("[Course QA Assistant] Restored active session:", currentSession.sessionId);
  }
});

// -------------------------------------------------------------
// Message Dispatcher
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Service Worker] Received action:", message.action);

  switch (message.action) {
    // ---------------------------------------------------------
    // 1. START QA SESSION
    // ---------------------------------------------------------
    case "START_QA_SESSION": {
      const sessionId = `QA-${Date.now().toString().slice(-6)}`;
      
      // Ensure clean state: zeroed counters, empty slides array
      currentSession = {
        sessionId,
        courseName: message.courseName || "Interactive Course",
        startTime: new Date().toISOString(),
        status: "ACTIVE",
        capturedCount: 0,
        analyzingCount: 0,
        issuesCount: 0,
        slides: []
      };

      chrome.storage.local.set({ activeSession: currentSession }, () => {
        sendResponse({ success: true, session: currentSession });
        broadcastSessionUpdate();
      });
      return true;
    }

    // ---------------------------------------------------------
    // 2. REAL SCREENSHOT CAPTURE (MANUAL & AUTOMATIC)
    // ---------------------------------------------------------
    case "CAPTURE_SLIDE":
    case "MANUAL_CAPTURE": {
      if (!currentSession || currentSession.status !== "ACTIVE") {
        sendResponse({ success: false, error: "No active QA session. Click Start QA first." });
        return true;
      }

      if (isCaptureInProgress) {
        sendResponse({ success: false, error: "Capture already in progress. Please wait." });
        return true;
      }

      isCaptureInProgress = true;
      const targetWindowId = sender.tab?.windowId || null;

      // Coordinate real screenshot capture through chrome.tabs.captureVisibleTab
      try {
        chrome.tabs.captureVisibleTab(targetWindowId, { format: "png" }, async (dataUrl) => {
          if (chrome.runtime.lastError) {
            isCaptureInProgress = false;
            const errMsg = chrome.runtime.lastError.message || "Failed to capture visible tab.";
            console.error("[Service Worker] captureVisibleTab error:", errMsg);
            sendResponse({ success: false, error: errMsg });
            return;
          }

          if (!dataUrl || !dataUrl.startsWith("data:image/png")) {
            isCaptureInProgress = false;
            sendResponse({ success: false, error: "Invalid screenshot format returned by browser API." });
            return;
          }

          try {
            // Sequential capture number (1-indexed)
            const nextCaptureNumber = currentSession.capturedCount + 1;
            const captureId = `cap_${currentSession.sessionId}_${String(nextCaptureNumber).padStart(3, "0")}_${Date.now().toString().slice(-4)}`;
            const timestamp = new Date().toISOString();
            const captureType = message.captureType || "manual";

            // Construct screenshot record for IndexedDB
            const screenshotRecord = {
              captureId,
              sessionId: currentSession.sessionId,
              captureNumber: nextCaptureNumber,
              slideNumber: message.slideNumber || nextCaptureNumber,
              timestamp,
              captureType,
              analysisStatus: "pending",
              dataUrl,
              mimeType: "image/png",
              sizeBytes: dataUrl.length,
              pageTitle: message.pageTitle || sender.tab?.title || "Slide Viewport",
              pageUrl: message.pageUrl || sender.tab?.url || ""
            };

            // Save actual screenshot into IndexedDB
            await saveScreenshotRecord(screenshotRecord);

            // Construct metadata reference for session storage
            const slideMetadata = {
              sessionId: currentSession.sessionId,
              captureId,
              captureNumber: nextCaptureNumber,
              slideNumber: message.slideNumber || nextCaptureNumber,
              timestamp,
              captureType,
              storageRef: `indexeddb://CourseQA_DB/screenshots/${captureId}`,
              analysisStatus: "pending",
              pageTitle: screenshotRecord.pageTitle,
              pageUrl: screenshotRecord.pageUrl
            };

            // Only increment counter after successful storage
            currentSession.capturedCount = nextCaptureNumber;
            currentSession.slides.push(slideMetadata);

            // Persist session metadata
            await new Promise((res) => chrome.storage.local.set({ activeSession: currentSession }, res));
            broadcastSessionUpdate();

            isCaptureInProgress = false;
            sendResponse({
              success: true,
              session: currentSession,
              slide: slideMetadata,
              captureId: captureId
            });
          } catch (storageErr) {
            isCaptureInProgress = false;
            console.error("[Service Worker] Error saving screenshot to IndexedDB:", storageErr);
            sendResponse({ success: false, error: `Storage failure: ${storageErr.message}` });
          }
        });
      } catch (err) {
        isCaptureInProgress = false;
        console.error("[Service Worker] Unexpected capture exception:", err);
        const errMsg = err?.message || (typeof err === "string" ? err : String(err || "Unknown error"));
        sendResponse({ success: false, error: `Capture exception: ${errMsg}` });
      }

      return true;
    }

    // ---------------------------------------------------------
    // 3. END QA SESSION
    // ---------------------------------------------------------
    case "END_QA_SESSION": {
      if (!currentSession) {
        sendResponse({ success: false, error: "No active QA session." });
        return true;
      }

      currentSession.status = "COMPLETED";
      currentSession.endTime = new Date().toISOString();
      const completedSession = { ...currentSession };

      chrome.storage.local.get({ sessionsHistory: [] }, (data) => {
        const history = [completedSession, ...data.sessionsHistory].slice(0, 20);
        chrome.storage.local.set({
          activeSession: null,
          sessionsHistory: history,
          lastCompletedSession: completedSession
        }, () => {
          currentSession = null;
          sendResponse({ success: true, session: completedSession });
          broadcastSessionUpdate(completedSession);
        });
      });
      return true;
    }

    // ---------------------------------------------------------
    // 4. RETRIEVE SCREENSHOT FROM INDEXEDDB
    // ---------------------------------------------------------
    case "GET_SCREENSHOT": {
      getScreenshotRecord(message.captureId)
        .then((record) => {
          if (!record) {
            sendResponse({ success: false, error: "Screenshot record not found." });
          } else {
            sendResponse({ success: true, record });
          }
        })
        .catch((err) => {
          const errMsg = err?.message || (typeof err === "string" ? err : String(err || "Unknown error"));
          sendResponse({ success: false, error: errMsg });
        });
      return true;
    }

    // ---------------------------------------------------------
    // 4b. RETRIEVE ALL SCREENSHOTS FOR A SESSION
    // ---------------------------------------------------------
    case "GET_SESSION_SCREENSHOTS": {
      const targetSessionId = message.sessionId || currentSession?.sessionId;
      getSessionScreenshots(targetSessionId)
        .then((screenshots) => {
          sendResponse({ success: true, screenshots });
        })
        .catch((err) => {
          const errMsg = err?.message || (typeof err === "string" ? err : String(err || "Failed to load session screenshots"));
          sendResponse({ success: false, error: errMsg });
        });
      return true;
    }

    // ---------------------------------------------------------
    // 5. SAVE TEXT EXTRACTION RESULT
    // ---------------------------------------------------------
    case "SAVE_TEXT_EXTRACTION": {
      const record = message.record;

      // Validate required fields and captureId format
      if (!record || typeof record !== "object" || !record.captureId || typeof record.captureId !== "string" || !record.captureId.trim()) {
        const msg = !record
          ? "SAVE_TEXT_EXTRACTION: message.record is missing."
          : "SAVE_TEXT_EXTRACTION: record.captureId is missing or invalid.";
        console.error("[Service Worker]", msg);
        sendResponse({ success: false, error: msg });
        return false;
      }

      // Attach sessionId from active session if not provided
      if (!record.sessionId && currentSession) {
        record.sessionId = currentSession.sessionId;
      }

      console.log(`[Service Worker] SAVE_TEXT_EXTRACTION start: captureId=${record.captureId}, status=${record.status}, words=${record.wordCount || 0}`);

      // Open database once per logical operation and reuse that connection
      openDB()
        .then((db) => {
          return new Promise((resolve, reject) => {
            // Coordinate textExtractions and screenshots stores in a single transaction
            const tx = db.transaction(["textExtractions", "screenshots"], "readwrite");

            // Register transaction completion and error handlers BEFORE queuing requests
            tx.oncomplete = () => {
              console.log(`[Service Worker] Text extraction saved successfully for ${record.captureId} (${record.wordCount || 0} words, status: ${record.status})`);
              resolve(record);
            };

            tx.onerror = () => {
              const err = tx.error instanceof Error
                ? tx.error
                : new Error(String(tx.error || "SAVE_TEXT_EXTRACTION transaction error"));
              console.error(`[Service Worker] Text extraction save failed for ${record.captureId}:`, err);
              reject(err);
            };

            tx.onabort = () => {
              const err = tx.error instanceof Error
                ? tx.error
                : new Error(String(tx.error || "SAVE_TEXT_EXTRACTION transaction aborted"));
              console.error(`[Service Worker] Text extraction transaction aborted for ${record.captureId}:`, err);
              reject(err);
            };

            // 1. Put extraction record to textExtractions
            const textStore = tx.objectStore("textExtractions");
            textStore.put(record);

            // 2. Update matching screenshot record's textExtractionStatus if present
            const screenshotStore = tx.objectStore("screenshots");
            const getReq = screenshotStore.get(record.captureId);

            getReq.onsuccess = () => {
              if (getReq.result) {
                const updated = {
                  ...getReq.result,
                  textExtractionStatus: record.status
                };
                screenshotStore.put(updated);
              } else {
                console.log(`[Service Worker] Matching screenshot not found for ${record.captureId}; saved extraction record.`);
              }
            };

            getReq.onerror = () => {
              console.warn(`[Service Worker] screenshots.get error during status update for ${record.captureId}:`, getReq.error);
            };
          });
        })
        .then((savedRecord) => {
          // Resolve operation only after required writes have successfully committed
          sendResponse({ success: true, record: savedRecord });
          // Stage 6: Trigger asynchronous language analysis in background
          runLanguageAnalysisForCapture(record.captureId);
        })
        .catch((err) => {
          // Reject on transaction failure instead of silently resolving
          const errMsg = err?.message || (typeof err === "string" ? err : "Failed to save text extraction");
          console.error(`[Service Worker] SAVE_TEXT_EXTRACTION failed for ${record.captureId}:`, errMsg);
          sendResponse({ success: false, error: errMsg });
        });

      return true; // Keep channel open for asynchronous sendResponse
    }

    // ---------------------------------------------------------
    // 6. GET TEXT EXTRACTION BY captureId
    // ---------------------------------------------------------
    case "GET_TEXT_EXTRACTION": {
      const reqCaptureId = message.captureId;

      // Validate captureId before calling IndexedDB store.get()
      if (!reqCaptureId || typeof reqCaptureId !== "string" || !reqCaptureId.trim()) {
        const errorMsg = "GET_TEXT_EXTRACTION: Valid captureId is required.";
        console.error("[Service Worker]", errorMsg);
        sendResponse({ success: false, error: errorMsg });
        return false;
      }

      console.log(`[Service Worker] GET_TEXT_EXTRACTION start for captureId=${reqCaptureId}`);

      openDB()
        .then((db) => {
          return new Promise((resolve, reject) => {
            const tx = db.transaction("textExtractions", "readonly");

            tx.onerror = () => {
              const err = tx.error instanceof Error
                ? tx.error
                : new Error(String(tx.error || "GET_TEXT_EXTRACTION transaction error"));
              reject(err);
            };

            tx.onabort = () => {
              const err = tx.error instanceof Error
                ? tx.error
                : new Error(String(tx.error || "GET_TEXT_EXTRACTION transaction aborted"));
              reject(err);
            };

            const store = tx.objectStore("textExtractions");
            const req = store.get(reqCaptureId);

            req.onsuccess = () => {
              resolve(req.result || null);
            };

            req.onerror = () => {
              const err = req.error instanceof Error
                ? req.error
                : new Error(String(req.error || "textExtractions.get() request failed"));
              reject(err);
            };
          });
        })
        .then((record) => {
          if (record) {
            console.log(`[Service Worker] GET_TEXT_EXTRACTION found record for ${reqCaptureId} (${record.wordCount || 0} words, status: ${record.status})`);
            sendResponse({ success: true, record });
          } else {
            console.log(`[Service Worker] GET_TEXT_EXTRACTION record not found yet for ${reqCaptureId}`);
            // Distinguish valid ID with no saved extraction from actual database failure
            sendResponse({
              success: false,
              error: "Text extraction record not yet available – it may still be processing or no result was saved.",
              notYetAvailable: true
            });
          }
        })
        .catch((err) => {
          const errMsg = err?.message || (typeof err === "string" ? err : "Failed to retrieve text extraction");
          console.error(`[Service Worker] GET_TEXT_EXTRACTION database failure for ${reqCaptureId}:`, errMsg);
          sendResponse({ success: false, error: errMsg });
        });

      return true; // Keep channel open for asynchronous sendResponse
    }

    // ---------------------------------------------------------
    // 7. OPEN SCREENSHOT VIEWER TAB
    // ---------------------------------------------------------
    case "OPEN_VIEWER_TAB": {
      const captureId = message.captureId || "";
      const viewerUrl = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(captureId)}`);
      chrome.tabs.create({ url: viewerUrl }, (tab) => {
        sendResponse({ success: true, tabId: tab.id });
      });
      return true;
    }

    // ---------------------------------------------------------
    // 8. STAGE 6: GRAMMAR & SPELLING ANALYSIS HANDLERS
    // ---------------------------------------------------------
    case "GET_ANALYSIS_FINDINGS": {
      const captureId = message.captureId;
      if (!captureId || typeof captureId !== "string" || !captureId.trim()) {
        sendResponse({ success: false, error: "GET_ANALYSIS_FINDINGS: Valid captureId is required." });
        return false;
      }

      getAnalysisFindings(captureId)
        .then((res) => {
          sendResponse({ success: true, ...res });
        })
        .catch((err) => {
          const errMsg = err?.message || String(err || "Failed to retrieve findings");
          sendResponse({ success: false, error: errMsg });
        });
      return true;
    }

    case "ANALYZE_CAPTURE_TEXT": {
      const captureId = message.captureId;
      if (!captureId || typeof captureId !== "string" || !captureId.trim()) {
        sendResponse({ success: false, error: "ANALYZE_CAPTURE_TEXT: Valid captureId is required." });
        return false;
      }

      runLanguageAnalysisForCapture(captureId)
        .then(() => {
          sendResponse({ success: true, message: `Analysis started for ${captureId}` });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err?.message || String(err) });
        });
      return true;
    }

    case "GET_ANALYSIS_CONFIG": {
      chrome.storage.local.get([
        "languageToolEndpoint",
        "languageToolLanguage",
        "languageToolApiKey",
        "languageToolUsername"
      ], (items) => {
        const analyzer = (typeof CourseQAGrammarAnalyzer !== "undefined")
          ? CourseQAGrammarAnalyzer
          : (typeof self !== "undefined" && self.CourseQAGrammarAnalyzer);

        sendResponse({
          success: true,
          config: {
            endpoint: items.languageToolEndpoint || analyzer?.DEFAULT_ENDPOINT || "https://api.languagetool.org/v2/check",
            language: items.languageToolLanguage || analyzer?.DEFAULT_LANGUAGE || "en-US",
            hasApiKey: !!items.languageToolApiKey,
            hasUsername: !!items.languageToolUsername
          }
        });
      });
      return true;
    }

    case "SET_ANALYSIS_CONFIG": {
      const updates = {};
      if (message.endpoint !== undefined) updates.languageToolEndpoint = message.endpoint;
      if (message.language !== undefined) updates.languageToolLanguage = message.language;
      if (message.apiKey !== undefined) updates.languageToolApiKey = message.apiKey;
      if (message.username !== undefined) updates.languageToolUsername = message.username;

      chrome.storage.local.set(updates, () => {
        sendResponse({ success: true, message: "Analysis configuration updated." });
      });
      return true;
    }

    // ---------------------------------------------------------
    // 6. STATUS & CONTROLS
    // ---------------------------------------------------------
    case "GET_QA_STATUS": {
      chrome.storage.local.get(["activeSession", "widgetVisible", "lastCompletedSession"], (data) => {
        sendResponse({
          activeSession: data.activeSession || currentSession,
          widgetVisible: data.widgetVisible !== false,
          lastCompletedSession: data.lastCompletedSession || null
        });
      });
      return true;
    }

    case "TOGGLE_WIDGET": {
      const isVisible = message.visible;
      chrome.storage.local.set({ widgetVisible: isVisible }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "SET_WIDGET_VISIBILITY",
              visible: isVisible
            }).catch(() => {});
          }
        });
        sendResponse({ success: true, visible: isVisible });
      });
      return true;
    }

    default:
      sendResponse({ status: "unknown_action" });
      return false;
  }
});

// Broadcast state updates to active tabs
function broadcastSessionUpdate(sessionOverride) {
  const session = sessionOverride || currentSession;
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: "QA_SESSION_UPDATED",
          session: session
        }).catch(() => {
          // Ignore tabs where content script is not loaded
        });
      }
    });
  });
}
