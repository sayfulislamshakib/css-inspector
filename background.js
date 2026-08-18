// background.js

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

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_pause_on_popup") {
    chrome.storage.local.get({ pauseOnPopup: true }, (result) => {
      const newValue = !result.pauseOnPopup;
      chrome.storage.local.set({ pauseOnPopup: newValue });
    });
  } else if (command === "toggle_block_interactions") {
    chrome.storage.local.get({ blockInteractions: true }, (result) => {
      const newValue = !result.blockInteractions;
      chrome.storage.local.set({ blockInteractions: newValue });
    });
  }
});

// Keep context menu title in sync whenever blockInteractions changes in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.blockInteractions !== undefined) {
    chrome.contextMenus.update("toggleBlockInteractions", {
      title: changes.blockInteractions.newValue ? "Disable Click Blocking" : "Enable Click Blocking"
    }, () => {
      if (chrome.runtime.lastError) {}
    });
  }
});

// Shared toggle logic — used by both icon click and keyboard shortcut
async function toggleInspectorForTab(tab) {
  if (!tab || !tab.id) return;
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "toggleInspector" });
    updateBadge(response, tab.id);
  } catch (e) {
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
      // Failed to inject script (e.g. on restricted chrome:// pages)
    }
  }
}

// Toggle via toolbar icon click (also triggered by _execute_action keyboard shortcut)
chrome.action.onClicked.addListener((tab) => toggleInspectorForTab(tab));

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

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'badgeOff' && sender.tab) {
    chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
  }
  
  // When a panel opens in one frame, tell all other frames in the tab to hide theirs
  if (request.action === 'panelOpened' && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, { 
      action: 'hideOtherPanels', 
      instanceId: request.instanceId 
    }).catch(() => {});
  }

  // When a frame is hovered, tell all other frames to clear their hover overlays
  if (request.action === 'frameHovered' && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, { 
      action: 'hideOtherOverlays', 
      instanceId: request.instanceId 
    }).catch(() => {});
  }
});
