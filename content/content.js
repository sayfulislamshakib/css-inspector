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
  let leaderSvg = null;

  // Gap measurement state
  let measureTarget = null;
  let measureOverlay = null;
  let measureOverlayB = null;
  let measureSvg = null;
  let isMeasuring = false;
  let isMeasureLocked = false;
  let isMeasurementEnabled = false;
  let pendingBadges = [];

  let lastMouseX = 0;
  let lastMouseY = 0;
  let currentAnimTarget = null;
  let lastMouseDownTarget = null;
  let lastMouseDownTime = 0;

  function isOurUI(el) {
    if (!el) return true;
    if (el === overlay || el === clickedOverlay || el === leaderSvg) return true;
    if (el.id && el.id.startsWith('css-inspector-')) return true;
    if (el.className && typeof el.className === 'string' && el.className.includes('css-inspector-')) return true;
    if (el.closest && (el.closest('#css-inspector-panel') || el.closest('#css-inspector-overlay-container') || el.closest('#css-inspector-toast') || el.closest('#css-inspector-leader-svg'))) return true;
    return false;
  }

  function formatDimension(val) {
    if (val === null || val === undefined) return '0';
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return String(val);
    if (num === 0) return '0';
    // Browser DevTools standard: round to 2 decimal places with EPSILON guard, omitting trailing zeroes
    const rounded = Math.round((num + Number.EPSILON) * 100) / 100;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2).replace(/\.?0+$/, '');
  }

  function formatPx(val) {
    if (val === null || val === undefined) return '0px';
    if (typeof val === 'string') {
      if (val === 'normal' || val === 'none' || val === 'auto') return val;
      if (val.endsWith('px')) {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          return `${formatDimension(num)}px`;
        }
        return val;
      }
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      return `${formatDimension(num)}px`;
    }
    return `${val}px`;
  }

  function getDeepestElementAt(x, y, initialTarget) {
    // 1. Gather all elements intersecting the coordinate (x, y)
    const rawElements = (document.elementsFromPoint(x, y) || []).filter(el => !isOurUI(el));

    if (rawElements.length === 0) {
      if (initialTarget && !isOurUI(initialTarget)) return initialTarget;
      return null;
    }

    // 2. Collect all candidates (including Shadow DOM & deeper children even with pointer-events: none)
    const candidates = new Set(rawElements);

    for (const el of rawElements) {
      // Explore shadow root
      if (el.shadowRoot && el.shadowRoot.elementFromPoint) {
        try {
          const shadowEl = el.shadowRoot.elementFromPoint(x, y);
          if (shadowEl && !isOurUI(shadowEl)) {
            candidates.add(shadowEl);
          }
        } catch (e) { }
      }

      // Explore direct children and nested descendants
      if (el.children && el.children.length > 0) {
        const stack = Array.from(el.children);
        let count = 0;
        while (stack.length > 0 && count < 60) {
          count++;
          const child = stack.pop();
          if (isOurUI(child)) continue;

          const r = child.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            candidates.add(child);
            if (child.children && child.children.length > 0) {
              stack.push(...Array.from(child.children));
            }
          }
        }
      }
    }

    // 3. Find the most specific element (smallest bounding box area & greatest DOM depth)
    let bestEl = null;
    let minArea = Infinity;
    let maxDepth = -1;

    function getDepth(el) {
      let d = 0;
      let p = el.parentElement;
      while (p) {
        d++;
        p = p.parentElement;
      }
      return d;
    }

    for (const el of candidates) {
      if (el === document.body || el === document.documentElement) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;

      const style = window.getComputedStyle(el);
      const isAnimated = style.animationName && style.animationName !== 'none';
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.opacity === '0' && !isAnimated) continue;

      const area = r.width * r.height;
      const depth = getDepth(el);

      if (bestEl === null) {
        bestEl = el;
        minArea = area;
        maxDepth = depth;
      } else {
        // If area is noticeably smaller, it's the more specific nested element
        if (area < minArea * 0.95) {
          bestEl = el;
          minArea = area;
          maxDepth = depth;
        } else if (Math.abs(area - minArea) <= minArea * 0.05) {
          // If area is nearly the same, pick the deeper descendant in the DOM tree
          if (depth > maxDepth) {
            bestEl = el;
            minArea = area;
            maxDepth = depth;
          }
        }
      }
    }

    return bestEl || rawElements[0] || initialTarget;
  }

  function getElementUnderCursor() {
    if (lastMouseX || lastMouseY) {
      return getDeepestElementAt(lastMouseX, lastMouseY, null);
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
    const defaultShortcuts = {
      toggleInspector: { ctrlKey: true, shiftKey: true, altKey: false, key: 'E' },
      togglePause: { ctrlKey: false, shiftKey: false, altKey: true, key: 'P' },
      toggleBlockInteractions: { ctrlKey: false, shiftKey: false, altKey: true, key: 'B' },
      toggleMeasurement: { ctrlKey: false, shiftKey: false, altKey: true, key: 'M' }
    };
    let customShortcuts = Object.assign({}, defaultShortcuts);

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
            customShortcuts = Object.assign({}, defaultShortcuts, changes.customShortcuts.newValue || {});
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

    // Create leader line pin SVG
    leaderSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    leaderSvg.id = 'css-inspector-leader-svg';
    overlay.appendChild(leaderSvg);

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
      closePanel();
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

      // 0. If clicked animation play/pause toggle button
      const animBtn = e.target.closest('.css-inspector-anim-btn');
      if (animBtn) {
        e.preventDefault();
        e.stopPropagation();
        const animTarget = currentAnimTarget || clickedTarget;
        if (animTarget) {
          const currentPlayState = window.getComputedStyle(animTarget).animationPlayState;
          const willPause = currentPlayState !== 'paused';
          animTarget.style.animationPlayState = willPause ? 'paused' : 'running';
          animBtn.textContent = willPause ? '▶ Resume' : '⏸ Pause';
          animBtn.classList.toggle('paused', willPause);
          const playStateText = animBtn.parentElement ? animBtn.parentElement.querySelector('.css-inspector-value-text') : null;
          if (playStateText) {
            playStateText.textContent = willPause ? 'paused' : 'running';
            playStateText.style.color = willPause ? '#f59e0b' : '#10b981';
          }
          showToast(`Animation ${willPause ? 'paused' : 'resumed'}`);
        }
        return;
      }

      // 0.1 If clicked inspect animated container button
      const inspectParentBtn = e.target.closest('[data-action="inspect-anim-parent"]');
      if (inspectParentBtn && currentAnimTarget) {
        e.preventDefault();
        e.stopPropagation();
        inspectElement(currentAnimTarget, null);
        updateOverlay(currentAnimTarget);
        return;
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

      // 2. If clicked color opacity badge
      const opacityBadge = e.target.closest('.css-inspector-color-opacity');
      if (opacityBadge) {
        const text = opacityBadge.textContent.trim();
        if (text) {
          navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`));
          return;
        }
      }

      // 3. If clicked color box or color wrap
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

    // Intercept other actions and record mouse down target for fast moving/animating items
    const intercept = (e) => {
      if (!isActive) return;
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      if (target && target.closest && target.closest('#css-inspector-panel')) return;

      if (e.type === 'mousedown' || e.type === 'pointerdown') {
        if (!isOurUI(target)) {
          lastMouseDownTarget = target;
          lastMouseDownTime = Date.now();
        }
      }

      if (blockInteractions) {
        e.preventDefault();
        e.stopPropagation();
      }
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
        requestGlobalToggle(!isActive);
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
          closePanel();
        } else {
          // No popup open — turn off the inspector entirely (in all frames)
          requestGlobalToggle(false);
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

  // Close the info panel and clear every selection/highlight artifact
  function closePanel() {
    if (panel) panel.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    if (clickedOverlay) clickedOverlay.classList.remove('active');
    if (overlayHighlight) overlayHighlight.classList.remove('active');
    if (selectedOverlayContainer) selectedOverlayContainer.innerHTML = '';
    if (gapHighlightsContainer) gapHighlightsContainer.innerHTML = '';
    if (overlayGaps) overlayGaps.classList.remove('active');
    if (leaderSvg) leaderSvg.innerHTML = '';
    clickedTarget = null;
    currentAnimTarget = null;
    currentHighlightedRegion = null;
    selectedHighlightRegions.clear();
    if (overlay) hideOverlayLabels();
    const contentEl = document.getElementById('css-inspector-content');
    if (contentEl) {
      contentEl.querySelectorAll('.css-inspector-region-selected').forEach(el => {
        el.classList.remove('css-inspector-region-selected');
      });
    }
    clearMeasurement();
    stopOverlayAnimationTracking();
    // Ensure the hover overlay is redrawn on the next mouse move, even over the same element
    forceUpdateOverlay = true;
  }

  // Ask the background to apply a state to every frame in the tab (keeps frames + badge in sync).
  // Falls back to a local toggle if the extension context is unavailable.
  function requestGlobalToggle(state) {
    try {
      chrome.runtime.sendMessage({ action: 'requestToggle', isActive: state }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          toggleInspector(state);
        }
      });
    } catch (err) {
      toggleInspector(state);
    }
  }

  // Toggle Inspector
  function toggleInspector(state) {
    if (state === isActive) return;
    isActive = state;
    if (!isActive) {
      isMeasurementEnabled = false;
      closePanel();
      currentTarget = null;
      isFrameHovered = false;
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

    const rawTarget = (e.composedPath && e.composedPath()[0]) || e.target;
    if (isOurUI(rawTarget)) return;

    const target = getDeepestElementAt(e.clientX, e.clientY, rawTarget);
    if (!target || isOurUI(target)) return;

    if (!isFrameHovered) {
      isFrameHovered = true;
      try {
        chrome.runtime.sendMessage({ action: 'frameHovered', instanceId: myInstanceId });
      } catch (err) { }
    }

    // If an element is clicked/selected:
    if (clickedTarget) {
      // When "Pause on Popup" is ON the box-model overlay stays on the selected element;
      // when OFF it keeps following the cursor.
      const refreshOverlay = () => {
        if (pauseOnPopup) {
          updateOverlay(clickedTarget);
        } else {
          currentTarget = target;
          updateOverlay(target);
        }
      };

      if (isMeasureLocked) {
        if (measureTarget) {
          renderMeasurement(clickedTarget, measureTarget);
        }
        refreshOverlay();
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

      refreshOverlay();
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
    let contentW = Math.max(0, rect.width - bl - br - pl - pr);
    let contentH = Math.max(0, rect.height - bt - bb - pt - pb);
    if (styles.boxSizing === 'content-box' && styles.width && styles.width !== 'auto' && styles.width.endsWith('px')) {
      contentW = parseFloat(styles.width);
    }
    if (styles.boxSizing === 'content-box' && styles.height && styles.height !== 'auto' && styles.height.endsWith('px')) {
      contentH = parseFloat(styles.height);
    }
    const contentCenterX = left + bl + pl + contentW / 2;
    const contentCenterY = top + bt + pt + contentH / 2;

    // Anchor & initial placement logic for pin leader line system
    const isThinElement = rect.height < 60;
    const isNarrowElement = rect.width < 120;
    const isWidthActive = selectedHighlightRegions.has('width') || currentHighlightedRegion === 'width';
    const isPaddingTopActive = (selectedHighlightRegions.has('padding') || selectedHighlightRegions.has('padding-all') || selectedHighlightRegions.has('padding-top') || currentHighlightedRegion === 'padding' || currentHighlightedRegion === 'padding-all' || currentHighlightedRegion === 'padding-top') && pt > 0;
    const isPaddingBottomActive = (selectedHighlightRegions.has('padding') || selectedHighlightRegions.has('padding-all') || selectedHighlightRegions.has('padding-bottom') || currentHighlightedRegion === 'padding' || currentHighlightedRegion === 'padding-all' || currentHighlightedRegion === 'padding-bottom') && pb > 0;

    // Cache target geometry for smart single/dual line positioning
    overlay._inspectorContext = {
      contentCenterX,
      contentCenterY,
      top,
      left,
      width: rect.width,
      height: rect.height,
      pt, pb, pl, pr,
      bt, bb, bl, br,
      mt, mb, ml, mr
    };

    labels.forEach(lbl => {
      const pos = lbl.dataset.pos;
      switch (pos) {
        // Margin labels
        case 'margin-top': {
          lbl.textContent = mt > 0 ? `${formatDimension(mt)}px` : '0px';
          const anchorX = contentCenterX;
          const anchorY = top;
          const mTop = (top >= 36) ? (top - 28) : (top + rect.height + 28);
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${mTop}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#f97316';
          break;
        }
        case 'margin-bottom': {
          lbl.textContent = mb > 0 ? `${formatDimension(mb)}px` : '0px';
          const anchorX = contentCenterX;
          const anchorY = top + rect.height;
          const mBottom = top + rect.height + 28;
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${mBottom}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#f97316';
          break;
        }
        case 'margin-left': {
          lbl.textContent = ml > 0 ? `${formatDimension(ml)}px` : '0px';
          const anchorX = left;
          const anchorY = contentCenterY;
          const mLeft = (left >= 60) ? (left - 50) : (left + rect.width + 50);
          lbl.style.left = `${mLeft}px`;
          lbl.style.top = `${contentCenterY}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#f97316';
          break;
        }
        case 'margin-right': {
          lbl.textContent = mr > 0 ? `${formatDimension(mr)}px` : '0px';
          const anchorX = left + rect.width;
          const anchorY = contentCenterY;
          const mRight = left + rect.width + 50;
          lbl.style.left = `${mRight}px`;
          lbl.style.top = `${contentCenterY}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#f97316';
          break;
        }

        // Border labels
        case 'border-top': {
          lbl.textContent = bt > 0 ? `${formatDimension(bt)}px` : '0px';
          const anchorX = contentCenterX;
          const anchorY = top + (bt > 0 ? bt / 2 : 0);
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${(top >= 36) ? (top - 28) : (top + rect.height + 28)}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#ca8a04';
          break;
        }
        case 'border-bottom': {
          lbl.textContent = bb > 0 ? `${formatDimension(bb)}px` : '0px';
          const anchorX = contentCenterX;
          const anchorY = top + rect.height - (bb > 0 ? bb / 2 : 0);
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${top + rect.height + 28}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#ca8a04';
          break;
        }
        case 'border-left': {
          lbl.textContent = bl > 0 ? `${formatDimension(bl)}px` : '0px';
          const anchorX = left + (bl > 0 ? bl / 2 : 0);
          const anchorY = contentCenterY;
          lbl.style.left = `${(left >= 50) ? (left - 24) : (left + rect.width + 24)}px`;
          lbl.style.top = `${anchorY}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#ca8a04';
          break;
        }
        case 'border-right': {
          lbl.textContent = br > 0 ? `${formatDimension(br)}px` : '0px';
          const anchorX = left + rect.width - (br > 0 ? br / 2 : 0);
          const anchorY = contentCenterY;
          lbl.style.left = `${left + rect.width + 24}px`;
          lbl.style.top = `${anchorY}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#ca8a04';
          break;
        }

        // Padding labels
        case 'padding-top': {
          lbl.textContent = pt > 0 ? `${formatDimension(pt)}px` : '0px';
          const anchorX = contentCenterX;
          const anchorY = top + bt + Math.max(pt / 2, 2);
          const pTop = (top >= 36) ? (top - 28) : (top + rect.height + 28);
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${pTop}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#10b981';
          break;
        }
        case 'padding-bottom': {
          lbl.textContent = pb > 0 ? `${formatDimension(pb)}px` : '0px';
          const anchorX = contentCenterX;
          const anchorY = top + rect.height - bb - Math.max(pb / 2, 2);
          const pBottom = top + rect.height + 28;
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${pBottom}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#10b981';
          break;
        }
        case 'padding-left': {
          lbl.textContent = pl > 0 ? `${formatDimension(pl)}px` : '0px';
          const anchorX = left + bl + Math.max(pl / 2, 2);
          const anchorY = contentCenterY;
          const pLeft = (contentW < 60 || pl < 24) ? (left - 50) : (left + bl + pl / 2);
          const pTop = (contentW < 60 || pl < 24) ? (contentCenterY - 26) : contentCenterY;
          lbl.style.left = `${pLeft}px`;
          lbl.style.top = `${pTop}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#10b981';
          break;
        }
        case 'padding-right': {
          lbl.textContent = pr > 0 ? `${formatDimension(pr)}px` : '0px';
          const anchorX = left + rect.width - br - Math.max(pr / 2, 2);
          const anchorY = contentCenterY;
          const pRight = (contentW < 60 || pr < 24) ? (left + rect.width + 50) : (left + rect.width - br - pr / 2);
          const pTop = (contentW < 60 || pr < 24) ? (contentCenterY - 26) : contentCenterY;
          lbl.style.left = `${pRight}px`;
          lbl.style.top = `${pTop}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#10b981';
          break;
        }

        // Width / Height / Content dimensions
        case 'width': {
          const targetW = (styles.boxSizing === 'content-box' && styles.width && styles.width !== 'auto' && styles.width.endsWith('px')) ? parseFloat(styles.width) : rect.width;
          lbl.textContent = `W: ${formatDimension(targetW)}px`;
          const anchorX = contentCenterX;
          const anchorY = (top >= 36) ? top : (top + rect.height);
          const wTop = (top >= 36) ? (top - 28) : (top + rect.height + 28);
          lbl.style.left = `${contentCenterX}px`;
          lbl.style.top = `${wTop}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#2563eb';
          break;
        }
        case 'height': {
          const targetH = (styles.boxSizing === 'content-box' && styles.height && styles.height !== 'auto' && styles.height.endsWith('px')) ? parseFloat(styles.height) : rect.height;
          lbl.textContent = `H: ${formatDimension(targetH)}px`;
          const anchorX = (left >= 60) ? left : (left + rect.width);
          const anchorY = contentCenterY;
          const hLeft = (left >= 60) ? (left - 50) : (left + rect.width + 50);
          lbl.style.left = `${hLeft}px`;
          lbl.style.top = `${anchorY}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#0d9488';
          break;
        }
        case 'content-dims': {
          lbl.innerHTML = `<span style="color:#93c5fd;font-weight:700;">W: ${formatDimension(contentW)}px</span> <span style="color:#ffffff;opacity:0.8;">×</span> <span style="color:#5eead4;font-weight:700;">H: ${formatDimension(contentH)}px</span>`;
          const anchorX = contentCenterX;
          const anchorY = contentCenterY;
          const cdTop = contentH < 32 ? ((top >= 65) ? (top - 58) : (top + rect.height + 58)) : contentCenterY;
          lbl.style.top = `${cdTop}px`;
          lbl.style.left = `${contentCenterX}px`;
          lbl.dataset.anchorX = anchorX;
          lbl.dataset.anchorY = anchorY;
          lbl.dataset.color = '#6366f1';
          break;
        }
      }
    });

    overlay.classList.add('active');
    renderGapHighlights(target);
    const activeLabelTypes = Array.from(selectedHighlightRegions);
    if (currentHighlightedRegion && !activeLabelTypes.includes(currentHighlightedRegion)) {
      activeLabelTypes.push(currentHighlightedRegion);
    }
    if (activeLabelTypes.length > 0) {
      showOverlayLabels(activeLabelTypes);
    } else {
      hideOverlayLabels();
    }
  }

  function getLabelColor(pos) {
    if (!pos) return '#2563eb';
    if (pos.startsWith('margin')) return '#f97316';
    if (pos.startsWith('border')) return '#ca8a04';
    if (pos.startsWith('padding')) return '#10b981';
    if (pos === 'width') return '#2563eb';
    if (pos === 'height') return '#0d9488';
    if (pos === 'content-dims') return '#6366f1';
    if (pos === 'gap' || pos.startsWith('gap')) return '#8b5cf6';
    return '#2563eb';
  }

  // Generates SVG path for the leader line connecting anchor directly into center of number
  function createCalloutPath(ax, ay, bx, by, hw, hh, isSide) {
    const dx = bx - ax;
    const dy = by - ay;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (Math.hypot(dx, dy) < 14) return null;

    const dirX = dx >= 0 ? 1 : -1;
    const dirY = dy >= 0 ? 1 : -1;

    // For top/bottom callouts: line ALWAYS meets the badge at horizontal center (bx)
    if (!isSide || absY >= absX) {
      const edgeY = dirY === 1 ? (by - hh) : (by + hh);

      // When anchor and badge share the same X: straight vertical line into center of number
      if (absX < 4) {
        return {
          path: `M ${bx} ${ay} L ${bx} ${edgeY}`
        };
      }

      // If anchor and badge have different X:
      // Vertical stem from ax -> smooth curve to midY -> horizontal bridge -> smooth curve -> straight vertical drop into (bx, edgeY)
      const midY = (ay + edgeY) / 2;
      const spanY = Math.abs(edgeY - ay);
      const r = Math.min(10, absX * 0.35, spanY * 0.35);

      if (r < 2) {
        return {
          path: `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${edgeY}`
        };
      }

      return {
        path: `M ${ax} ${ay} L ${ax} ${midY - dirY * r} Q ${ax} ${midY} ${ax + dirX * r} ${midY} L ${bx - dirX * r} ${midY} Q ${bx} ${midY} ${bx} ${midY + dirY * r} L ${bx} ${edgeY}`
      };
    } else {
      // For side callouts: line ALWAYS meets the badge at vertical center (by)
      const edgeX = dirX === 1 ? (bx - hw) : (bx + hw);

      if (absY < 4) {
        return {
          path: `M ${ax} ${by} L ${edgeX} ${by}`
        };
      }

      const midX = (ax + edgeX) / 2;
      const spanX = Math.abs(edgeX - ax);
      const r = Math.min(10, spanX * 0.35, absY * 0.35);

      if (r < 2) {
        return {
          path: `M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${by} L ${edgeX} ${by}`
        };
      }

      return {
        path: `M ${ax} ${ay} L ${midX - dirX * r} ${ay} Q ${midX} ${ay} ${midX} ${ay + dirY * r} L ${midX} ${by - dirY * r} Q ${midX} ${by} ${midX + dirX * r} ${by} L ${edgeX} ${by}`
      };
    }
  }

  function drawLeaderLines(labelItems) {
    if (!leaderSvg) return;
    leaderSvg.innerHTML = '';

    const fragment = document.createDocumentFragment();

    labelItems.forEach(item => {
      const ax = item.anchorX;
      const ay = item.anchorY;
      const bx = item.x;
      const by = item.y;
      const hw = item.width / 2;
      const hh = item.height / 2;
      const color = item.color || getLabelColor(item.pos);

      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy);

      // Only draw leader line if badge is displaced away from its anchor
      if (dist < 14) return;

      const callout = createCalloutPath(ax, ay, bx, by, hw, hh, item.isSide);
      if (!callout) return;

      // 1. Crisp colored leader stem line (clean, flat, no dark border)
      const stemPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      stemPath.setAttribute('d', callout.path);
      stemPath.setAttribute('fill', 'none');
      stemPath.setAttribute('stroke', color);
      stemPath.setAttribute('stroke-width', '1.8');
      stemPath.setAttribute('stroke-linecap', 'round');
      stemPath.setAttribute('stroke-linejoin', 'round');
      fragment.appendChild(stemPath);

      // 2. Round pin indicator directly at (ax, ay)
      const anchorCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      anchorCircle.setAttribute('cx', ax);
      anchorCircle.setAttribute('cy', ay);
      anchorCircle.setAttribute('r', '4');
      anchorCircle.setAttribute('fill', '#ffffff');
      anchorCircle.setAttribute('stroke', color);
      anchorCircle.setAttribute('stroke-width', '2');
      fragment.appendChild(anchorCircle);
    });

    leaderSvg.appendChild(fragment);
  }

  function resolveVisibleOverlayLabelOverlaps() {
    const visibleLabels = [
      ...Array.from(overlay.querySelectorAll('.css-inspector-olabel.visible')),
      ...Array.from(gapHighlightsContainer ? gapHighlightsContainer.querySelectorAll('.css-inspector-gap-badge') : [])
    ];

    if (visibleLabels.length === 0) {
      if (leaderSvg) leaderSvg.innerHTML = '';
      return;
    }

    const ctx = overlay._inspectorContext || {
      contentCenterX: window.innerWidth / 2,
      contentCenterY: window.innerHeight / 2,
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      pt: 0, pb: 0, pl: 0, pr: 0,
      bt: 0, bb: 0, bl: 0, br: 0,
      mt: 0, mb: 0, ml: 0, mr: 0
    };
    const { contentCenterX, contentCenterY, top, left, width, height, pt, pb, pl, pr, bt, bb, bl, br, mt, mb, ml, mr } = ctx;

    const labelItems = visibleLabels.map(lbl => {
      const rect = lbl.getBoundingClientRect();
      const textLen = (lbl.textContent || '').length;
      const w = rect.width > 0 ? rect.width : Math.max(38, textLen * 8 + 18);
      const h = rect.height > 0 ? rect.height : 21;
      const x = parseFloat(lbl.style.left) || (rect.left + rect.width / 2);
      const y = parseFloat(lbl.style.top) || (rect.top + rect.height / 2);
      const ax = parseFloat(lbl.dataset.anchorX);
      const ay = parseFloat(lbl.dataset.anchorY);
      const color = lbl.dataset.color || getLabelColor(lbl.dataset.pos);
      const isSide = lbl.dataset.pos === 'height' || lbl.dataset.pos === 'padding-left' || lbl.dataset.pos === 'padding-right' || lbl.dataset.pos === 'margin-left' || lbl.dataset.pos === 'margin-right' || lbl.dataset.pos === 'border-left' || lbl.dataset.pos === 'border-right';
      return {
        el: lbl,
        pos: lbl.dataset.pos,
        width: w,
        height: h,
        x: x,
        y: y,
        anchorX: isNaN(ax) ? x : ax,
        anchorY: isNaN(ay) ? y : ay,
        color: color,
        isSide: isSide
      };
    });

    // ── Zone Classification ──
    const topItems = [];
    const bottomItems = [];
    const leftItems = [];
    const rightItems = [];
    const neutralItems = [];

    for (const item of labelItems) {
      const p = item.pos;
      if (p === 'padding-top' || p === 'margin-top' || p === 'border-top') {
        topItems.push(item);
      } else if (p === 'padding-bottom' || p === 'margin-bottom' || p === 'border-bottom') {
        bottomItems.push(item);
      } else if (p === 'padding-left' || p === 'margin-left' || p === 'border-left' || p === 'height') {
        leftItems.push(item);
      } else if (p === 'padding-right' || p === 'margin-right' || p === 'border-right') {
        rightItems.push(item);
      } else {
        // e.g. 'width', 'content-dims', 'gap'
        neutralItems.push(item);
      }
    }

    const hasTopRoom = top >= 36;

    // Distribute neutral items (e.g. width)
    for (const item of neutralItems) {
      if (item.pos === 'content-dims') {
        if (height >= 36 && width >= 70) {
          item.x = contentCenterX;
          item.y = contentCenterY;
          item.anchorX = contentCenterX;
          item.anchorY = contentCenterY;
          continue;
        }
      }
      if (hasTopRoom && topItems.length <= bottomItems.length) {
        topItems.push(item);
      } else {
        bottomItems.push(item);
      }
    }

    // Viewport check: If element is too close to top of viewport, move topItems to bottomItems so they stay visible
    if (!hasTopRoom && topItems.length > 0) {
      while (topItems.length > 0) {
        bottomItems.unshift(topItems.pop());
      }
    }

    // ── Single Line Rule: Center directly in item middle ──
    if (labelItems.length === 1) {
      const item = labelItems[0];
      if (!item.isSide) {
        item.x = contentCenterX;
        item.anchorX = contentCenterX;
        if (bottomItems.includes(item)) {
          item.y = top + height + 26;
        } else {
          item.y = hasTopRoom ? (top - 26) : (top + height + 26);
        }
      } else {
        item.y = contentCenterY;
        item.anchorY = contentCenterY;
        item.x = (left >= 60) ? (left - 50) : (left + width + 50);
        item.anchorX = (left >= 60) ? left : (left + width);
      }
    }
    // ── 2 Lines Rule: One Top, One Bottom (Zero Overlap, Centered in Number) ──
    else if (labelItems.length === 2 && hasTopRoom && topItems.length === 1 && bottomItems.length === 1) {
      const itemTop = topItems[0];
      const itemBottom = bottomItems[0];

      // Top line directly in middle at top
      itemTop.x = contentCenterX;
      itemTop.anchorX = contentCenterX;
      itemTop.y = top - 26;

      // Bottom line directly in middle at bottom
      itemBottom.x = contentCenterX;
      itemBottom.anchorX = contentCenterX;
      itemBottom.y = top + height + 26;
    }
    // ── Multi-Line Zone Distribution: Horizontally spaced & locked to center of number ──
    else {
      // 1. Arrange topItems horizontally (each line centered with its number)
      if (topItems.length === 1) {
        topItems[0].x = contentCenterX;
        topItems[0].anchorX = contentCenterX;
        topItems[0].y = top - 26;
      } else if (topItems.length > 1) {
        const count = topItems.length;
        const totalW = topItems.reduce((acc, it) => acc + it.width, 0);
        const spacing = Math.max(72, Math.min(110, (totalW + 40) / count));

        for (let i = 0; i < count; i++) {
          const offsetIdx = i - (count - 1) / 2;
          topItems[i].x = contentCenterX + offsetIdx * spacing;
          topItems[i].anchorX = topItems[i].x; // Locked to center of number!
          topItems[i].y = top - 26;
        }
      }

      // 2. Arrange bottomItems horizontally (each line centered with its number)
      if (bottomItems.length === 1) {
        bottomItems[0].x = contentCenterX;
        bottomItems[0].anchorX = contentCenterX;
        bottomItems[0].y = top + height + 26;
      } else if (bottomItems.length > 1) {
        const count = bottomItems.length;
        const totalW = bottomItems.reduce((acc, it) => acc + it.width, 0);
        const spacing = Math.max(72, Math.min(110, (totalW + 40) / count));

        for (let i = 0; i < count; i++) {
          const offsetIdx = i - (count - 1) / 2;
          bottomItems[i].x = contentCenterX + offsetIdx * spacing;
          bottomItems[i].anchorX = bottomItems[i].x; // Locked to center of number!
          bottomItems[i].y = top + height + 26;
        }
      }
    }

    // 3. Arrange leftItems vertically
    if (leftItems.length === 1) {
      leftItems[0].x = (left >= 60) ? (left - 50) : (left + width + 50);
      leftItems[0].y = contentCenterY;
      leftItems[0].anchorX = (left >= 60) ? left : (left + width);
      leftItems[0].anchorY = contentCenterY;
    } else if (leftItems.length > 1) {
      const count = leftItems.length;
      for (let i = 0; i < count; i++) {
        const offsetIdx = i - (count - 1) / 2;
        leftItems[i].x = (left >= 60) ? (left - 50) : (left + width + 50);
        leftItems[i].anchorX = (left >= 60) ? left : (left + width);
        leftItems[i].y = contentCenterY + offsetIdx * 28;
        leftItems[i].anchorY = leftItems[i].y;
      }
    }

    // 4. Arrange rightItems vertically
    if (rightItems.length === 1) {
      rightItems[0].x = left + width + 50;
      rightItems[0].y = contentCenterY;
      rightItems[0].anchorX = left + width;
      rightItems[0].anchorY = contentCenterY;
    } else if (rightItems.length > 1) {
      const count = rightItems.length;
      for (let i = 0; i < count; i++) {
        const offsetIdx = i - (count - 1) / 2;
        rightItems[i].x = left + width + 50;
        rightItems[i].anchorX = left + width;
        rightItems[i].y = contentCenterY + offsetIdx * 28;
        rightItems[i].anchorY = rightItems[i].y;
      }
    }

    // Ensure proper anchorY for each item
    for (const item of labelItems) {
      const p = item.pos;
      if (p === 'padding-top') {
        item.anchorY = top + bt + Math.max(pt / 2, 2);
      } else if (p === 'padding-bottom') {
        item.anchorY = top + height - bb - Math.max(pb / 2, 2);
      } else if (p === 'margin-top' || p === 'border-top') {
        item.anchorY = top;
      } else if (p === 'margin-bottom' || p === 'border-bottom') {
        item.anchorY = top + height;
      } else if (p === 'width') {
        item.anchorY = item.y <= top ? top : (top + height);
      }
    }

    // Viewport Boundary Clamping: Never let any badge be cut off by screen boundaries!
    const screenPad = 10;
    for (const item of labelItems) {
      const halfW = item.width / 2;
      const halfH = item.height / 2;
      item.x = Math.max(halfW + screenPad, Math.min(window.innerWidth - halfW - screenPad, item.x));
      item.y = Math.max(halfH + screenPad, Math.min(window.innerHeight - halfH - screenPad, item.y));
      if (!item.isSide) {
        const minAx = left + bl + 6;
        const maxAx = left + width - br - 6;
        if (minAx < maxAx) {
          item.anchorX = Math.max(minAx, Math.min(maxAx, item.x));
        } else {
          item.anchorX = contentCenterX;
        }
      } else {
        const minAy = top + bt + 6;
        const maxAy = top + height - bb - 6;
        if (minAy < maxAy) {
          item.anchorY = Math.max(minAy, Math.min(maxAy, item.y));
        } else {
          item.anchorY = contentCenterY;
        }
      }
    }

    // Apply resolved positions
    for (const item of labelItems) {
      item.el.style.left = `${item.x}px`;
      item.el.style.top = `${item.y}px`;
    }

    // Render pin leader lines with precision arrows and smooth rounded elbows
    drawLeaderLines(labelItems);
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
        const isNonZero = lbl.textContent && lbl.textContent !== '0px' && lbl.textContent !== '0' && lbl.textContent !== '-';
        if ((type === 'padding' || type === 'padding-all') && pos.startsWith('padding-')) return isNonZero;
        if ((type === 'margin' || type === 'margin-all') && pos.startsWith('margin-')) return isNonZero;
        if ((type === 'border' || type === 'border-all') && pos.startsWith('border-')) return isNonZero;
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
    if (leaderSvg) {
      leaderSvg.innerHTML = '';
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
                  value: `${formatDimension(gapDist)}px`
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
                  value: `${formatDimension(gapDist)}px`
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
      const parts = String(slot.value).split('/').map(p => parseFloat(p.trim()) || 0);
      const maxVal = Math.max(...parts);
      if (maxVal <= 0) return;

      const strip = document.createElement('div');
      strip.className = 'css-inspector-gap-strip';
      strip.style.left = `${slot.left}px`;
      strip.style.top = `${slot.top}px`;
      strip.style.width = `${slot.width}px`;
      strip.style.height = `${slot.height}px`;
      gapHighlightsContainer.appendChild(strip);

      const slotCenterX = slot.left + slot.width / 2;
      const slotCenterY = slot.top + slot.height / 2;

      let badgeX = slotCenterX;
      let badgeY = slotCenterY;

      // Project outward if slot is thin so it doesn't get crammed or overlayed
      if (slot.type === 'row' || (slot.height < 24 && slot.width >= slot.height)) {
        if (slot.left + slot.width + 36 <= window.innerWidth) {
          badgeX = slot.left + slot.width + 24;
        } else {
          badgeX = Math.max(30, slot.left - 24);
        }
      } else if (slot.type === 'column' || (slot.width < 28 && slot.height > slot.width)) {
        if (slot.top - 24 >= 10) {
          badgeY = slot.top - 20;
        } else {
          badgeY = slot.top + slot.height + 20;
        }
      }

      const badge = document.createElement('span');
      badge.className = 'css-inspector-gap-badge';
      badge.textContent = slot.value;
      badge.style.left = `${badgeX}px`;
      badge.style.top = `${badgeY}px`;
      badge.dataset.anchorX = slotCenterX;
      badge.dataset.anchorY = slotCenterY;
      badge.dataset.color = '#8b5cf6';
      badge.dataset.pos = 'gap';
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
    const contentW = Math.max(0, width - bl - br - pl - pr);
    const contentH = Math.max(0, height - bt - bb - pt - pb);

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
        rLeft = pr > 0 ? (left + width - br - pr) : (left + width - br - 2);
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
        rTop = top;
        rLeft = left;
        rWidth = width;
        rHeight = height;
        colorType = 'width';
        break;
      case 'height':
        rTop = top;
        rLeft = left;
        rWidth = width;
        rHeight = height;
        colorType = 'height';
        break;
      case 'content':
        return { top: rect.top + bt + pt, left: rect.left + bl + pl, width: contentW, height: contentH, colorType: 'content' };

      case 'gap':
        return null;

      default:
        return null;
    }

    return { top: rTop, left: rLeft, width: rWidth, height: rHeight, colorType };
  }

  function highlightRegion(target, regionKey) {
    if (!overlayHighlight) return;
    currentHighlightedRegion = regionKey;

    const activeEl = target || (pauseOnPopup && clickedTarget) || clickedTarget || currentTarget;

    if (!activeEl || !regionKey) {
      overlayHighlight.classList.remove('active');
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
      const borderRadius = (regionKey === 'margin' || regionKey.startsWith('margin')) ? '0px' : (window.getComputedStyle(activeEl).borderRadius || '0px');
      overlayHighlight.style.borderRadius = borderRadius;
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
        const borderRadius = (regionKey === 'margin' || regionKey.startsWith('margin')) ? '0px' : (window.getComputedStyle(activeEl).borderRadius || '0px');
        itemEl.style.borderRadius = borderRadius;
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

    const rawTarget = (e.composedPath && e.composedPath()[0]) || e.target;

    // If clicking inside panel, let it work normally
    if (rawTarget && rawTarget.closest && rawTarget.closest('#css-inspector-panel')) {
      return;
    }

    // Intercept the click to disable website actions
    if (blockInteractions) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Determine deepest target element to inspect / measure
    let candidateTarget = rawTarget;
    if (Date.now() - lastMouseDownTime < 700 && lastMouseDownTarget && !isOurUI(lastMouseDownTarget)) {
      // If rawTarget is body or html (common when animated items move during click), prefer lastMouseDownTarget
      if (!candidateTarget || candidateTarget === document.body || candidateTarget === document.documentElement) {
        candidateTarget = lastMouseDownTarget;
      }
    }
    if ((!candidateTarget || candidateTarget === document.body || candidateTarget === document.documentElement) && currentTarget && !isOurUI(currentTarget)) {
      candidateTarget = currentTarget;
    }

    let el = getDeepestElementAt(e.clientX, e.clientY, candidateTarget) || candidateTarget || currentTarget;

    if (!el || isOurUI(el)) return;

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

    if (el === clickedTarget && panel && panel.classList.contains('active')) return;

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
      const hovered = getElementUnderCursor();
      if (clickedTarget && hovered && hovered !== clickedTarget) {
        measureTarget = hovered;
        renderMeasurement(clickedTarget, measureTarget);
      } else if (hovered) {
        const parentContainer = getReferenceContainer(hovered);
        if (parentContainer && parentContainer !== hovered) {
          renderMeasurement(parentContainer, hovered);
        }
      }
      showToast("Distance Measurement: ON");
    }
  }


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
      if (parseFloat(formatDimension(topDist)) > 0) {
        const topY1 = Math.min(rectA.top, rectB.top);
        const topY2 = Math.max(rectA.top, rectB.top);
        drawMeasureLine(measureSvg, innerCenterX, topY1, innerCenterX, topY2, topDist, 'vertical', 'top');
      }

      // 2. Bottom distance
      const bottomDist = Math.abs(rectA.bottom - rectB.bottom);
      if (parseFloat(formatDimension(bottomDist)) > 0) {
        const botY1 = Math.min(rectA.bottom, rectB.bottom);
        const botY2 = Math.max(rectA.bottom, rectB.bottom);
        drawMeasureLine(measureSvg, innerCenterX, botY1, innerCenterX, botY2, bottomDist, 'vertical', 'bottom');
      }

      // 3. Left distance
      const leftDist = Math.abs(rectB.left - rectA.left);
      if (parseFloat(formatDimension(leftDist)) > 0) {
        const leftX1 = Math.min(rectA.left, rectB.left);
        const leftX2 = Math.max(rectA.left, rectB.left);
        drawMeasureLine(measureSvg, leftX1, innerCenterY, leftX2, innerCenterY, leftDist, 'horizontal', 'left');
      }

      // 4. Right distance
      const rightDist = Math.abs(rectA.right - rectB.right);
      if (parseFloat(formatDimension(rightDist)) > 0) {
        const rightX1 = Math.min(rectA.right, rectB.right);
        const rightX2 = Math.max(rectA.right, rectB.right);
        drawMeasureLine(measureSvg, rightX1, innerCenterY, rightX2, innerCenterY, rightDist, 'horizontal', 'right');
      }
    }

    // Hovered item's width & height dimension badge
    const bw = formatDimension(rectB.width);
    const bh = formatDimension(rectB.height);
    if (parseFloat(bw) > 0 && parseFloat(bh) > 0) {
      queueDimensionsBadge(rectB, bw, bh);
    }

    // Solve all overlaps across all badges in this frame
    resolveAllBadgeOverlaps(pendingBadges);

    // Draw all non-overlapping badges on SVG
    renderAllBadges(measureSvg, pendingBadges);
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
    const labelText = `${formatDimension(distance)}px`;
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

  let colorCanvasCtx = null;
  function getColorCanvasCtx() {
    if (!colorCanvasCtx) {
      try {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        colorCanvasCtx = c.getContext('2d', { willReadFrequently: true });
      } catch (e) { }
    }
    return colorCanvasCtx;
  }

  function parseColor(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'none') {
      return null;
    }

    const hexPart = (x) => ("0" + Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16)).slice(-2).toUpperCase();

    let r = 0, g = 0, b = 0, a = 1;
    let parsed = false;

    // Fast path: standard rgba/rgb strings
    const rgbaMatch = colorStr.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
    if (rgbaMatch) {
      r = parseInt(rgbaMatch[1], 10);
      g = parseInt(rgbaMatch[2], 10);
      b = parseInt(rgbaMatch[3], 10);
      if (rgbaMatch[4] !== undefined) {
        a = rgbaMatch[4].endsWith('%') ? parseFloat(rgbaMatch[4]) / 100 : parseFloat(rgbaMatch[4]);
      }
      parsed = true;
    }

    // Slash syntax: rgb(r g b / a)
    if (!parsed) {
      const slashMatch = colorStr.match(/^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
      if (slashMatch) {
        r = parseInt(slashMatch[1], 10);
        g = parseInt(slashMatch[2], 10);
        b = parseInt(slashMatch[3], 10);
        if (slashMatch[4] !== undefined) {
          a = slashMatch[4].endsWith('%') ? parseFloat(slashMatch[4]) / 100 : parseFloat(slashMatch[4]);
        }
        parsed = true;
      }
    }

    // Hex syntax: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
    if (!parsed && colorStr.startsWith('#')) {
      const hex = colorStr.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
        parsed = true;
      } else if (hex.length === 4) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
        a = parseInt(hex[3] + hex[3], 16) / 255;
        parsed = true;
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        parsed = true;
      } else if (hex.length === 8) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        a = parseInt(hex.slice(6, 8), 16) / 255;
        parsed = true;
      }
    }

    // Canvas fallback for modern formats: color(), oklch, lab, hsl, hsla, named colors
    if (!parsed) {
      try {
        const ctx = getColorCanvasCtx();
        if (ctx) {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000000';
          ctx.fillStyle = colorStr;
          const normalized = ctx.fillStyle;
          if (normalized.startsWith('#')) {
            r = parseInt(normalized.slice(1, 3), 16);
            g = parseInt(normalized.slice(3, 5), 16);
            b = parseInt(normalized.slice(5, 7), 16);
            a = 1;
            parsed = true;
          } else {
            const m = normalized.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
            if (m) {
              r = parseInt(m[1], 10);
              g = parseInt(m[2], 10);
              b = parseInt(m[3], 10);
              a = m[4] !== undefined ? parseFloat(m[4]) : 1;
              parsed = true;
            }
          }
        }
      } catch (e) { }
    }

    if (!parsed) {
      return null;
    }

    a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
    const hex = `#${hexPart(r)}${hexPart(g)}${hexPart(b)}`;
    const alphaHex = hexPart(Math.round(a * 255));
    const hex8 = `${hex}${alphaHex}`;
    const opacityPercent = Math.round(a * 100);
    const hasOpacity = a < 0.999;
    const displayCss = hasOpacity ? `rgba(${r}, ${g}, ${b}, ${a})` : hex;

    return {
      raw: colorStr,
      hex,
      hex8,
      r,
      g,
      b,
      a,
      hasOpacity,
      opacityPercent,
      displayCss
    };
  }

  function rgbToHex(rgbStr) {
    const parsed = parseColor(rgbStr);
    if (parsed) return parsed.hex;
    const rgb = rgbStr ? rgbStr.match(/\d+/g) : null;
    if (!rgb || rgb.length < 3) return rgbStr;
    const hex = (x) => ("0" + parseInt(x).toString(16)).slice(-2);
    return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`.toUpperCase();
  }

  function renderColorValueHtml(parsedColor, classText = '') {
    if (!parsedColor) return '';
    const opacityBadge = parsedColor.hasOpacity
      ? `<span class="css-inspector-color-opacity" title="Opacity: ${parsedColor.opacityPercent}%">${parsedColor.opacityPercent}%</span>`
      : '';

    return `
      <div class="css-inspector-color-wrap" data-color="${parsedColor.hex}" data-rgba="${parsedColor.displayCss}" data-opacity="${parsedColor.opacityPercent}">
        <div class="css-inspector-color-box-wrap" title="${parsedColor.displayCss}">
          <div class="css-inspector-color-box" style="background-color: ${parsedColor.displayCss}"></div>
        </div>
        <span class="css-inspector-value-text">${parsedColor.hex}</span>
        ${opacityBadge}
      </div>
      ${classText ? `<span class="css-inspector-class-text">${classText}</span>` : ''}
    `;
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
      backgroundColor: /^bg-(?!auto|cover|contain|bottom|top|center|left|right|repeat|no-repeat|fixed|local|scroll|clip|origin)/,
      animation: /^animate-/,
      transition: /^(transition|duration-|ease-|delay-)/,
      transform: /^(rotate-|scale-|translate-|skew-|transform)/
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
      backgroundColor: 'backgroundColor',
      animation: 'animation',
      transition: 'transition',
      transform: 'transform'
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
    if (l === 'radius') return 'border';
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

  // Helper to find animation on target, its pseudo-elements, or its closest animated ancestor
  function findAnimatedElement(target) {
    if (!target || target === document.body || target === document.documentElement) return null;

    // 1. Direct animation on target
    const s = window.getComputedStyle(target);
    if (s.animationName && s.animationName !== 'none' && s.animationName !== '') {
      return { el: target, source: 'self', styles: s, animationName: s.animationName };
    }

    // 2. Pseudo-elements (::before, ::after) on target
    try {
      const before = window.getComputedStyle(target, '::before');
      if (before.animationName && before.animationName !== 'none' && before.animationName !== '') {
        return { el: target, source: '::before', styles: before, animationName: before.animationName };
      }
      const after = window.getComputedStyle(target, '::after');
      if (after.animationName && after.animationName !== 'none' && after.animationName !== '') {
        return { el: target, source: '::after', styles: after, animationName: after.animationName };
      }
    } catch (e) { }

    // 3. Web Animations API on target
    if (target.getAnimations) {
      try {
        const anims = target.getAnimations();
        if (anims && anims.length > 0) {
          const first = anims[0];
          const animName = first.animationName || (first.id ? first.id : 'web-animation');
          return { el: target, source: 'web-animation', styles: s, animationName: animName, animObj: first };
        }
      } catch (e) { }
    }

    // 4. Closest ancestor with animation (e.g. clicked inside animated button, card, spinner)
    let curr = target.parentElement;
    let depth = 0;
    while (curr && curr !== document.body && curr !== document.documentElement && depth < 10) {
      depth++;
      const cs = window.getComputedStyle(curr);
      if (cs.animationName && cs.animationName !== 'none' && cs.animationName !== '') {
        return { el: curr, source: 'ancestor', styles: cs, animationName: cs.animationName };
      }
      try {
        const cb = window.getComputedStyle(curr, '::before');
        if (cb.animationName && cb.animationName !== 'none' && cb.animationName !== '') {
          return { el: curr, source: 'ancestor::before', styles: cb, animationName: cb.animationName };
        }
        const ca = window.getComputedStyle(curr, '::after');
        if (ca.animationName && ca.animationName !== 'none' && ca.animationName !== '') {
          return { el: curr, source: 'ancestor::after', styles: ca, animationName: ca.animationName };
        }
      } catch (e) { }
      if (curr.getAnimations) {
        try {
          const anims = curr.getAnimations();
          if (anims && anims.length > 0) {
            const first = anims[0];
            const animName = first.animationName || (first.id ? first.id : 'web-animation');
            return { el: curr, source: 'ancestor-web-animation', styles: cs, animationName: animName, animObj: first };
          }
        } catch (e) { }
      }
      curr = curr.parentElement;
    }

    // 5. Descendants (e.g. clicked container of animated SVG or spinner)
    if (target.getAnimations) {
      try {
        const subAnims = target.getAnimations({ subtree: true });
        if (subAnims && subAnims.length > 0) {
          const first = subAnims[0];
          const subTarget = first.effect ? first.effect.target : null;
          if (subTarget && subTarget !== target) {
            return {
              el: subTarget,
              source: 'child',
              styles: window.getComputedStyle(subTarget),
              animationName: first.animationName || 'child-animation',
              animObj: first
            };
          }
        }
      } catch (e) { }
    }

    return null;
  }

  // Helper to find transition on target or its closest ancestor
  function findTransitionElement(target) {
    if (!target || target === document.body || target === document.documentElement) return null;
    const s = window.getComputedStyle(target);
    const hasSelfTrans = s.transitionDuration && s.transitionDuration !== '0s' && s.transitionDuration !== '0ms' && s.transitionProperty && s.transitionProperty !== 'none';
    if (hasSelfTrans) {
      return { el: target, source: 'self', styles: s };
    }
    let curr = target.parentElement;
    let depth = 0;
    while (curr && curr !== document.body && curr !== document.documentElement && depth < 6) {
      depth++;
      const cs = window.getComputedStyle(curr);
      const hasTrans = cs.transitionDuration && cs.transitionDuration !== '0s' && cs.transitionDuration !== '0ms' && cs.transitionProperty && cs.transitionProperty !== 'none';
      if (hasTrans) {
        return { el: curr, source: 'ancestor', styles: cs };
      }
      curr = curr.parentElement;
    }
    return null;
  }

  // Helper to find CSS keyframe rule by animation name
  function findKeyframesRule(animationName) {
    if (!animationName || animationName === 'none') return null;
    const firstAnim = animationName.split(',')[0].trim();
    try {
      for (let i = document.styleSheets.length - 1; i >= 0; i--) {
        const sheet = document.styleSheets[i];
        let rules;
        try { rules = sheet.cssRules || sheet.rules; } catch (e) { continue; }
        if (!rules) continue;
        for (let j = rules.length - 1; j >= 0; j--) {
          const rule = rules[j];
          if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === firstAnim) {
            return rule;
          }
        }
      }
    } catch (e) { }
    return null;
  }

  let animTrackingFrameId = null;
  function startOverlayAnimationTracking(targetEl) {
    stopOverlayAnimationTracking();
    const trackTarget = targetEl || clickedTarget;
    if (!trackTarget) return;

    function tick() {
      if (clickedTarget && panel && panel.classList.contains('active')) {
        updateOverlay(pauseOnPopup ? clickedTarget : (currentTarget || clickedTarget));

        if (clickedOverlay && clickedOverlay.classList.contains('active')) {
          const rect = clickedTarget.getBoundingClientRect();
          clickedOverlay.style.top = `${rect.top}px`;
          clickedOverlay.style.left = `${rect.left}px`;
          clickedOverlay.style.width = `${rect.width}px`;
          clickedOverlay.style.height = `${rect.height}px`;
        }

        animTrackingFrameId = requestAnimationFrame(tick);
      } else {
        stopOverlayAnimationTracking();
      }
    }
    animTrackingFrameId = requestAnimationFrame(tick);
  }

  function stopOverlayAnimationTracking() {
    if (animTrackingFrameId) {
      cancelAnimationFrame(animTrackingFrameId);
      animTrackingFrameId = null;
    }
  }

  function inspectElement(el, e) {
    clickedTarget = el;
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
      const parsed = parseColor(colorValue);
      if (!parsed) return;
      colorsToShow.push({ label, parsed });
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

    if (hasText && styles.color && styles.color !== 'rgba(0, 0, 0, 0)' && styles.color !== 'transparent') {
      addColor('Text', styles.color);
    }

    let colorsSectionHtml = '';
    if (colorsToShow.length > 0) {
      let colorsHtml = colorsToShow.map(c => {
        let colorCategory = null;
        const l = c.label.toLowerCase();
        if (l.includes('background')) colorCategory = 'backgroundColor';
        else if (l.includes('text')) colorCategory = 'color';
        const colorClass = colorCategory ? findPropertyClass(el, colorCategory) : '';

        return `
        <div class="css-inspector-row">
          <span class="css-inspector-label">${c.label}</span>
          <div class="css-inspector-value">
            ${renderColorValueHtml(c.parsed, colorClass)}
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

    if (styles.opacity && styles.opacity !== '1') {
      const opFloat = parseFloat(styles.opacity);
      const opPct = isNaN(opFloat) ? styles.opacity : `${Math.round(opFloat * 100)}%`;
      const opDisplay = isNaN(opFloat) ? styles.opacity : `${opPct} (${styles.opacity})`;
      extraRows += renderInspectorRow('Opacity', opDisplay, 'opacity', el);
    }
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
        extraRows += renderInspectorRow('Border Width', formatPx(bwTop));
      } else {
        if (parseFloat(bwTop) > 0) extraRows += renderInspectorRow('Border Top Width', formatPx(bwTop));
        if (parseFloat(bwRight) > 0) extraRows += renderInspectorRow('Border Right Width', formatPx(bwRight));
        if (parseFloat(bwBottom) > 0) extraRows += renderInspectorRow('Border Bottom Width', formatPx(bwBottom));
        if (parseFloat(bwLeft) > 0) extraRows += renderInspectorRow('Border Left Width', formatPx(bwLeft));
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

    if (styles.transform && styles.transform !== 'none') {
      extraRows += renderInspectorRow('Transform', styles.transform, 'transform', el);
    }

    if (extraRows) {
      extraPropsHtml = `
      <div class="css-inspector-section">
        <div class="css-inspector-section-title">Properties</div>
        ${extraRows}
      </div>
    `;
    }

    // Animation detection (checks element, pseudo-elements, Web Animations, and ancestors)
    let animationSectionHtml = '';
    const animInfo = findAnimatedElement(el);
    if (animInfo) {
      const animEl = animInfo.el;
      const animStyles = animInfo.styles;
      const animName = animInfo.animationName || animStyles.animationName;

      let animRows = '';

      // If animation is on an ancestor or pseudo-element, show source badge and quick switch
      if (animInfo.source === 'ancestor') {
        const tag = animEl.tagName.toLowerCase();
        const cls = animEl.className && typeof animEl.className === 'string' && animEl.className.trim()
          ? '.' + animEl.className.trim().split(/\s+/)[0]
          : '';
        animRows += `
          <div class="css-inspector-row">
            <span class="css-inspector-label">Applied On</span>
            <div class="css-inspector-value" style="display:flex;align-items:center;gap:6px;">
              <span class="css-inspector-value-text">&lt;${tag}${cls}&gt;</span>
              <button class="css-inspector-inspect-parent-btn" data-action="inspect-anim-parent" title="Inspect animated container">Inspect</button>
            </div>
          </div>
        `;
      } else if (animInfo.source.includes('::')) {
        animRows += `
          <div class="css-inspector-row">
            <span class="css-inspector-label">Applied On</span>
            <div class="css-inspector-value">
              <span class="css-inspector-value-text" style="color:#a855f7;font-weight:600;">${animInfo.source} pseudo-element</span>
            </div>
          </div>
        `;
      }

      animRows += renderInspectorRow('Name', animName, 'animation', animEl);

      // Keyframes preview if found in stylesheets
      const kfRule = findKeyframesRule(animName);
      if (kfRule && kfRule.cssRules && kfRule.cssRules.length > 0) {
        const steps = Array.from(kfRule.cssRules).map(r => r.keyText).join(' → ');
        animRows += `
          <div class="css-inspector-row">
            <span class="css-inspector-label">Keyframes</span>
            <div class="css-inspector-value">
              <span class="css-inspector-value-text" style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:#6366f1;">${steps}</span>
            </div>
          </div>
        `;
      }

      if (animStyles.animationDuration && animStyles.animationDuration !== '0s') {
        animRows += renderInspectorRow('Duration', animStyles.animationDuration);
      }
      if (animStyles.animationTimingFunction) {
        animRows += renderInspectorRow('Timing', animStyles.animationTimingFunction);
      }
      if (animStyles.animationIterationCount) {
        animRows += renderInspectorRow('Iterations', animStyles.animationIterationCount);
      }
      if (animStyles.animationDelay && animStyles.animationDelay !== '0s') {
        animRows += renderInspectorRow('Delay', animStyles.animationDelay);
      }
      if (animStyles.animationDirection && animStyles.animationDirection !== 'normal') {
        animRows += renderInspectorRow('Direction', animStyles.animationDirection);
      }
      if (animStyles.animationFillMode && animStyles.animationFillMode !== 'none') {
        animRows += renderInspectorRow('Fill Mode', animStyles.animationFillMode);
      }

      const isPaused = animStyles.animationPlayState === 'paused' || animEl.style.animationPlayState === 'paused';
      const playStateText = isPaused ? 'paused' : 'running';
      const playStateBtn = `<button class="css-inspector-anim-btn ${isPaused ? 'paused' : ''}" data-action="toggle-anim" title="Toggle animation play/pause">${isPaused ? '▶ Resume' : '⏸ Pause'}</button>`;
      animRows += `
        <div class="css-inspector-row">
          <span class="css-inspector-label">Play State</span>
          <div class="css-inspector-value" style="display:flex;flex-direction:row;align-items:center;gap:8px;">
            <span class="css-inspector-value-text" style="color:${isPaused ? '#f59e0b' : '#10b981'};font-weight:600;">${playStateText}</span>
            ${playStateBtn}
          </div>
        </div>
      `;

      animationSectionHtml = `
      <div class="css-inspector-section">
        <div class="css-inspector-section-title">Animation</div>
        ${animRows}
      </div>
    `;
    }

    // Transition detection (checks element and ancestors)
    let transitionSectionHtml = '';
    const transInfo = findTransitionElement(el);
    if (transInfo) {
      const transEl = transInfo.el;
      const transStyles = transInfo.styles;
      let transRows = '';

      if (transInfo.source === 'ancestor') {
        const tag = transEl.tagName.toLowerCase();
        const cls = transEl.className && typeof transEl.className === 'string' && transEl.className.trim()
          ? '.' + transEl.className.trim().split(/\s+/)[0]
          : '';
        transRows += `
          <div class="css-inspector-row">
            <span class="css-inspector-label">Applied On</span>
            <div class="css-inspector-value">
              <span class="css-inspector-value-text">&lt;${tag}${cls}&gt;</span>
            </div>
          </div>
        `;
      }

      transRows += renderInspectorRow('Property', transStyles.transitionProperty, 'transition', transEl);
      transRows += renderInspectorRow('Duration', transStyles.transitionDuration);
      if (transStyles.transitionTimingFunction) transRows += renderInspectorRow('Timing', transStyles.transitionTimingFunction);
      if (transStyles.transitionDelay && transStyles.transitionDelay !== '0s') transRows += renderInspectorRow('Delay', transStyles.transitionDelay);

      transitionSectionHtml = `
      <div class="css-inspector-section">
        <div class="css-inspector-section-title">Transition</div>
        ${transRows}
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
      radiusHtml = renderInspectorRow('Radius', formatPx(rVal), 'radius', el);
    }

    const rawRowGap = styles.rowGap || styles.gridRowGap || '0px';
    const rawColGap = styles.columnGap || styles.gridColumnGap || '0px';
    const rowGap = (rawRowGap === 'normal') ? '0px' : rawRowGap;
    const columnGap = (rawColGap === 'normal') ? '0px' : rawColGap;
    let gapHtml = '';

    if (rowGap === columnGap && rowGap !== '0px') {
      gapHtml = renderInspectorRow('Gap', formatPx(rowGap), 'gap', el);
    } else if (rowGap !== '0px' || columnGap !== '0px') {
      gapHtml = renderInspectorRow('Gap (Row/Col)', `${formatPx(rowGap)} / ${formatPx(columnGap)}`, 'gap', el);
    }

    let marginHtml = '';
    const mt = styles.marginTop, mr = styles.marginRight, mb = styles.marginBottom, ml = styles.marginLeft;
    if (mt !== '0px' || mr !== '0px' || mb !== '0px' || ml !== '0px') {
      if (mt === mr && mt === mb && mt === ml) {
        marginHtml = renderInspectorRow('Margin', formatPx(mt), 'margin', el);
      } else {
        let marginContent = '';
        if (mt !== '0px') marginContent += renderInspectorRow('Margin Top', formatPx(mt));
        if (mr !== '0px') marginContent += renderInspectorRow('Margin Right', formatPx(mr));
        if (mb !== '0px') marginContent += renderInspectorRow('Margin Bottom', formatPx(mb));
        if (ml !== '0px') marginContent += renderInspectorRow('Margin Left', formatPx(ml));
        const mCls = findPropertyClass(el, 'margin');
        if (mCls) marginContent += `<div class="css-inspector-row"><span class="css-inspector-label">Margin Class</span><div class="css-inspector-value"><span class="css-inspector-class-text">${mCls}</span></div></div>`;
        marginHtml = marginContent;
      }
    }

    let paddingHtml = '';
    const pt = styles.paddingTop, pr = styles.paddingRight, pb = styles.paddingBottom, pl = styles.paddingLeft;
    if (pt !== '0px' || pr !== '0px' || pb !== '0px' || pl !== '0px') {
      if (pt === pr && pt === pb && pt === pl) {
        paddingHtml = renderInspectorRow('Padding', formatPx(pt), 'padding', el);
      } else {
        let paddingContent = '';
        if (pt !== '0px') paddingContent += renderInspectorRow('Padding Top', formatPx(pt));
        if (pr !== '0px') paddingContent += renderInspectorRow('Padding Right', formatPx(pr));
        if (pb !== '0px') paddingContent += renderInspectorRow('Padding Bottom', formatPx(pb));
        if (pl !== '0px') paddingContent += renderInspectorRow('Padding Left', formatPx(pl));
        const pCls = findPropertyClass(el, 'padding');
        if (pCls) paddingContent += `<div class="css-inspector-row"><span class="css-inspector-label">Padding Class</span><div class="css-inspector-value"><span class="css-inspector-class-text">${pCls}</span></div></div>`;
        paddingHtml = paddingContent;
      }
    }

    let typographyHtml = '';
    if (hasText) {
      const parsedTextColor = parseColor(styles.color);
      const textColorClass = findPropertyClass(el, 'color');

      const textColorHtml = (parsedTextColor && styles.color !== 'rgba(0, 0, 0, 0)' && styles.color !== 'transparent') ? `
      <div class="css-inspector-row">
        <span class="css-inspector-label">Text color</span>
        <div class="css-inspector-value">
          ${renderColorValueHtml(parsedTextColor, textColorClass)}
        </div>
      </div>
    ` : '';

      typographyHtml = `
    <div class="css-inspector-section">
      <div class="css-inspector-section-title">Text properties</div>
      ${renderInspectorRow('Font Family', styles.fontFamily.replace(/['"]/g, ''), 'fontFamily', el)}
      ${renderInspectorRow('Font Size', formatPx(styles.fontSize), 'fontSize', el)}
      ${renderInspectorRow('Line Height', styles.lineHeight === 'normal' ? 'normal' : formatPx(styles.lineHeight), 'lineHeight', el)}
      ${renderInspectorRow('Font Weight', getFontWeightName(styles.fontWeight), 'fontWeight', el)}
      ${renderInspectorRow('Letter Spacing', styles.letterSpacing === 'normal' ? 'normal' : formatPx(styles.letterSpacing), 'letterSpacing', el)}
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
        return formatDimension(num);
      }
      return val;
    };

    const parseVal = (val) => parseFloat(val) || 0;
    const bTop = parseVal(styles.borderTopWidth);
    const bRight = parseVal(styles.borderRightWidth);
    const bBottom = parseVal(styles.borderBottomWidth);
    const bLeft = parseVal(styles.borderLeftWidth);
    const padTop = parseVal(styles.paddingTop);
    const padRight = parseVal(styles.paddingRight);
    const padBottom = parseVal(styles.paddingBottom);
    const padLeft = parseVal(styles.paddingLeft);

    let boxContentW = Math.max(0, rect.width - bLeft - bRight - padLeft - padRight);
    let boxContentH = Math.max(0, rect.height - bTop - bBottom - padTop - padBottom);
    if (styles.boxSizing === 'content-box' && styles.width && styles.width !== 'auto' && styles.width.endsWith('px')) {
      boxContentW = parseFloat(styles.width);
    }
    if (styles.boxSizing === 'content-box' && styles.height && styles.height !== 'auto' && styles.height.endsWith('px')) {
      boxContentH = parseFloat(styles.height);
    }

    const targetW = (styles.width && styles.width !== 'auto' && styles.width.endsWith('px')) ? styles.width : rect.width;
    const targetH = (styles.height && styles.height !== 'auto' && styles.height.endsWith('px')) ? styles.height : rect.height;

    content.innerHTML = `
    <div class="css-inspector-section">
      <div class="css-inspector-section-title">Layout & Dimensions</div>
      ${renderInspectorRow('Tag', tag)}
      ${renderInspectorRow('Display', styles.display, 'display', el)}
      ${renderInspectorRow('Width', formatPx(targetW), 'width', el)}
      ${renderInspectorRow('Height', formatPx(targetH), 'height', el)}
      ${radiusHtml}
      ${paddingHtml}
      ${marginHtml}
      ${gapHtml}
    </div>

    ${typographyHtml}
    ${extraPropsHtml}
    ${animationSectionHtml}
    ${transitionSectionHtml}
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
                <span class="css-inspector-box-dims" data-side="content"><span style="color:#60a5fa;font-weight:600;">${formatDimension(boxContentW)}</span> × <span style="color:#2dd4bf;font-weight:600;">${formatDimension(boxContentH)}</span></span>
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
    if (animInfo || transInfo) {
      currentAnimTarget = animInfo ? animInfo.el : (transInfo ? transInfo.el : null);
      startOverlayAnimationTracking(currentAnimTarget || el);
    } else {
      currentAnimTarget = null;
      stopOverlayAnimationTracking();
    }
    try {
      chrome.runtime.sendMessage({ action: 'panelOpened', instanceId: myInstanceId });
    } catch (err) { }

    // Position panel reliably based on click or element bounding box
    const clientX = (e && typeof e.clientX === 'number' && (e.clientX > 0 || e.clientY > 0)) ? e.clientX : (rect.left + rect.width / 2);
    const clientY = (e && typeof e.clientY === 'number' && (e.clientX > 0 || e.clientY > 0)) ? e.clientY : (rect.top + rect.height / 2);

    const panelWidth = panel.offsetWidth || 340;
    const panelHeight = panel.offsetHeight || 420;

    let top = clientY + 15;
    let left = clientX + 15;

    // Check if it goes off bottom
    if (top + panelHeight > window.innerHeight) {
      top = clientY - panelHeight - 15;
    }

    // Check if it goes off right
    if (left + panelWidth > window.innerWidth) {
      left = clientX - panelWidth - 15;
    }

    // Final boundary checks just in case
    top = Math.max(10, top);
    left = Math.max(10, left);

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  // Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getState") {
      sendResponse({ isActive });
    } else if (request.action === 'hideOtherPanels') {
      if (request.instanceId !== myInstanceId) {
        closePanel();
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
