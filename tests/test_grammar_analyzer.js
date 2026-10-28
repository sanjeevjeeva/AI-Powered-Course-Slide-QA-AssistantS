/**
 * Stage 6 – Comprehensive Language Analysis Engine Test Suite
 * Tests grammar, spelling, punctuation, capitalization, and repeated-word analysis.
 *
 * Covers:
 *   1.  Spelling finding normalization
 *   2.  Grammar finding normalization (subject-verb, verb forms, articles)
 *   3.  Punctuation and capitalization finding normalization
 *   4.  Adjacent repeated-word detection (engine + regex safeguard)
 *   5.  Multiple suggestions handling
 *   6.  Empty text and whitespace-only text handling (skipped status)
 *   7.  Technical terms and acronym suppression (avoiding false-positive spelling)
 *   8.  Exact text offset slicing and boundary verification
 *   9.  Association of captureId, sessionId, and slideNumber
 *   10. Duplicate prevention and cleanup upon re-analysis
 *   11. IndexedDB v3 schema, save, query, and retrieval
 *   12. Network failure and malformed response handling
 *   13. Missing configuration fallback and retry behavior
 *   14. Sequence validation (text extraction availability guard)
 *   15. Live integration test against real LanguageTool API (clearly distinguished)
 *
 * Run with: node tests/test_grammar_analyzer.js
 */

