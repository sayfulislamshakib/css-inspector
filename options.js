// options.js

// Default shortcuts
const DEFAULT_SHORTCUTS = {
  toggleInspector: { ctrlKey: true, shiftKey: true, altKey: false, key: 'E' },
  togglePause: { ctrlKey: false, shiftKey: false, altKey: true, key: 'P' },
  toggleBlockInteractions: { ctrlKey: false, shiftKey: false, altKey: true, key: 'B' }
};

// Current shortcut state
let currentShortcuts = {};

// ── Checkbox Settings ──

function saveOptions() {
  const blockInteractions = document.getElementById('blockInteractions').checked;
  const pauseOnPopup = document.getElementById('pauseOnPopup').checked;
  chrome.storage.local.set({ blockInteractions, pauseOnPopup }, () => {
    showStatus('Settings saved!');
    
    // Also update the context menu title
    chrome.contextMenus.update("toggleBlockInteractions", {
      title: blockInteractions ? "Disable Click Blocking" : "Enable Click Blocking"
    }, () => {
      // Ignore errors if context menu hasn't been created yet
      if (chrome.runtime.lastError) {}
    });
  });
}

function restoreOptions() {
  chrome.storage.local.get({ blockInteractions: true, pauseOnPopup: true }, (result) => {
    document.getElementById('blockInteractions').checked = result.blockInteractions;
    document.getElementById('pauseOnPopup').checked = result.pauseOnPopup;
  });
}

// ── Status Display ──

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.classList.add('visible');
  setTimeout(() => {
    status.classList.remove('visible');
  }, 2000);
}

// ── Keyboard Shortcut System ──

// Convert a shortcut object to a human-readable string
function shortcutToString(shortcut) {
  if (!shortcut || !shortcut.key) return '';
  const parts = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  parts.push(shortcut.key);
  return parts.join('+');
}

// Render key badges HTML inside a shortcut-input element
function renderShortcutBadges(container, shortcut) {
  if (!container) return;
  if (!shortcut || !shortcut.key) {
    container.innerHTML = '<span class="placeholder-text">Click to record</span>';
    return;
  }
  const parts = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  parts.push(shortcut.key);

  container.innerHTML = parts.map((part, i) => {
    let html = `<span class="key-badge">${part}</span>`;
    if (i < parts.length - 1) {
      html += '<span class="key-separator">+</span>';
    }
    return html;
  }).join('');
}

// Check if two shortcuts are the same combination
function shortcutsMatch(a, b) {
  if (!a || !b) return false;
  return a.ctrlKey === b.ctrlKey &&
         a.altKey === b.altKey &&
         a.shiftKey === b.shiftKey &&
         a.key === b.key;
}

// Save shortcuts to storage
function saveShortcuts() {
  chrome.storage.local.set({ customShortcuts: currentShortcuts }, () => {
    showStatus('Shortcut saved!');
  });
}

// Restore shortcuts from storage
function restoreShortcuts() {
  chrome.storage.local.get({ customShortcuts: DEFAULT_SHORTCUTS }, (result) => {
    currentShortcuts = Object.assign({}, DEFAULT_SHORTCUTS, result.customShortcuts);
    
    // Render each shortcut
    const toggleInspectorEl = document.getElementById('shortcutToggleInspector');
    const togglePauseEl = document.getElementById('shortcutTogglePause');
    const toggleBlockInteractionsEl = document.getElementById('shortcutToggleBlockInteractions');
    
    renderShortcutBadges(toggleInspectorEl, currentShortcuts.toggleInspector);
    renderShortcutBadges(togglePauseEl, currentShortcuts.togglePause);
    renderShortcutBadges(toggleBlockInteractionsEl, currentShortcuts.toggleBlockInteractions);
  });
}

// Map key event to a normalized key name
function normalizeKey(e) {
  // For letter keys, use uppercase
  if (e.key.length === 1) return e.key.toUpperCase();
  
  // Special key mappings
  const keyMap = {
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    'Insert': 'Insert',
    ' ': 'Space',
    'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
    'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
    'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    ',': ',', '.': '.', '/': '/', ';': ';', "'": "'",
    '[': '[', ']': ']', '\\': '\\', '`': '`', '-': '-', '=': '=',
  };
  
  return keyMap[e.key] || e.key;
}

