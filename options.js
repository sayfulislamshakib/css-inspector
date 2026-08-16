// options.js

// Saves options to chrome.storage
function saveOptions() {
  const blockInteractions = document.getElementById('blockInteractions').checked;
  const pauseOnPopup = document.getElementById('pauseOnPopup').checked;
  chrome.storage.local.set({ blockInteractions, pauseOnPopup }, () => {
    // Update status to let user know options were saved.
    const status = document.getElementById('status');
    status.textContent = 'Settings saved!';
    status.classList.add('visible');
    setTimeout(() => {
      status.classList.remove('visible');
    }, 2000);
    
    // Also update the context menu title
    chrome.contextMenus.update("toggleBlockInteractions", {
      title: blockInteractions ? "Disable Click Blocking" : "Enable Click Blocking"
    }, () => {
      // Ignore errors if context menu hasn't been created yet
      if (chrome.runtime.lastError) {}
    });
  });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restoreOptions() {
  chrome.storage.local.get({ blockInteractions: true, pauseOnPopup: true }, (result) => {
    document.getElementById('blockInteractions').checked = result.blockInteractions;
    document.getElementById('pauseOnPopup').checked = result.pauseOnPopup;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('blockInteractions').addEventListener('change', saveOptions);
document.getElementById('pauseOnPopup').addEventListener('change', saveOptions);
