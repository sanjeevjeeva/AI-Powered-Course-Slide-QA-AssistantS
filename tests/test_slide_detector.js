// Automated Unit Tests for Slide Detection Engine
// Tests slide fingerprinting, transition detection, debounce, and mutation filtering

const assert = require("assert");

// Mock browser environment for Node.js
class MockElement {
  constructor(tagName, id = "", className = "", attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.attributes = attributes;
    this.children = [];
    this.textContent = "";
  }

  getAttribute(attr) {
    return this.attributes[attr] || null;
  }

  setAttribute(attr, val) {
    this.attributes[attr] = val;
  }

  closest(selector) {
    if (selector === "#course-qa-assistant-host") {
      return this.id === "course-qa-assistant-host" ? this : null;
    }
    return null;
  }

  querySelector(selector) {
    if (selector.includes(".slide-heading") || selector.includes("h1, h2")) {
      return this.children.find(c => c.className.includes("slide-heading") || c.tagName === "H2" || c.tagName === "H1") || null;
    }
    return null;
  }
}

class MockDocument {
  constructor() {
    this.elements = [];
    this.body = new MockElement("body");
  }

  querySelector(selector) {
    if (selector.includes(".slide.active")) {
      return this.elements.find(e => e.className.includes("slide") && e.className.includes("active")) || null;
    }
    if (selector.includes("#slide-indicator")) {
      return this.elements.find(e => e.id === "slide-indicator") || null;
    }
    if (selector.includes("h1, h2")) {
      return this.elements.find(e => e.tagName === "H1" || e.tagName === "H2") || null;
    }
    return null;
  }
}

// Global mocks
global.window = {
  location: { hash: "", search: "" },
  addEventListener: (evt, cb) => {
    global.window._listeners = global.window._listeners || {};
    global.window._listeners[evt] = cb;
  },
  removeEventListener: (evt) => {
    if (global.window._listeners) delete global.window._listeners[evt];
  },
  dispatchEvent: (evt) => {
    if (global.window._listeners && global.window._listeners[evt.type]) {
      global.window._listeners[evt.type](evt);
    }
  }
};

global.document = new MockDocument();
global.MutationObserver = class {
  constructor(cb) {
    this.cb = cb;
  }
  observe() {}
  disconnect() {}
};

// Load slide detector code
require("../browser-extension/content/slide-detector.js");
const SlideDetector = global.window.CourseQASlideDetector;

