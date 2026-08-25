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

  // Gap measurement state
  let measureTarget = null;
  let measureOverlay = null;
  let measureOverlayB = null;
  let measureSvg = null;
  let isMeasuring = false;

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
      toggleBlockInteractions: { ctrlKey: false, shiftKey: false, altKey: true, key: 'B' }
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

      // ── Built-in keyboard shortcuts (only when inspector is active) ──
      if (!isActive) return;

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
  }

  // Toggle Inspector
  function toggleInspector(state) {
    isActive = state;
    if (!isActive) {
      overlay.classList.remove('active');
      if (overlayHighlight) overlayHighlight.classList.remove('active');
      if (selectedOverlayContainer) selectedOverlayContainer.innerHTML = '';
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
    if (isMeasuring && clickedTarget && measureTarget) {
      renderMeasurement(clickedTarget, measureTarget);
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

    // If paused on a selected element, keep box model overlay locked on it
    if (pauseOnPopup && clickedTarget) {
      updateOverlay(clickedTarget);
      return;
    }

    if (target === currentTarget && !forceUpdateOverlay) return;
    forceUpdateOverlay = false;
    currentTarget = target;

    updateOverlay(target);
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
          lbl.textContent = `${Math.round(rect.width)}px`;
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'height':
          lbl.textContent = `${Math.round(rect.height)}px`;
          lbl.style.top = `${top + rect.height / 2}px`;
          lbl.style.left = `${left + rect.width / 2}px`;
          break;
        case 'content-dims':
          lbl.textContent = `${Math.round(contentW)} × ${Math.round(contentH)}`;
          lbl.style.top = `${contentCenterY}px`;
          lbl.style.left = `${contentCenterX}px`;
          break;
      }
    });

    overlay.classList.add('active');
    if (selectedHighlightRegions.size > 0) {
      showOverlayLabels(Array.from(selectedHighlightRegions));
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
  }

  function hideOverlayLabels() {
    const labels = overlay.querySelectorAll('.css-inspector-olabel');
    labels.forEach(lbl => lbl.classList.remove('visible'));
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
      if (selectedHighlightRegions.size > 0) {
        if (activeEl) updateOverlay(activeEl);
        showOverlayLabels(Array.from(selectedHighlightRegions));
      } else {
        hideOverlayLabels();
      }
      return;
    }

    updateOverlay(activeEl);

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

    if (!activeEl || selectedHighlightRegions.size === 0) {
      if (currentHighlightedRegion) {
        showOverlayLabels(currentHighlightedRegion);
      } else {
        hideOverlayLabels();
      }
      return;
    }

    updateOverlay(activeEl);

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

    // Shift+click: measure gap between selected element and this one
    if (e.shiftKey && clickedTarget) {
      const elToMeasure = target || currentTarget;
      if (elToMeasure && elToMeasure !== overlay && elToMeasure !== clickedOverlay
        && !(elToMeasure.id && elToMeasure.id.startsWith('css-inspector-'))
        && elToMeasure !== clickedTarget) {
        e.preventDefault();
        e.stopPropagation();
        measureTarget = elToMeasure;
        isMeasuring = true;
        renderMeasurement(clickedTarget, measureTarget);
        showToast('Measuring gap — press Esc to exit');
        return;
      }
    }

    // Regular click clears measurement if active
    if (isMeasuring) {
      clearMeasurement();
    }

    // If popup is showing and pauseOnPopup is true, the inspector is paused
    if (pauseOnPopup && clickedTarget) {
      return;
    }

    const elToInspect = target || currentTarget;
    if (elToInspect && elToInspect !== overlay && elToInspect !== clickedOverlay && !(elToInspect.id && elToInspect.id.startsWith('css-inspector-'))) {
      clickedTarget = elToInspect;
      inspectElement(elToInspect, e);
      // Ensure box model overlay stays visible on selected element
      updateOverlay(elToInspect);
      setTimeout(() => {
        if (clickedTarget) updateOverlay(clickedTarget);
      }, 50);
    }
  }

  // ── Gap Measurement System ──

  function clearMeasurement() {
    isMeasuring = false;
    measureTarget = null;
    if (measureOverlay) measureOverlay.classList.remove('active');
    if (measureOverlayB) measureOverlayB.classList.remove('active');
    if (measureSvg) measureSvg.classList.remove('active');
  }

  function renderMeasurement(elA, elB) {
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

    // Calculate gaps
    // Horizontal gap: distance between nearest horizontal edges
    // Vertical gap: distance between nearest vertical edges
    const hGap = calcEdgeGap(rectA.left, rectA.right, rectB.left, rectB.right);
    const vGap = calcEdgeGap(rectA.top, rectA.bottom, rectB.top, rectB.bottom);

    // Prepare SVG
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    measureSvg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    measureSvg.style.width = `${vw}px`;
    measureSvg.style.height = `${vh}px`;
    measureSvg.classList.add('active');
    measureSvg.innerHTML = '';

    const midAx = rectA.left + rectA.width / 2;
    const midAy = rectA.top + rectA.height / 2;
    const midBx = rectB.left + rectB.width / 2;
    const midBy = rectB.top + rectB.height / 2;

    // Draw horizontal measurement line if there's a gap
    if (hGap.distance > 0) {
      const y = Math.max(Math.min(midAy, midBy), Math.max(rectA.top, rectB.top));
      const clampedY = Math.min(y, Math.min(rectA.bottom, rectB.bottom));
      const finalY = (y + clampedY) / 2 || Math.min(midAy, midBy);
      drawMeasureLine(measureSvg, hGap.startEdge, finalY, hGap.endEdge, finalY, Math.round(hGap.distance), 'horizontal');
    }

    // Draw vertical measurement line if there's a gap
    if (vGap.distance > 0) {
      const x = Math.max(Math.min(midAx, midBx), Math.max(rectA.left, rectB.left));
      const clampedX = Math.min(x, Math.min(rectA.right, rectB.right));
      const finalX = (x + clampedX) / 2 || Math.min(midAx, midBx);
      drawMeasureLine(measureSvg, finalX, vGap.startEdge, finalX, vGap.endEdge, Math.round(vGap.distance), 'vertical');
    }

    // If elements overlap in both axes, show overlap info
    if (hGap.distance <= 0 && vGap.distance <= 0) {
      const overlapLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      overlapLabel.setAttribute('x', (midAx + midBx) / 2);
      overlapLabel.setAttribute('y', (midAy + midBy) / 2);
      overlapLabel.setAttribute('text-anchor', 'middle');
      overlapLabel.setAttribute('dominant-baseline', 'middle');
      overlapLabel.setAttribute('class', 'css-inspector-measure-text-overlap');
      overlapLabel.textContent = 'Overlapping';
      measureSvg.appendChild(overlapLabel);
    }
  }

  function calcEdgeGap(aStart, aEnd, bStart, bEnd) {
    // Returns the gap between two ranges and which edges form that gap
    if (aEnd <= bStart) {
      // A is entirely before B
      return { distance: bStart - aEnd, startEdge: aEnd, endEdge: bStart };
    } else if (bEnd <= aStart) {
      // B is entirely before A
      return { distance: aStart - bEnd, startEdge: bEnd, endEdge: aStart };
    } else {
      // They overlap
      return { distance: 0, startEdge: 0, endEdge: 0 };
    }
  }

  function drawMeasureLine(svg, x1, y1, x2, y2, distance, direction) {
    const ns = 'http://www.w3.org/2000/svg';

    // Main measurement line
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'css-inspector-measure-line');
    svg.appendChild(line);

    // Cap lines (end markers)
    const capLen = 8;
    if (direction === 'horizontal') {
      // Vertical caps at both ends
      drawCapLine(svg, x1, y1 - capLen, x1, y1 + capLen);
      drawCapLine(svg, x2, y2 - capLen, x2, y2 + capLen);
    } else {
      // Horizontal caps at both ends
      drawCapLine(svg, x1 - capLen, y1, x1 + capLen, y1);
      drawCapLine(svg, x2 - capLen, y2, x2 + capLen, y2);
    }

    // Distance label
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Background rect for label
    const labelText = `${distance}px`;
    const padding = 4;
    const fontSize = 11;
    const textWidth = labelText.length * 7;
    const rectWidth = textWidth + padding * 2;
    const rectHeight = fontSize + padding * 2;

    const labelBg = document.createElementNS(ns, 'rect');
    labelBg.setAttribute('x', midX - rectWidth / 2);
    labelBg.setAttribute('y', midY - rectHeight / 2);
    labelBg.setAttribute('width', rectWidth);
    labelBg.setAttribute('height', rectHeight);
    labelBg.setAttribute('rx', '4');
    labelBg.setAttribute('class', 'css-inspector-measure-label-bg');
    svg.appendChild(labelBg);

    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', midX);
    text.setAttribute('y', midY);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('class', 'css-inspector-measure-label');
    text.textContent = labelText;
    svg.appendChild(text);
  }

  function drawCapLine(svg, x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'css-inspector-measure-cap');
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
                <span class="css-inspector-box-dims" data-side="content">${Math.round(rect.width)} × ${Math.round(rect.height)}</span>
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
    }
  });

  // Auto-init for message listener availability
  init();
}
