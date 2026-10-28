// Course QA Assistant - Language Analysis Engine (Stage 6)
// Provides grammar, spelling, punctuation, capitalization, and repeated-word detection
// via LanguageTool-compatible API endpoints.
// Runs in Background Service Worker and is testable in Node.js.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CourseQAGrammarAnalyzer = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_ENDPOINT = "https://api.languagetool.org/v2/check";
  const DEFAULT_LANGUAGE = "en-US";

  // Common technical terms, acronyms, and enterprise data terminology
  // to avoid flagging as false-positive spelling errors.
  const TECH_ALLOWLIST = new Set([
    "api", "apis", "etl", "elt", "sql", "nosql", "sla", "slas", "qa",
    "dom", "html", "css", "url", "urls", "json", "rest", "graphql",
    "saas", "paas", "iaas", "sdk", "sdks", "ui", "ux", "olap", "oltp",
    "dataops", "devops", "devsecops", "mlops", "ai", "ml", "bi",
    "kafka", "spark", "hadoop", "snowflake", "databricks", "kubernetes",
    "postgres", "postgresql", "mysql", "mongodb", "redis", "cloud",
    "dataset", "datasets", "metadata", "pipeline", "pipelines", "lakehouse",
    "datalake", "datalakes", "microservice", "microservices", "frontend",
    "backend", "viewport", "elearning", "e-learning", "subId"
  ]);

  /**
   * Checks whether a word is an acronym or recognized technical term.
   */
  function isTechnicalTerm(word) {
    if (!word || typeof word !== "string") return false;
    const clean = word.trim().replace(/^['"“‘(]+|[)'"”’.,;:!?]+$/g, "");
    if (!clean) return false;

    // Check uppercase acronyms (e.g., "ETL", "SLA", "SQL", "APIs")
    if (/^[A-Z]{2,}[s]?$/.test(clean)) return true;

    // Check lowercase against technical dictionary
    return TECH_ALLOWLIST.has(clean.toLowerCase());
  }

  /**
   * Categorizes a LanguageTool match into one of the required Stage 6 issue types:
   * "spelling" | "grammar" | "punctuation" | "capitalization" | "repeated-word" | "other"
   */
  function categorizeMatch(match) {
    const ruleId = (match.rule && match.rule.id) ? match.rule.id.toUpperCase() : "";
    const issueType = (match.rule && match.rule.issueType) ? match.rule.issueType.toLowerCase() : "";
    const categoryId = (match.rule && match.rule.category && match.rule.category.id)
      ? match.rule.category.id.toUpperCase()
      : "";

    // 1. Repeated words
    if (
      issueType === "duplication" ||
      ruleId.includes("REPEAT") ||
      ruleId.includes("DUPLICATION") ||
      categoryId.includes("REDUNDANCY")
    ) {
      return "repeated-word";
    }

    // 2. Spelling / Typos
    if (
      issueType === "misspelling" ||
      categoryId === "TYPOS" ||
      ruleId.includes("MORFOLOGIK") ||
      ruleId.includes("SPELL")
    ) {
      return "spelling";
    }

    // 3. Punctuation
    if (
      issueType === "punctuation" ||
      categoryId === "PUNCTUATION" ||
      ruleId.includes("PUNCTUATION") ||
      ruleId.includes("COMMA")
    ) {
      return "punctuation";
    }

    // 4. Capitalization
    if (
      issueType === "casing" ||
      categoryId === "CASING" ||
      ruleId.includes("CAPITALIZATION") ||
      ruleId.includes("UPPERCASE") ||
      ruleId.includes("LOWERCASE")
    ) {
      return "capitalization";
    }

    // 5. Grammar
    if (
      issueType === "grammar" ||
      categoryId === "GRAMMAR" ||
      ruleId.includes("AGR") ||
      ruleId.includes("VERB") ||
      ruleId.includes("ARTICLE") ||
      ruleId.includes("DT_")
    ) {
      return "grammar";
    }

    // Fallback based on issueType
    if (issueType.includes("grammar")) return "grammar";
    if (issueType.includes("spell")) return "spelling";

    return "grammar";
  }

  /**
   * Assigns an issue severity rating based on category and rule properties.
   */
  function determineSeverity(category, match) {
    if (category === "grammar" || category === "spelling") {
      return "high";
    }
    if (category === "repeated-word") {
      return "medium";
    }
    if (category === "capitalization" || category === "punctuation") {
      return "low";
    }
    return "medium";
  }

  /**
   * Normalizes LanguageTool API matches into the project's finding schema.
   *
   * @param {Array} matches - Raw LanguageTool matches array
   * @param {string} fullText - Original text that was analyzed
   * @param {object} context - { captureId, sessionId, slideNumber }
   * @returns {Array<object>} Standardized findings
   */
  function normalizeLanguageToolMatches(matches, fullText, { captureId, sessionId, slideNumber }) {
    if (!Array.isArray(matches) || !fullText) return [];

    const findings = [];
    const timestamp = new Date().toISOString();

    matches.forEach((match, index) => {
      const startOffset = typeof match.offset === "number" ? match.offset : 0;
      const length = typeof match.length === "number" ? match.length : 0;
      const endOffset = startOffset + length;

      // Extract exact text from original input
      const originalText = fullText.slice(startOffset, endOffset);

      const category = categorizeMatch(match);

      // Filter false positives on legitimate technical terms & acronyms
      if (category === "spelling" && isTechnicalTerm(originalText)) {
        return;
      }

      // Collect replacement suggestions
      const suggestions = Array.isArray(match.replacements)
        ? match.replacements
            .map((r) => (typeof r === "string" ? r : r.value))
            .filter(Boolean)
            .slice(0, 5)
        : [];

      const severity = determineSeverity(category, match);
      const ruleId = match.rule?.id || "GENERIC_RULE";
      const issueId = `iss_${captureId}_${index + 1}_${Math.random().toString(36).slice(2, 6)}`;

      findings.push({
        issueId,
        sessionId: sessionId || "unknown-session",
        captureId: captureId,
        slideNumber: slideNumber || 1,
        category,
        ruleId,
        message: match.message || "Potential language issue detected.",
        originalText,
        suggestions,
        startOffset,
        endOffset,
        severity,
        source: "languagetool",
        status: "open",
        createdAt: timestamp
      });
    });

    return findings;
  }

  /**
   * Standalone adjacent repeated-word detector (e.g. "the the", "is is").
   * Acts as a reliable safeguard in case the remote engine lacks a specific repeat rule.
   */
  function detectAdjacentRepeatedWords(text, { captureId, sessionId, slideNumber }) {
    if (!text || typeof text !== "string") return [];
    const findings = [];
    const regex = /\b([a-zA-Z]{2,})\s+\1\b/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      const repeatedWord = match[1];

      findings.push({
        issueId: `iss_rep_${captureId}_${startOffset}`,
        sessionId: sessionId || "unknown-session",
        captureId,
        slideNumber: slideNumber || 1,
        category: "repeated-word",
        ruleId: "ADJACENT_DUPLICATE_WORD",
        message: `Word "${repeatedWord}" is repeated consecutively.`,
        originalText: match[0],
        suggestions: [repeatedWord],
        startOffset,
        endOffset,
        severity: "medium",
        source: "internal-regex",
        status: "open",
        createdAt: new Date().toISOString()
      });
    }

    return findings;
  }

  /**
   * Main analysis method. Analyzes slide text using LanguageTool API or compatible endpoint.
   *
   * @param {object} opts
   * @param {string} opts.text              - Text to analyze
   * @param {string} opts.captureId         - Associated captureId
   * @param {string} opts.sessionId         - Associated sessionId
   * @param {number} opts.slideNumber       - Slide number
   * @param {string} [opts.endpoint]        - LanguageTool endpoint URL
   * @param {string} [opts.language]        - Language code (default 'en-US')
   * @param {string} [opts.apiKey]          - Optional API key
   * @param {string} [opts.username]        - Optional username
   * @param {Function} [opts.fetchImpl]     - Custom fetch implementation (for Node tests)
   * @returns {Promise<object>}             - Analysis result record
   */
  async function analyzeText(opts) {
    const {
      text,
      captureId,
      sessionId,
      slideNumber = 1,
      endpoint = DEFAULT_ENDPOINT,
      language = DEFAULT_LANGUAGE,
      apiKey = null,
      username = null,
      fetchImpl = (typeof fetch !== "undefined" ? fetch : null)
    } = opts;

    if (!captureId || typeof captureId !== "string" || !captureId.trim()) {
      return {
        status: "failed",
        error: "Valid captureId is required for analysis.",
        findings: []
      };
    }

    // Handle empty or whitespace-only text
    if (!text || typeof text !== "string" || !text.trim()) {
      return {
        status: "skipped",
        reason: "No usable text to analyze on this slide.",
        findings: [],
        totalIssues: 0,
        captureId,
        sessionId,
        slideNumber
      };
    }

    if (!fetchImpl) {
      return {
        status: "failed",
        error: "Fetch API is not available in current environment.",
        findings: [],
        captureId
      };
    }

    // Build URL-encoded form data for LanguageTool POST /v2/check
    const params = new URLSearchParams();
    params.append("text", text);
    params.append("language", language || DEFAULT_LANGUAGE);

    if (apiKey) params.append("apiKey", apiKey);
    if (username) params.append("username", username);

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: params.toString()
      });
    } catch (networkErr) {
      const errMsg = networkErr?.message || String(networkErr || "Network connection failure");
      return {
        status: "failed",
        error: `Language service network error: ${errMsg}`,
        findings: [],
        captureId,
        sessionId,
        slideNumber
      };
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch (_) {}
      return {
        status: "failed",
        error: `Language service HTTP error: ${response.status} ${response.statusText} ${detail}`.trim(),
        findings: [],
        captureId,
        sessionId,
        slideNumber
      };
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      return {
        status: "failed",
        error: "Malformed JSON response received from language service.",
        findings: [],
        captureId,
        sessionId,
        slideNumber
      };
    }

    // Normalize matches
    const ltMatches = Array.isArray(data.matches) ? data.matches : [];
    const normalized = normalizeLanguageToolMatches(ltMatches, text, {
      captureId,
      sessionId,
      slideNumber
    });

    // Check for any duplicate words not caught by the LT ruleset
    const regexRepeats = detectAdjacentRepeatedWords(text, {
      captureId,
      sessionId,
      slideNumber
    });

    // Merge without overlapping duplicates
    regexRepeats.forEach((rep) => {
      const alreadyCovered = normalized.some(
        (n) => n.category === "repeated-word" && Math.abs(n.startOffset - rep.startOffset) < 3
      );
      if (!alreadyCovered) {
        normalized.push(rep);
      }
    });

    // Sort findings by position in text
    normalized.sort((a, b) => a.startOffset - b.startOffset);

    return {
      status: "completed",
      findings: normalized,
      totalIssues: normalized.length,
      captureId,
      sessionId,
      slideNumber,
      analyzedAt: new Date().toISOString()
    };
  }

  return {
    DEFAULT_ENDPOINT,
    DEFAULT_LANGUAGE,
    isTechnicalTerm,
    categorizeMatch,
    determineSeverity,
    normalizeLanguageToolMatches,
    detectAdjacentRepeatedWords,
    analyzeText
  };
});
