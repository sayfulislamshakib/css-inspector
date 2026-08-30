if (!window.cssInspectorInjected) {
  window.cssInspectorInjected = true;

  const myInstanceId = Math.random().toString(36).substring(2, 15);

  // State
  let isActive = false;
  let blockInteractions = true;
  let pauseOnPopup = true;
  let currentTarget = null;
  let clickedTarget = null;
  let overlay = null;
  let overlayMargin = null;
  let overlayPadding = null;
  let overlayContent = null;
  let overlayHighlight = null;
  let overlayGaps = null;
  let clickedOverlay = null;
  let panel = null;
  const collapsedSections = new Set();
  let isFrameHovered = false;
  let currentHighlightedRegion = null;
  const selectedHighlightRegions = new Set();
  let selectedOverlayContainer = null;
  let gapHighlightsContainer = null;

  // Gap measurement state
  let measureTarget = null;
  let measureOverlay = null;
  let measureOverlayB = null;
  let measureSvg = null;
  let isMeasuring = false;
  let isMeasureLocked = false;
  let isMeasurementEnabled = false;

  let lastMouseX = 0;
  let lastMouseY = 0;

  function getElementUnderCursor() {
    if (lastMouseX || lastMouseY) {
      const elements = document.elementsFromPoint(lastMouseX, lastMouseY) || [];
      const el = elements.find(item => item !== overlay && item !== clickedOverlay && !(item.id && item.id.startsWith('css-inspector-')) && !item.closest('#css-inspector-panel'));
      if (el) return el;
    }
    return currentTarget;
  }

  let isDraggingPanel = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialPanelX = 0;
  let initialPanelY = 0;
  let forceUpdateOverlay = false;

  // Initialize
  function init() {
    if (document.getElementById('css-inspector-overlay-container')) return;

    // Ensure Inter font is loaded
    if (!document.getElementById('css-inspector-font-inter')) {
      const fontLink = document.createElement('link');
      fontLink.id = 'css-inspector-font-inter';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(fontLink);
    }

    // Custom keyboard shortcuts
    let customShortcuts = {
      toggleInspector: { ctrlKey: true, shiftKey: true, altKey: false, key: 'E' },
      togglePause: { ctrlKey: false, shiftKey: false, altKey: true, key: 'P' },
      toggleBlockInteractions: { ctrlKey: false, shiftKey: false, altKey: true, key: 'B' },
      toggleMeasurement: { ctrlKey: false, shiftKey: false, altKey: true, key: 'M' }
    };

    try {
      chrome.storage.local.get({ blockInteractions: true, pauseOnPopup: true, customShortcuts: null }, (result) => {
        blockInteractions = result.blockInteractions;
        pauseOnPopup = result.pauseOnPopup;
        if (result.customShortcuts) {
          customShortcuts = Object.assign({}, customShortcuts, result.customShortcuts);
        }
      });

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
          if (changes.blockInteractions !== undefined) {
            blockInteractions = changes.blockInteractions.newValue;
            if (isActive) {
              showToast(`Click Blocking: ${blockInteractions ? "ON" : "OFF"}`);
            }
          }
          if (changes.pauseOnPopup !== undefined) {
            pauseOnPopup = changes.pauseOnPopup.newValue;
            forceUpdateOverlay = true;
            if (isActive) {
              showToast(`Pause on Popup: ${pauseOnPopup ? "ON" : "OFF"}`);
              if (pauseOnPopup && clickedTarget) {
                updateOverlay(clickedTarget);
              } else if (!pauseOnPopup && currentTarget) {
                updateOverlay(currentTarget);
              }
            }
          }
          if (changes.customShortcuts !== undefined) {
            customShortcuts = changes.customShortcuts.newValue;
          }
        }
      });
    } catch (e) { }

    // Create overlay container
    overlay = document.createElement('div');
    overlay.id = 'css-inspector-overlay-container';

    overlayMargin = document.createElement('div');
    overlayMargin.id = 'css-inspector-overlay-margin';
    overlay.appendChild(overlayMargin);

    overlayPadding = document.createElement('div');
    overlayPadding.id = 'css-inspector-overlay-padding';
    overlay.appendChild(overlayPadding);

    overlayContent = document.createElement('div');
    overlayContent.id = 'css-inspector-overlay-content';
    overlay.appendChild(overlayContent);

    overlayHighlight = document.createElement('div');
    overlayHighlight.id = 'css-inspector-overlay-highlight';
    overlay.appendChild(overlayHighlight);

    selectedOverlayContainer = document.createElement('div');
    selectedOverlayContainer.id = 'css-inspector-overlay-selected-container';
    overlay.appendChild(selectedOverlayContainer);

    gapHighlightsContainer = document.createElement('div');
    gapHighlightsContainer.id = 'css-inspector-gap-highlights';
    overlay.appendChild(gapHighlightsContainer);

    // Create gap overlay SVG
    overlayGaps = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlayGaps.id = 'css-inspector-overlay-gaps';
    overlayGaps.innerHTML = `
    <defs>
      <pattern id="css-inspector-gap-pattern" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
        <rect width="5" height="10" fill="rgba(147, 51, 234, 0.4)" />
        <rect x="5" width="5" height="10" fill="rgba(147, 51, 234, 0.15)" />
      </pattern>
      <mask id="css-inspector-gap-mask">
        <rect width="100%" height="100%" fill="white" />
        <g id="css-inspector-gap-mask-children"></g>
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="url(#css-inspector-gap-pattern)" mask="url(#css-inspector-gap-mask)" />
  `;
    overlay.appendChild(overlayGaps);

    // Create overlay value labels container
    const overlayLabels = document.createElement('div');
    overlayLabels.id = 'css-inspector-overlay-labels';
    overlayLabels.innerHTML = `
    <span class="css-inspector-olabel" data-pos="margin-top"></span>
    <span class="css-inspector-olabel" data-pos="margin-right"></span>
    <span class="css-inspector-olabel" data-pos="margin-bottom"></span>
    <span class="css-inspector-olabel" data-pos="margin-left"></span>
    <span class="css-inspector-olabel" data-pos="border-top"></span>
    <span class="css-inspector-olabel" data-pos="border-right"></span>
    <span class="css-inspector-olabel" data-pos="border-bottom"></span>
    <span class="css-inspector-olabel" data-pos="border-left"></span>
    <span class="css-inspector-olabel" data-pos="padding-top"></span>
    <span class="css-inspector-olabel" data-pos="padding-right"></span>
    <span class="css-inspector-olabel" data-pos="padding-bottom"></span>
    <span class="css-inspector-olabel" data-pos="padding-left"></span>
    <span class="css-inspector-olabel" data-pos="width"></span>
    <span class="css-inspector-olabel" data-pos="height"></span>
    <span class="css-inspector-olabel" data-pos="content-dims"></span>
  `;
    overlay.appendChild(overlayLabels);

    document.body.appendChild(overlay);

    // Create clicked overlay
    clickedOverlay = document.createElement('div');
    clickedOverlay.id = 'css-inspector-clicked-overlay';
    document.body.appendChild(clickedOverlay);

    // Create gap measurement overlays
    measureOverlay = document.createElement('div');
    measureOverlay.id = 'css-inspector-measure-overlay-a';
    measureOverlay.className = 'css-inspector-measure-overlay';
    document.body.appendChild(measureOverlay);

    measureOverlayB = document.createElement('div');
    measureOverlayB.id = 'css-inspector-measure-overlay-b';
    measureOverlayB.className = 'css-inspector-measure-overlay';
    document.body.appendChild(measureOverlayB);

    measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    measureSvg.id = 'css-inspector-measure-svg';
    document.body.appendChild(measureSvg);

    // Create panel
    panel = document.createElement('div');
    panel.id = 'css-inspector-panel';
    panel.innerHTML = `
    <div class="css-inspector-header" id="css-inspector-header">
      <h3>Element Info</h3>
      <button class="css-inspector-close" id="css-inspector-close" title="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div id="css-inspector-content"></div>
  `;
    document.body.appendChild(panel);

    document.getElementById('css-inspector-close').addEventListener('click', () => {
      panel.classList.remove('active');
      overlay.classList.remove('active');
      if (overlayHighlight) overlayHighlight.classList.remove('active');
      if (selectedOverlayContainer) selectedOverlayContainer.innerHTML = '';
      if (gapHighlightsContainer) gapHighlightsContainer.innerHTML = '';
      overlayGaps.classList.remove('active');
      hideOverlayLabels();
      clickedOverlay.classList.remove('active');
      clickedTarget = null;
      currentHighlightedRegion = null;
      selectedHighlightRegions.clear();
      clearSelectedHighlightUI();
      clearMeasurement();
    });

    const contentEl = document.getElementById('css-inspector-content');

    // Helper to extract highlightable info from a target element inside popup
    function getHighlightableFromEvent(e) {
      const sideEl = e.target.closest('[data-side]');
      if (sideEl) {
        return { regionKey: sideEl.getAttribute('data-side'), element: sideEl };
      }
      const boxEl = e.target.closest('[data-box]');
      if (boxEl) {
        return { regionKey: boxEl.getAttribute('data-box'), element: boxEl };
      }
      const rowEl = e.target.closest('[data-highlight]');
      if (rowEl) {
        return { regionKey: rowEl.getAttribute('data-highlight'), element: rowEl };
      }
      return null;
    }

    function updateSelectedUI() {
      contentEl.querySelectorAll('.css-inspector-region-selected').forEach(el => {
        el.classList.remove('css-inspector-region-selected');
      });

      selectedHighlightRegions.forEach(regionKey => {
        const matchingElements = contentEl.querySelectorAll(
          `[data-side="${regionKey}"], [data-box="${regionKey}"], [data-highlight="${regionKey}"]`
        );
        matchingElements.forEach(el => el.classList.add('css-inspector-region-selected'));
      });
    }

    function clearSelectedHighlightUI() {
      contentEl.querySelectorAll('.css-inspector-region-selected').forEach(el => {
        el.classList.remove('css-inspector-region-selected');
      });
    }

    // Delegated hover highlight for Element Info popup (Box model & Layout rows)
    contentEl.addEventListener('mouseover', (e) => {
      const el = (pauseOnPopup && clickedTarget) ? clickedTarget : (clickedTarget || currentTarget);
      if (!el) return;

      const item = getHighlightableFromEvent(e);
      if (item) {
        // If this region is already selected/clicked, do not trigger hover highlight
        if (selectedHighlightRegions.has(item.regionKey)) {
          highlightRegion(null, null);
          return;
        }
        highlightRegion(el, item.regionKey);
      } else {
        highlightRegion(null, null);
      }
    });

    contentEl.addEventListener('mouseout', (e) => {
      if (!contentEl.contains(e.relatedTarget)) {
        highlightRegion(null, null);
      }
    });

    // Prevent browser text selection when Shift-clicking inside panel
    contentEl.addEventListener('mousedown', (e) => {
      if (e.shiftKey) {
        e.preventDefault();
      }
    });

    // Delegated click handler for selecting/toggling highlight and click-to-copy
    contentEl.addEventListener('click', (e) => {
      if (window.getSelection) {
        const sel = window.getSelection();
        if (sel.removeAllRanges) sel.removeAllRanges();
      }

      if (e.target.closest('select') || e.target.closest('.css-inspector-section-title')) return;

      const el = clickedTarget || currentTarget;
      const item = getHighlightableFromEvent(e);

      if (item && el) {
        const isShift = e.shiftKey;

        if (isShift) {
          // Shift + Click: toggle this item in the multi-select set
          if (selectedHighlightRegions.has(item.regionKey)) {
            selectedHighlightRegions.delete(item.regionKey);
          } else {
            selectedHighlightRegions.add(item.regionKey);
          }
        } else {
          // Regular Click (no Shift):
          if (selectedHighlightRegions.size === 1 && selectedHighlightRegions.has(item.regionKey)) {
            // Clicking the only selected item again -> unselect all
            selectedHighlightRegions.clear();
          } else {
            // Select only this item
            selectedHighlightRegions.clear();
            selectedHighlightRegions.add(item.regionKey);
          }
        }

        updateSelectedUI();
        renderSelectedRegions(el);
      }

      // 1. If clicked a class text (.css-inspector-class-text)
      const classEl = e.target.closest('.css-inspector-class-text');
      if (classEl) {
        const text = classEl.textContent.trim();
        if (text) {
          navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`));
          return;
        }
      }

      // 2. If clicked color box or color wrap
      const colorWrap = e.target.closest('.css-inspector-color-wrap');
      if (colorWrap) {
        const hexEl = colorWrap.querySelector('.css-inspector-value-text');
        const hex = hexEl ? hexEl.textContent.trim() : colorWrap.textContent.trim();
        if (hex) {
          navigator.clipboard.writeText(hex).then(() => showToast(`Copied ${hex}`));
          return;
        }
      }

      // 3. If clicked value text (.css-inspector-value-text)
      const valueTextEl = e.target.closest('.css-inspector-value-text');
      if (valueTextEl) {
        const text = valueTextEl.textContent.trim();
        if (text) {
          navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`));
          return;
        }
      }

      // 4. If clicked box model values (.css-inspector-box-val, .css-inspector-box-dims)
      const boxVal = e.target.closest('.css-inspector-box-val, .css-inspector-box-dims');
      if (boxVal) {
        const text = boxVal.textContent.trim();
        if (text && text !== '-') {
          navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`));
          return;
        }
      }

      // 5. If clicked any value container (.css-inspector-value)
      const valueEl = e.target.closest('.css-inspector-value');
      if (valueEl) {
        const firstText = valueEl.querySelector('.css-inspector-value-text');
        const text = firstText ? firstText.textContent.trim() : valueEl.textContent.trim();
        if (text) {
          navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`));
          return;
        }
      }
    });

    const header = panel.querySelector('.css-inspector-header');
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.css-inspector-close')) return;
      isDraggingPanel = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialPanelX = rect.left;
      initialPanelY = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isDraggingPanel) {
        e.preventDefault();
        e.stopPropagation();
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        let newX = initialPanelX + dx;
        let newY = initialPanelY + dy;

        newX = Math.max(0, Math.min(newX, window.innerWidth - panel.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - panel.offsetHeight));

        panel.style.left = `${newX}px`;
        panel.style.top = `${newY}px`;
      }
    }, true);

    document.addEventListener('mouseup', () => {
      isDraggingPanel = false;
    }, true);

    // Listeners
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('scroll', handleScroll, true);

    // Handle mouse leaving the frame to prevent stuck overlays
    document.addEventListener('mouseout', (e) => {
      if (!isActive || isDraggingPanel) return;

      // If relatedTarget is null, the pointer has left the document viewport
      if (!e.relatedTarget) {
        isFrameHovered = false;
        if (!clickedTarget) {
          overlay.classList.remove('active');
        }
        currentTarget = null;
      }
    }, true);

    // Intercept other actions
    const intercept = (e) => {
      if (!isActive || !blockInteractions) return;
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      if (target.closest && target.closest('#css-inspector-panel')) return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('mousedown', intercept, true);
    document.addEventListener('mouseup', intercept, true);
    document.addEventListener('pointerdown', intercept, true);
    document.addEventListener('pointerup', intercept, true);
    document.addEventListener('submit', intercept, true);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // ── Custom shortcut matching ──
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

      // Helper to check if a keydown event matches a shortcut definition
      function matchesShortcut(shortcut) {
        if (!shortcut || !shortcut.key) return false;
        return e.ctrlKey === !!shortcut.ctrlKey &&
          e.altKey === !!shortcut.altKey &&
          e.shiftKey === !!shortcut.shiftKey &&
          key === shortcut.key;
      }

      // Toggle Inspector shortcut (works even when inspector is off)
      if (matchesShortcut(customShortcuts.toggleInspector)) {
        e.preventDefault();
        e.stopPropagation();
        toggleInspector(!isActive);
        try {
          if (!isActive) {
            chrome.runtime.sendMessage({ action: 'badgeOff' });
          }
        } catch (err) { }
        return;
      }

      // Toggle Pause on Popup shortcut
      if (matchesShortcut(customShortcuts.togglePause)) {
        e.preventDefault();
        e.stopPropagation();
        pauseOnPopup = !pauseOnPopup;
        try {
          chrome.storage.local.set({ pauseOnPopup });
        } catch (err) { }
        return;
      }

      // Toggle Block Interactions shortcut
      if (matchesShortcut(customShortcuts.toggleBlockInteractions)) {
        e.preventDefault();
        e.stopPropagation();
        blockInteractions = !blockInteractions;
        try {
          chrome.storage.local.set({ blockInteractions });
        } catch (err) { }
        return;
      }

      // Toggle Distance Measurement shortcut
      if (matchesShortcut(customShortcuts.toggleMeasurement)) {
        e.preventDefault();
        e.stopPropagation();
        toggleMeasurementShortcut();
        return;
      }

      // ── Built-in keyboard shortcuts (only when inspector is active) ──
      if (!isActive) return;

      // Instant Alt-key measuring when Alt is pressed
      if (e.key === 'Alt') {
        e.preventDefault();
        const hoveredEl = getElementUnderCursor();
        if (hoveredEl) {
          if (clickedTarget && hoveredEl !== clickedTarget) {
            measureTarget = hoveredEl;
            isMeasuring = true;
            renderMeasurement(clickedTarget, measureTarget);
          } else {
            const targetToMeasure = clickedTarget || hoveredEl;
            const parentContainer = getReferenceContainer(targetToMeasure);
            if (parentContainer && parentContainer !== targetToMeasure) {
              isMeasuring = true;
              renderMeasurement(parentContainer, targetToMeasure);
            }
          }
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        if (isMeasuring) {
          // Exit measurement mode first
          clearMeasurement();
        } else if (clickedTarget) {
          // Close popup and deselect element
          panel.classList.remove('active');
          clickedOverlay.classList.remove('active');
          overlay.classList.remove('active');
          if (overlayHighlight) overlayHighlight.classList.remove('active');
          if (selectedOverlayContainer) selectedOverlayContainer.innerHTML = '';
          if (gapHighlightsContainer) gapHighlightsContainer.innerHTML = '';
          overlayGaps.classList.remove('active');
          hideOverlayLabels();
          clickedTarget = null;
          currentHighlightedRegion = null;
          selectedHighlightRegions.clear();
        } else {
          // No popup open — turn off the inspector entirely
          toggleInspector(false);
          try {
            chrome.runtime.sendMessage({ action: 'badgeOff' });
          } catch (err) { }
        }
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        if (isActive) e.preventDefault();
        if (!isMeasureLocked && !isMeasurementEnabled) {
          clearMeasurement();
        }
      }
    }, true);
  }

  // Toggle Inspector
  function toggleInspector(state) {
    isActive = state;
    if (!isActive) {
      isMeasurementEnabled = false;
      overlay.classList.remove('active');
      if (overlayHighlight) overlayHighlight.classList.remove('active');
      if (selectedOverlayContainer) selectedOverlayContainer.innerHTML = '';
      if (gapHighlightsContainer) gapHighlightsContainer.innerHTML = '';
      clickedOverlay.classList.remove('active');
      panel.classList.remove('active');
      currentTarget = null;
      clickedTarget = null;
      currentHighlightedRegion = null;
      selectedHighlightRegions.clear();
      clearMeasurement();
      document.body.classList.remove('css-inspector-mode-active');
      showToast("Inspector: OFF");
    } else {
      document.body.classList.add('css-inspector-mode-active');
      showToast("Inspector: ON");
    }
  }

  function showToast(message) {
    let toast = document.getElementById('css-inspector-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'css-inspector-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');

    if (toast.timeoutId) clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // Scroll logic
  function handleScroll(e) {
    if (!isActive || isDraggingPanel) return;

    // Update clicked overlay (selection indicator) position
    if (clickedTarget) {
      const rect = clickedTarget.getBoundingClientRect();
      clickedOverlay.style.top = `${rect.top}px`;
      clickedOverlay.style.left = `${rect.left}px`;
      clickedOverlay.style.width = `${rect.width}px`;
      clickedOverlay.style.height = `${rect.height}px`;
    }

    // Update measurement overlays on scroll
    if (isMeasuring) {
      if (clickedTarget && measureTarget) {
        renderMeasurement(clickedTarget, measureTarget);
      } else if (!clickedTarget && currentTarget) {
        const parentContainer = getReferenceContainer(currentTarget);
        if (parentContainer && parentContainer !== currentTarget) {
          renderMeasurement(parentContainer, currentTarget);
        }
      }
    }

    // Update box model overlay (margin/padding/content)
    const activeTarget = (pauseOnPopup && clickedTarget) ? clickedTarget : currentTarget;
    if (activeTarget) {
      updateOverlay(activeTarget);
      if (currentHighlightedRegion) {
        highlightRegion(activeTarget, currentHighlightedRegion);
      }
      if (selectedHighlightRegions.size > 0) {
        renderSelectedRegions(activeTarget);
      }
    }
  }

  // Hover logic
  function handleMouseMove(e) {
    if (!isActive || isDraggingPanel) return;

    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    const target = (e.composedPath && e.composedPath()[0]) || e.target;

    // Ignore our own UI elements
    if ((target.closest && target.closest('#css-inspector-panel')) || target === overlay || target === clickedOverlay) return;
    if (target.id && target.id.startsWith('css-inspector-')) return;

    if (!isFrameHovered) {
      isFrameHovered = true;
      try {
        chrome.runtime.sendMessage({ action: 'frameHovered', instanceId: myInstanceId });
      } catch (err) { }
    }

    // If an element is clicked/selected:
    if (clickedTarget) {
      if (isMeasureLocked) {
        if (measureTarget) {
          renderMeasurement(clickedTarget, measureTarget);
        }
        updateOverlay(clickedTarget);
        return;
      }

      // Only measure on hover if measurement mode is enabled or user holds Alt / Shift
      if (isMeasurementEnabled || e.altKey || e.shiftKey) {
        if (target && target !== clickedTarget && target !== overlay && target !== clickedOverlay && !(target.id && target.id.startsWith('css-inspector-'))) {
          measureTarget = target;
          isMeasuring = true;
          renderMeasurement(clickedTarget, target);
        } else if (isMeasuring && (!target || target === clickedTarget)) {
          clearMeasurement();
        }
      } else if (isMeasuring) {
        clearMeasurement();
      }

      updateOverlay(clickedTarget);
      return;
    }

    if (target === currentTarget && !forceUpdateOverlay) {
      if ((isMeasurementEnabled || e.altKey) && target) {
        const parentContainer = getReferenceContainer(target);
        if (parentContainer && parentContainer !== target) {
          isMeasuring = true;
          renderMeasurement(parentContainer, target);
        }
      }
      return;
    }
    forceUpdateOverlay = false;
    currentTarget = target;

    updateOverlay(target);

    // If measurement mode is ON (Alt+M) or holding Alt, show distance measurement in default hover state to parent container!
    if (isMeasurementEnabled || e.altKey) {
      if (target && target !== overlay && target !== clickedOverlay && !(target.id && target.id.startsWith('css-inspector-'))) {
        const parentContainer = getReferenceContainer(target);
        if (parentContainer && parentContainer !== target) {
          isMeasuring = true;
          renderMeasurement(parentContainer, target);
        } else if (isMeasuring) {
          clearMeasurement();
        }
      } else if (isMeasuring) {
        clearMeasurement();
      }
    } else if (isMeasuring && !isMeasureLocked) {
      clearMeasurement();
    }
  }

  function updateOverlay(target) {
    if (!target) {
      overlay.classList.remove('active');
      overlayGaps.classList.remove('active');
      hideOverlayLabels();
      return;
    }

    const rect = target.getBoundingClientRect();
    const styles = window.getComputedStyle(target);

    const parseVal = (val) => parseFloat(val) || 0;

    const mt = parseVal(styles.marginTop);
    const mr = parseVal(styles.marginRight);
    const mb = parseVal(styles.marginBottom);
    const ml = parseVal(styles.marginLeft);

    const pt = parseVal(styles.paddingTop);
    const pr = parseVal(styles.paddingRight);
    const pb = parseVal(styles.paddingBottom);
    const pl = parseVal(styles.paddingLeft);

    const bt = parseVal(styles.borderTopWidth);
    const br = parseVal(styles.borderRightWidth);
    const bb = parseVal(styles.borderBottomWidth);
    const bl = parseVal(styles.borderLeftWidth);

    const top = rect.top;
    const left = rect.left;

    overlayMargin.style.top = `${top - mt}px`;
    overlayMargin.style.left = `${left - ml}px`;
    overlayMargin.style.width = `${rect.width + ml + mr}px`;
    overlayMargin.style.height = `${rect.height + mt + mb}px`;
    overlayMargin.style.borderWidth = `${mt}px ${mr}px ${mb}px ${ml}px`;

    overlayPadding.style.top = `${top + bt}px`;
    overlayPadding.style.left = `${left + bl}px`;
    overlayPadding.style.width = `${Math.max(0, rect.width - bl - br)}px`;
    overlayPadding.style.height = `${Math.max(0, rect.height - bt - bb)}px`;
    overlayPadding.style.borderWidth = `${pt}px ${pr}px ${pb}px ${pl}px`;

    overlayContent.style.top = `${top + bt + pt}px`;
    overlayContent.style.left = `${left + bl + pl}px`;
    overlayContent.style.width = `${Math.max(0, rect.width - bl - br - pl - pr)}px`;
    overlayContent.style.height = `${Math.max(0, rect.height - bt - bb - pt - pb)}px`;

    // Gap Highlighting for Flex/Grid
    const display = styles.display;
    if (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid') {
      overlayGaps.classList.add('active');
      const contentBoxTop = top + bt + pt;
      const contentBoxLeft = left + bl + pl;
      const contentBoxWidth = Math.max(0, rect.width - bl - br - pl - pr);
      const contentBoxHeight = Math.max(0, rect.height - bt - bb - pt - pb);

      overlayGaps.style.top = `${contentBoxTop}px`;
      overlayGaps.style.left = `${contentBoxLeft}px`;
      overlayGaps.style.width = `${contentBoxWidth}px`;
      overlayGaps.style.height = `${contentBoxHeight}px`;

      const maskChildrenGroup = overlayGaps.querySelector('#css-inspector-gap-mask-children');
      maskChildrenGroup.innerHTML = ''; // Clear previous children

      // Iterate over children and punch holes in the mask
      Array.from(target.children).forEach(child => {
        const childStyles = window.getComputedStyle(child);
        if (childStyles.display !== 'none') {
          const childRect = child.getBoundingClientRect();
          // Calculate child coordinates relative to the SVG container (the content box)
          const relX = childRect.left - contentBoxLeft;
          const relY = childRect.top - contentBoxTop;

          const rectEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rectEl.setAttribute("x", relX);
          rectEl.setAttribute("y", relY);
          rectEl.setAttribute("width", childRect.width);
          rectEl.setAttribute("height", childRect.height);
          rectEl.setAttribute("fill", "black"); // Black masks out the pattern
          maskChildrenGroup.appendChild(rectEl);
        }
      });
    } else {
      overlayGaps.classList.remove('active');
    }

    // Update overlay value labels positions and text
    const labels = overlay.querySelectorAll('.css-inspector-olabel');
    const contentW = Math.max(0, rect.width - bl - br - pl - pr);
    const contentH = Math.max(0, rect.height - bt - bb - pt - pb);
    const contentCenterX = left + bl + pl + contentW / 2;
    const contentCenterY = top + bt + pt + contentH / 2;

    labels.forEach(lbl => {
      const pos = lbl.dataset.pos;
      switch (pos) {
        // Margin labels
        case 'margin-top':
          lbl.textContent = mt > 0 ? `${Math.round(mt)}px` : '0px';
          lbl.style.top = `${top - (mt > 0 ? mt / 2 : 0)}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'margin-bottom':
          lbl.textContent = mb > 0 ? `${Math.round(mb)}px` : '0px';
          lbl.style.top = `${top + rect.height + (mb > 0 ? mb / 2 : 0)}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'margin-left':
          lbl.textContent = ml > 0 ? `${Math.round(ml)}px` : '0px';
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left - (ml > 0 ? ml / 2 : 0)}px`;
          break;
        case 'margin-right':
          lbl.textContent = mr > 0 ? `${Math.round(mr)}px` : '0px';
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + rect.width + (mr > 0 ? mr / 2 : 0)}px`;
          break;
        // Border labels
        case 'border-top':
          lbl.textContent = bt > 0 ? `${Math.round(bt)}px` : '0px';
          lbl.style.top = `${top + (bt > 0 ? bt / 2 : 0)}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'border-bottom':
          lbl.textContent = bb > 0 ? `${Math.round(bb)}px` : '0px';
          lbl.style.top = `${top + rect.height - (bb > 0 ? bb / 2 : 0)}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'border-left':
          lbl.textContent = bl > 0 ? `${Math.round(bl)}px` : '0px';
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + (bl > 0 ? bl / 2 : 0)}px`;
          break;
        case 'border-right':
          lbl.textContent = br > 0 ? `${Math.round(br)}px` : '0px';
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + rect.width - (br > 0 ? br / 2 : 0)}px`;
          break;
        // Padding labels
        case 'padding-top':
          lbl.textContent = pt > 0 ? `${Math.round(pt)}px` : '0px';
          lbl.style.top = `${top + bt + (pt > 0 ? pt / 2 : 0)}px`;
          lbl.style.left = `${contentCenterX}px`;
          break;
        case 'padding-bottom':
          lbl.textContent = pb > 0 ? `${Math.round(pb)}px` : '0px';
          lbl.style.top = `${top + rect.height - bb - (pb > 0 ? pb / 2 : 0)}px`;
          lbl.style.left = `${contentCenterX}px`;
          break;
        case 'padding-left':
          lbl.textContent = pl > 0 ? `${Math.round(pl)}px` : '0px';
          lbl.style.top = `${contentCenterY}px`;
          lbl.style.left = `${left + bl + (pl > 0 ? pl / 2 : 0)}px`;
          break;
        case 'padding-right':
          lbl.textContent = pr > 0 ? `${Math.round(pr)}px` : '0px';
          lbl.style.top = `${contentCenterY}px`;
          lbl.style.left = `${left + rect.width - br - (pr > 0 ? pr / 2 : 0)}px`;
          break;
        // Content / Width / Height dimensions
        case 'width':
          lbl.textContent = `W: ${Math.round(rect.width)}px`;
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'height':
          lbl.textContent = `H: ${Math.round(rect.height)}px`;
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'content-dims':
          lbl.innerHTML = `<span style="color:#93c5fd;font-weight:700;">W: ${Math.round(contentW)}px</span> <span style="color:#ffffff;opacity:0.8;">×</span> <span style="color:#5eead4;font-weight:700;">H: ${Math.round(contentH)}px</span>`;
          lbl.style.top = `${contentCenterY}px`;
          lbl.style.left = `${contentCenterX}px`;
          break;
      }
    });

    overlay.classList.add('active');
    renderGapHighlights(target);
    if (selectedHighlightRegions.size > 0) {
      showOverlayLabels(Array.from(selectedHighlightRegions));
    } else {
      resolveVisibleOverlayLabelOverlaps();
    }
  }

  function resolveVisibleOverlayLabelOverlaps() {
    const visibleLabels = Array.from(overlay.querySelectorAll('.css-inspector-olabel.visible'));
    if (visibleLabels.length <= 1) return;

    const labelItems = visibleLabels.map(lbl => {
      const w = lbl.offsetWidth || Math.max(38, (lbl.textContent.length * 8) + 16);
      const h = lbl.offsetHeight || 24;
      const x = parseFloat(lbl.style.left) || 0;
      const y = parseFloat(lbl.style.top) || 0;
      return {
        el: lbl,
        pos: lbl.dataset.pos,
        width: w,
        height: h,
        x: x,
        y: y
      };
    });

    const padding = 6;
    const maxIterations = 50;

    for (let iter = 0; iter < maxIterations; iter++) {
      let moved = false;

      for (let i = 0; i < labelItems.length; i++) {
        for (let j = i + 1; j < labelItems.length; j++) {
          const b1 = labelItems[i];
          const b2 = labelItems[j];

          const w1 = b1.width / 2;
          const h1 = b1.height / 2;
          const w2 = b2.width / 2;
          const h2 = b2.height / 2;

          const dx = b2.x - b1.x;
          const dy = b2.y - b1.y;

          const minDistanceX = w1 + w2 + padding;
          const minDistanceY = h1 + h2 + padding;

          const overlapX = minDistanceX - Math.abs(dx);
          const overlapY = minDistanceY - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            moved = true;

            if (overlapX < overlapY) {
              const shift = (overlapX / 2) + 0.5;
              const sign = dx >= 0 ? 1 : -1;
              b1.x -= shift * sign;
              b2.x += shift * sign;
            } else {
              const shift = (overlapY / 2) + 0.5;
              const sign = dy >= 0 ? 1 : -1;
              b1.y -= shift * sign;
              b2.y += shift * sign;
            }
          }
        }
      }

      if (!moved) break;
    }

    // Apply resolved positions
    for (const item of labelItems) {
      item.el.style.left = `${Math.round(item.x)}px`;
      item.el.style.top = `${Math.round(item.y)}px`;
    }
  }

  function showOverlayLabels(...args) {
    const flattened = args.flat(Infinity).filter(Boolean);
    if (flattened.length === 0) {
      hideOverlayLabels();
      return;
    }
    const labels = overlay.querySelectorAll('.css-inspector-olabel');
    labels.forEach(lbl => {
      const pos = lbl.dataset.pos;
      const match = flattened.some(type => {
        if (!type || typeof type !== 'string') return false;
        if (pos === type) return true;
        if ((type === 'padding' || type === 'padding-all') && pos.startsWith('padding-')) return true;
        if ((type === 'margin' || type === 'margin-all') && pos.startsWith('margin-')) return true;
        if ((type === 'border' || type === 'border-all') && pos.startsWith('border-')) return true;
        if ((type === 'content' || type === 'content-dims') && pos === 'content-dims') return true;
        if (type === 'width' && pos === 'width') return true;
        if (type === 'height' && pos === 'height') return true;
        return false;
      });
      if (match) {
        lbl.classList.add('visible');
      } else {
        lbl.classList.remove('visible');
      }
    });

    resolveVisibleOverlayLabelOverlaps();
  }

  function hideOverlayLabels() {
    const labels = overlay.querySelectorAll('.css-inspector-olabel');
    labels.forEach(lbl => lbl.classList.remove('visible'));
    if (gapHighlightsContainer && !selectedHighlightRegions.has('gap') && currentHighlightedRegion !== 'gap') {
      gapHighlightsContainer.innerHTML = '';
    }
  }

  function computeGaps(target) {
    if (!target) return [];
    const styles = window.getComputedStyle(target);

    const rawRG = styles.rowGap || styles.gridRowGap || '0px';
    const rawCG = styles.columnGap || styles.gridColumnGap || '0px';
    const rG = (rawRG === 'normal') ? 0 : (parseFloat(rawRG) || 0);
    const cG = (rawCG === 'normal') ? 0 : (parseFloat(rawCG) || 0);

    const rect = target.getBoundingClientRect();
    const bt = parseFloat(styles.borderTopWidth) || 0;
    const bl = parseFloat(styles.borderLeftWidth) || 0;
    const pt = parseFloat(styles.paddingTop) || 0;
    const pl = parseFloat(styles.paddingLeft) || 0;
    const pb = parseFloat(styles.paddingBottom) || 0;
    const pr = parseFloat(styles.paddingRight) || 0;

    const contentTop = rect.top + bt + pt;
    const contentLeft = rect.left + bl + pl;
    const contentWidth = Math.max(0, rect.width - bl - pr - pl - (parseFloat(styles.borderRightWidth) || 0));
    const contentHeight = Math.max(0, rect.height - bt - pb - pt - (parseFloat(styles.borderBottomWidth) || 0));

    const visibleChildren = Array.from(target.children).filter(child => {
      const cs = window.getComputedStyle(child);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'absolute' && cs.position !== 'fixed';
    });

    const gapSlots = [];

    if (visibleChildren.length >= 2) {
      const childRects = visibleChildren.map(c => c.getBoundingClientRect());

      // Check horizontal (column) gaps between items
      for (let i = 0; i < childRects.length; i++) {
        for (let j = 0; j < childRects.length; j++) {
          if (i === j) continue;
          const a = childRects[i];
          const b = childRects[j];

          // Check if b is to the right of a and overlapping vertically
          const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (vOverlap > 4 && b.left >= a.right - 1) {
            const gapDist = b.left - a.right;
            if (gapDist > 1) {
              const hasBetween = childRects.some((mid, mIdx) => {
                if (mIdx === i || mIdx === j) return false;
                return mid.left >= a.right - 2 && mid.right <= b.left + 2 && (Math.min(a.bottom, mid.bottom) - Math.max(a.top, mid.top) > 4);
              });
              if (!hasBetween) {
                const gTop = Math.min(a.top, b.top);
                const gBottom = Math.max(a.bottom, b.bottom);
                gapSlots.push({
                  type: 'column',
                  left: a.right,
                  top: gTop,
                  width: gapDist,
                  height: Math.max(16, gBottom - gTop),
                  value: `${Math.round(gapDist)}px`
                });
              }
            }
          }

          // Check vertical (row) gaps between items
          const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (hOverlap > 4 && b.top >= a.bottom - 1) {
            const gapDist = b.top - a.bottom;
            if (gapDist > 1) {
              const hasBetween = childRects.some((mid, mIdx) => {
                if (mIdx === i || mIdx === j) return false;
                return mid.top >= a.bottom - 2 && mid.bottom <= b.top + 2 && (Math.min(a.right, mid.right) - Math.max(a.left, mid.left) > 4);
              });
              if (!hasBetween) {
                const gLeft = Math.min(a.left, b.left);
                const gRight = Math.max(a.right, b.right);
                gapSlots.push({
                  type: 'row',
                  left: gLeft,
                  top: a.bottom,
                  width: Math.max(16, gRight - gLeft),
                  height: gapDist,
                  value: `${Math.round(gapDist)}px`
                });
              }
            }
          }
        }
      }
    }

    // Fallback if no direct pair-gaps found but gap property is defined
    if (gapSlots.length === 0 && (rG > 0 || cG > 0)) {
      const valText = (rG > 0 && cG > 0 && rG !== cG) ? `${rG}px / ${cG}px` : `${rG || cG}px`;
      gapSlots.push({
        type: 'generic',
        left: contentLeft,
        top: contentTop,
        width: contentWidth,
        height: contentHeight,
        value: valText
      });
    }

    // Deduplicate slots that are virtually identical
    const uniqueSlots = [];
    gapSlots.forEach(slot => {
      const isDuplicate = uniqueSlots.some(u =>
        Math.abs(u.left - slot.left) < 4 && Math.abs(u.top - slot.top) < 4
      );
      if (!isDuplicate) {
        uniqueSlots.push(slot);
      }
    });

    return uniqueSlots;
  }

  function renderGapHighlights(target) {
    if (!gapHighlightsContainer) return;
    gapHighlightsContainer.innerHTML = '';

    const isGapActive = currentHighlightedRegion === 'gap' || selectedHighlightRegions.has('gap');
    if (!isGapActive || !target) return;

    const gaps = computeGaps(target);
    gaps.forEach(slot => {
      const strip = document.createElement('div');
      strip.className = 'css-inspector-gap-strip';
      strip.style.left = `${slot.left}px`;
      strip.style.top = `${slot.top}px`;
      strip.style.width = `${slot.width}px`;
      strip.style.height = `${slot.height}px`;
      gapHighlightsContainer.appendChild(strip);

      const badge = document.createElement('span');
      badge.className = 'css-inspector-gap-badge';
      badge.textContent = slot.value;
      badge.style.left = `${slot.left + slot.width / 2}px`;
      badge.style.top = `${slot.top + slot.height / 2}px`;
      gapHighlightsContainer.appendChild(badge);
    });
  }

  function getRegionGeometry(target, regionKey) {
    if (!target || !regionKey) return null;

    const rect = target.getBoundingClientRect();
    const styles = window.getComputedStyle(target);
    const parseVal = (val) => parseFloat(val) || 0;

    const mt = parseVal(styles.marginTop);
    const mr = parseVal(styles.marginRight);
    const mb = parseVal(styles.marginBottom);
    const ml = parseVal(styles.marginLeft);

    const pt = parseVal(styles.paddingTop);
    const pr = parseVal(styles.paddingRight);
    const pb = parseVal(styles.paddingBottom);
    const pl = parseVal(styles.paddingLeft);

    const bt = parseVal(styles.borderTopWidth);
    const br = parseVal(styles.borderRightWidth);
    const bb = parseVal(styles.borderBottomWidth);
    const bl = parseVal(styles.borderLeftWidth);

    const top = rect.top;
    const left = rect.left;
    const width = rect.width;
    const height = rect.height;

    let rTop = 0, rLeft = 0, rWidth = 0, rHeight = 0;
    let colorType = '';

    switch (regionKey) {
      // ── Padding ──
      case 'padding-left':
        rTop = top + bt;
        rLeft = left + bl;
        rWidth = pl > 0 ? pl : 2;
        rHeight = Math.max(0, height - bt - bb);
        colorType = 'padding';
        break;
      case 'padding-right':
        rTop = top + bt;
        rLeft = pr > 0 ? (left + width - bl - pr) : (left + width - bl - 2);
        rWidth = pr > 0 ? pr : 2;
        rHeight = Math.max(0, height - bt - bb);
        colorType = 'padding';
        break;
      case 'padding-top':
        rTop = top + bt;
        rLeft = left + bl;
        rWidth = Math.max(0, width - bl - br);
        rHeight = pt > 0 ? pt : 2;
        colorType = 'padding';
        break;
      case 'padding-bottom':
        rTop = pb > 0 ? (top + height - bb - pb) : (top + height - bb - 2);
        rLeft = left + bl;
        rWidth = Math.max(0, width - bl - br);
        rHeight = pb > 0 ? pb : 2;
        colorType = 'padding';
        break;
      case 'padding':
        rTop = top + bt;
        rLeft = left + bl;
        rWidth = Math.max(0, width - bl - br);
        rHeight = Math.max(0, height - bt - bb);
        colorType = 'padding-all';
        break;

      // ── Margin ──
      case 'margin-left':
        rTop = top - mt;
        rLeft = ml > 0 ? (left - ml) : left;
        rWidth = ml > 0 ? ml : 2;
        rHeight = height + mt + mb;
        colorType = 'margin';
        break;
      case 'margin-right':
        rTop = top - mt;
        rLeft = left + width;
        rWidth = mr > 0 ? mr : 2;
        rHeight = height + mt + mb;
        colorType = 'margin';
        break;
      case 'margin-top':
        rTop = mt > 0 ? (top - mt) : top;
        rLeft = left - ml;
        rWidth = width + ml + mr;
        rHeight = mt > 0 ? mt : 2;
        colorType = 'margin';
        break;
      case 'margin-bottom':
        rTop = top + height;
        rLeft = left - ml;
        rWidth = width + ml + mr;
        rHeight = mb > 0 ? mb : 2;
        colorType = 'margin';
        break;
      case 'margin':
        rTop = top - mt;
        rLeft = left - ml;
        rWidth = width + ml + mr;
        rHeight = height + mt + mb;
        colorType = 'margin-all';
        break;

      // ── Border ──
      case 'border-left':
        rTop = top;
        rLeft = left;
        rWidth = bl > 0 ? bl : 2;
        rHeight = height;
        colorType = 'border';
        break;
      case 'border-right':
        rTop = top;
        rLeft = br > 0 ? (left + width - br) : (left + width - 2);
        rWidth = br > 0 ? br : 2;
        rHeight = height;
        colorType = 'border';
        break;
      case 'border-top':
        rTop = top;
        rLeft = left;
        rWidth = width;
        rHeight = bt > 0 ? bt : 2;
        colorType = 'border';
        break;
      case 'border-bottom':
        rTop = bb > 0 ? (top + height - bb) : (top + height - 2);
        rLeft = left;
        rWidth = width;
        rHeight = bb > 0 ? bb : 2;
        colorType = 'border';
        break;
      case 'border':
        rTop = top;
        rLeft = left;
        rWidth = width;
        rHeight = height;
        colorType = 'border-all';
        break;

      // ── Width / Height / Content Dimensions ──
      case 'width':
      case 'height':
        rTop = top;
        rLeft = left;
        rWidth = width;
        rHeight = height;
        colorType = 'content';
        break;
      case 'content':
        rTop = top + bt + pt;
        rLeft = left + bl + pl;
        rWidth = Math.max(0, width - bl - br - pl - pr);
        rHeight = Math.max(0, height - bt - bb - pt - pb);
        colorType = 'content';
        break;
    }

    if (!colorType) return null;
    return { top: rTop, left: rLeft, width: rWidth, height: rHeight, colorType };
  }

  function highlightRegion(target, regionKey) {
    const activeEl = target || (pauseOnPopup && clickedTarget) || clickedTarget || currentTarget;
    currentHighlightedRegion = regionKey;
    if (!activeEl || !regionKey || !overlayHighlight) {
      if (overlayHighlight) overlayHighlight.classList.remove('active');
      renderGapHighlights(activeEl);
      if (selectedHighlightRegions.size > 0) {
        if (activeEl) updateOverlay(activeEl);
        showOverlayLabels(Array.from(selectedHighlightRegions));
      } else {
        hideOverlayLabels();
      }
      return;
    }

    updateOverlay(activeEl);
    renderGapHighlights(activeEl);

    const geo = getRegionGeometry(activeEl, regionKey);
    if (geo) {
      overlayHighlight.style.top = `${geo.top}px`;
      overlayHighlight.style.left = `${geo.left}px`;
      overlayHighlight.style.width = `${geo.width}px`;
      overlayHighlight.style.height = `${geo.height}px`;
      overlayHighlight.className = `active type-${geo.colorType}`;

      const types = Array.from(selectedHighlightRegions);
      types.push(regionKey);
      showOverlayLabels(types);
    } else {
      overlayHighlight.classList.remove('active');
      if (selectedHighlightRegions.size > 0) {
        showOverlayLabels(Array.from(selectedHighlightRegions));
      } else {
        hideOverlayLabels();
      }
    }
  }

  function renderSelectedRegions(target) {
    if (!selectedOverlayContainer) return;
    selectedOverlayContainer.innerHTML = '';

    const activeEl = target || (pauseOnPopup && clickedTarget) || clickedTarget || currentTarget;
    renderGapHighlights(activeEl);

    if (!activeEl || selectedHighlightRegions.size === 0) {
      if (currentHighlightedRegion) {
        showOverlayLabels(currentHighlightedRegion);
      } else {
        hideOverlayLabels();
      }
      return;
    }

    updateOverlay(activeEl);
    renderGapHighlights(activeEl);

    selectedHighlightRegions.forEach(regionKey => {
      const geo = getRegionGeometry(activeEl, regionKey);
      if (geo) {
        const itemEl = document.createElement('div');
        itemEl.className = `css-inspector-selected-item type-${geo.colorType}`;
        itemEl.style.top = `${geo.top}px`;
        itemEl.style.left = `${geo.left}px`;
        itemEl.style.width = `${geo.width}px`;
        itemEl.style.height = `${geo.height}px`;
        selectedOverlayContainer.appendChild(itemEl);
      }
    });

    const types = Array.from(selectedHighlightRegions);
    if (currentHighlightedRegion) {
      types.push(currentHighlightedRegion);
    }
    showOverlayLabels(types);
  }

  // Click logic
  function handleClick(e) {
    if (!isActive) return;

    const target = (e.composedPath && e.composedPath()[0]) || e.target;

    // If clicking inside panel, let it work normally
    if (target.closest && target.closest('#css-inspector-panel')) {
      return;
    }

    // Intercept the click to disable website actions
    if (blockInteractions) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Determine target element to inspect / measure
    let el = target || currentTarget;
    if (!el || el === overlay || el === clickedOverlay || (el.id && el.id.startsWith('css-inspector-'))) {
      const elements = document.elementsFromPoint(e.clientX, e.clientY) || [];
      el = elements.find(item => item !== overlay && item !== clickedOverlay && !(item.id && item.id.startsWith('css-inspector-')) && !item.closest('#css-inspector-panel'));
    }

    if (!el) return;

    // Shift + click: Toggle / Lock measurement between selected element and target element
    if (e.shiftKey) {
      if (clickedTarget && el !== clickedTarget) {
        if (isMeasureLocked && measureTarget === el) {
          clearMeasurement();
          showToast('Measurement unlocked');
        } else {
          measureTarget = el;
          isMeasuring = true;
          isMeasureLocked = true;
          renderMeasurement(clickedTarget, measureTarget);
          showToast('Measurement locked — press Esc to exit');
        }
        return;
      } else if (!clickedTarget) {
        clickedTarget = el;
        inspectElement(el, e);
        updateOverlay(el);
        return;
      }
    }

    // Regular click (no Shift):
    if (isMeasureLocked) {
      clearMeasurement();
    }

    if (el === clickedTarget) return;

    clickedTarget = el;
    isMeasuring = false;
    isMeasureLocked = false;
    measureTarget = null;
    inspectElement(el, e);
    updateOverlay(el);
    setTimeout(() => {
      if (clickedTarget) updateOverlay(clickedTarget);
    }, 50);
  }

  // ── Gap Measurement System ──

  function getReferenceContainer(target) {
    if (!target || !target.parentElement) return null;
    return target.offsetParent || target.parentElement || document.body;
  }

  function toggleMeasurementShortcut() {
    if (!isActive) return;
    isMeasurementEnabled = !isMeasurementEnabled;
    if (!isMeasurementEnabled) {
      clearMeasurement();
      showToast("Distance Measurement: OFF");
    } else {
      isMeasuring = true;
      if (clickedTarget && currentTarget && currentTarget !== clickedTarget) {
        measureTarget = currentTarget;
        renderMeasurement(clickedTarget, measureTarget);
      } else if (currentTarget) {
        const parentContainer = getReferenceContainer(currentTarget);
        if (parentContainer && parentContainer !== currentTarget) {
          renderMeasurement(parentContainer, currentTarget);
        }
      }
      showToast("Distance Measurement: ON");
    }
  }

  let pendingBadges = [];

  function clearMeasurement() {
    isMeasuring = false;
    isMeasureLocked = false;
    measureTarget = null;
    pendingBadges = [];
    if (measureOverlay) measureOverlay.classList.remove('active');
    if (measureOverlayB) measureOverlayB.classList.remove('active');
    if (measureSvg) measureSvg.classList.remove('active');
  }

  function renderMeasurement(elA, elB) {
    if (!elA || !elB || elA === elB) {
      clearMeasurement();
      return;
    }

    pendingBadges = [];

    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();

    // Highlight both elements
    measureOverlay.style.top = `${rectA.top}px`;
    measureOverlay.style.left = `${rectA.left}px`;
    measureOverlay.style.width = `${rectA.width}px`;
    measureOverlay.style.height = `${rectA.height}px`;
    measureOverlay.classList.add('active');

    measureOverlayB.style.top = `${rectB.top}px`;
    measureOverlayB.style.left = `${rectB.left}px`;
    measureOverlayB.style.width = `${rectB.width}px`;
    measureOverlayB.style.height = `${rectB.height}px`;
    measureOverlayB.classList.add('active');

    // Prepare SVG
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    measureSvg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    measureSvg.style.width = `${vw}px`;
    measureSvg.style.height = `${vh}px`;
    measureSvg.classList.add('active');
    measureSvg.innerHTML = '';

    // Check if elements are disjoint or nested/overlapping
    const isDisjointH = rectA.right <= rectB.left || rectB.right <= rectA.left;
    const isDisjointV = rectA.bottom <= rectB.top || rectB.bottom <= rectA.top;

    if (isDisjointH || isDisjointV) {
      // ── Disjoint / Adjacent Elements ──
      // Horizontal gap
      if (rectA.right <= rectB.left) {
        const dist = rectB.left - rectA.right;
        const vOverlap = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
        const y = vOverlap > 0
          ? (Math.max(rectA.top, rectB.top) + Math.min(rectA.bottom, rectB.bottom)) / 2
          : (rectA.top + rectA.bottom) / 2;
        drawMeasureLine(measureSvg, rectA.right, y, rectB.left, y, dist, 'horizontal', 'gap-h');
      } else if (rectB.right <= rectA.left) {
        const dist = rectA.left - rectB.right;
        const vOverlap = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
        const y = vOverlap > 0
          ? (Math.max(rectA.top, rectB.top) + Math.min(rectA.bottom, rectB.bottom)) / 2
          : (rectA.top + rectA.bottom) / 2;
        drawMeasureLine(measureSvg, rectB.right, y, rectA.left, y, dist, 'horizontal', 'gap-h');
      }

      // Vertical gap
      if (rectA.bottom <= rectB.top) {
        const dist = rectB.top - rectA.bottom;
        const hOverlap = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
        const x = hOverlap > 0
          ? (Math.max(rectA.left, rectB.left) + Math.min(rectA.right, rectB.right)) / 2
          : (rectA.left + rectA.right) / 2;
        drawMeasureLine(measureSvg, x, rectA.bottom, x, rectB.top, dist, 'vertical', 'gap-v');
      } else if (rectB.bottom <= rectA.top) {
        const dist = rectA.top - rectB.bottom;
        const hOverlap = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
        const x = hOverlap > 0
          ? (Math.max(rectA.left, rectB.left) + Math.min(rectA.right, rectB.right)) / 2
          : (rectA.left + rectA.right) / 2;
        drawMeasureLine(measureSvg, x, rectB.bottom, x, rectA.top, dist, 'vertical', 'gap-v');
      }
    } else {
      // ── Nested / Overlapping Elements (4-direction edge distances) ──
      const innerCenterX = (rectB.left + rectB.right) / 2;
      const innerCenterY = (rectB.top + rectB.bottom) / 2;

      // 1. Top distance
      const topDist = Math.abs(rectB.top - rectA.top);
      if (Math.round(topDist) > 0) {
        const topY1 = Math.min(rectA.top, rectB.top);
        const topY2 = Math.max(rectA.top, rectB.top);
        drawMeasureLine(measureSvg, innerCenterX, topY1, innerCenterX, topY2, topDist, 'vertical', 'top');
      }

      // 2. Bottom distance
      const bottomDist = Math.abs(rectA.bottom - rectB.bottom);
      if (Math.round(bottomDist) > 0) {
        const botY1 = Math.min(rectA.bottom, rectB.bottom);
        const botY2 = Math.max(rectA.bottom, rectB.bottom);
        drawMeasureLine(measureSvg, innerCenterX, botY1, innerCenterX, botY2, bottomDist, 'vertical', 'bottom');
      }

      // 3. Left distance
      const leftDist = Math.abs(rectB.left - rectA.left);
      if (Math.round(leftDist) > 0) {
        const leftX1 = Math.min(rectA.left, rectB.left);
        const leftX2 = Math.max(rectA.left, rectB.left);
        drawMeasureLine(measureSvg, leftX1, innerCenterY, leftX2, innerCenterY, leftDist, 'horizontal', 'left');
      }

      // 4. Right distance
      const rightDist = Math.abs(rectA.right - rectB.right);
      if (Math.round(rightDist) > 0) {
        const rightX1 = Math.min(rectA.right, rectB.right);
        const rightX2 = Math.max(rectA.right, rectB.right);
        drawMeasureLine(measureSvg, rightX1, innerCenterY, rightX2, innerCenterY, rightDist, 'horizontal', 'right');
      }
    }

    // Hovered item's width & height dimension badge
    const bw = Math.round(rectB.width);
    const bh = Math.round(rectB.height);
    if (bw > 0 && bh > 0) {
      queueDimensionsBadge(rectB, bw, bh);
    }

    // Solve all overlaps across all badges in this frame
    resolveAllBadgeOverlaps(pendingBadges);

    // Draw all non-overlapping badges on SVG
    renderAllBadges(measureSvg, pendingBadges);
  }

  function queueDimensionsBadge(targetRect, width, height) {
    const labelText = `${width} × ${height}px`;
    const paddingX = 8;
    const textWidth = Math.max(24, labelText.length * 7.5);
    const rectWidth = Math.max(50, textWidth + paddingX * 2);
    const rectHeight = 24;

    let initX = targetRect.left + targetRect.width / 2;
    let initY = targetRect.bottom + rectHeight / 2 + 8;

    // If element is big enough, center inside it
    if (targetRect.width >= rectWidth + 12 && targetRect.height >= rectHeight + 12) {
      initX = targetRect.left + targetRect.width / 2;
      initY = targetRect.top + targetRect.height / 2;
    }

    pendingBadges.push({
      text: labelText,
      width: rectWidth,
      height: rectHeight,
      x: initX,
      y: initY,
      zone: 'dim'
    });
  }

  function drawMeasureLine(svg, x1, y1, x2, y2, distance, direction, zone) {
    if (distance <= 0) return;
    const ns = 'http://www.w3.org/2000/svg';
    const color = (zone === 'gap-h' || zone === 'gap-v') ? '#8b5cf6' : '#ff3311';

    // Main measurement line
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('class', 'css-inspector-measure-line');
    line.style.setProperty('stroke', color, 'important');
    line.style.setProperty('stroke-width', '1.5px', 'important');
    svg.appendChild(line);

    // Cap lines (end markers - perpendicular T-caps)
    const capLen = 7;
    if (direction === 'horizontal') {
      drawCapLine(svg, x1, y1 - capLen, x1, y1 + capLen, color);
      drawCapLine(svg, x2, y2 - capLen, x2, y2 + capLen, color);
    } else {
      drawCapLine(svg, x1 - capLen, y1, x1 + capLen, y1, color);
      drawCapLine(svg, x2 - capLen, y2, x2 + capLen, y2, color);
    }

    // Distance label metrics
    const labelText = `${Math.round(distance)}px`;
    const paddingX = 8;
    const textWidth = Math.max(20, labelText.length * 8);
    const rectWidth = Math.max(38, textWidth + paddingX * 2);
    const rectHeight = 26;

    let initX = (x1 + x2) / 2;
    let initY = (y1 + y2) / 2;

    if (zone === 'top') {
      initY = Math.min(y1, y2) + Math.abs(y2 - y1) / 2;
      if (Math.abs(y2 - y1) < rectHeight + 8) {
        initY = Math.min(y1, y2) - rectHeight / 2 - 4;
      }
    } else if (zone === 'bottom') {
      initY = Math.min(y1, y2) + Math.abs(y2 - y1) / 2;
      if (Math.abs(y2 - y1) < rectHeight + 8) {
        initY = Math.max(y1, y2) + rectHeight / 2 + 4;
      }
    } else if (zone === 'left') {
      initX = Math.min(x1, x2) + Math.abs(x2 - x1) / 2;
      if (Math.abs(x2 - x1) < rectWidth + 8) {
        initX = Math.min(x1, x2) - rectWidth / 2 - 4;
      }
    } else if (zone === 'right') {
      initX = Math.min(x1, x2) + Math.abs(x2 - x1) / 2;
      if (Math.abs(x2 - x1) < rectWidth + 8) {
        initX = Math.max(x1, x2) + rectWidth / 2 + 4;
      }
    }

    const badgeColor = (zone === 'gap-h' || zone === 'gap-v') ? '#8b5cf6' : '#ff3311';

    pendingBadges.push({
      text: labelText,
      width: rectWidth,
      height: rectHeight,
      x: initX,
      y: initY,
      zone: zone,
      color: badgeColor
    });
  }

  function queueDimensionsBadge(targetRect, width, height) {
    const labelText = `W: ${width}px × H: ${height}px`;
    const paddingX = 8;
    const textWidth = Math.max(28, labelText.length * 7.5);
    const rectWidth = Math.max(68, textWidth + paddingX * 2);
    const rectHeight = 24;

    let initX = targetRect.left + targetRect.width / 2;
    let initY = targetRect.bottom + rectHeight / 2 + 8;

    // If element is big enough, center inside it
    if (targetRect.width >= rectWidth + 12 && targetRect.height >= rectHeight + 12) {
      initX = targetRect.left + targetRect.width / 2;
      initY = targetRect.top + targetRect.height / 2;
    }

    pendingBadges.push({
      text: labelText,
      widthVal: width,
      heightVal: height,
      isDual: true,
      width: rectWidth,
      height: rectHeight,
      x: initX,
      y: initY,
      zone: 'dim',
      color: '#1e293b' // Dark pill for dual color contrast
    });
  }

  function resolveAllBadgeOverlaps(badges) {
    if (!badges || badges.length <= 1) return;
    const padding = 6;
    const maxIterations = 50;

    for (let iter = 0; iter < maxIterations; iter++) {
      let moved = false;

      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          const b1 = badges[i];
          const b2 = badges[j];

          const w1 = b1.width / 2;
          const h1 = b1.height / 2;
          const w2 = b2.width / 2;
          const h2 = b2.height / 2;

          const dx = b2.x - b1.x;
          const dy = b2.y - b1.y;

          const minDistanceX = w1 + w2 + padding;
          const minDistanceY = h1 + h2 + padding;

          const overlapX = minDistanceX - Math.abs(dx);
          const overlapY = minDistanceY - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            moved = true;

            if (overlapX < overlapY) {
              const shift = (overlapX / 2) + 0.5;
              const sign = dx >= 0 ? 1 : -1;
              b1.x -= shift * sign;
              b2.x += shift * sign;
            } else {
              const shift = (overlapY / 2) + 0.5;
              const sign = dy >= 0 ? 1 : -1;
              b1.y -= shift * sign;
              b2.y += shift * sign;
            }
          }
        }
      }

      if (!moved) break;
    }

    // Keep within screen bounds
    for (const b of badges) {
      const halfW = b.width / 2;
      const halfH = b.height / 2;
      b.x = Math.max(halfW + 8, Math.min(window.innerWidth - halfW - 8, b.x));
      b.y = Math.max(halfH + 8, Math.min(window.innerHeight - halfH - 8, b.y));
    }
  }

  function renderAllBadges(svg, badges) {
    const ns = 'http://www.w3.org/2000/svg';

    for (const b of badges) {
      const rectWidth = b.width;
      const rectHeight = b.height;
      const badgeX = b.x;
      const badgeY = b.y;
      const badgeColor = b.color || '#ff3311';

      const labelBg = document.createElementNS(ns, 'rect');
      labelBg.setAttribute('x', badgeX - rectWidth / 2);
      labelBg.setAttribute('y', badgeY - rectHeight / 2);
      labelBg.setAttribute('width', rectWidth);
      labelBg.setAttribute('height', rectHeight);
      labelBg.setAttribute('rx', 6);
      labelBg.setAttribute('ry', 6);
      labelBg.setAttribute('fill', badgeColor);
      labelBg.setAttribute('class', 'css-inspector-measure-label-bg');
      labelBg.style.setProperty('fill', badgeColor, 'important');
      if (b.isDual) {
        labelBg.setAttribute('stroke', '#3b82f6');
        labelBg.setAttribute('stroke-width', '1');
      }
      svg.appendChild(labelBg);

      if (b.isDual) {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', badgeX);
        text.setAttribute('y', badgeY);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-family', "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
        text.style.setProperty('font-family', "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", 'important');
        text.style.setProperty('font-size', '12px', 'important');
        text.style.setProperty('font-weight', '600', 'important');

        const tspanW = document.createElementNS(ns, 'tspan');
        tspanW.setAttribute('fill', '#93c5fd'); // Width Blue
        tspanW.textContent = `W: ${b.widthVal}px`;
        text.appendChild(tspanW);

        const tspanX = document.createElementNS(ns, 'tspan');
        tspanX.setAttribute('fill', '#ffffff');
        tspanX.setAttribute('opacity', '0.75');
        tspanX.textContent = ' × ';
        text.appendChild(tspanX);

        const tspanH = document.createElementNS(ns, 'tspan');
        tspanH.setAttribute('fill', '#5eead4'); // Height Teal
        tspanH.textContent = `H: ${b.heightVal}px`;
        text.appendChild(tspanH);

        svg.appendChild(text);
      } else {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', badgeX);
        text.setAttribute('y', badgeY);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('class', 'css-inspector-measure-label');
        text.style.setProperty('fill', '#ffffff', 'important');
        text.style.setProperty('font-family', "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", 'important');
        text.style.setProperty('font-size', '12px', 'important');
        text.style.setProperty('font-weight', '600', 'important');
        text.textContent = b.text;
        svg.appendChild(text);
      }
    }
  }

  function drawCapLine(svg, x1, y1, x2, y2, color = '#ff3311') {
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('class', 'css-inspector-measure-cap');
    line.style.setProperty('stroke', color, 'important');
    line.style.setProperty('stroke-width', '1.5px', 'important');
    svg.appendChild(line);
  }

  function rgbToHex(rgbStr) {
    const rgb = rgbStr.match(/\d+/g);
    if (!rgb || rgb.length < 3) return rgbStr;
    const hex = (x) => ("0" + parseInt(x).toString(16)).slice(-2);
    return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`.toUpperCase();
  }

  function getFontWeightName(weight) {
    const map = {
      '100': 'Thin (100)',
      '200': 'Extra Light (200)',
      '300': 'Light (300)',
      '400': 'Regular (400)',
      '500': 'Medium (500)',
      '600': 'Semi Bold (600)',
      '700': 'Bold (700)',
      '800': 'Extra Bold (800)',
      '900': 'Black (900)'
    };
    if (weight === 'normal') return 'Regular (400)';
    if (weight === 'bold') return 'Bold (700)';
    return map[weight] ? map[weight] : weight;
  }

  function findPropertyClass(el, category) {
    if (!el) return '';
    const classList = Array.from(el.classList || []);

    const patterns = {
      display: /^(flex|grid|block|inline-block|inline|hidden|table|contents|inline-flex|inline-grid|d-flex|d-block|d-none|d-inline)$/,
      width: /^(w-|max-w-|min-w-|width-)/,
      height: /^(h-|max-h-|min-h-|height-)/,
      padding: /^(p-|px-|py-|pt-|pb-|pl-|pr-|ps-|pe-|padding-)/,
      margin: /^(m-|mx-|my-|mt-|mb-|ml-|mr-|ms-|me-|margin-)/,
      gap: /^(gap-|gap-x-|gap-y-)/,
      justify: /^justify-(start|end|center|between|around|evenly|normal)/,
      align: /^items-(start|end|center|baseline|stretch)/,
      direction: /^flex-(row|col|row-reverse|col-reverse)/,
      radius: /^(rounded|rounded-)/,
      shadow: /^(shadow|shadow-)/,
      position: /^(static|fixed|absolute|relative|sticky)$/,
      zIndex: /^(z-|z-\[)/,
      opacity: /^opacity-/,
      fontFamily: /^font-(sans|serif|mono|roboto|inter|poppins|heading|body)/,
      fontSize: /^(text-(xs|sm|base|lg|xl|\d+xl)|text-\[\d+)/,
      lineHeight: /^(leading-|leading-\[)/,
      fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\d{3})/,
      letterSpacing: /^tracking-(tighter|tight|normal|wide|wider|widest|\[)/,
      textAlign: /^text-(left|center|right|justify|start|end)/,
      color: /^text-(?!xs|sm|base|lg|xl|\d+xl|left|right|center|justify|start|end|uppercase|lowercase|capitalize|normal-case|italic|non-italic|wrap|nowrap|balance|pretty|ellipsis|clip|break-)/,
      backgroundColor: /^bg-(?!auto|cover|contain|bottom|top|center|left|right|repeat|no-repeat|fixed|local|scroll|clip|origin)/
    };

    const regex = patterns[category];
    if (!regex) return '';

    // 1. Direct class on el
    const matching = [];
    for (const cls of classList) {
      if (regex.test(cls)) {
        if (category === 'fontFamily' && patterns.fontWeight.test(cls)) continue;
        matching.push(`.${cls}`);
      }
    }
    if (matching.length > 0) return matching.join(' ');

    // 2. Check closest ancestor for inherited typography properties
    const inherited = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'color'];
    if (inherited.includes(category)) {
      let curr = el.parentElement;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        if (curr.classList && curr.classList.length > 0) {
          for (const cls of Array.from(curr.classList)) {
            if (regex.test(cls)) {
              if (category === 'fontFamily' && patterns.fontWeight.test(cls)) continue;
              return `.${cls}`;
            }
          }
        }
        curr = curr.parentElement;
      }
    }

    // 3. Scan stylesheets for matched CSS rules
    const cssPropMap = {
      display: 'display',
      width: 'width',
      height: 'height',
      padding: 'padding',
      margin: 'margin',
      gap: 'gap',
      justify: 'justifyContent',
      align: 'alignItems',
      direction: 'flexDirection',
      radius: 'borderRadius',
      shadow: 'boxShadow',
      position: 'position',
      zIndex: 'zIndex',
      opacity: 'opacity',
      fontFamily: 'fontFamily',
      fontSize: 'fontSize',
      lineHeight: 'lineHeight',
      fontWeight: 'fontWeight',
      letterSpacing: 'letterSpacing',
      textAlign: 'textAlign',
      color: 'color',
      backgroundColor: 'backgroundColor'
    };

    const cssProp = cssPropMap[category];
    if (cssProp) {
      try {
        for (let i = document.styleSheets.length - 1; i >= 0; i--) {
          const sheet = document.styleSheets[i];
          let rules;
          try { rules = sheet.cssRules || sheet.rules; } catch (e) { continue; }
          if (!rules) continue;
          for (let j = rules.length - 1; j >= 0; j--) {
            const rule = rules[j];
            if (rule.selectorText && rule.style && rule.style[cssProp]) {
              try {
                if (el.matches(rule.selectorText)) {
                  const classMatch = rule.selectorText.match(/\.[\w-]+/);
                  if (classMatch) return classMatch[0];
                  return rule.selectorText;
                }
              } catch (e) { }
            }
          }
        }
      } catch (e) { }
    }

    return '';
  }

  function getHighlightKeyForLabel(label) {
    if (!label) return null;
    const l = label.toLowerCase().trim();
    if (l === 'padding left') return 'padding-left';
    if (l === 'padding right') return 'padding-right';
    if (l === 'padding top') return 'padding-top';
    if (l === 'padding bottom') return 'padding-bottom';
    if (l === 'padding') return 'padding';
    if (l === 'margin left') return 'margin-left';
    if (l === 'margin right') return 'margin-right';
    if (l === 'margin top') return 'margin-top';
    if (l === 'margin bottom') return 'margin-bottom';
    if (l === 'margin') return 'margin';
    if (l.includes('border left')) return 'border-left';
    if (l.includes('border right')) return 'border-right';
    if (l.includes('border top')) return 'border-top';
    if (l.includes('border bottom')) return 'border-bottom';
    if (l === 'border' || l === 'border width' || l === 'border style') return 'border';
    if (l === 'width') return 'width';
    if (l === 'height') return 'height';
    if (l === 'gap' || l.startsWith('gap')) return 'gap';
    return null;
  }

  function renderInspectorRow(label, value, category = null, el = null) {
    let classHtml = '';
    if (category && el) {
      const cls = findPropertyClass(el, category);
      if (cls) {
        classHtml = `<span class="css-inspector-class-text">${cls}</span>`;
      }
    }

    const highlightKey = getHighlightKeyForLabel(label);
    const highlightAttr = highlightKey ? ` data-highlight="${highlightKey}"` : '';

    return `
    <div class="css-inspector-row"${highlightAttr}>
      <span class="css-inspector-label">${label}</span>
      <div class="css-inspector-value">
        <span class="css-inspector-value-text">${value}</span>
        ${classHtml}
      </div>
    </div>
  `;
  }

  function inspectElement(el, e) {
    currentHighlightedRegion = null;
    selectedHighlightRegions.clear();
    if (overlayHighlight) overlayHighlight.classList.remove('active');
    if (selectedOverlayContainer) selectedOverlayContainer.innerHTML = '';
    if (gapHighlightsContainer) gapHighlightsContainer.innerHTML = '';
    hideOverlayLabels();
    const styles = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const content = document.getElementById('css-inspector-content');

    const colorsToShow = [];
    const addColor = (label, colorValue) => {
      if (!colorValue || colorValue === 'rgba(0, 0, 0, 0)' || colorValue === 'transparent' || colorValue === 'none') return;
      const hex = rgbToHex(colorValue);
      colorsToShow.push({ label, hex });
    };

    let hasText = false;
    const tag = el.tagName.toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag)) {
      hasText = true;
    } else {
      for (let node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
          hasText = true;
          break;
        }
      }
    }

    addColor('Background', styles.backgroundColor);

    const hasBorder = parseFloat(styles.borderTopWidth) > 0 || parseFloat(styles.borderRightWidth) > 0 || parseFloat(styles.borderBottomWidth) > 0 || parseFloat(styles.borderLeftWidth) > 0;
    if (hasBorder) {
      if (styles.borderTopColor === styles.borderRightColor && styles.borderTopColor === styles.borderBottomColor && styles.borderTopColor === styles.borderLeftColor) {
        addColor('Border', styles.borderTopColor);
      } else {
        if (parseFloat(styles.borderTopWidth) > 0) addColor('Border Top', styles.borderTopColor);
        if (parseFloat(styles.borderRightWidth) > 0) addColor('Border Right', styles.borderRightColor);
        if (parseFloat(styles.borderBottomWidth) > 0) addColor('Border Bottom', styles.borderBottomColor);
        if (parseFloat(styles.borderLeftWidth) > 0) addColor('Border Left', styles.borderLeftColor);
      }
    }

    if (tag === 'svg' || tag === 'path' || tag === 'rect' || tag === 'circle') {
      addColor('Fill', styles.fill);
      addColor('Stroke', styles.stroke);
    }

    let colorsSectionHtml = '';
    if (colorsToShow.length > 0) {
      let colorsHtml = colorsToShow.map(c => {
        const isBg = c.label.toLowerCase().includes('background');
        const colorClass = isBg ? findPropertyClass(el, 'backgroundColor') : '';

        return `
        <div class="css-inspector-row">
          <span class="css-inspector-label">${c.label}</span>
          <div class="css-inspector-value">
            <div class="css-inspector-color-wrap">
              <div class="css-inspector-color-box" style="background-color: ${c.hex}"></div>
              <span class="css-inspector-value-text">${c.hex}</span>
            </div>
            ${colorClass ? `<span class="css-inspector-class-text">${colorClass}</span>` : ''}
          </div>
        </div>
      `;
      }).join('');

      colorsSectionHtml = `
      <div class="css-inspector-section">
        <div class="css-inspector-section-title">Colors</div>
        ${colorsHtml}
      </div>
    `;
    }

    const makeSelect = (prop, options, currentValue) => {
      return `
      <select class="css-inspector-select" data-prop="${prop}">
        ${options.map(opt => `<option value="${opt}" ${currentValue === opt ? 'selected' : ''}>${opt}</option>`).join('')}
      </select>
    `;
    };

    let extraPropsHtml = '';
    let extraRows = '';

    if (styles.opacity && styles.opacity !== '1') extraRows += renderInspectorRow('Opacity', styles.opacity, 'opacity', el);
    if (styles.boxShadow && styles.boxShadow !== 'none') extraRows += renderInspectorRow('Shadow', styles.boxShadow, 'shadow', el);

    // Border style & width
    const bsTop = styles.borderTopStyle, bsRight = styles.borderRightStyle, bsBottom = styles.borderBottomStyle, bsLeft = styles.borderLeftStyle;
    const bwTop = styles.borderTopWidth, bwRight = styles.borderRightWidth, bwBottom = styles.borderBottomWidth, bwLeft = styles.borderLeftWidth;
    const hasBorderStyle = (bsTop !== 'none' && parseFloat(bwTop) > 0) || (bsRight !== 'none' && parseFloat(bwRight) > 0) || (bsBottom !== 'none' && parseFloat(bwBottom) > 0) || (bsLeft !== 'none' && parseFloat(bwLeft) > 0);
    if (hasBorderStyle) {
      // Border style
      if (bsTop === bsRight && bsTop === bsBottom && bsTop === bsLeft) {
        extraRows += renderInspectorRow('Border Style', bsTop);
      } else {
        if (bsTop !== 'none' && parseFloat(bwTop) > 0) extraRows += renderInspectorRow('Border Top Style', bsTop);
        if (bsRight !== 'none' && parseFloat(bwRight) > 0) extraRows += renderInspectorRow('Border Right Style', bsRight);
        if (bsBottom !== 'none' && parseFloat(bwBottom) > 0) extraRows += renderInspectorRow('Border Bottom Style', bsBottom);
        if (bsLeft !== 'none' && parseFloat(bwLeft) > 0) extraRows += renderInspectorRow('Border Left Style', bsLeft);
      }
      // Border width
      if (bwTop === bwRight && bwTop === bwBottom && bwTop === bwLeft) {
        extraRows += renderInspectorRow('Border Width', bwTop);
      } else {
        if (parseFloat(bwTop) > 0) extraRows += renderInspectorRow('Border Top Width', bwTop);
        if (parseFloat(bwRight) > 0) extraRows += renderInspectorRow('Border Right Width', bwRight);
        if (parseFloat(bwBottom) > 0) extraRows += renderInspectorRow('Border Bottom Width', bwBottom);
        if (parseFloat(bwLeft) > 0) extraRows += renderInspectorRow('Border Left Width', bwLeft);
      }
    }

    if (styles.position && styles.position !== 'static') {
      extraRows += renderInspectorRow('Position', styles.position, 'position', el);
      if (styles.zIndex && styles.zIndex !== 'auto') extraRows += renderInspectorRow('Z-Index', styles.zIndex, 'zIndex', el);
    }

    if (styles.display === 'flex' || styles.display === 'inline-flex') {
      if (styles.flexDirection && styles.flexDirection !== 'row') extraRows += renderInspectorRow('Direction', styles.flexDirection, 'direction', el);

      const justifyOpts = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'normal'];
      const alignOpts = ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'normal'];

      extraRows += renderInspectorRow('Justify', makeSelect('justifyContent', justifyOpts, styles.justifyContent), 'justify', el);
      extraRows += renderInspectorRow('Align', makeSelect('alignItems', alignOpts, styles.alignItems), 'align', el);
    }

    if (extraRows) {
      extraPropsHtml = `
      <div class="css-inspector-section">
        <div class="css-inspector-section-title">Properties</div>
        ${extraRows}
      </div>
    `;
    }

    let radiusHtml = '';
    const hasRadius = (styles.borderRadius && styles.borderRadius !== '0px' && parseFloat(styles.borderRadius) > 0) ||
      parseFloat(styles.borderTopLeftRadius) > 0 ||
      parseFloat(styles.borderTopRightRadius) > 0 ||
      parseFloat(styles.borderBottomRightRadius) > 0 ||
      parseFloat(styles.borderBottomLeftRadius) > 0;

    if (hasRadius) {
      const rVal = styles.borderRadius || styles.borderTopLeftRadius;
      radiusHtml = renderInspectorRow('Radius', rVal, 'radius', el);
    }

    const rawRowGap = styles.rowGap || styles.gridRowGap || '0px';
    const rawColGap = styles.columnGap || styles.gridColumnGap || '0px';
    const rowGap = (rawRowGap === 'normal') ? '0px' : rawRowGap;
    const columnGap = (rawColGap === 'normal') ? '0px' : rawColGap;
    let gapHtml = '';

    if (rowGap === columnGap && rowGap !== '0px') {
      gapHtml = renderInspectorRow('Gap', rowGap, 'gap', el);
    } else if (rowGap !== '0px' || columnGap !== '0px') {
      gapHtml = renderInspectorRow('Gap (Row/Col)', `${rowGap} / ${columnGap}`, 'gap', el);
    }

    let marginHtml = '';
    const mt = styles.marginTop, mr = styles.marginRight, mb = styles.marginBottom, ml = styles.marginLeft;
    if (mt !== '0px' || mr !== '0px' || mb !== '0px' || ml !== '0px') {
      if (mt === mr && mt === mb && mt === ml) {
        marginHtml = renderInspectorRow('Margin', mt, 'margin', el);
      } else {
        let marginContent = '';
        if (mt !== '0px') marginContent += renderInspectorRow('Margin Top', mt);
        if (mr !== '0px') marginContent += renderInspectorRow('Margin Right', mr);
        if (mb !== '0px') marginContent += renderInspectorRow('Margin Bottom', mb);
        if (ml !== '0px') marginContent += renderInspectorRow('Margin Left', ml);
        const mCls = findPropertyClass(el, 'margin');
        if (mCls) marginContent += `<div class="css-inspector-row"><span class="css-inspector-label">Margin Class</span><div class="css-inspector-value"><span class="css-inspector-class-text">${mCls}</span></div></div>`;
        marginHtml = marginContent;
      }
    }

    let paddingHtml = '';
    const pt = styles.paddingTop, pr = styles.paddingRight, pb = styles.paddingBottom, pl = styles.paddingLeft;
    if (pt !== '0px' || pr !== '0px' || pb !== '0px' || pl !== '0px') {
      if (pt === pr && pt === pb && pt === pl) {
        paddingHtml = renderInspectorRow('Padding', pt, 'padding', el);
      } else {
        let paddingContent = '';
        if (pt !== '0px') paddingContent += renderInspectorRow('Padding Top', pt);
        if (pr !== '0px') paddingContent += renderInspectorRow('Padding Right', pr);
        if (pb !== '0px') paddingContent += renderInspectorRow('Padding Bottom', pb);
        if (pl !== '0px') paddingContent += renderInspectorRow('Padding Left', pl);
        const pCls = findPropertyClass(el, 'padding');
        if (pCls) paddingContent += `<div class="css-inspector-row"><span class="css-inspector-label">Padding Class</span><div class="css-inspector-value"><span class="css-inspector-class-text">${pCls}</span></div></div>`;
        paddingHtml = paddingContent;
      }
    }

    let typographyHtml = '';
    if (hasText) {
      const textColorHex = rgbToHex(styles.color);
      const textColorClass = findPropertyClass(el, 'color');

      const textColorHtml = (styles.color && styles.color !== 'rgba(0, 0, 0, 0)' && styles.color !== 'transparent') ? `
      <div class="css-inspector-row">
        <span class="css-inspector-label">Text color</span>
        <div class="css-inspector-value">
          <div class="css-inspector-color-wrap">
            <div class="css-inspector-color-box" style="background-color: ${textColorHex}"></div>
            <span class="css-inspector-value-text">${textColorHex}</span>
          </div>
          ${textColorClass ? `<span class="css-inspector-class-text">${textColorClass}</span>` : ''}
        </div>
      </div>
    ` : '';

      typographyHtml = `
    <div class="css-inspector-section">
      <div class="css-inspector-section-title">Text properties</div>
      ${renderInspectorRow('Font Family', styles.fontFamily.replace(/['"]/g, ''), 'fontFamily', el)}
      ${renderInspectorRow('Font Size', styles.fontSize, 'fontSize', el)}
      ${renderInspectorRow('Line Height', styles.lineHeight, 'lineHeight', el)}
      ${renderInspectorRow('Font Weight', getFontWeightName(styles.fontWeight), 'fontWeight', el)}
      ${renderInspectorRow('Letter Spacing', styles.letterSpacing === 'normal' ? 'normal' : styles.letterSpacing, 'letterSpacing', el)}
      ${textColorHtml}
      ${renderInspectorRow('Align', makeSelect('textAlign', ['start', 'end', 'left', 'right', 'center', 'justify'], styles.textAlign), 'textAlign', el)}
    </div>`;
    }

    const formatBoxVal = (val) => {
      if (!val || val === '0px' || val === 'none') return '-';
      if (val === 'auto') return 'auto';
      const num = parseFloat(val);
      if (!isNaN(num)) {
        if (num === 0) return '-';
        return Number.isInteger(num) ? num.toString() : num.toFixed(1).replace(/\.0$/, '');
      }
      return val;
    };

    content.innerHTML = `
    <div class="css-inspector-section">
      <div class="css-inspector-section-title">Layout & Dimensions</div>
      ${renderInspectorRow('Tag', tag)}
      ${renderInspectorRow('Display', styles.display, 'display', el)}
      ${renderInspectorRow('Width', `${Math.round(rect.width)}px`, 'width', el)}
      ${renderInspectorRow('Height', `${Math.round(rect.height)}px`, 'height', el)}
      ${radiusHtml}
      ${paddingHtml}
      ${marginHtml}
      ${gapHtml}
    </div>

    ${typographyHtml}
    ${extraPropsHtml}
    ${colorsSectionHtml}

    <div class="css-inspector-section">
      <div class="css-inspector-section-title">Box Model</div>
      <div class="css-inspector-box-model">
        <div class="css-inspector-box css-inspector-box-margin" data-box="margin">
          <span class="css-inspector-box-label">margin</span>
          <span class="css-inspector-box-val css-inspector-box-top" data-side="margin-top">${formatBoxVal(styles.marginTop)}</span>
          <span class="css-inspector-box-val css-inspector-box-bottom" data-side="margin-bottom">${formatBoxVal(styles.marginBottom)}</span>
          <span class="css-inspector-box-val css-inspector-box-left" data-side="margin-left">${formatBoxVal(styles.marginLeft)}</span>
          <span class="css-inspector-box-val css-inspector-box-right" data-side="margin-right">${formatBoxVal(styles.marginRight)}</span>

          <div class="css-inspector-box css-inspector-box-border" data-box="border">
            <span class="css-inspector-box-label">border</span>
            <span class="css-inspector-box-val css-inspector-box-top" data-side="border-top">${formatBoxVal(styles.borderTopWidth)}</span>
            <span class="css-inspector-box-val css-inspector-box-bottom" data-side="border-bottom">${formatBoxVal(styles.borderBottomWidth)}</span>
            <span class="css-inspector-box-val css-inspector-box-left" data-side="border-left">${formatBoxVal(styles.borderLeftWidth)}</span>
            <span class="css-inspector-box-val css-inspector-box-right" data-side="border-right">${formatBoxVal(styles.borderRightWidth)}</span>

            <div class="css-inspector-box css-inspector-box-padding" data-box="padding">
              <span class="css-inspector-box-label">padding</span>
              <span class="css-inspector-box-val css-inspector-box-top" data-side="padding-top">${formatBoxVal(styles.paddingTop)}</span>
              <span class="css-inspector-box-val css-inspector-box-bottom" data-side="padding-bottom">${formatBoxVal(styles.paddingBottom)}</span>
              <span class="css-inspector-box-val css-inspector-box-left" data-side="padding-left">${formatBoxVal(styles.paddingLeft)}</span>
              <span class="css-inspector-box-val css-inspector-box-right" data-side="padding-right">${formatBoxVal(styles.paddingRight)}</span>

              <div class="css-inspector-box css-inspector-box-content" data-box="content" data-side="content">
                <span class="css-inspector-box-dims" data-side="content"><span style="color:#60a5fa;font-weight:600;">W: ${Math.round(rect.width)}</span> × <span style="color:#2dd4bf;font-weight:600;">H: ${Math.round(rect.height)}</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

    // Attach collapsible section listeners
    const sectionTitles = content.querySelectorAll('.css-inspector-section-title');
    sectionTitles.forEach(title => {
      const titleText = title.textContent.trim();
      const section = title.closest('.css-inspector-section');

      // Restore collapsed state
      if (collapsedSections.has(titleText) && section) {
        section.classList.add('collapsed');
      }

      title.addEventListener('click', (e) => {
        if (section) {
          section.classList.toggle('collapsed');
          if (section.classList.contains('collapsed')) {
            collapsedSections.add(titleText);
          } else {
            collapsedSections.delete(titleText);
          }
        }
      });
    });

    // Attach change listeners for selects
    const selects = content.querySelectorAll('.css-inspector-select');
    selects.forEach(select => {
      select.addEventListener('change', (e) => {
        const prop = e.target.getAttribute('data-prop');
        const val = e.target.value;
        if (clickedTarget) {
          clickedTarget.style[prop] = val;

          // Update overlay immediately
          setTimeout(() => {
            const newRect = clickedTarget.getBoundingClientRect();
            clickedOverlay.style.width = newRect.width + 'px';
            clickedOverlay.style.height = newRect.height + 'px';
            clickedOverlay.style.top = newRect.top + 'px';
            clickedOverlay.style.left = newRect.left + 'px';

            if (pauseOnPopup && clickedTarget) {
              updateOverlay(clickedTarget);
            } else if (currentTarget) {
              updateOverlay(currentTarget);
            }
          }, 10);
        }
      });
    });

    // Update clicked overlay (selection indicator) position
    clickedOverlay.style.top = `${rect.top}px`;
    clickedOverlay.style.left = `${rect.left}px`;
    clickedOverlay.style.width = `${rect.width}px`;
    clickedOverlay.style.height = `${rect.height}px`;
    clickedOverlay.classList.add('active');

    // Show box model overlay (margin/padding/content) on the selected element
    updateOverlay(el);

    panel.classList.add('active');
    try {
      chrome.runtime.sendMessage({ action: 'panelOpened', instanceId: myInstanceId });
    } catch (err) { }

    // Position panel based on click
    if (e) {
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;

      let top = e.clientY + 15;
      let left = e.clientX + 15;

      // Check if it goes off bottom
      if (top + panelHeight > window.innerHeight) {
        top = e.clientY - panelHeight - 15;
      }

      // Check if it goes off right
      if (left + panelWidth > window.innerWidth) {
        left = e.clientX - panelWidth - 15;
      }

      // Final boundary checks just in case
      top = Math.max(10, top);
      left = Math.max(10, left);

      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
    }
  }

  // Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getState") {
      sendResponse({ isActive });
    } else if (request.action === 'hideOtherPanels') {
      if (request.instanceId !== myInstanceId) {
        if (panel) panel.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        if (clickedOverlay) clickedOverlay.classList.remove('active');
        clickedTarget = null;
        isFrameHovered = false;
      }
    } else if (request.action === 'hideOtherOverlays') {
      if (request.instanceId !== myInstanceId) {
        isFrameHovered = false;
        if (!clickedTarget && overlay) {
          overlay.classList.remove('active');
          currentTarget = null;
        }
      }
    } else if (request.action === "toggleInspector") {
      init(); // Ensure injected
      const newState = request.isActive !== undefined ? request.isActive : !isActive;
      toggleInspector(newState);
      sendResponse({ success: true, isActive: newState });
    } else if (request.action === 'toggleMeasurementShortcut') {
      toggleMeasurementShortcut();
    }
  });

  // Auto-init for message listener availability
  init();
}
