/**
 * WaitPlay background service worker.
 *
 * Watches outgoing XHR/fetch requests with chrome.webRequest. If a request
 * is still in flight 5 seconds after it started, the content script for
 * that tab is told to show the "want to play while you wait?" overlay.
 * When the tracked request finishes (success or error), the content
 * script is told to stop the game immediately.
 *
 * No blocking listeners are used, so this never delays or modifies any
 * network traffic - it only observes timing.
 */

const LONG_REQUEST_MS = 5000;

// requestId -> { tabId, timeoutId }
const pendingRequests = new Map();

// tabId -> requestId currently driving an active overlay/game in that tab
const activeOverlayByTab = new Map();

function safeSendMessage(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    // Swallow "no receiving end" errors (e.g. chrome:// pages, closed tabs).
    void chrome.runtime.lastError;
  });
}

function forgetRequest(requestId) {
  const entry = pendingRequests.get(requestId);
  if (entry) {
    clearTimeout(entry.timeoutId);
    pendingRequests.delete(requestId);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return; // not associated with a tab (e.g. extension/background traffic)
    if (activeOverlayByTab.has(details.tabId)) return; // one overlay/game at a time per tab

    const timeoutId = setTimeout(() => {
      pendingRequests.delete(details.requestId);
      activeOverlayByTab.set(details.tabId, details.requestId);
      safeSendMessage(details.tabId, {
        type: "waitplay-show",
        requestId: details.requestId
      });
    }, LONG_REQUEST_MS);

    pendingRequests.set(details.requestId, {
      tabId: details.tabId,
      timeoutId
    });
  },
  { urls: ["<all_urls>"], types: ["xmlhttprequest"] }
);

function handleRequestFinished(details, reason) {
  const wasTracked = pendingRequests.has(details.requestId);
  forgetRequest(details.requestId);

  const activeRequestId = activeOverlayByTab.get(details.tabId);
  if (activeRequestId === details.requestId) {
    activeOverlayByTab.delete(details.tabId);
    safeSendMessage(details.tabId, {
      type: "waitplay-stop",
      requestId: details.requestId,
      reason
    });
  } else if (wasTracked) {
    // Finished before the 5s threshold - nothing to do, overlay was never shown.
  }
}

chrome.webRequest.onCompleted.addListener(
  (details) => handleRequestFinished(details, "completed"),
  { urls: ["<all_urls>"], types: ["xmlhttprequest"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => handleRequestFinished(details, "error"),
  { urls: ["<all_urls>"], types: ["xmlhttprequest"] }
);

// If the tab navigates to a new page, any overlay/game in the old document
// is gone with it - stop tracking so a stray timer doesn't fire into a
// fresh page later.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // main frame only
  activeOverlayByTab.delete(details.tabId);
  for (const [requestId, entry] of pendingRequests) {
    if (entry.tabId === details.tabId) {
      clearTimeout(entry.timeoutId);
      pendingRequests.delete(requestId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeOverlayByTab.delete(tabId);
  for (const [requestId, entry] of pendingRequests) {
    if (entry.tabId === tabId) {
      clearTimeout(entry.timeoutId);
      pendingRequests.delete(requestId);
    }
  }
});

// The content script tells us when the user dismisses the prompt without
// playing, or closes the result screen, so this tab can trigger again for
// the next slow request.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "waitplay-release" && sender.tab) {
    activeOverlayByTab.delete(sender.tab.id);
  }
});