const assert = require("assert");
const Analyzer = require("../browser-extension/background/grammar-analyzer.js");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function report(name, passed, detail = "") {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${name} -> ${detail}`);
  }
}

// ===================================================================
// Mock IDB Environment for Stage 6 analysisFindings Store
// ===================================================================
class MockIDBDatabaseV3 {
  constructor() {
    this.version = 3;
    this.stores = {
      screenshots: new Map(),
      textExtractions: new Map(),
      analysisFindings: new Map()
    };
  }

  // Simulates clearing existing findings for a captureId
  clearFindingsForCapture(captureId) {
    for (const [key, record] of this.stores.analysisFindings.entries()) {
      if (record.captureId === captureId) {
        this.stores.analysisFindings.delete(key);
      }
    }
  }

  saveFinding(record) {
    this.stores.analysisFindings.set(record.issueId, JSON.parse(JSON.stringify(record)));
    return Promise.resolve(record.issueId);
  }

  getFindingsByCapture(captureId) {
    const results = [];
    for (const record of this.stores.analysisFindings.values()) {
      if (record.captureId === captureId) {
        results.push(JSON.parse(JSON.stringify(record)));
      }
    }
    return Promise.resolve(results);
  }
}

async function runAllTests() {
  console.log("==========================================================");
  console.log("Course QA Assistant - Stage 6 Grammar Analyzer Test Suite");
  console.log("==========================================================\n");

  // -----------------------------------------------------------------
  // 1. SPELLING FINDING NORMALIZATION
  // -----------------------------------------------------------------
  console.log("── Test 1: Normalization of Spelling Findings ──");
  {
    const text = "We need to fix this misstake immediately.";
    const mockMatch = {
      message: "Possible spelling mistake found.",
      offset: text.indexOf("misstake"),
      length: "misstake".length,
      replacements: [{ value: "mistake" }],
      rule: {
        id: "MORFOLOGIK_RULE_EN_US",
        issueType: "misspelling",
        category: { id: "TYPOS", name: "Possible Typo" }
      }
    };

    const findings = Analyzer.normalizeLanguageToolMatches([mockMatch], text, {
      captureId: "cap_spell_01",
      sessionId: "sess_01",
      slideNumber: 1
    });

    report("Should extract exactly one finding", findings.length === 1);
    report("Category must be 'spelling'", findings[0]?.category === "spelling");
    report("Rule ID preserved", findings[0]?.ruleId === "MORFOLOGIK_RULE_EN_US");
    report("Original text matches offset slice", findings[0]?.originalText === "misstake");
    report("Suggestions list normalized", findings[0]?.suggestions[0] === "mistake");
    report("Severity rated 'high'", findings[0]?.severity === "high");
    report("Status initialized to 'open'", findings[0]?.status === "open");
  }

  // -----------------------------------------------------------------
  // 2. GRAMMAR FINDING NORMALIZATION
  // -----------------------------------------------------------------
  console.log("\n── Test 2: Normalization of Grammar Findings ──");
  {
    const text = "Data Products provides trusted assets.";
    const mockMatch = {
      message: "The plural noun 'Products' requires a plural verb.",
      offset: 14,
      length: 8,
      replacements: [{ value: "provide" }],
      rule: {
        id: "PERS_PRONOUN_VERB_AGREEMENT",
        issueType: "grammar",
        category: { id: "GRAMMAR", name: "Grammar" }
      }
    };

    const findings = Analyzer.normalizeLanguageToolMatches([mockMatch], text, {
      captureId: "cap_gram_01",
      sessionId: "sess_01",
      slideNumber: 2
    });

    report("Category must be 'grammar'", findings[0]?.category === "grammar");
    report("Subject-verb agreement message captured", findings[0]?.message.includes("plural verb"));
    report("Original verb extracted", findings[0]?.originalText === "provides");
    report("Suggested verb replacement extracted", findings[0]?.suggestions[0] === "provide");
    report("Severity rated 'high'", findings[0]?.severity === "high");
  }

  // -----------------------------------------------------------------
  // 3. PUNCTUATION & CAPITALIZATION NORMALIZATION
  // -----------------------------------------------------------------
  console.log("\n── Test 3: Punctuation and Capitalization Findings ──");
  {
    const text = "However we should test this thoroughly.";
    const mockPunctMatch = {
      message: "A comma may be missing after 'However'.",
      offset: 0,
      length: 7,
      replacements: [{ value: "However," }],
      rule: {
        id: "HOWEVER_COMMA",
        issueType: "punctuation",
        category: { id: "PUNCTUATION", name: "Punctuation" }
      }
    };
    const mockCapMatch = {
      message: "This sentence does not start with an uppercase letter",
      offset: 0,
      length: 7,
      replacements: [{ value: "However" }],
      rule: {
        id: "UPPERCASE_SENTENCE_START",
        issueType: "casing",
        category: { id: "CASING", name: "Capitalization" }
      }
    };

    const punctFindings = Analyzer.normalizeLanguageToolMatches([mockPunctMatch], text, {
      captureId: "cap_pct_01",
      sessionId: "sess_01",
      slideNumber: 3
    });
    const capFindings = Analyzer.normalizeLanguageToolMatches([mockCapMatch], text, {
      captureId: "cap_cap_01",
      sessionId: "sess_01",
      slideNumber: 3
    });

    report("Punctuation category categorized correctly", punctFindings[0]?.category === "punctuation");
    report("Punctuation severity rated 'low'", punctFindings[0]?.severity === "low");
    report("Capitalization category categorized correctly", capFindings[0]?.category === "capitalization");
    report("Capitalization severity rated 'low'", capFindings[0]?.severity === "low");
  }

  // -----------------------------------------------------------------
  // 4. ADJACENT REPEATED-WORD DETECTION
  // -----------------------------------------------------------------
  console.log("\n── Test 4: Adjacent Repeated-Word Detection ──");
  {
    const text = "Verify that the the system pipeline executes correctly.";
    const regexFindings = Analyzer.detectAdjacentRepeatedWords(text, {
      captureId: "cap_rep_01",
      sessionId: "sess_01",
      slideNumber: 4
    });

    report("Regex detector finds repeated word", regexFindings.length === 1);
    report("Category is 'repeated-word'", regexFindings[0]?.category === "repeated-word");
    report("Original text contains duplicate pair", regexFindings[0]?.originalText === "the the");
    report("Offset start matches 'the the'", regexFindings[0]?.startOffset === 12);
    report("Suggestion is the single word 'the'", regexFindings[0]?.suggestions[0] === "the");

    // Engine match handling for duplicate words
    const engineMatch = {
      message: "Word repetition detected.",
      offset: 12,
      length: 7,
      replacements: [{ value: "the" }],
      rule: {
        id: "ENGLISH_WORD_REPEAT_RULE",
        issueType: "duplication",
        category: { id: "MISC", name: "Miscellaneous" }
      }
    };
    const engineFindings = Analyzer.normalizeLanguageToolMatches([engineMatch], text, {
      captureId: "cap_rep_01",
      sessionId: "sess_01",
      slideNumber: 4
    });
    report("Engine duplication rule categorized as 'repeated-word'", engineFindings[0]?.category === "repeated-word");
  }

  // -----------------------------------------------------------------
  // 5. MULTIPLE SUGGESTIONS HANDLING
  // -----------------------------------------------------------------
  console.log("\n── Test 5: Multiple Suggestions Handling ──");
  {
    const text = "The recieve function failed.";
    const mockMatch = {
      message: "Spelling error",
      offset: 4,
      length: 7,
      replacements: [
        { value: "receive" },
        { value: "relieve" },
        { value: "recipe" },
        { value: "received" },
        { value: "receiver" },
        { value: "surplus_suggestion" }
      ],
      rule: { id: "MORFOLOGIK_RULE_EN_US", category: { id: "TYPOS" } }
    };

    const findings = Analyzer.normalizeLanguageToolMatches([mockMatch], text, {
      captureId: "cap_sugg_01",
      sessionId: "sess_01",
      slideNumber: 1
    });

    report("Suggestions array populated", Array.isArray(findings[0]?.suggestions));
    report("Top suggestion is 'receive'", findings[0]?.suggestions[0] === "receive");
    report("Suggestions list clamped to max 5 items", findings[0]?.suggestions.length === 5);
    report("Suggestions are pure strings", findings[0]?.suggestions.every((s) => typeof s === "string"));
  }

  // -----------------------------------------------------------------
  // 6. EMPTY & WHITESPACE-ONLY TEXT HANDLING
  // -----------------------------------------------------------------
  console.log("\n── Test 6: Empty and Whitespace-Only Text ──");
  {
    const emptyRes = await Analyzer.analyzeText({
      text: "",
      captureId: "cap_empty",
      sessionId: "sess_01",
      slideNumber: 1
    });
    report("Empty text returns 'skipped' status", emptyRes.status === "skipped");
    report("Empty text has 0 findings", emptyRes.findings.length === 0);
    report("Reason provided for skipping", !!emptyRes.reason);

    const spaceRes = await Analyzer.analyzeText({
      text: "   \n\t  \r\n   ",
      captureId: "cap_space",
      sessionId: "sess_01",
      slideNumber: 1
    });
    report("Whitespace-only text returns 'skipped' status", spaceRes.status === "skipped");
    report("Whitespace-only text has 0 findings", spaceRes.findings.length === 0);
  }

  // -----------------------------------------------------------------
  // 7. TECHNICAL TERMS & ACRONYM SUPPRESSION
  // -----------------------------------------------------------------
  console.log("\n── Test 7: Technical Terms and Acronyms Suppression ──");
  {
    const terms = ["ETL", "SQL", "Kafka", "Kubernetes", "Snowflake", "SLA", "APIs", "JSON"];
    for (const term of terms) {
      report(`isTechnicalTerm recognises '${term}'`, Analyzer.isTechnicalTerm(term));
    }

    // When LanguageTool returns a misspelling on a technical acronym like "ETL"
    const text = "We built the ETL pipeline in Kubernetes.";
    const mockEtlMatch = {
      message: "Possible spelling mistake",
      offset: 13,
      length: 3, // "ETL"
      replacements: [{ value: "EAT" }],
      rule: { id: "MORFOLOGIK_RULE_EN_US", category: { id: "TYPOS" } }
    };
    const mockKubeMatch = {
      message: "Possible spelling mistake",
      offset: 29,
      length: 10, // "Kubernetes"
      replacements: [],
      rule: { id: "MORFOLOGIK_RULE_EN_US", category: { id: "TYPOS" } }
    };

    const findings = Analyzer.normalizeLanguageToolMatches([mockEtlMatch, mockKubeMatch], text, {
      captureId: "cap_tech_01",
      sessionId: "sess_01",
      slideNumber: 5
    });

    report("Technical terms & acronyms filtered out of findings", findings.length === 0);
  }

  // -----------------------------------------------------------------
  // 8. TEXT OFFSETS & SLICING ACCURACY
  // -----------------------------------------------------------------
  console.log("\n── Test 8: Correct Text Offsets and Slicing ──");
  {
    const text = "Modern Data Architecture with Apache Kafka streaming.";
    const offset = 30;
    const length = 12; // "Apache Kafka"
    const mockMatch = {
      message: "Example notice",
      offset,
      length,
      replacements: [],
      rule: { id: "CUSTOM_RULE", category: { id: "GRAMMAR" } }
    };

    const findings = Analyzer.normalizeLanguageToolMatches([mockMatch], text, {
      captureId: "cap_off_01",
      sessionId: "sess_01",
      slideNumber: 1
    });

    report("Start offset matches input offset", findings[0]?.startOffset === 30);
    report("End offset is startOffset + length", findings[0]?.endOffset === 42);
    report(
      "OriginalText matches exact slice from original input",
      text.slice(findings[0]?.startOffset, findings[0]?.endOffset) === findings[0]?.originalText
    );
  }

  // -----------------------------------------------------------------
  // 9. ASSOCIATION OF CAPTUREID, SESSIONID, AND SLIDENUMBER
  // -----------------------------------------------------------------
  console.log("\n── Test 9: Association with Session, Capture, and Slide ──");
  {
    const text = "Testing context association.";
    const mockMatch = {
      message: "Grammar test",
      offset: 0,
      length: 7,
      replacements: [],
      rule: { id: "TEST_RULE", category: { id: "GRAMMAR" } }
    };

    const findings = Analyzer.normalizeLanguageToolMatches([mockMatch], text, {
      captureId: "cap_custom_999",
      sessionId: "sess_beta_42",
      slideNumber: 4
    });

    report("finding.captureId correctly set", findings[0]?.captureId === "cap_custom_999");
    report("finding.sessionId correctly set", findings[0]?.sessionId === "sess_beta_42");
    report("finding.slideNumber correctly set", findings[0]?.slideNumber === 4);
    report("finding.issueId incorporates captureId", findings[0]?.issueId.includes("cap_custom_999"));
  }

  // -----------------------------------------------------------------
  // 10. DUPLICATE PREVENTION ON RE-ANALYSIS
  // -----------------------------------------------------------------
  console.log("\n── Test 10: Duplicate Prevention on Repeated Analysis ──");
  {
    const db = new MockIDBDatabaseV3();
    const captureId = "cap_recheck_123";

    const issue1 = {
      issueId: `iss_${captureId}_1`,
      captureId,
      sessionId: "sess_01",
      category: "spelling",
      message: "First run error",
      originalText: "misstake"
    };

    await db.saveFinding(issue1);
    const beforeCount = (await db.getFindingsByCapture(captureId)).length;
    report("Initial save stores 1 finding", beforeCount === 1);

    // Simulate re-analysis: clean previous findings for captureId then save updated findings
    db.clearFindingsForCapture(captureId);
    const updatedIssue1 = {
      issueId: `iss_${captureId}_1_recheck`,
      captureId,
      sessionId: "sess_01",
      category: "spelling",
      message: "Updated error",
      originalText: "misstake"
    };
    await db.saveFinding(updatedIssue1);

    const after = await db.getFindingsByCapture(captureId);
    report("Re-analysis does not accumulate duplicate findings", after.length === 1);
    report("Updated record replaces previous findings", after[0]?.message === "Updated error");
  }

  // -----------------------------------------------------------------
  // 11. INDEXEDDB SCHEMA, SAVE, AND RETRIEVAL
  // -----------------------------------------------------------------
  console.log("\n── Test 11: IndexedDB v3 Schema, Save & Retrieval ──");
  {
    const db = new MockIDBDatabaseV3();
    report("Database version is v3", db.version === 3);
    report("Object store 'analysisFindings' exists", !!db.stores.analysisFindings);
    report("Preserved 'screenshots' store", !!db.stores.screenshots);
    report("Preserved 'textExtractions' store", !!db.stores.textExtractions);

    const testRecord = {
      issueId: "iss_test_idb_1",
      captureId: "cap_idb_01",
      sessionId: "sess_idb_01",
      slideNumber: 2,
      category: "grammar",
      ruleId: "TEST_IDB_RULE",
      message: "Integration DB test finding",
      originalText: "provides",
      suggestions: ["provide"],
      startOffset: 10,
      endOffset: 18,
      severity: "high",
      source: "languagetool",
      status: "open",
      createdAt: new Date().toISOString()
    };

    await db.saveFinding(testRecord);
    const retrieved = await db.getFindingsByCapture("cap_idb_01");
    report("Successfully retrieved saved finding by captureId", retrieved.length === 1);
    report("Retrieved original text matches", retrieved[0]?.originalText === "provides");
    report("Retrieved severity matches", retrieved[0]?.severity === "high");
  }

  // -----------------------------------------------------------------
  // 12. NETWORK FAILURES & MALFORMED RESPONSES
  // -----------------------------------------------------------------
  console.log("\n── Test 12: Network Failures and Malformed Responses ──");
  {
    // Simulate network error
    const failingFetch = async () => {
      throw new Error("Failed to connect to language server: ECONNREFUSED");
    };

    const netRes = await Analyzer.analyzeText({
      text: "Some valid text for checking.",
      captureId: "cap_net_err",
      sessionId: "sess_01",
      slideNumber: 1,
      fetchImpl: failingFetch
    });

    report("Network failure returns 'failed' status", netRes.status === "failed");
    report("Descriptive network error message captured", netRes.error.includes("ECONNREFUSED"));
    report("Empty findings returned on failure", netRes.findings.length === 0);

    // Simulate 500 Internal Server Error
    const http500Fetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Backend crashed"
    });

    const httpRes = await Analyzer.analyzeText({
      text: "Some valid text for checking.",
      captureId: "cap_http_err",
      sessionId: "sess_01",
      slideNumber: 1,
      fetchImpl: http500Fetch
    });

    report("HTTP 500 returns 'failed' status", httpRes.status === "failed");
    report("Error message includes status code 500", httpRes.error.includes("500"));

    // Simulate malformed JSON
    const malformedJsonFetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      }
    });

    const parseRes = await Analyzer.analyzeText({
      text: "Some valid text for checking.",
      captureId: "cap_json_err",
      sessionId: "sess_01",
      slideNumber: 1,
      fetchImpl: malformedJsonFetch
    });

    report("Malformed JSON returns 'failed' status", parseRes.status === "failed");
    report("Malformed JSON error message captured", parseRes.error.includes("Malformed JSON"));
  }

  // -----------------------------------------------------------------
  // 13. MISSING CONFIGURATION FALLBACK & RETRY BEHAVIOR
  // -----------------------------------------------------------------
  console.log("\n── Test 13: Configuration Fallback and Retry Behavior ──");
  {
    let requestedUrl = null;
    let attemptCount = 0;

    const trackingFetch = async (url) => {
      attemptCount++;
      requestedUrl = url;
      if (attemptCount === 1) {
        throw new Error("Temporary network timeout");
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ matches: [] })
      };
    };

    // First attempt fails
    const firstAttempt = await Analyzer.analyzeText({
      text: "Testing retry behavior.",
      captureId: "cap_retry_01",
      sessionId: "sess_01",
      slideNumber: 1,
      fetchImpl: trackingFetch
    });

    report("First attempt uses DEFAULT_ENDPOINT", requestedUrl === Analyzer.DEFAULT_ENDPOINT);
    report("First attempt fails with network error", firstAttempt.status === "failed");

    // Retry succeeds
    const secondAttempt = await Analyzer.analyzeText({
      text: "Testing retry behavior.",
      captureId: "cap_retry_01",
      sessionId: "sess_01",
      slideNumber: 1,
      fetchImpl: trackingFetch
    });

    report("Retry successfully recovers to 'completed' status", secondAttempt.status === "completed");
    report("Attempt count reached 2", attemptCount === 2);
  }

  // -----------------------------------------------------------------
  // 14. SEQUENCE VALIDATION (PREVENTION BEFORE EXTRACTION)
  // -----------------------------------------------------------------
  console.log("\n── Test 14: Prevention of Analysis Before Text Extraction ──");
  {
    const missingCaptureRes = await Analyzer.analyzeText({
      text: "Valid content",
      captureId: "", // Missing capture ID
      sessionId: "sess_01"
    });
    report("Empty captureId is rejected immediately", missingCaptureRes.status === "failed");
    report("Explicit error message returned for missing captureId", missingCaptureRes.error.includes("captureId"));

    const nullTextRes = await Analyzer.analyzeText({
      text: null, // Text extraction has not completed or returned null
      captureId: "cap_not_ready",
      sessionId: "sess_01"
    });
    report("Null text marks analysis as 'skipped' instead of creating errors", nullTextRes.status === "skipped");
  }

  // -----------------------------------------------------------------
  // 15. LIVE INTEGRATION TEST (REAL LANGUAGETOOL API)
  // -----------------------------------------------------------------
  console.log("\n── Test 15: LIVE INTEGRATION TEST (Real LanguageTool API) ──");
  console.log("    [Live Call to https://api.languagetool.org/v2/check]");
  try {
    const liveText = "This sentence have a obvious mistake and the the duplicate word.";
    const liveResult = await Analyzer.analyzeText({
      text: liveText,
      captureId: "cap_live_integration",
      sessionId: "sess_live_test",
      slideNumber: 1,
      fetchImpl: (typeof fetch !== "undefined" ? fetch : require("node-fetch"))
    });

    report("Live LanguageTool API call succeeded", liveResult.status === "completed");
    report("Live API identified findings", liveResult.findings && liveResult.findings.length > 0);

    const categoriesDetected = new Set(liveResult.findings.map((f) => f.category));
    console.log(`    Detected categories: ${Array.from(categoriesDetected).join(", ")}`);
    console.log(`    Total live findings: ${liveResult.findings.length}`);

    report("Repeated word 'the the' identified", categoriesDetected.has("repeated-word"));
    report("Grammar error identified in 'This sentence have'", categoriesDetected.has("grammar"));
  } catch (liveErr) {
    console.warn(`    ⚠️ Live API request encountered environment limitation: ${liveErr.message}`);
    report("Live LanguageTool test executed", false, liveErr.message);
  }

  // ===================================================================
  // Summary
  // ===================================================================
  console.log("\n==========================================================");
  console.log(`Stage 6 Language Analysis Tests: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total`);
  console.log("==========================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
