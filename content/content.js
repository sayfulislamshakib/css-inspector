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
let clickedOverlay = null;
let panel = null;
const collapsedSections = new Set();
let isFrameHovered = false;

let isDraggingPanel = false;
let dragStartX = 0;
let dragStartY = 0;
let initialPanelX = 0;
let initialPanelY = 0;

// Initialize
function init() {
  if (document.getElementById('css-inspector-overlay-container')) return;

  try {
    chrome.storage.local.get({ blockInteractions: true, pauseOnPopup: true }, (result) => {
      blockInteractions = result.blockInteractions;
      pauseOnPopup = result.pauseOnPopup;
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

  // Create overlay value labels container
  const overlayLabels = document.createElement('div');
  overlayLabels.id = 'css-inspector-overlay-labels';
  overlayLabels.innerHTML = `
    <span class="css-inspector-olabel" data-pos="margin-top"></span>
    <span class="css-inspector-olabel" data-pos="margin-right"></span>
    <span class="css-inspector-olabel" data-pos="margin-bottom"></span>
    <span class="css-inspector-olabel" data-pos="margin-left"></span>
    <span class="css-inspector-olabel" data-pos="padding-top"></span>
    <span class="css-inspector-olabel" data-pos="padding-right"></span>
    <span class="css-inspector-olabel" data-pos="padding-bottom"></span>
    <span class="css-inspector-olabel" data-pos="padding-left"></span>
    <span class="css-inspector-olabel" data-pos="content-dims"></span>
  `;
  overlay.appendChild(overlayLabels);

  document.body.appendChild(overlay);

  // Create clicked overlay
  clickedOverlay = document.createElement('div');
  clickedOverlay.id = 'css-inspector-clicked-overlay';
  document.body.appendChild(clickedOverlay);

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
    clickedOverlay.classList.remove('active');
    clickedTarget = null;
  });

  // Delegated click-to-copy for text values, color codes, and class names
  const contentEl = document.getElementById('css-inspector-content');
  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('select') || e.target.closest('.css-inspector-section-title')) return;

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
    if (!isActive) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();

      if (clickedTarget) {
        // Close popup and deselect element
        panel.classList.remove('active');
        clickedOverlay.classList.remove('active');
        clickedTarget = null;
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
    clickedOverlay.classList.remove('active');
    panel.classList.remove('active');
    currentTarget = null;
    clickedTarget = null;
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

  // Update clicked overlay (pink border) position
  if (clickedTarget) {
    const rect = clickedTarget.getBoundingClientRect();
    clickedOverlay.style.top = `${rect.top}px`;
    clickedOverlay.style.left = `${rect.left}px`;
    clickedOverlay.style.width = `${rect.width}px`;
    clickedOverlay.style.height = `${rect.height}px`;
  }

  // Update box model overlay (margin/padding/content)
  if (pauseOnPopup && clickedTarget) {
    // Paused on selection: keep box model overlay on the selected element
    updateOverlay(clickedTarget);
  } else if (currentTarget) {
    // Hovering: follow the hovered element
    updateOverlay(currentTarget);
  }
}

// Hover logic
function handleMouseMove(e) {
  if (!isActive || isDraggingPanel) return;

  const target = (e.composedPath && e.composedPath()[0]) || e.target;

  // Ignore our own UI elements
  if ((target.closest && target.closest('#css-inspector-panel')) || target === overlay || target === clickedOverlay) return;
  if (target.id && target.id.startsWith('css-inspector-')) return;

  if (target === currentTarget) return;
  currentTarget = target;

  if (!isFrameHovered) {
    isFrameHovered = true;
    try {
      chrome.runtime.sendMessage({ action: 'frameHovered', instanceId: myInstanceId });
    } catch (err) {}
  }

  // If paused on a selected element, don't move the box model overlay
  if (pauseOnPopup && clickedTarget) {
    return;
  }

  updateOverlay(target);
}

function updateOverlay(target) {
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
        lbl.textContent = mt > 0 ? `${Math.round(mt)}px` : '';
        lbl.style.top = `${top - mt / 2}px`;
        lbl.style.left = `${left + rect.width / 2}px`;
        break;
      case 'margin-bottom':
        lbl.textContent = mb > 0 ? `${Math.round(mb)}px` : '';
        lbl.style.top = `${top + rect.height + mb / 2}px`;
        lbl.style.left = `${left + rect.width / 2}px`;
        break;
      case 'margin-left':
        lbl.textContent = ml > 0 ? `${Math.round(ml)}px` : '';
        lbl.style.top = `${top + rect.height / 2}px`;
        lbl.style.left = `${left - ml / 2}px`;
        break;
      case 'margin-right':
        lbl.textContent = mr > 0 ? `${Math.round(mr)}px` : '';
        lbl.style.top = `${top + rect.height / 2}px`;
        lbl.style.left = `${left + rect.width + mr / 2}px`;
        break;
      // Padding labels
      case 'padding-top':
        lbl.textContent = pt > 0 ? `${Math.round(pt)}px` : '';
        lbl.style.top = `${top + bt + pt / 2}px`;
        lbl.style.left = `${contentCenterX}px`;
        break;
      case 'padding-bottom':
        lbl.textContent = pb > 0 ? `${Math.round(pb)}px` : '';
        lbl.style.top = `${top + rect.height - bb - pb / 2}px`;
        lbl.style.left = `${contentCenterX}px`;
        break;
      case 'padding-left':
        lbl.textContent = pl > 0 ? `${Math.round(pl)}px` : '';
        lbl.style.top = `${contentCenterY}px`;
        lbl.style.left = `${left + bl + pl / 2}px`;
        break;
      case 'padding-right':
        lbl.textContent = pr > 0 ? `${Math.round(pr)}px` : '';
        lbl.style.top = `${contentCenterY}px`;
        lbl.style.left = `${left + rect.width - br - pr / 2}px`;
        break;
      // Content dimensions
      case 'content-dims':
        lbl.textContent = `${Math.round(contentW)} × ${Math.round(contentH)}`;
        lbl.style.top = `${contentCenterY}px`;
        lbl.style.left = `${contentCenterX}px`;
        break;
    }
  });

  overlay.classList.add('active');
}

