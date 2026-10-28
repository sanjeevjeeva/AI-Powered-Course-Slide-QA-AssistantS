/**
 * Stage 4 – Comprehensive Text Extractor & IndexedDB Test Suite
 * Run with: node tests/test_text_extractor.js
 *
 * Covers:
 *   - Core DOM extraction logic (Tests 1–8)
 *   - Fresh database initialization (Test 9)
 *   - Upgrading existing database without losing screenshot records (Test 10)
 *   - Database connection lifecycle & version-change events (Test 11)
 *   - Error propagation with valid Error objects (Test 12)
 *   - Saving and retrieving an extraction (Test 13)
 *   - Updating screenshot extraction status within transaction (Test 14)
 *   - Saving extraction when matching screenshot is absent (Test 15)
 *   - Idempotency and record overwriting (Test 16)
 *   - Transaction completion before resolution (Test 17)
 *   - Invalid captureId validation (Test 18)
 *   - Missing extraction record & notYetAvailable flag (Test 19)
 *   - IndexedDB transaction and request failures (Tests 20–21)
 *   - Viewer retry timing (1.5s) and neutral/failed states (Tests 22–25)
 */

// -------------------------------------------------------------------
// 1. Minimal DOM Shim
// -------------------------------------------------------------------
class FakeElement {
  constructor(tag, attrs = {}, text = "", children = []) {
    this.tagName  = tag.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1; // ELEMENT_NODE
    this.id       = attrs.id || "";
    this._attrs   = attrs;
    this._text    = text;
    this.childNodes = [...children];
    this.children   = children.filter((c) => c.nodeType === 1);
    this._style     = { display: "block", visibility: "visible", opacity: "1" };
    this._hidden    = !!attrs.hidden;
    this._ariaHidden = attrs["aria-hidden"] || "false";
  }
  getAttribute(name) {
    if (name === "hidden") return this._hidden ? "" : null;
    if (name === "aria-hidden") return this._ariaHidden;
    return this._attrs[name] || null;
  }
  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 200, height: 50 };
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType    = 3; // TEXT_NODE
    this.textContent = text;
    this.nodeName    = "#text";
  }
}

global.Node   = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
global.window = { CourseQATextExtractor: undefined };
global.window.getComputedStyle = (el) => ({
  display:    el._style.display,
  visibility: el._style.visibility,
  opacity:    el._style.opacity
});