// Reserved/dangerous shortcuts that shouldn't be used
function isReservedShortcut(shortcut) {
  const reserved = [
    { ctrlKey: true, key: 'C' },
    { ctrlKey: true, key: 'V' },
    { ctrlKey: true, key: 'X' },
    { ctrlKey: true, key: 'A' },
    { ctrlKey: true, key: 'Z' },
    { ctrlKey: true, key: 'S' },
    { ctrlKey: true, key: 'W' },
    { ctrlKey: true, key: 'T' },
    { ctrlKey: true, key: 'N' },
    { ctrlKey: true, key: 'F' },
    { ctrlKey: true, key: 'P' },
    { ctrlKey: true, key: 'R' },
    { ctrlKey: true, key: 'L' },
  ];
  
  return reserved.some(r => {
    return shortcut.ctrlKey === (r.ctrlKey || false) &&
           shortcut.altKey === (r.altKey || false) &&
           shortcut.shiftKey === (r.shiftKey || false) &&
           shortcut.key === r.key;
  });
}

function showError(msg) {
  const errorEl = document.getElementById('shortcutError');
  errorEl.textContent = msg;
  setTimeout(() => { errorEl.textContent = ''; }, 4000);
}

// Set up shortcut recording for an input element
function setupShortcutRecorder(inputEl, shortcutId) {
  if (!inputEl) return;
  let isRecording = false;

  inputEl.addEventListener('click', () => {
    if (isRecording) return;
    isRecording = true;
    inputEl.classList.add('recording');
    inputEl.innerHTML = '<span class="placeholder-text">Press keys...</span>';
    inputEl.focus();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (!isRecording) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Ignore standalone modifier keys
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    // Escape cancels recording
    if (e.key === 'Escape') {
      isRecording = false;
      inputEl.classList.remove('recording');
      renderShortcutBadges(inputEl, currentShortcuts[shortcutId]);
      return;
    }
    
    const key = normalizeKey(e);
    const hasModifier = e.ctrlKey || e.altKey || e.shiftKey;
    
    // Require at least one modifier key
    if (!hasModifier) {
      showError('Shortcut must include at least one modifier key (Ctrl, Alt, or Shift).');
      return;
    }

    const newShortcut = {
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      key: key
    };
    
    // Check for reserved shortcuts
    if (isReservedShortcut(newShortcut)) {
      showError(`${shortcutToString(newShortcut)} is a reserved browser shortcut.`);
      return;
    }

    // Check for conflicts with any other shortcut
    for (const [id, otherShortcut] of Object.entries(currentShortcuts)) {
      if (id !== shortcutId && otherShortcut && shortcutsMatch(newShortcut, otherShortcut)) {
        showError(`${shortcutToString(newShortcut)} is already used by another shortcut.`);
        return;
      }
    }

    // Accept the shortcut
    isRecording = false;
    inputEl.classList.remove('recording');
    currentShortcuts[shortcutId] = newShortcut;
    renderShortcutBadges(inputEl, newShortcut);
    saveShortcuts();
  });
  
  // Cancel recording when clicking outside
  document.addEventListener('click', (e) => {
    if (isRecording && !inputEl.contains(e.target)) {
      isRecording = false;
      inputEl.classList.remove('recording');
      renderShortcutBadges(inputEl, currentShortcuts[shortcutId]);
    }
  });
}

// ── Init ──

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  restoreShortcuts();
  
  // Checkbox listeners
  document.getElementById('blockInteractions').addEventListener('change', saveOptions);
  document.getElementById('pauseOnPopup').addEventListener('change', saveOptions);
  
  // Set up shortcut recorders
  setupShortcutRecorder(document.getElementById('shortcutToggleInspector'), 'toggleInspector');
  setupShortcutRecorder(document.getElementById('shortcutTogglePause'), 'togglePause');
  setupShortcutRecorder(document.getElementById('shortcutToggleBlockInteractions'), 'toggleBlockInteractions');
  
  // Clear buttons
  document.getElementById('clearToggleInspector').addEventListener('click', () => {
    currentShortcuts.toggleInspector = null;
    renderShortcutBadges(document.getElementById('shortcutToggleInspector'), null);
    saveShortcuts();
  });
  
  document.getElementById('clearTogglePause').addEventListener('click', () => {
    currentShortcuts.togglePause = null;
    renderShortcutBadges(document.getElementById('shortcutTogglePause'), null);
    saveShortcuts();
  });

  document.getElementById('clearToggleBlockInteractions').addEventListener('click', () => {
    currentShortcuts.toggleBlockInteractions = null;
    renderShortcutBadges(document.getElementById('shortcutToggleBlockInteractions'), null);
    saveShortcuts();
  });
  
  // Reset to defaults
  document.getElementById('resetShortcuts').addEventListener('click', () => {
    currentShortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
    renderShortcutBadges(document.getElementById('shortcutToggleInspector'), currentShortcuts.toggleInspector);
    renderShortcutBadges(document.getElementById('shortcutTogglePause'), currentShortcuts.togglePause);
    renderShortcutBadges(document.getElementById('shortcutToggleBlockInteractions'), currentShortcuts.toggleBlockInteractions);
    saveShortcuts();
    showStatus('Shortcuts reset to defaults!');
  });
});
