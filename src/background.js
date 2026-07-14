// Knockoff background service worker. The toolbar button toggles the
// in-page control panel on Amazon tabs; anywhere else (no content script to
// answer the message) it opens the settings page instead.

// First install: open the welcome page. Knockoff works out of the box, so
// onboarding is a demo ("see it work on Amazon"), not a settings form.
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  }
});

chrome.action.onClicked.addListener(function (tab) {
  chrome.tabs.sendMessage(tab.id, { type: "ko-toggle-panel" }, function () {
    if (chrome.runtime.lastError) chrome.runtime.openOptionsPage();
  });
});

// Content scripts can't open the options page themselves.
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "ko-open-options") chrome.runtime.openOptionsPage();
});
