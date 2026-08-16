// background.js
// Service worker for the CSS Inspector extension



// Listen for clicks on the extension icon
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ blockInteractions: true }, (result) => {
    chrome.contextMenus.create({
      id: "toggleBlockInteractions",
      title: result.blockInteractions ? "Disable Click Blocking" : "Enable Click Blocking",
      contexts: ["all"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "toggleBlockInteractions") {
    chrome.storage.local.get({ blockInteractions: true }, (result) => {
      const newValue = !result.blockInteractions;
      chrome.storage.local.set({ blockInteractions: newValue }, () => {
        chrome.contextMenus.update("toggleBlockInteractions", {
          title: newValue ? "Disable Click Blocking" : "Enable Click Blocking"
        });
      });
    });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "toggleInspector" });
    updateBadge(response, tab.id);
  } catch (e) {
    console.log("Content script not injected yet. Injecting now...");
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['content/content.js']
      });
      
      const response = await chrome.tabs.sendMessage(tab.id, { action: "toggleInspector" });
      updateBadge(response, tab.id);
    } catch (injectError) {
      console.error("Failed to inject script: ", injectError);
    }
  }
});

function updateBadge(response, tabId) {
  if (response && response.isActive !== undefined) {
    if (response.isActive) {
      chrome.action.setBadgeText({ text: "ON", tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId: tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId: tabId });
    }
  }
}