function showOverlayLabels(type) {
  const labels = overlay.querySelectorAll('.css-inspector-olabel');
  labels.forEach(lbl => {
    const pos = lbl.dataset.pos;
    if (pos.startsWith(type) || (type === 'content' && pos === 'content-dims')) {
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

  // If popup is showing and pauseOnPopup is true, the inspector is paused
  if (pauseOnPopup && clickedTarget) {
    return;
  }

  if (currentTarget) {
    clickedTarget = currentTarget;
    inspectElement(currentTarget, e);
  }
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
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  return '';
}

function renderInspectorRow(label, value, category = null, el = null) {
  let classHtml = '';
  if (category && el) {
    const cls = findPropertyClass(el, category);
    if (cls) {
      classHtml = `<span class="css-inspector-class-text">${cls}</span>`;
    }
  }

  return `
    <div class="css-inspector-row">
      <span class="css-inspector-label">${label}</span>
      <div class="css-inspector-value">
        <span class="css-inspector-value-text">${value}</span>
        ${classHtml}
      </div>
    </div>
  `;
}

function inspectElement(el, e) {
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
  if (styles.borderRadius && styles.borderRadius !== '0px') extraRows += renderInspectorRow('Radius', styles.borderRadius, 'radius', el);

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
        <div class="css-inspector-box css-inspector-box-margin">
          <span class="css-inspector-box-label">margin</span>
          <span class="css-inspector-box-val css-inspector-box-top">${formatBoxVal(styles.marginTop)}</span>
          <span class="css-inspector-box-val css-inspector-box-bottom">${formatBoxVal(styles.marginBottom)}</span>
          <span class="css-inspector-box-val css-inspector-box-left">${formatBoxVal(styles.marginLeft)}</span>
          <span class="css-inspector-box-val css-inspector-box-right">${formatBoxVal(styles.marginRight)}</span>

          <div class="css-inspector-box css-inspector-box-border">
            <span class="css-inspector-box-label">border</span>
            <span class="css-inspector-box-val css-inspector-box-top">${formatBoxVal(styles.borderTopWidth)}</span>
            <span class="css-inspector-box-val css-inspector-box-bottom">${formatBoxVal(styles.borderBottomWidth)}</span>
            <span class="css-inspector-box-val css-inspector-box-left">${formatBoxVal(styles.borderLeftWidth)}</span>
            <span class="css-inspector-box-val css-inspector-box-right">${formatBoxVal(styles.borderRightWidth)}</span>

            <div class="css-inspector-box css-inspector-box-padding">
              <span class="css-inspector-box-label">padding</span>
              <span class="css-inspector-box-val css-inspector-box-top">${formatBoxVal(styles.paddingTop)}</span>
              <span class="css-inspector-box-val css-inspector-box-bottom">${formatBoxVal(styles.paddingBottom)}</span>
              <span class="css-inspector-box-val css-inspector-box-left">${formatBoxVal(styles.paddingLeft)}</span>
              <span class="css-inspector-box-val css-inspector-box-right">${formatBoxVal(styles.paddingRight)}</span>

              <div class="css-inspector-box css-inspector-box-content">
                <span class="css-inspector-box-dims">${Math.round(rect.width)} × ${Math.round(rect.height)}</span>
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

  // Attach box model hover listeners for overlay labels
  const boxModelContainer = content.querySelector('.css-inspector-box-model');
  if (boxModelContainer) {
    boxModelContainer.addEventListener('mouseover', (e) => {
      const box = e.target.closest('.css-inspector-box');
      if (!box) {
        hideOverlayLabels();
        return;
      }
      
      if (box.classList.contains('css-inspector-box-content')) {
        showOverlayLabels('content');
      } else if (box.classList.contains('css-inspector-box-padding')) {
        showOverlayLabels('padding');
      } else if (box.classList.contains('css-inspector-box-border')) {
        hideOverlayLabels();
      } else if (box.classList.contains('css-inspector-box-margin')) {
        showOverlayLabels('margin');
      }
    });

    boxModelContainer.addEventListener('mouseout', (e) => {
      if (!boxModelContainer.contains(e.relatedTarget)) {
        hideOverlayLabels();
      }
    });
  }

  // Update clicked overlay (pink border) position
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
  } catch (err) {}

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
  } else if (request.action === "updateSettings") {
    if (request.blockInteractions !== undefined) blockInteractions = request.blockInteractions;
    if (request.pauseOnPopup !== undefined) pauseOnPopup = request.pauseOnPopup;
    sendResponse({ success: true });
  } else if (request.action === "updateBlockInteractions") {
    blockInteractions = request.value;
    sendResponse({ success: true });
  }
});

// Listen for storage changes to update settings in real-time across all tabs
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.blockInteractions !== undefined) {
      blockInteractions = changes.blockInteractions.newValue;
    }
    if (changes.pauseOnPopup !== undefined) {
      pauseOnPopup = changes.pauseOnPopup.newValue;
    }
  }
});

// Auto-init for message listener availability
init();
}
