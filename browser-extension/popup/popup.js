// Course QA Assistant - Popup Script
// Displays live capture metrics and provides access to view all captured slides individually

document.addEventListener("DOMContentLoaded", () => {
  const statusPill = document.getElementById("status-pill");
  const statusLabel = document.getElementById("status-label");
  const sessionId = document.getElementById("session-id");
  const capturedEl = document.getElementById("popup-captured");
  const analyzingEl = document.getElementById("popup-analyzing");
  const issuesEl = document.getElementById("popup-issues");
  const toggleWidget = document.getElementById("toggle-widget");
  const btnViewLatest = document.getElementById("btn-popup-view-latest");
  const capturedSlidesSection = document.getElementById("captured-slides-section");
  const slidesCountLabel = document.getElementById("slides-count-label");
  const slidesList = document.getElementById("slides-list");

  let latestCaptureId = null;

  // Load initial status
  chrome.runtime.sendMessage({ action: "GET_QA_STATUS" }, (res) => {
    if (!res) return;

    toggleWidget.checked = res.widgetVisible !== false;

    if (res.activeSession && res.activeSession.status === "ACTIVE") {
      const s = res.activeSession;
      statusPill.classList.add("active");
      statusLabel.textContent = "Active";
      sessionId.textContent = `${s.sessionId} (${s.courseName})`;
      capturedEl.textContent = s.capturedCount;
      analyzingEl.textContent = s.analyzingCount;
      issuesEl.textContent = s.issuesCount;

      if (s.slides && s.slides.length > 0) {
        latestCaptureId = s.slides[s.slides.length - 1].captureId;
        btnViewLatest.style.display = "flex";
        renderSlidesList(s.slides);
      } else {
        renderSlidesList([]);
      }
    } else if (res.lastCompletedSession) {
      const s = res.lastCompletedSession;
      statusPill.classList.remove("active");
      statusLabel.textContent = "Ended";
      sessionId.textContent = `Last: ${s.sessionId}`;
      capturedEl.textContent = s.capturedCount;
      analyzingEl.textContent = s.analyzingCount;
      issuesEl.textContent = s.issuesCount;

      if (s.slides && s.slides.length > 0) {
        latestCaptureId = s.slides[s.slides.length - 1].captureId;
        btnViewLatest.style.display = "flex";
        renderSlidesList(s.slides);
      } else {
        renderSlidesList([]);
      }
    } else {
      statusPill.classList.remove("active");
      statusLabel.textContent = "Idle";
      sessionId.textContent = "Ready to start session on page";
      btnViewLatest.style.display = "none";
      renderSlidesList([]);
    }
  });

  function renderSlidesList(slides) {
    if (!slides || !slides.length) {
      if (capturedSlidesSection) capturedSlidesSection.style.display = "none";
      return;
    }

    if (capturedSlidesSection) capturedSlidesSection.style.display = "flex";
    if (slidesCountLabel) slidesCountLabel.textContent = slides.length;
    if (!slidesList) return;

    slidesList.innerHTML = "";

    slides.forEach((slide) => {
      const row = document.createElement("div");
      row.className = "slide-row";

      const title = slide.pageTitle || `Slide #${slide.captureNumber}`;
      const type = (slide.captureType || "auto").toUpperCase();
      const time = slide.timestamp ? new Date(slide.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

      row.innerHTML = `
        <div class="slide-row-left">
          <span class="slide-row-num">#${slide.captureNumber}</span>
          <div class="slide-row-info">
            <span class="slide-row-title" title="${title}">${title}</span>
            <span class="slide-row-type">${type} • ${time}</span>
          </div>
        </div>
        <button class="btn-row-view" data-id="${slide.captureId}">View ↗</button>
      `;

      row.querySelector(".btn-row-view").addEventListener("click", () => {
        chrome.runtime.sendMessage({
          action: "OPEN_VIEWER_TAB",
          captureId: slide.captureId
        });
      });

      slidesList.appendChild(row);
    });
  }

  // Open viewer tab for latest capture
  btnViewLatest.addEventListener("click", () => {
    if (latestCaptureId) {
      chrome.runtime.sendMessage({
        action: "OPEN_VIEWER_TAB",
        captureId: latestCaptureId
      });
    }
  });

  // Toggle widget visibility
  toggleWidget.addEventListener("change", (e) => {
    chrome.runtime.sendMessage({
      action: "TOGGLE_WIDGET",
      visible: e.target.checked
    });
  });
});