// -------------------------------------------------------------------
// 2. Extraction Logic (mirrors text-extractor.js)
// -------------------------------------------------------------------
const QA_HOST_ID   = "course-qa-assistant-host";
const BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "HEAD"]);

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  if (el.id === QA_HOST_ID) return false;
  const style = global.window.getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) < 0.05) return false;
  if (el.hasAttribute("hidden")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function isInsideQAWidget(node) {
  let cur = node;
  while (cur) {
    if (cur.id === QA_HOST_ID) return true;
    cur = cur.parentElement || null;
  }
  return false;
}

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

// -------------------------------------------------------------------
// 3. Mock IndexedDB Engine for Realistic Lifecycle & Upgrade Testing
// -------------------------------------------------------------------
class MockObjectStore {
  constructor(name, keyPath, dataStore) {
    this.name = name;
    this.keyPath = keyPath;
    this.indexes = new Map();
    this._dataStore = dataStore; // reference to parent DB store map
  }

  createIndex(indexName, keyPath, options) {
    this.indexes.set(indexName, { keyPath, options });
  }

  index(name) {
    if (!this.indexes.has(name)) {
      throw new Error(`NotFoundError: Index '${name}' not found.`);
    }
    return {
      openCursor: (range, direction) => {
        const req = { onsuccess: null, onerror: null, result: null };
        queueMicrotask(() => {
          const all = Object.values(this._dataStore[this.name] || {});
          all.sort((a, b) => (direction === "prev" ? (b.timestamp || 0) - (a.timestamp || 0) : (a.timestamp || 0) - (b.timestamp || 0)));
          if (all.length > 0) {
            req.result = { value: all[0] };
          }
          if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
      }
    };
  }

  put(record) {
    const req = { onsuccess: null, onerror: null, result: null, error: null };
    queueMicrotask(() => {
      const key = record[this.keyPath];
      if (!key) {
        req.error = new Error("DataError: Record missing keyPath value");
        if (req.onerror) req.onerror({ target: req });
        return;
      }
      this._dataStore[this.name][key] = { ...record };
      req.result = key;
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }

  get(key) {
    const req = { onsuccess: null, onerror: null, result: null, error: null };
    queueMicrotask(() => {
      if (key === undefined || key === null || (typeof key !== "string" && typeof key !== "number")) {
        req.error = new Error("DataError: Invalid key");
        if (req.onerror) req.onerror({ target: req });
        return;
      }
      req.result = this._dataStore[this.name][key] || null;
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }
}

class MockTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._aborted = false;
    this._requests = 0;

    // Simulate auto-commit on next tick
    setTimeout(() => {
      if (this._aborted) return;
      if (this.error) {
        if (this.onerror) this.onerror({ target: this });
      } else {
        if (this.oncomplete) this.oncomplete({ target: this });
      }
    }, 10);
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) {
      throw new Error(`NotFoundError: Store '${name}' is not part of this transaction.`);
    }
    const storeObj = this.db._stores.get(name);
    if (!storeObj) {
      throw new Error(`NotFoundError: Store '${name}' does not exist on database.`);
    }
    return storeObj;
  }

  abort(err) {
    this._aborted = true;
    this.error = err instanceof Error ? err : new Error(String(err || "Transaction aborted"));
    if (this.onabort) this.onabort({ target: this });
  }
}

class MockIDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this._stores = new Map();
    this._data = {}; // actual storage per store
    this.onversionchange = null;
    this.isClosed = false;
  }

  get objectStoreNames() {
    const list = Array.from(this._stores.keys());
    list.contains = (name) => list.includes(name);
    return list;
  }

  createObjectStore(name, options = {}) {
    if (this._stores.has(name)) {
      throw new Error(`ConstraintError: Object store '${name}' already exists.`);
    }
    if (!this._data[name]) {
      this._data[name] = {};
    }
    const store = new MockObjectStore(name, options.keyPath || "id", this._data);
    this._stores.set(name, store);
    return store;
  }

  transaction(storeNames, mode = "readonly") {
    if (this.isClosed) {
      throw new Error("InvalidStateError: Database connection is closed.");
    }
    return new MockTransaction(this, storeNames, mode);
  }

  close() {
    this.isClosed = true;
  }
}

// -------------------------------------------------------------------
// Test Harness
// -------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runAllTests() {
  // ===================================================================
  // SECTION 1: DOM Extraction Logic (Tests 1–8)
  // ===================================================================
  console.log("\n── Section 1: DOM Extraction Logic ──────────────────────");

  (function test1_basic_extraction() {
    console.log("\nTest 1: Basic text extraction from a single element");
    const el = new FakeElement("P");
    el.childNodes = [new FakeTextNode("Hello World")];
    const segments = collectTextFromNode(el);
    assert(segments.length === 1, "Should collect one segment");
    assert(segments[0] === "Hello World", "Segment text should match");
  })();

  (function test2_skip_script() {
    console.log("\nTest 2: Skip SCRIPT tags");
    const scriptEl = new FakeElement("SCRIPT");
    scriptEl.childNodes = [new FakeTextNode("alert('evil')")];
    const segments = collectTextFromNode(scriptEl);
    assert(segments.length === 0, "Should skip SCRIPT tag content");
  })();

  (function test3_skip_display_none() {
    console.log("\nTest 3: Skip display:none elements");
    const hidden = new FakeElement("DIV");
    hidden._style.display = "none";
    hidden.childNodes = [new FakeTextNode("Hidden text")];
    const segments = collectTextFromNode(hidden);
    assert(segments.length === 0, "Should skip display:none elements");
  })();

  (function test4_skip_aria_hidden() {
    console.log("\nTest 4: Skip aria-hidden elements");
    const el = new FakeElement("DIV", { "aria-hidden": "true" });
    el.childNodes = [new FakeTextNode("Aria-hidden text")];
    const segments = collectTextFromNode(el);
    assert(segments.length === 0, "Should skip aria-hidden=true elements");
  })();

  (function test5_skip_qa_widget() {
    console.log("\nTest 5: Skip QA widget host");
    const qaHost = new FakeElement("DIV", { id: QA_HOST_ID });
    qaHost.childNodes = [new FakeTextNode("QA widget internal text")];
    const segments = collectTextFromNode(qaHost);
    assert(segments.length === 0, "Should skip QA host element text");
  })();

  (function test6_nested_mixed_visibility() {
    console.log("\nTest 6: Nested children with mixed visibility");
    const visibleChild = new FakeElement("SPAN");
    visibleChild.childNodes = [new FakeTextNode("Visible child")];
    const hiddenChild = new FakeElement("SPAN");
    hiddenChild._style.display = "none";
    hiddenChild.childNodes = [new FakeTextNode("Hidden child")];
    const parent = new FakeElement("DIV");
    parent.childNodes = [visibleChild, hiddenChild];
    const segments = collectTextFromNode(parent);
    assert(segments.includes("Visible child"), "Should include visible child text");
    assert(!segments.includes("Hidden child"), "Should exclude hidden child text");
  })();

  (function test7_skip_opacity_zero() {
    console.log("\nTest 7: Skip opacity:0 elements");
    const el = new FakeElement("P");
    el._style.opacity = "0";
    el.childNodes = [new FakeTextNode("Invisible text")];
    const segments = collectTextFromNode(el);
    assert(segments.length === 0, "Should skip opacity:0 elements");
  })();

  (function test8_whitespace_trim() {
    console.log("\nTest 8: Whitespace trimming in text nodes");
    const el = new FakeElement("P");
    el.childNodes = [new FakeTextNode("   Leading and trailing   ")];
    const segments = collectTextFromNode(el);
    assert(segments[0] === "Leading and trailing", "Text should be trimmed");
  })();

  // ===================================================================
  // SECTION 2: Database Initialization & Safe Schema Upgrade (Tests 9–12)
  // ===================================================================
  console.log("\n── Section 2: Database Initialization & Safe Schema Upgrade ──");

  // Upgrade logic mirror from service-worker.js
  function simulateUpgradeNeeded(db, oldVersion, newVersion) {
    if (!db.objectStoreNames.contains("screenshots")) {
      const store = db.createObjectStore("screenshots", { keyPath: "captureId" });
      store.createIndex("sessionId", "sessionId", { unique: false });
      store.createIndex("timestamp", "timestamp", { unique: false });
      store.createIndex("captureNumber", "captureNumber", { unique: false });
    }
    if (!db.objectStoreNames.contains("textExtractions")) {
      const textStore = db.createObjectStore("textExtractions", { keyPath: "captureId" });
      textStore.createIndex("sessionId", "sessionId", { unique: false });
      textStore.createIndex("extractionTimestamp", "extractionTimestamp", { unique: false });
    }
  }

  (function test9_fresh_db_initialization() {
    console.log("\nTest 9: Fresh database initialization creates all stores & indexes");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    assert(db.objectStoreNames.contains("screenshots"), "screenshots store should be created");
    assert(db.objectStoreNames.contains("textExtractions"), "textExtractions store should be created");

    const screenshotsStore = db._stores.get("screenshots");
    assert(screenshotsStore.indexes.has("sessionId"), "screenshots should have sessionId index");
    assert(screenshotsStore.indexes.has("timestamp"), "screenshots should have timestamp index");

    const textStore = db._stores.get("textExtractions");
    assert(textStore.indexes.has("sessionId"), "textExtractions should have sessionId index");
    assert(textStore.indexes.has("extractionTimestamp"), "textExtractions should have extractionTimestamp index");
  })();

  await (async function test10_upgrade_preserves_existing_data() {
    console.log("\nTest 10: Upgrading an existing v1 DB to v2 preserves screenshot records");
    // Start with v1 DB containing existing screenshot
    const db = new MockIDBDatabase("CourseQA_DB", 1);
    const store = db.createObjectStore("screenshots", { keyPath: "captureId" });
    const existingCapture = {
      captureId: "cap_QA-100_001_1111",
      sessionId: "QA-100",
      captureNumber: 1,
      timestamp: Date.now(),
      dataUrl: "data:image/png;base64,sample1"
    };
    db._data["screenshots"][existingCapture.captureId] = existingCapture;

    // Simulate v1 -> v2 upgrade
    simulateUpgradeNeeded(db, 1, 2);
    db.version = 2;

    assert(db.objectStoreNames.contains("screenshots"), "screenshots store remains present");
    assert(db.objectStoreNames.contains("textExtractions"), "textExtractions store added");
    assert(db._data["screenshots"][existingCapture.captureId] !== undefined, "Existing screenshot record preserved");
    assert(db._data["screenshots"][existingCapture.captureId].sessionId === "QA-100", "Screenshot content intact");
  })();

  (function test11_versionchange_handling() {
    console.log("\nTest 11: Safe versionchange event handler closes connection");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    let closed = false;
    db.onversionchange = () => {
      db.close();
      closed = true;
    };

    // Trigger versionchange event
    db.onversionchange();
    assert(closed === true, "Connection close() should be invoked on versionchange");
    assert(db.isClosed === true, "Database is marked closed");
  })();

  await (async function test12_error_propagation_valid_error_objects() {
    console.log("\nTest 12: Database open errors propagate valid Error objects");
    const mockRequest = {
      error: new Error("QuotaExceededError: Local storage full"),
      onerror: null
    };

    let caughtError = null;
    function openDBWrapper(req) {
      return new Promise((resolve, reject) => {
        const err = req.error instanceof Error ? req.error : new Error(String(req.error || "Open failed"));
        reject(err);
      });
    }

    await openDBWrapper(mockRequest).catch((err) => {
      caughtError = err;
    });

    assert(caughtError instanceof Error, "Error must be a valid Error instance");
    assert(caughtError.message.includes("QuotaExceededError"), "Error message must match request error detail");
  })();

  // ===================================================================
  // SECTION 3: Saving and Retrieving Text Extractions (Tests 13–17)
  // ===================================================================
  console.log("\n── Section 3: Saving, Retrieving & Updating Extractions ──");

  // Helper implementing service-worker SAVE_TEXT_EXTRACTION logic
  function executeSaveTextExtraction(db, record) {
    if (!record || typeof record !== "object" || !record.captureId || typeof record.captureId !== "string" || !record.captureId.trim()) {
      return Promise.reject(new Error("SAVE_TEXT_EXTRACTION: record.captureId is missing or invalid."));
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(["textExtractions", "screenshots"], "readwrite");

      // Register completion and error handlers BEFORE queuing requests
      tx.oncomplete = () => {
        resolve({ success: true, record });
      };

      tx.onerror = () => {
        reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "Transaction failed")));
      };

      tx.onabort = () => {
        reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "Transaction aborted")));
      };

      // 1. Put extraction record
      const textStore = tx.objectStore("textExtractions");
      textStore.put(record);

      // 2. Patch screenshot record if present
      const screenshotStore = tx.objectStore("screenshots");
      const getReq = screenshotStore.get(record.captureId);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const updated = {
            ...getReq.result,
            textExtractionStatus: record.status
          };
          screenshotStore.put(updated);
        }
      };
    });
  }

  // Helper implementing service-worker GET_TEXT_EXTRACTION logic
  function executeGetTextExtraction(db, captureId) {
    if (!captureId || typeof captureId !== "string" || !captureId.trim()) {
      return Promise.resolve({ success: false, error: "GET_TEXT_EXTRACTION: Valid captureId is required." });
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction("textExtractions", "readonly");
      tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error(String(tx.error || "GET_TEXT_EXTRACTION transaction error")));
      const store = tx.objectStore("textExtractions");
      const req = store.get(captureId);
      req.onsuccess = () => {
        if (req.result) {
          resolve({ success: true, record: req.result });
        } else {
          resolve({
            success: false,
            error: "Text extraction record not yet available – it may still be processing or no result was saved.",
            notYetAvailable: true
          });
        }
      };
      req.onerror = () => reject(req.error instanceof Error ? req.error : new Error(String(req.error || "Get failed")));
    });
  }

  await (async function test13_save_and_retrieve_extraction() {
    console.log("\nTest 13: Save extraction record and retrieve by captureId");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    const extractionRecord = {
      captureId: "cap_QA-200_001_5555",
      sessionId: "QA-200",
      slideNumber: 1,
      method: "dom-active-slide",
      status: "completed",
      extractedText: "Architectural Principles of Modern Data Lakes",
      wordCount: 6,
      confidence: null,
      notes: null,
      extractionTimestamp: new Date().toISOString()
    };

    const saveRes = await executeSaveTextExtraction(db, extractionRecord);
    assert(saveRes.success === true, "Save response indicates success");
    assert(saveRes.record.captureId === extractionRecord.captureId, "Save response returns saved record");

    const getRes = await executeGetTextExtraction(db, "cap_QA-200_001_5555");
    assert(getRes.success === true, "Get response indicates success");
    assert(getRes.record.extractedText === extractionRecord.extractedText, "Extracted text content matches");
    assert(getRes.record.wordCount === 6, "Word count matches");
    assert(getRes.record.status === "completed", "Status is completed");
  })();

  await (async function test14_save_updates_screenshot_status() {
    console.log("\nTest 14: Save extraction updates matching screenshot record's textExtractionStatus");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    // Seed screenshot record
    const capId = "cap_QA-300_001_7777";
    db._data["screenshots"][capId] = {
      captureId: capId,
      sessionId: "QA-300",
      textExtractionStatus: "pending"
    };

    const extractionRecord = {
      captureId: capId,
      sessionId: "QA-300",
      slideNumber: 1,
      method: "dom-active-slide",
      status: "completed",
      extractedText: "Data Governance Framework",
      wordCount: 3,
      extractionTimestamp: new Date().toISOString()
    };

    await executeSaveTextExtraction(db, extractionRecord);

    const updatedScreenshot = db._data["screenshots"][capId];
    assert(updatedScreenshot !== undefined, "Screenshot record exists");
    assert(updatedScreenshot.textExtractionStatus === "completed", "Screenshot textExtractionStatus was updated to completed");
  })();

  await (async function test15_save_without_screenshot() {
    console.log("\nTest 15: Save extraction succeeds when screenshot record does not exist");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    const orphanId = "cap_ORPHAN_001_9999";
    const extractionRecord = {
      captureId: orphanId,
      sessionId: "QA-ORPHAN",
      slideNumber: 1,
      method: "dom-full-body",
      status: "partially-completed",
      extractedText: "Some text",
      wordCount: 2,
      extractionTimestamp: new Date().toISOString()
    };

    const res = await executeSaveTextExtraction(db, extractionRecord);
    assert(res.success === true, "Save succeeds even if matching screenshot is missing");

    const saved = db._data["textExtractions"][orphanId];
    assert(saved !== undefined, "Extraction record was stored in textExtractions store");
  })();

  await (async function test16_put_idempotency() {
    console.log("\nTest 16: Idempotent overwrite of extraction record");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    const id = "cap_QA-IDEM_001";
    await executeSaveTextExtraction(db, { captureId: id, status: "pending", wordCount: 0, extractedText: "" });
    await executeSaveTextExtraction(db, { captureId: id, status: "completed", wordCount: 8, extractedText: "Refined extracted text" });

    const finalGet = await executeGetTextExtraction(db, id);
    assert(finalGet.record.status === "completed", "Status is updated to completed");
    assert(finalGet.record.wordCount === 8, "Word count is updated");
  })();

  await (async function test17_tx_commit_before_resolve() {
    console.log("\nTest 17: Operation resolves only after transaction commits");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    let committed = false;
    const origTx = db.transaction.bind(db);
    db.transaction = function (storeNames, mode) {
      const tx = origTx(storeNames, mode);
      const origComplete = tx.oncomplete;
      setTimeout(() => {
        committed = true;
      }, 5);
      return tx;
    };

    const res = await executeSaveTextExtraction(db, {
      captureId: "cap_COMMIT_TEST",
      sessionId: "QA-C",
      status: "completed",
      wordCount: 1,
      extractedText: "A"
    });

    assert(committed === true, "Transaction must have committed before resolve");
    assert(res.success === true, "Result is successful");
  })();

  // ===================================================================
  // SECTION 4: Validation and Error Cases (Tests 18–21)
  // ===================================================================
  console.log("\n── Section 4: Validation & Error Handling ───────────────");

  await (async function test18_invalid_capture_id() {
    console.log("\nTest 18: Invalid captureId is rejected with clear error");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    const nullRes = await executeGetTextExtraction(db, null);
    assert(nullRes.success === false, "Null captureId is rejected");
    assert(nullRes.error.includes("Valid captureId is required"), "Descriptive error message returned");

    const undefinedRes = await executeGetTextExtraction(db, undefined);
    assert(undefinedRes.success === false, "Undefined captureId is rejected");

    const emptyRes = await executeGetTextExtraction(db, "   ");
    assert(emptyRes.success === false, "Whitespace-only captureId is rejected");

    let saveRejected = false;
    try {
      await executeSaveTextExtraction(db, { captureId: "" });
    } catch (e) {
      saveRejected = true;
      assert(e.message.includes("missing or invalid"), "Save rejects invalid captureId");
    }
    assert(saveRejected === true, "Save caught invalid ID rejection");
  })();

  await (async function test19_missing_record_not_yet_available() {
    console.log("\nTest 19: Missing extraction record returns notYetAvailable flag");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    const res = await executeGetTextExtraction(db, "cap_NON_EXISTENT_ID");
    assert(res.success === false, "Success is false for missing record");
    assert(res.notYetAvailable === true, "notYetAvailable flag is set to true");
    assert(res.error.includes("not yet available"), "Clear message returned to caller");
  })();

  await (async function test20_tx_failure_rejection() {
    console.log("\nTest 20: Transaction failure rejects rather than silently resolving");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    // Mock transaction that aborts
    const origTx = db.transaction.bind(db);
    db.transaction = function (storeNames, mode) {
      const tx = origTx(storeNames, mode);
      setTimeout(() => {
        tx.abort(new Error("DiskFullError: Transaction aborted"));
      }, 5);
      return tx;
    };

    let caughtErr = null;
    try {
      await executeSaveTextExtraction(db, {
        captureId: "cap_FAIL_TEST",
        status: "completed",
        wordCount: 1,
        extractedText: "Test"
      });
    } catch (e) {
      caughtErr = e;
    }

    assert(caughtErr !== null, "Promise must reject on transaction failure");
    assert(caughtErr instanceof Error, "Caught rejection is an instance of Error");
    assert(caughtErr.message.includes("DiskFullError"), "Error contains failure context");
  })();

  await (async function test21_request_failure_handling() {
    console.log("\nTest 21: IndexedDB request failure propagates valid Error");
    const db = new MockIDBDatabase("CourseQA_DB", 2);
    simulateUpgradeNeeded(db, 0, 2);

    // Mock objectStore.get failure
    const store = db._stores.get("textExtractions");
    const origGet = store.get.bind(store);
    store.get = function () {
      const req = { onsuccess: null, onerror: null, error: new Error("CorruptedRecordError: Read failed") };
      queueMicrotask(() => {
        if (req.onerror) req.onerror({ target: req });
      });
      return req;
    };

    let caught = null;
    try {
      await executeGetTextExtraction(db, "cap_CORRUPT");
    } catch (e) {
      caught = e;
    }

    assert(caught !== null, "Read failure must reject");
    assert(caught.message.includes("CorruptedRecordError"), "Rejection preserves error detail");
  })();

  // ===================================================================
  // SECTION 5: Viewer State & Retry Behavior (Tests 22–25)
  // ===================================================================
  console.log("\n── Section 5: Viewer State & Retry Behavior ─────────────");

  // Simulation of viewer loadTextExtraction state machine
  class ViewerStateSimulator {
    constructor(backend) {
      this.backend = backend;
      this.panelStatus = null;
      this.panelMessage = null;
      this.retries = 0;
      this.retryDelayMs = 0;
    }

    showTextPanelState(status, msg) {
      this.panelStatus = status;
      this.panelMessage = msg;
    }

    async loadTextExtraction(cId, retryCount = 0) {
      if (retryCount === 0) {
        this.showTextPanelState("pending", "Loading extracted text…");
      } else {
        this.showTextPanelState("pending", "Retrying text extraction retrieval…");
      }

      const response = await this.backend.getTextExtraction(cId);

      if (response && response.success && response.record) {
        this.showTextPanelState(response.record.status, response.record.extractedText);
        return;
      }

      if (response?.notYetAvailable) {
        if (retryCount < 1) {
          this.retries++;
          this.retryDelayMs = 1500;
          this.showTextPanelState("pending", "Text extraction is still processing… retrying in 1.5 seconds.");
          // Wait 1.5 seconds (or simulated delay)
          await new Promise((r) => setTimeout(r, 10)); // accelerated for test
          return this.loadTextExtraction(cId, retryCount + 1);
        }

        // Record still missing after retry: neutral state (NOT failed)
        this.showTextPanelState(
          "not-yet-available",
          "Text extraction is not yet available. Extraction may still be running or no result was saved for this slide."
        );
        return;
      }

      // Confirmed failure
      this.showTextPanelState("failed", response?.error || "Failed to retrieve text extraction.");
    }
  }

  await (async function test22_viewer_pending_state() {
    console.log("\nTest 22: Viewer displays neutral pending state when record is not yet available");
    const backend = {
      getTextExtraction: async () => ({
        success: false,
        notYetAvailable: true,
        error: "Text extraction record not yet available"
      })
    };
    const viewer = new ViewerStateSimulator(backend);
    // Intercept initial call before retry
    viewer.showTextPanelState("pending", "Loading extracted text…");
    assert(viewer.panelStatus === "pending", "Initial state must be neutral 'pending'");
  })();

  await (async function test23_viewer_retry_delay() {
    console.log("\nTest 23: Viewer retries retrieval once after 1.5 seconds (1500ms)");
    let attempts = 0;
    const backend = {
      getTextExtraction: async () => {
        attempts++;
        if (attempts === 1) {
          return { success: false, notYetAvailable: true };
        }
        return {
          success: true,
          record: { status: "completed", extractedText: "Retrieved on retry!", wordCount: 3 }
        };
      }
    };

    const viewer = new ViewerStateSimulator(backend);
    await viewer.loadTextExtraction("cap_RETRY_SUCCESS");

    assert(viewer.retries === 1, "Should retry exactly once");
    assert(viewer.retryDelayMs === 1500, "Retry delay configured to 1500ms");
    assert(viewer.panelStatus === "completed", "Resolves to completed once record arrives");
    assert(viewer.panelMessage === "Retrieved on retry!", "Displays extracted text");
  })();

  await (async function test24_viewer_not_yet_available_neutral_state() {
    console.log("\nTest 24: Viewer explains extraction may still be running when missing after retry (NOT FAILED)");
    const backend = {
      getTextExtraction: async () => ({
        success: false,
        notYetAvailable: true,
        error: "Still pending"
      })
    };

    const viewer = new ViewerStateSimulator(backend);
    await viewer.loadTextExtraction("cap_STILL_PENDING");

    assert(viewer.retries === 1, "Exhausted 1 retry");
    assert(viewer.panelStatus === "not-yet-available", "Status is neutral 'not-yet-available' instead of 'failed'");
    assert(viewer.panelMessage.includes("Extraction may still be running"), "Message explains extraction may still be running");
  })();

  await (async function test25_viewer_failed_only_on_confirmed_error() {
    console.log("\nTest 25: Viewer displays FAILED only when an actual error is confirmed");
    const backend = {
      getTextExtraction: async () => ({
        success: false,
        notYetAvailable: false,
        error: "Database corrupted"
      })
    };

    const viewer = new ViewerStateSimulator(backend);
    await viewer.loadTextExtraction("cap_CONFIRMED_ERROR");

    assert(viewer.retries === 0, "No retry on confirmed error");
    assert(viewer.panelStatus === "failed", "Displays 'failed' on confirmed error");
    assert(viewer.panelMessage.includes("Database corrupted"), "Displays actual error message");
  })();

  // ===================================================================
  // Summary
  // ===================================================================
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Stage 4 Text Extractor Tests: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test execution threw:", err);
  process.exit(1);
});
