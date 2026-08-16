if (!window.cssPeeperInjected) {
  window.cssPeeperInjected = true;

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
  
  let isDraggingPanel = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialPanelX = 0;
  let initialPanelY = 0;

// Initialize
function init() {
  if (document.getElementById('css-peeper-overlay-container')) return;

  try {
    chrome.storage.local.get({ blockInteractions: true, pauseOnPopup: true }, (result) => {
      blockInteractions = result.blockInteractions;
      pauseOnPopup = result.pauseOnPopup;
    });
  } catch (e) {}

  // Create overlay container
  overlay = document.createElement('div');
  overlay.id = 'css-peeper-overlay-container';

  overlayMargin = document.createElement('div');
  overlayMargin.id = 'css-peeper-overlay-margin';
  overlay.appendChild(overlayMargin);

  overlayPadding = document.createElement('div');
  overlayPadding.id = 'css-peeper-overlay-padding';
  overlay.appendChild(overlayPadding);

  overlayContent = document.createElement('div');
  overlayContent.id = 'css-peeper-overlay-content';
  overlay.appendChild(overlayContent);

  document.body.appendChild(overlay);

  // Create clicked overlay
  clickedOverlay = document.createElement('div');
  clickedOverlay.id = 'css-peeper-clicked-overlay';
  document.body.appendChild(clickedOverlay);

  // Create panel
  panel = document.createElement('div');
  panel.id = 'css-peeper-panel';
  panel.innerHTML = `
    <div class="css-peeper-header" id="css-peeper-header">
      <h3>Element Info</h3>
      <button class="css-peeper-close" id="css-peeper-close" title="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div id="css-peeper-content"></div>
  `;
  document.body.appendChild(panel);

  document.getElementById('css-peeper-close').addEventListener('click', () => {
    panel.classList.remove('active');
    overlay.classList.remove('active');
    clickedOverlay.classList.remove('active');
    clickedTarget = null;
  });

  const header = panel.querySelector('.css-peeper-header');
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.css-peeper-close')) return;
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
  
  // Intercept other actions
  const intercept = (e) => {
    if (!isActive || !blockInteractions) return;
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (target.closest && target.closest('#css-peeper-panel')) return;
    e.preventDefault();
    e.stopPropagation();
  };
  
  document.addEventListener('mousedown', intercept, true);
  document.addEventListener('mouseup', intercept, true);
  document.addEventListener('pointerdown', intercept, true);
  document.addEventListener('pointerup', intercept, true);
  document.addEventListener('submit', intercept, true);
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
    document.body.classList.remove('css-peeper-mode-active');
    showToast("Inspector: OFF");
  } else {
    document.body.classList.add('css-peeper-mode-active');
    showToast("Inspector: ON");
  }
}