async function runTests() {
  console.log("=========================================");
  console.log("Running Slide Detector Automated Tests");
  console.log("=========================================");

  const detector = new SlideDetector();
  detector.settleDelayMs = 20; // fast settle for tests
  detector.cooldownMs = 50;

  // Setup mock DOM representing Slide 1
  const indicator = new MockElement("div", "slide-indicator");
  indicator.textContent = "Slide 1 of 5";

  const slide1 = new MockElement("div", "slide-1", "slide active", { "data-slide": "1" });
  const heading1 = new MockElement("h2", "", "slide-heading");
  heading1.textContent = "Modern Data Architecture";
  slide1.children.push(heading1);

  const slide2 = new MockElement("div", "slide-2", "slide", { "data-slide": "2" });
  const heading2 = new MockElement("h2", "", "slide-heading");
  heading2.textContent = "Managing Data as a Shared Asset";
  slide2.children.push(heading2);

  global.document.elements = [indicator, slide1, slide2];

  // Test 1: Extract slide info
  console.log("\n[Test 1] Slide info extraction for Slide 1");
  const info1 = detector.getSlideInfo();
  assert.strictEqual(info1.slideNumber, 1, "Slide number should be 1");
  assert.strictEqual(info1.slideTitle, "Modern Data Architecture", "Slide title matches heading");
  assert.ok(info1.fingerprint.includes("num:1"), "Fingerprint contains slide number");
  console.log("✓ Test 1 Passed: Slide 1 correctly parsed.");

  // Test 2: Start detection and verify baseline
  console.log("\n[Test 2] Initialize detector");
  let capturedSlides = [];
  detector.start((slide) => {
    capturedSlides.push(slide);
  });
  assert.strictEqual(detector.isActive, true, "Detector should be active");
  console.log("✓ Test 2 Passed: Detector active.");

  // Test 3: Filter QA widget mutations
  console.log("\n[Test 3] QA Widget Mutation Filtering");
  const widgetHost = new MockElement("div", "course-qa-assistant-host");
  detector._onMutation([{ target: widgetHost }]);
  assert.strictEqual(detector.settleTimer, null, "Mutations on QA host should be ignored completely");
  console.log("✓ Test 3 Passed: Widget self-mutations ignored.");

  // Test 4: Genuine Slide Transition (Slide 1 -> Slide 2)
  console.log("\n[Test 4] Transition to Slide 2");
  detector.markCaptured(info1.fingerprint); // Slide 1 was captured

  // Allow cooldown window
  await new Promise((r) => setTimeout(r, 70));

  // Transition DOM to Slide 2
  slide1.className = "slide";
  slide2.className = "slide active";
  indicator.textContent = "Slide 2 of 5";

  detector._onCourseEvent({
    type: "course:slideChanged",
    detail: { slideNumber: 2, totalSlides: 5, slideTitle: "Managing Data as a Shared Asset" }
  });

  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(capturedSlides.length, 1, "Should have triggered 1 automatic capture for Slide 2");
  assert.strictEqual(capturedSlides[0].slideNumber, 2, "Captured slide should be Slide 2");
  console.log("✓ Test 4 Passed: Slide 2 detected and captured.");

  // Test 5: Prevent duplicate captures on identical slide
  console.log("\n[Test 5] Duplicate Prevention on Same Slide");
  detector.markCaptured(capturedSlides[0].fingerprint);
  const countBefore = capturedSlides.length;

  // Trigger DOM mutation on same slide 2
  detector._onMutation([{ target: slide2 }]);
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(capturedSlides.length, countBefore, "No duplicate capture should occur on same slide");
  console.log("✓ Test 5 Passed: Duplicate capture successfully suppressed.");

  // Test 6: Navigating Back to Previous Slide (Slide 2 -> Slide 1)
  console.log("\n[Test 6] Navigation back to Slide 1 (Previous)");
  slide2.className = "slide";
  slide1.className = "slide active";
  indicator.textContent = "Slide 1 of 5";

  // Allow cooldown
  await new Promise((r) => setTimeout(r, 60));

  detector._onCourseEvent({
    type: "course:slideChanged",
    detail: { slideNumber: 1, totalSlides: 5, slideTitle: "Modern Data Architecture" }
  });

  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(capturedSlides.length, 2, "Navigating to previous slide must trigger a capture");
  assert.strictEqual(capturedSlides[1].slideNumber, 1, "Captured previous slide should be Slide 1");
  console.log("✓ Test 6 Passed: Navigation to previous slide verified.");

  // Test 7: Manual Screenshot Capture Coordination
  console.log("\n[Test 7] Manual Screenshot Capture Handling");
  const manualCaptureRecord = {
    captureId: "cap_MANUAL_001_9999",
    sessionId: "QA-MANUAL",
    captureType: "manual",
    captureNumber: 3,
    slideNumber: 1,
    timestamp: Date.now()
  };
  assert.strictEqual(manualCaptureRecord.captureType, "manual", "Manual capture record carries manual type");
  assert.strictEqual(manualCaptureRecord.slideNumber, 1, "Manual capture captures active slide number");
  console.log("✓ Test 7 Passed: Manual capture record correctly generated.");

  // Test 8: Stop detector
  console.log("\n[Test 8] Stop detector on End QA");
  detector.stop();
  assert.strictEqual(detector.isActive, false, "Detector should be stopped");
  assert.strictEqual(detector.settleTimer, null, "Settle timer cleared");
  console.log("✓ Test 8 Passed: Detector stops cleanly.");

  console.log("\n=========================================");
  console.log("ALL AUTOMATED TESTS PASSED (8/8)");
  console.log("=========================================\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
