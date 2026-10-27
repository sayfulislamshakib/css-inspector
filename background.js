// background.js

// Listen for clicks on the extension icon
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ blockInteractions: true }, (result) => {
    // Remove first so re-installs/updates don't throw "duplicate id" errors
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "toggleBlockInteractions",
        title: result.blockInteractions ? "Disable Click Blocking" : "Enable Click Blocking",
        contexts: ["all"]
      });
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
  } else if (command === "toggle_measurement") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggleMeasurementShortcut" }).catch(() => {});
      }
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

  // Read the current state from the top frame, injecting the content script if needed
  let currentState = false;
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { action: "getState" }, { frameId: 0 });
    currentState = !!(state && state.isActive);
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
    } catch (injectError) {
      // Failed to inject script (e.g. on restricted chrome:// pages)
      return;
    }
  }

  // Send an explicit state so every frame ends up in the same state
  await setInspectorStateForTab(tab.id, !currentState);
}

async function setInspectorStateForTab(tabId, isActive) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: "toggleInspector", isActive });
    updateBadge(response, tabId);
    return true;
  } catch (e) {
    return false;
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

  // In-page shortcut (or Esc) asked to change state — apply it to every frame in the tab
  if (request.action === 'requestToggle' && sender.tab) {
    setInspectorStateForTab(sender.tab.id, !!request.isActive)
      .then((ok) => sendResponse({ ok }));
    return true; // keep the message channel open for the async response
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

// Clear badge on tab refresh or navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
});