function showToast(message) {
  let toast = document.getElementById('css-peeper-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'css-peeper-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  
  if (toast.timeoutId) clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Hover logic
function handleMouseMove(e) {
  if (!isActive || isDraggingPanel) return;
  
  if (pauseOnPopup && clickedTarget) {
    if (overlay) overlay.classList.remove('active');
    return;
  }

  const target = (e.composedPath && e.composedPath()[0]) || e.target;

  // Ignore our own UI
  if ((target.closest && target.closest('#css-peeper-panel')) || target === overlay || target === clickedOverlay) return;

  // Don't highlight the already clicked element
  if (target === clickedTarget) {
    overlay.classList.remove('active');
    currentTarget = target; // Keep track so click handler knows we are clicking the active target
    return;
  }

  if (target === currentTarget) return;

  currentTarget = target;

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

  const top = rect.top + window.scrollY;
  const left = rect.left + window.scrollX;

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
  
  overlay.classList.add('active');
}

// Click logic
function handleClick(e) {
  if (!isActive) return;

  const target = (e.composedPath && e.composedPath()[0]) || e.target;

  // If clicking inside panel, let it work normally
  if (target.closest && target.closest('#css-peeper-panel')) {
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
    if (overlay) overlay.classList.remove('active');
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
    '100': 'Thin',
    '200': 'Extra Light',
    '300': 'Light',
    '400': 'Regular',
    '500': 'Medium',
    '600': 'Semi Bold',
    '700': 'Bold',
    '800': 'Extra Bold',
    '900': 'Black'
  };
  if (weight === 'normal') return '400 (Regular)';
  if (weight === 'bold') return '700 (Bold)';
  return map[weight] ? `${weight} (${map[weight]})` : weight;
}

function inspectElement(el, e) {
  const styles = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  const content = document.getElementById('css-peeper-content');
  
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

  if (hasText) {
    addColor('Text', styles.color);
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
    let colorsHtml = colorsToShow.map(c => `
        <div class="css-peeper-row">
          <span class="css-peeper-label">${c.label}</span>
          <div class="css-peeper-color-wrap css-peeper-copyable" data-color="${c.hex}" title="Click to copy ${c.hex}">
            <span class="css-peeper-value">${c.hex}</span>
            <div class="css-peeper-color-box" style="background-color: ${c.hex}"></div>
          </div>
        </div>
    `).join('');
    
    colorsSectionHtml = `
      <div class="css-peeper-section">
        <div class="css-peeper-section-title">Colors</div>
        ${colorsHtml}
      </div>
    `;
  }

  const makeSelect = (prop, options, currentValue) => {
    return `
      <select class="css-peeper-select" data-prop="${prop}">
        ${options.map(opt => `<option value="${opt}" ${currentValue === opt ? 'selected' : ''}>${opt}</option>`).join('')}
      </select>
    `;
  };

  let extraPropsHtml = '';
  const extras = [];
  
  if (styles.opacity && styles.opacity !== '1') extras.push({ label: 'Opacity', value: styles.opacity });
  if (styles.boxShadow && styles.boxShadow !== 'none') extras.push({ label: 'Shadow', value: styles.boxShadow });
  if (styles.borderRadius && styles.borderRadius !== '0px') extras.push({ label: 'Radius', value: styles.borderRadius });
  
  if (styles.position && styles.position !== 'static') {
    extras.push({ label: 'Position', value: styles.position });
    if (styles.zIndex && styles.zIndex !== 'auto') extras.push({ label: 'Z-Index', value: styles.zIndex });
  }
  
  if (styles.display === 'flex' || styles.display === 'inline-flex') {
    if (styles.flexDirection && styles.flexDirection !== 'row') extras.push({ label: 'Direction', value: styles.flexDirection });
    
    const justifyOpts = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'normal'];
    const alignOpts = ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'normal'];
    
    extras.push({ label: 'Justify', value: makeSelect('justifyContent', justifyOpts, styles.justifyContent) });
    extras.push({ label: 'Align', value: makeSelect('alignItems', alignOpts, styles.alignItems) });
  }
  
  if (extras.length > 0) {
    extraPropsHtml = `
      <div class="css-peeper-section">
        <div class="css-peeper-section-title">Properties</div>
        ${extras.map(e => `
          <div class="css-peeper-row">
            <span class="css-peeper-label">${e.label}</span>
            <span class="css-peeper-value">${e.value}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  const rawRowGap = styles.rowGap || styles.gridRowGap || '0px';
  const rawColGap = styles.columnGap || styles.gridColumnGap || '0px';
  const rowGap = (rawRowGap === 'normal') ? '0px' : rawRowGap;
  const columnGap = (rawColGap === 'normal') ? '0px' : rawColGap;
  let gapHtml = '';
  
  if (rowGap === columnGap) {
    gapHtml = `
    <div class="css-peeper-row">
      <span class="css-peeper-label">Gap</span>
      <span class="css-peeper-value">${rowGap}</span>
    </div>`;
  } else {
    gapHtml = `
    <div class="css-peeper-row">
      <span class="css-peeper-label">Gap (Row/Col)</span>
      <span class="css-peeper-value">${rowGap} / ${columnGap}</span>
    </div>`;
  }

  let marginHtml = '';
  const mt = styles.marginTop, mr = styles.marginRight, mb = styles.marginBottom, ml = styles.marginLeft;
  if (mt !== '0px' || mr !== '0px' || mb !== '0px' || ml !== '0px') {
    if (mt === mr && mt === mb && mt === ml) {
      marginHtml = `<div class="css-peeper-row"><span class="css-peeper-label">Margin</span><span class="css-peeper-value">${mt}</span></div>`;
    } else {
      if (mt !== '0px') marginHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Margin Top</span><span class="css-peeper-value">${mt}</span></div>`;
      if (mr !== '0px') marginHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Margin Right</span><span class="css-peeper-value">${mr}</span></div>`;
      if (mb !== '0px') marginHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Margin Bottom</span><span class="css-peeper-value">${mb}</span></div>`;
      if (ml !== '0px') marginHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Margin Left</span><span class="css-peeper-value">${ml}</span></div>`;
    }
  }
  
  let paddingHtml = '';
  const pt = styles.paddingTop, pr = styles.paddingRight, pb = styles.paddingBottom, pl = styles.paddingLeft;
  if (pt !== '0px' || pr !== '0px' || pb !== '0px' || pl !== '0px') {
    if (pt === pr && pt === pb && pt === pl) {
      paddingHtml = `<div class="css-peeper-row"><span class="css-peeper-label">Padding</span><span class="css-peeper-value">${pt}</span></div>`;
    } else {
      if (pt !== '0px') paddingHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Padding Top</span><span class="css-peeper-value">${pt}</span></div>`;
      if (pr !== '0px') paddingHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Padding Right</span><span class="css-peeper-value">${pr}</span></div>`;
      if (pb !== '0px') paddingHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Padding Bottom</span><span class="css-peeper-value">${pb}</span></div>`;
      if (pl !== '0px') paddingHtml += `<div class="css-peeper-row"><span class="css-peeper-label">Padding Left</span><span class="css-peeper-value">${pl}</span></div>`;
    }
  }

  let typographyHtml = '';
  if (hasText) {
    typographyHtml = `
    <div class="css-peeper-section">
      <div class="css-peeper-section-title">Typography</div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Font</span>
        <span class="css-peeper-value">${styles.fontFamily.split(',')[0].replace(/['"]/g, '')}</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Size</span>
        <span class="css-peeper-value">${styles.fontSize}</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Weight</span>
        <span class="css-peeper-value">${getFontWeightName(styles.fontWeight)}</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Line Height</span>
        <span class="css-peeper-value">${styles.lineHeight}</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Align</span>
        <span class="css-peeper-value">${makeSelect('textAlign', ['start', 'end', 'left', 'right', 'center', 'justify'], styles.textAlign)}</span>
      </div>
    </div>`;
  }

  content.innerHTML = `
    <div class="css-peeper-section">
      <div class="css-peeper-section-title">Layout & Dimensions</div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Tag</span>
        <span class="css-peeper-value">${tag}</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Display</span>
        <span class="css-peeper-value">${styles.display}</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Width</span>
        <span class="css-peeper-value">${Math.round(rect.width)}px</span>
      </div>
      <div class="css-peeper-row">
        <span class="css-peeper-label">Height</span>
        <span class="css-peeper-value">${Math.round(rect.height)}px</span>
      </div>
      ${paddingHtml}
      ${marginHtml}
      ${gapHtml}
    </div>

    ${typographyHtml}
    ${extraPropsHtml}
    ${colorsSectionHtml}

    <div class="css-peeper-section">
      <div class="css-peeper-section-title">Box Model</div>
      <div class="css-peeper-box-model">
        <div class="css-peeper-box css-peeper-box-margin">
          <span class="css-peeper-box-label">margin</span>
          <span class="css-peeper-box-top">${styles.marginTop}</span>
          <span class="css-peeper-box-bottom">${styles.marginBottom}</span>
          <span class="css-peeper-box-left">${styles.marginLeft}</span>
          <span class="css-peeper-box-right">${styles.marginRight}</span>

          <div class="css-peeper-box css-peeper-box-padding">
            <span class="css-peeper-box-label">padding</span>
            <span class="css-peeper-box-top">${styles.paddingTop}</span>
            <span class="css-peeper-box-bottom">${styles.paddingBottom}</span>
            <span class="css-peeper-box-left">${styles.paddingLeft}</span>
            <span class="css-peeper-box-right">${styles.paddingRight}</span>

            <div class="css-peeper-box-content">
              ${Math.round(rect.width)} × ${Math.round(rect.height)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach collapsible section listeners
  const sectionTitles = content.querySelectorAll('.css-peeper-section-title');
  sectionTitles.forEach(title => {
    const titleText = title.textContent.trim();
    const section = title.closest('.css-peeper-section');
    
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
  const selects = content.querySelectorAll('.css-peeper-select');
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
          clickedOverlay.style.top = (newRect.top + window.scrollY) + 'px';
          clickedOverlay.style.left = (newRect.left + window.scrollX) + 'px';
        }, 10);
      }
    });
  });

  // Attach copy listeners
  const copyables = content.querySelectorAll('.css-peeper-copyable');
  copyables.forEach(el => {
    el.addEventListener('click', () => {
      const colorToCopy = el.dataset.color;
      navigator.clipboard.writeText(colorToCopy).then(() => {
        showToast(`Copied ${colorToCopy}`);
      }).catch(err => {
        console.error('Failed to copy: ', err);
      });
    });
  });

  // Update clicked overlay position
  clickedOverlay.style.top = `${rect.top + window.scrollY}px`;
  clickedOverlay.style.left = `${rect.left + window.scrollX}px`;
  clickedOverlay.style.width = `${rect.width}px`;
  clickedOverlay.style.height = `${rect.height}px`;
  clickedOverlay.classList.add('active');

  panel.classList.add('active');

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
  return true;
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
