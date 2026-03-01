// ─── Service Worker ───
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ─── PWA Install ───
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-btn').style.display = 'flex';
});
document.getElementById('install-btn').addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') document.getElementById('install-btn').style.display = 'none';
        deferredPrompt = null;
    } else {
        openModal('ios-install-modal');
    }
});

// ─── Helpers ───
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsArrayBuffer(file);
    });
}
function rgbToHex(r, g, b) {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

function showLoader(text = 'Processing...') {
    document.getElementById('loader-text').innerText = text;
    document.getElementById('loader-overlay').classList.add('visible');
}
function hideLoader() { document.getElementById('loader-overlay').classList.remove('visible'); }
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let _toastTimer;
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => { if (!t.classList.contains('show')) t.textContent = ''; }, 350);
    }, 2000);
}

// ─── Navigation ───
let isDirty = false;
let currentScreen = 'home';

function attemptNavHome() {
    if (isDirty) openModal('unsaved-modal');
    else navTo('home');
}
function confirmNavHome() {
    closeModal('unsaved-modal');
    isDirty = false;
    navTo('home');
}

function navTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId + '-screen').classList.add('active');
    currentScreen = screenId;

    const header  = document.getElementById('tool-header');
    const title   = document.getElementById('tool-title');
    const actions = document.getElementById('header-actions');

    if (screenId === 'home') { header.classList.remove('visible'); return; }
    header.classList.add('visible');

    if (screenId === 'editor') {
        title.innerText = 'Edit PDF';
        actions.innerHTML = `
            <button onclick="document.getElementById('upload-pdf').click()" class="btn btn-ghost">📄 Open PDF</button>
            <div class="page-nav">
                <button onclick="changePage(-1)" id="prev-btn" disabled>◀</button>
                <span id="page-info">—</span>
                <button onclick="changePage(1)" id="next-btn" disabled>▶</button>
            </div>
            <button onclick="openExportModal()" class="btn btn-success">💾 Save</button>
        `;
    } else if (screenId === 'organize') {
        title.innerText = 'Organize Pages';
        actions.innerHTML = `<button onclick="openSaveModal('organize')" class="btn btn-success">💾 <span class="btn-label">Save</span></button>`;
    } else if (screenId === 'merge') {
        title.innerText = 'Merge PDFs';
        actions.innerHTML = `
            <button onclick="document.getElementById('upload-merge').click()" class="btn btn-ghost">＋ <span class="btn-label">Add PDF</span></button>
            <button onclick="openSaveModal('merge')" class="btn btn-success">🔗 <span class="btn-label">Merge</span></button>
        `;
    } else if (screenId === 'split') {
        title.innerText = 'Extract Pages';
        actions.innerHTML = `
            <button onclick="selectAllSplitPages()" class="btn btn-ghost">☑ <span class="btn-label">All</span></button>
            <button onclick="openSaveModal('split')" class="btn btn-success">✂️ <span class="btn-label">Extract</span></button>
        `;
    }
}

let currentSaveAction = '';
function openSaveModal(action) {
    currentSaveAction = action;
    const defaults = { merge: 'Merged_Document', split: 'Extracted_Pages', organize: 'Organized_Document' };
    document.getElementById('save-filename').value = defaults[action] || 'Document';
    openModal('save-modal');
    document.getElementById('save-confirm-btn').onclick = () => {
        closeModal('save-modal');
        const name = document.getElementById('save-filename').value || defaults[action];
        if (action === 'organize') exportOrganizedPDF(name);
        else if (action === 'merge') exportMergedPDF(name);
        else if (action === 'split') exportSplitPDF(name);
    };
}

// ══════════════════════════════════════════
// MODULE 1: PDF EDITOR
// ══════════════════════════════════════════
const { jsPDF } = window.jspdf;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let canvas = new fabric.Canvas('main-canvas', {
    preserveObjectStacking: true,
    selection: false,
    allowTouchScrolling: true,
});

let sigCanvas, pdfDoc = null, pageNum = 1, currentZoom = 1;
let pageStates = {}, activeTool = 'pan';
let undoStack = [], redoStack = [];
let _suppressUndo = false;
let currentRawViewport = null;
let currentPageTextContent = null;
let bgCanvasData = null; 
const PDF_QUALITY = 2.0;

function pushUndo() {
    if (_suppressUndo) return;
    undoStack.push(JSON.stringify(canvas));
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
}

function undo() {
    if (!undoStack.length) { showToast('Nothing to undo'); return; }
    _suppressUndo = true;
    redoStack.push(JSON.stringify(canvas));
    canvas.loadFromJSON(undoStack.pop(), () => { canvas.renderAll(); _suppressUndo = false; hideObjActions(); });
    isDirty = true;
}

function redo() {
    if (!redoStack.length) { showToast('Nothing to redo'); return; }
    _suppressUndo = true;
    undoStack.push(JSON.stringify(canvas));
    canvas.loadFromJSON(redoStack.pop(), () => { canvas.renderAll(); _suppressUndo = false; hideObjActions(); });
    isDirty = true;
}

canvas.on('object:added',    () => { isDirty = true; pushUndo(); });
canvas.on('object:modified', () => { isDirty = true; pushUndo(); });
canvas.on('object:removed',  () => { isDirty = true; pushUndo(); });
canvas.on('path:created', function(opt) {
    isDirty = true;
    if (activeTool === 'highlighter') {
        opt.path.globalCompositeOperation = 'multiply';
        canvas.renderAll();
    }
});

// Color Selection via custom mobile palette
function selectColor(element, hex) {
    document.getElementById('colorPicker').value = hex;
    document.querySelectorAll('.color-dot').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    updateStyle();
}

const TOOLS_WITH_PROPS = new Set(['text', 'pen', 'highlighter', 'shape']);
function showToolBubble(toolName) {
    const bubble = document.getElementById('tool-bubble');
    document.getElementById('font-wrap').style.display = (toolName === 'text' || toolName === 'selected-text') ? 'flex' : 'none';
    document.getElementById('shape-wrap').style.display = (toolName === 'shape' || toolName === 'selected-shape') ? 'flex' : 'none';

    let btn = document.getElementById('tool-' + toolName);
    if (!btn && toolName.includes('selected')) {
        btn = document.getElementById('tool-pan'); 
    }

    const editorRect = document.getElementById('editor-screen').getBoundingClientRect();
    if (btn) {
        const btnRect = btn.getBoundingClientRect();
        const cx = btnRect.left + btnRect.width / 2 - editorRect.left;
        bubble.style.display = 'flex';
        bubble.style.bottom = '70px';
        requestAnimationFrame(() => {
            const bw = bubble.offsetWidth;
            let left = cx - bw / 2;
            left = Math.max(8, Math.min(left, editorRect.width - bw - 8));
            bubble.style.left = left + 'px';
            bubble.style.transform = 'none';
            const arrow = document.getElementById('bubble-arrow');
            arrow.style.left = (cx - left) + 'px';
        });
    } else {
        bubble.style.display = 'flex';
        bubble.style.left = '50%';
        bubble.style.transform = 'translateX(-50%)';
    }
}
function hideToolBubble() { document.getElementById('tool-bubble').style.display = 'none'; }

function showObjActions(obj) {
    const bar = document.getElementById('obj-actions');
    const wrapper = document.getElementById('canvas-wrapper');
    if (!obj) { hideObjActions(); return; }

    const bound = obj.getBoundingRect(true);
    const wrapperRect = wrapper.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const wrapperLeft = wrapperRect.left - workspaceRect.left + workspace.scrollLeft;
    const wrapperTop  = wrapperRect.top  - workspaceRect.top  + workspace.scrollTop;

    const objLeft = wrapperLeft + bound.left * currentZoom;
    const objTop  = wrapperTop  + bound.top  * currentZoom;
    const objW    = bound.width  * currentZoom;
    const objH    = bound.height * currentZoom;

    bar.style.display = 'flex';

    requestAnimationFrame(() => {
        const bw = bar.offsetWidth;
        let top = objTop + objH + 16; 
        let left = objLeft + objW / 2 - bw / 2;

        if (top + bar.offsetHeight > workspace.scrollTop + workspace.clientHeight) {
            top = objTop - bar.offsetHeight - 16;
            document.getElementById('obj-actions-arrow').style.top = 'auto';
            document.getElementById('obj-actions-arrow').style.bottom = '-7px';
            document.getElementById('obj-actions-arrow').style.transform = 'translateX(-50%) rotate(225deg)';
        } else {
            document.getElementById('obj-actions-arrow').style.top = '-7px';
            document.getElementById('obj-actions-arrow').style.bottom = 'auto';
            document.getElementById('obj-actions-arrow').style.transform = 'translateX(-50%) rotate(45deg)';
        }

        const maxLeft = workspace.scrollLeft + workspace.clientWidth - bw - 4;
        left = Math.max(workspace.scrollLeft + 4, Math.min(left, maxLeft));

        bar.style.top  = top  + 'px';
        bar.style.left = left + 'px';

        const arrow = document.getElementById('obj-actions-arrow');
        const cx = (objLeft + objW / 2) - left;
        arrow.style.left = Math.max(12, Math.min(cx, bw - 12)) + 'px';
    });
}
function hideObjActions() { document.getElementById('obj-actions').style.display = 'none'; }

function setTool(tool) {
    activeTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('tool-' + tool);
    if (btn) btn.classList.add('active');

    canvas.isDrawingMode = (tool === 'pen' || tool === 'highlighter');
    
    if (tool === 'pan') canvas.defaultCursor = 'grab';
    else if (tool === 'text') canvas.defaultCursor = 'text';
    else if (tool === 'scan') {
        canvas.defaultCursor = 'crosshair';
        showToast('Drag a box over text to scan');
    }
    else if (tool === 'sig-place') {
        canvas.defaultCursor = 'crosshair';
        showToast('Tap where you want to sign');
    }
    else canvas.defaultCursor = 'crosshair';

    if (TOOLS_WITH_PROPS.has(tool)) showToolBubble(tool);
    else hideToolBubble();

    hideObjActions();
    updateStyle();
}

// ─── Zoom & Page Navigation ───
function applyZoom() {
    const wrapper = document.getElementById('canvas-wrapper');
    const spacer  = document.getElementById('scroll-spacer');
    if (!canvas.width) return;

    const scaledW = canvas.width  * currentZoom;
    const scaledH = canvas.height * currentZoom;

    wrapper.style.transform = `scale(${currentZoom})`;
    spacer.style.minWidth  = (scaledW + 32) + 'px';
    spacer.style.minHeight = (scaledH + 32) + 'px';
    spacer.style.width  = '';
    spacer.style.height = '';
    setTimeout(() => canvas.calcOffset(), 40);
}

function setZoom(delta) {
    currentZoom = Math.max(0.15, Math.min(4, currentZoom + delta));
    applyZoom();
}

function changePage(offset) {
    if (!pdfDoc) return;
    const np = pageNum + offset;
    if (np > 0 && np <= pdfDoc.numPages) {
        pageStates[pageNum] = JSON.stringify(canvas);
        pageNum = np;
        hideObjActions();
        hideToolBubble();
        renderPage(pageNum);
    }
}

let initialPinchDistance = null;
let lastPinchZoom = 1;
const workspace = document.getElementById('workspace');

workspace.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault();
        initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        lastPinchZoom = currentZoom;
    }
}, { passive: false });

workspace.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialPinchDistance) {
        e.preventDefault();
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const scale = d / initialPinchDistance;
        currentZoom = Math.max(0.15, Math.min(4, lastPinchZoom * scale));
        applyZoom();
    }
}, { passive: false });

workspace.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) initialPinchDistance = null;
});

workspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        currentZoom = Math.max(0.15, Math.min(4, currentZoom + delta));
        applyZoom();
    }
}, { passive: false });

// ─── Drag, Scan, Text, Shape logic ───
let isDragging = false, lastPosX, lastPosY;
let isScanning = false, scanStartX = 0, scanStartY = 0, scanRectOverlay = null;

function setManipulating(val) {
    if (val) workspace.style.overflow = 'hidden';
    else workspace.style.overflow = 'auto';
}

canvas.on('mouse:down', function(opt) {
    const ptr = canvas.getPointer(opt.e);
    
    if (activeTool === 'scan') {
        isScanning = true;
        scanStartX = ptr.x;
        scanStartY = ptr.y;
        scanRectOverlay = new fabric.Rect({
            left: ptr.x, top: ptr.y, width: 0, height: 0,
            fill: 'rgba(108,99,255,0.3)', stroke: '#6c63ff', strokeWidth: 1,
            selectable: false, evented: false
        });
        canvas.add(scanRectOverlay);
        return;
    }

    if (activeTool === 'pan') {
        if (opt.target) { setManipulating(true); return; }
        if (!opt.e.touches || opt.e.touches.length === 1) {
            isDragging = true;
            canvas.defaultCursor = 'grabbing';
            lastPosX = opt.e.clientX ?? opt.e.touches?.[0].clientX;
            lastPosY = opt.e.clientY ?? opt.e.touches?.[0].clientY;
        }
    } else if (activeTool === 'text') {
        if (opt.target?.type === 'i-text') return;
        const obj = new fabric.IText('Tap to type', {
            left: ptr.x, top: ptr.y,
            fill: document.getElementById('colorPicker').value,
            fontSize: parseInt(document.getElementById('sizePicker').value) || 20,
            fontFamily: document.getElementById('fontFamily').value,
            originX: 'left', originY: 'top',
        });
        canvas.add(obj); canvas.setActiveObject(obj); canvas.renderAll();
        setTool('pan');
        setTimeout(() => { showObjActions(obj); syncToolbar(obj); }, 50);
    } else if (activeTool === 'shape') {
        const shapeType = document.getElementById('shapeType').value;
        const color = document.getElementById('colorPicker').value;
        const strokeW = Math.max(1, parseInt(document.getElementById('sizePicker').value) / 5);
        let obj;

        if (shapeType === 'rect') {
            obj = new fabric.Rect({ left: ptr.x-50, top: ptr.y-30, width: 100, height: 60, fill: 'transparent', stroke: color, strokeWidth: strokeW });
        } else if (shapeType === 'circle') {
            obj = new fabric.Circle({ left: ptr.x-40, top: ptr.y-40, radius: 40, fill: 'transparent', stroke: color, strokeWidth: strokeW });
        } else if (shapeType === 'triangle') {
            obj = new fabric.Triangle({ left: ptr.x-40, top: ptr.y-40, width: 80, height: 80, fill: 'transparent', stroke: color, strokeWidth: strokeW });
        } else if (shapeType === 'line') {
            obj = new fabric.Line([ptr.x, ptr.y, ptr.x + 100, ptr.y], { stroke: color, strokeWidth: strokeW });
        }

        if(obj) { canvas.add(obj); canvas.setActiveObject(obj); }
        setTool('pan');
    } else if (activeTool === 'sig-place') {
        setTool('pan');
        _pendingSigCenter = ptr;
        openModal('sig-modal');
        if (!sigCanvas) {
            sigCanvas = new fabric.Canvas('sig-canvas', { isDrawingMode: true });
            sigCanvas.freeDrawingBrush.width = 3;
            sigCanvas.freeDrawingBrush.color = '#000000';
        }
        sigCanvas.clear(); sigCanvas.renderAll();
    }
});

canvas.on('mouse:move', function(opt) {
    if (isScanning && scanRectOverlay) {
        const ptr = canvas.getPointer(opt.e);
        scanRectOverlay.set({
            width: Math.abs(ptr.x - scanStartX),
            height: Math.abs(ptr.y - scanStartY),
            left: Math.min(ptr.x, scanStartX),
            top: Math.min(ptr.y, scanStartY)
        });
        canvas.renderAll();
    } else if (isDragging && activeTool === 'pan') {
        const e  = opt.e;
        const cx = e.clientX ?? e.touches?.[0].clientX;
        const cy = e.clientY ?? e.touches?.[0].clientY;
        if (cx !== undefined) {
            workspace.scrollLeft -= (cx - lastPosX);
            workspace.scrollTop  -= (cy - lastPosY);
            lastPosX = cx; lastPosY = cy;
        }
    }
});

canvas.on('mouse:up', () => {
    isDragging = false;
    setManipulating(false);
    if (activeTool === 'pan') canvas.defaultCursor = 'grab';

    if (isScanning && scanRectOverlay) {
        isScanning = false;
        let bounds = scanRectOverlay.getBoundingRect();
        canvas.remove(scanRectOverlay);
        scanRectOverlay = null;

        if (bounds.width < 5 || bounds.height < 5) {
            showToast("Please drag a box over the text to scan");
            return;
        }
        executeScan(bounds);
    }
});

function executeScan(bounds) {
    if (!currentPageTextContent || !currentRawViewport || !bgCanvasData) {
        showToast("PDF data not available"); return;
    }

    let detectedFont = 'Arial';
    let detectedSize = 20;
    let foundText = false;

    let pdfYTop = currentRawViewport.height - bounds.top;
    let pdfYBot = currentRawViewport.height - (bounds.top + bounds.height);

    let maxFontSize = 0;
    for (let item of currentPageTextContent.items) {
        let tx = item.transform[4];
        let ty = item.transform[5];
        let th = Math.abs(item.transform[0]);
        let tw = item.width;

        if (tx + tw >= bounds.left && tx <= bounds.left + bounds.width && ty >= pdfYBot && ty <= pdfYTop) {
            if (th > maxFontSize) {
                maxFontSize = th;
                detectedSize = Math.round(th);
                let fontStr = item.fontName.toLowerCase();
                if (fontStr.includes('serif') || fontStr.includes('times')) detectedFont = 'Georgia';
                else if (fontStr.includes('mono') || fontStr.includes('courier')) detectedFont = 'Courier New';
                else detectedFont = 'Arial';
                foundText = true;
            }
        }
    }

    let detectedColor = "#000000";
    try {
        let sx = bounds.left * PDF_QUALITY;
        let sy = bounds.top * PDF_QUALITY;
        let sw = bounds.width * PDF_QUALITY;
        let sh = bounds.height * PDF_QUALITY;
        let imgData = bgCanvasData.getImageData(sx, sy, sw, sh).data;
        
        let colorCounts = {};
        let maxColor = "#000000";
        let maxCount = 0;

        for(let i=0; i<imgData.length; i+=16) {
            let r = imgData[i], g = imgData[i+1], b = imgData[i+2], a = imgData[i+3];
            if (a > 100 && (r < 230 || g < 230 || b < 230)) {
                let hex = rgbToHex(r,g,b);
                colorCounts[hex] = (colorCounts[hex] || 0) + 1;
                if (colorCounts[hex] > maxCount) {
                    maxCount = colorCounts[hex];
                    maxColor = hex;
                }
            }
        }
        if (maxCount > 0) detectedColor = maxColor;
    } catch (e) { console.warn("Pixel scan failed", e); }

    if (foundText) {
        document.getElementById('sizePicker').value = detectedSize;
        document.getElementById('fontFamily').value = detectedFont;
        selectColor(document.querySelector('.color-rainbow'), detectedColor);
        document.getElementById('colorPicker').value = detectedColor;
        showToast(`Matched: ${detectedSize}px ${detectedFont}`);
    } else {
        selectColor(document.querySelector('.color-rainbow'), detectedColor);
        document.getElementById('colorPicker').value = detectedColor;
        showToast(`Color picked: ${detectedColor}`);
    }
    
    setTool('text');
}

// ─── Double Tap to Select All (Overwrite Fix) ───
let _lastTapTarget = null, _lastTapTime = 0;

function enterTextEdit(obj) {
    if (!obj || obj.type !== 'i-text') return;
    canvas.setActiveObject(obj);
    obj.enterEditing();
    setTimeout(() => {
        obj.selectAll();
        canvas.renderAll();
    }, 50);
    showObjActions(obj);
}

canvas.on('mouse:dblclick', (opt) => {
    if (opt.target?.type === 'i-text') enterTextEdit(opt.target);
});

canvas.on('mouse:down', function(tapOpt) {
    const now = Date.now();
    const target = tapOpt.target;
    if (target?.type === 'i-text' && target === _lastTapTarget && (now - _lastTapTime) < 400) {
        enterTextEdit(target);
        _lastTapTime = 0; _lastTapTarget = null;
        return;
    }
    if (activeTool === 'pan') {
        _lastTapTarget = target || null;
        _lastTapTime   = now;
    }
});

// Object Events (Fixes mobile touch-drag blocking)
canvas.on('object:moving',   (opt) => { showObjActions(opt.target); });
canvas.on('object:scaling',  (opt) => { showObjActions(opt.target); });
canvas.on('object:rotating', (opt) => { showObjActions(opt.target); });

canvas.on('selection:created', (opt) => {
    syncToolbar(opt.selected?.[0] || canvas.getActiveObject());
    showObjActions(canvas.getActiveObject());
});
canvas.on('selection:updated', (opt) => {
    syncToolbar(canvas.getActiveObject());
    showObjActions(canvas.getActiveObject());
});
canvas.on('text:editing:entered', () => {
    const obj = canvas.getActiveObject();
    syncToolbar(obj);
    showObjActions(obj);
});
canvas.on('text:editing:exited', () => {
    showObjActions(canvas.getActiveObject());
});

workspace.addEventListener('scroll', () => {
    const obj = canvas.getActiveObject();
    if (obj) showObjActions(obj);
}, { passive: true });

canvas.on('selection:cleared', () => {
    hideObjActions();
    if (!TOOLS_WITH_PROPS.has(activeTool)) hideToolBubble();
});

function syncToolbar(obj) {
    obj = obj || canvas.getActiveObject();
    if (!obj) return;
    
    if (obj.type === 'i-text') {
        selectColor(document.querySelector('.color-rainbow'), obj.fill || '#000000');
        document.getElementById('sizePicker').value  = obj.fontSize || 20;
        document.getElementById('fontFamily').value  = obj.fontFamily || 'Arial';
        showToolBubble('selected-text');
    } else if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'triangle' || obj.type === 'line' || obj.type === 'path') {
        const col = obj.stroke || obj.fill || '#000000';
        selectColor(document.querySelector('.color-rainbow'), col !== 'transparent' ? col : '#000000');
        showToolBubble('selected-shape');
    }
}

// ─── Load PDF ───
document.getElementById('upload-pdf').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
        showLoader('Loading PDF...');
        const ab = await readFileAsArrayBuffer(file);
        pdfDoc = await pdfjsLib.getDocument(new Uint8Array(ab)).promise;
        pageNum = 1; pageStates = {}; isDirty = false; undoStack = []; redoStack = [];
        document.getElementById('editor-placeholder').style.display = 'none';
        document.getElementById('canvas-wrapper').style.display = 'block';
        await renderPage(pageNum, true);
        showToast('PDF loaded');
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to load PDF');
    } finally {
        hideLoader();
        e.target.value = '';
    }
});

async function renderPage(num, autoFit = false) {
    const page   = await pdfDoc.getPage(num);
    currentRawViewport = page.getViewport({ scale: 1 });
    currentPageTextContent = await page.getTextContent();

    if (autoFit) {
        await new Promise(r => setTimeout(r, 80));
        const availW = workspace.clientWidth  - 32;
        const availH = workspace.clientHeight - 32;
        let scaleToFit = Math.min(availW / currentRawViewport.width, availH / currentRawViewport.height);
        currentZoom = Math.min(scaleToFit, 1.0);
    }

    const hiVP = page.getViewport({ scale: PDF_QUALITY });
    const tmp  = document.createElement('canvas');
    tmp.width  = hiVP.width;
    tmp.height = hiVP.height;
    bgCanvasData = tmp.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: bgCanvasData, viewport: hiVP }).promise;

    canvas.clear();
    canvas.setDimensions({ width: currentRawViewport.width, height: currentRawViewport.height });

    const img = new fabric.Image(tmp, {
        scaleX: currentRawViewport.width  / hiVP.width,
        scaleY: currentRawViewport.height / hiVP.height,
    });
    
    canvas.setBackgroundImage(img, () => {
        canvas.renderAll();
        if (pageStates[num]) canvas.loadFromJSON(pageStates[num], canvas.renderAll.bind(canvas));
        applyZoom();
    });

    document.getElementById('page-info').textContent = `${num}/${pdfDoc.numPages}`;
    document.getElementById('prev-btn').disabled = (num <= 1);
    document.getElementById('next-btn').disabled = (num >= pdfDoc.numPages);
}

function updateStyle() {
    const color = document.getElementById('colorPicker').value;
    const size  = parseInt(document.getElementById('sizePicker').value) || 20;
    const font  = document.getElementById('fontFamily').value;
    const active = canvas.getActiveObject();

    if (active?.type === 'i-text') {
        active.set({ fill: color, fontSize: size, fontFamily: font });
        canvas.renderAll();
        isDirty = true;
    } else if (active?.type === 'rect' || active?.type === 'circle' || active?.type === 'triangle' || active?.type === 'line') {
        active.set({ stroke: color, strokeWidth: Math.max(1, size / 5) });
        canvas.renderAll();
        isDirty = true;
    } else if (active?.type === 'path') {
        active.set({ stroke: color });
        canvas.renderAll();
        isDirty = true;
    }

    if (activeTool === 'highlighter') {
        const r = parseInt(color.substr(1,2),16), g = parseInt(color.substr(3,2),16), b = parseInt(color.substr(5,2),16);
        canvas.freeDrawingBrush.color = `rgba(${r},${g},${b},0.35)`;
        canvas.freeDrawingBrush.width = size * 1.8;
    } else {
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = size / 4;
    }
}

function deleteSelected() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) { showToast('Nothing selected'); return; }
    canvas.discardActiveObject();
    objs.forEach(o => canvas.remove(o));
    isDirty = true;
    hideObjActions();
    showToast(`Deleted ${objs.length} object${objs.length > 1 ? 's' : ''}`);
}

function duplicateSelected() {
    const active = canvas.getActiveObject();
    if (!active) { showToast('Nothing selected'); return; }
    active.clone(cloned => {
        cloned.set({ left: active.left + 20, top: active.top + 20 });
        canvas.add(cloned);
        canvas.setActiveObject(cloned);
        isDirty = true;
    });
}

function handleImageUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = f => {
        fabric.Image.fromURL(f.target.result, img => {
            img.scaleToWidth(Math.min(200, canvas.width * 0.4));
            img.set({ left: canvas.width/2, top: canvas.height/2, originX: 'center', originY: 'center' });
            canvas.add(img); canvas.setActiveObject(img);
            setTool('pan'); isDirty = true;
        });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function openSignatureModal() {
    if (!pdfDoc) { showToast('Open a PDF first'); return; }
    setTool('sig-place');
}

function clearSignature() { if (sigCanvas) sigCanvas.clear(); }

function saveSignature() {
    if (!sigCanvas || !sigCanvas.getObjects().length) { closeModal('sig-modal'); return; }
    fabric.Image.fromURL(sigCanvas.toDataURL('image/png'), img => {
        const targetW = Math.min(180, canvas.width * 0.35);
        img.scaleToWidth(targetW);

        if (_pendingSigCenter) {
            img.set({ left: _pendingSigCenter.x, top: _pendingSigCenter.y, originX: 'center', originY: 'center' });
            _pendingSigCenter = null;
        } else {
            img.set({ left: canvas.width/2, top: canvas.height * 0.75, originX: 'center', originY: 'center' });
        }

        canvas.add(img); canvas.setActiveObject(img);
        setTool('pan'); isDirty = true;
        closeModal('sig-modal');
        showToast('Signature placed ✓');
    });
}

const STAMPS = [
    { label: 'APPROVED',     bg: '#16a34a' },
    { label: 'REJECTED',     bg: '#dc2626' },
    { label: 'DRAFT',        bg: '#ca8a04' },
    { label: 'CONFIDENTIAL', bg: '#7c3aed' },
    { label: 'REVIEWED',     bg: '#0284c7' },
    { label: 'SIGNED',       bg: '#0f766e' },
];

function insertStamp() {
    if (!pdfDoc) { showToast('Open a PDF first'); return; }
    const grid = document.getElementById('stamp-grid');
    grid.innerHTML = '';
    STAMPS.forEach(s => {
        const btn = document.createElement('button');
        btn.style.cssText = `background:${s.bg}22;border:2px solid ${s.bg}66;color:${s.bg};
            border-radius:10px;padding:12px 8px;font-weight:700;font-size:12px;letter-spacing:1px;
            cursor:pointer;font-family:var(--font-display);transition:all 0.2s;`;
        btn.textContent = s.label;
        btn.onclick = () => {
            const text = new fabric.Text(s.label, {
                left: canvas.width/2, top: canvas.height/2,
                originX: 'center', originY: 'center',
                fill: s.bg, fontSize: 36, fontFamily: 'Impact',
                opacity: 0.8, stroke: s.bg, strokeWidth: 1, angle: -15,
            });
            canvas.add(text); canvas.setActiveObject(text);
            setTool('pan'); isDirty = true;
            closeModal('stamp-modal');
            showToast(`${s.label} stamp added`);
        };
        grid.appendChild(btn);
    });
    openModal('stamp-modal');
}

function openExportModal() {
    if (!pdfDoc) { showToast('Open a PDF first'); return; }
    openModal('export-modal');
}

async function executeExport() {
    closeModal('export-modal');
    showLoader('Exporting...');
    const name   = document.getElementById('export-name').value || 'Edited_Document';
    const format = document.getElementById('export-format').value;
    await new Promise(r => setTimeout(r, 50));

    if (format === 'png') {
        const a = document.createElement('a');
        a.href = canvas.toDataURL({ format: 'png', quality: 1 });
        a.download = name + '.png';
        a.click();
        showToast('Page exported as PNG ✓');
    } else {
        pageStates[pageNum] = JSON.stringify(canvas);
        let pdf = null;
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const vp   = page.getViewport({ scale: 2 });
            const tmp  = document.createElement('canvas');
            tmp.width = vp.width; tmp.height = vp.height;
            await page.render({ canvasContext: tmp.getContext('2d'), viewport: vp }).promise;
            const sc = new fabric.StaticCanvas(null, { width: vp.width, height: vp.height });
            await new Promise(res => {
                sc.setBackgroundImage(new fabric.Image(tmp), () => {
                    if (pageStates[i]) sc.loadFromJSON(pageStates[i], () => { sc.renderAll(); res(); });
                    else res();
                });
            });
            const imgData = sc.toDataURL('image/jpeg', 0.85);
            const orient  = vp.width > vp.height ? 'l' : 'p';
            if (i === 1) pdf = new jsPDF({ orientation: orient, unit: 'px', format: [vp.width, vp.height] });
            else pdf.addPage([vp.width, vp.height], orient);
            pdf.addImage(imgData, 'JPEG', 0, 0, vp.width, vp.height);
        }
        const blob = pdf.output('blob');
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = name + '.pdf';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('PDF saved ✓');
    }
    isDirty = false;
    hideLoader();
}

document.addEventListener('keydown', e => {
    if (currentScreen !== 'editor') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canvas.getActiveObject()?.isEditing) { e.preventDefault(); deleteSelected(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelected(); }
    if (e.key === 'ArrowLeft')  changePage(-1);
    if (e.key === 'ArrowRight') changePage(1);
});

// ══════════════════════════════════════════
// MODULE 2: ORGANIZE
// ══════════════════════════════════════════
let orgPdfDoc = null, orgPdfJsDoc = null, orgPageArray = [];

document.getElementById('upload-org').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
        showLoader('Loading pages...');
        document.getElementById('org-upload-box').style.display = 'none';
        isDirty = false;
        const ab = await readFileAsArrayBuffer(file);
        orgPdfDoc   = await PDFLib.PDFDocument.load(ab);
        orgPdfJsDoc = await pdfjsLib.getDocument(new Uint8Array(ab)).promise;
        orgPageArray = Array.from({ length: orgPdfJsDoc.numPages }, (_, i) => i);
        await renderOrganizeGrid();
        showToast(orgPdfJsDoc.numPages + ' pages loaded');
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to read PDF');
        document.getElementById('org-upload-box').style.display = '';
    } finally {
        hideLoader();
        e.target.value = '';
    }
});

async function renderOrganizeGrid() {
    const grid = document.getElementById('thumbnail-grid');
    grid.innerHTML = '';
    for (let i = 0; i < orgPageArray.length; i++) {
        const page   = await orgPdfJsDoc.getPage(orgPageArray[i] + 1);
        const vp     = page.getViewport({ scale: 0.3 });
        const fullVP = page.getViewport({ scale: 1.2 });

        const wrap = document.createElement('div');
        wrap.className = 'thumb-card';

        const badge = document.createElement('div');
        badge.className = 'thumb-badge';
        badge.textContent = i + 1;
        wrap.appendChild(badge);

        const tc = document.createElement('canvas');
        tc.width = vp.width; tc.height = vp.height;
        tc.style.borderRadius = '6px';
        await page.render({ canvasContext: tc.getContext('2d'), viewport: vp }).promise;
        wrap.appendChild(tc);

        const preview = document.createElement('div');
        preview.className = 'preview-popup';
        const pc = document.createElement('canvas');
        pc.width = fullVP.width; pc.height = fullVP.height;
        pc.style.maxWidth = '75vw'; pc.style.maxHeight = '65vh';
        page.render({ canvasContext: pc.getContext('2d'), viewport: fullVP });
        preview.appendChild(pc);
        wrap.appendChild(preview);

        const controls = document.createElement('div');
        controls.className = 'thumb-controls';
        controls.innerHTML = `
            <button class="thumb-ctrl-btn" onclick="movePage(${i},-1)">◀</button>
            <button class="thumb-ctrl-btn del" onclick="deletePage(${i})">✕</button>
            <button class="thumb-ctrl-btn" onclick="movePage(${i},1)">▶</button>
        `;
        wrap.appendChild(controls);
        grid.appendChild(wrap);
    }
}

function movePage(index, dir) {
    const ni = index + dir;
    if (ni < 0 || ni >= orgPageArray.length) return;
    [orgPageArray[index], orgPageArray[ni]] = [orgPageArray[ni], orgPageArray[index]];
    isDirty = true;
    renderOrganizeGrid();
}

function deletePage(index) {
    orgPageArray.splice(index, 1);
    isDirty = true;
    if (!orgPageArray.length) {
        document.getElementById('org-upload-box').style.display = '';
        document.getElementById('thumbnail-grid').innerHTML = '';
        orgPdfDoc = null;
        showToast('All pages deleted');
    } else {
        renderOrganizeGrid();
        showToast('Page deleted');
    }
}

async function exportOrganizedPDF(filename) {
    if (!orgPdfDoc || !orgPageArray.length) return;
    showLoader('Saving...');
    try {
        const newPdf = await PDFLib.PDFDocument.create();
        const pages  = await newPdf.copyPages(orgPdfDoc, orgPageArray);
        pages.forEach(p => newPdf.addPage(p));
        triggerDownload(await newPdf.save(), filename + '.pdf');
        isDirty = false;
        showToast('PDF saved ✓');
    } catch (e) { console.error(e); showToast('❌ Export failed'); }
    hideLoader();
}

// ══════════════════════════════════════════
// MODULE 3: MERGE
// ══════════════════════════════════════════
let mergeFiles = [];

document.getElementById('upload-merge').addEventListener('change', e => {
    mergeFiles = mergeFiles.concat(Array.from(e.target.files));
    isDirty = true;
    e.target.value = '';
    renderMergeList();
    showToast(mergeFiles.length + ' file' + (mergeFiles.length !== 1 ? 's' : '') + ' queued');
});

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
}

function renderMergeList() {
    const list = document.getElementById('merge-list');
    list.innerHTML = '';
    mergeFiles.forEach((file, i) => {
        const item = document.createElement('div');
        item.className = 'merge-item';
        item.innerHTML = `
            <div class="merge-item-name">
                <div class="merge-item-icon">📄</div>
                <div class="merge-item-text">
                    <div class="fname">${file.name}</div>
                    <div class="fsize">${formatBytes(file.size)}</div>
                </div>
            </div>
            <div class="merge-controls">
                <button class="btn btn-ghost" onclick="moveMergeFile(${i},-1)" style="padding:5px 8px">🔼</button>
                <button class="btn btn-ghost" onclick="moveMergeFile(${i},1)"  style="padding:5px 8px">🔽</button>
                <button class="btn btn-danger" onclick="removeMergeFile(${i})" style="padding:5px 10px">✕</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function moveMergeFile(i, dir) {
    const ni = i + dir;
    if (ni < 0 || ni >= mergeFiles.length) return;
    [mergeFiles[i], mergeFiles[ni]] = [mergeFiles[ni], mergeFiles[i]];
    isDirty = true;
    renderMergeList();
}

function removeMergeFile(i) {
    mergeFiles.splice(i, 1);
    isDirty = true;
    renderMergeList();
    showToast('File removed');
}

async function exportMergedPDF(filename) {
    if (mergeFiles.length < 2) { showToast('Add at least 2 PDFs to merge'); return; }
    showLoader('Merging PDFs...');
    try {
        const merged = await PDFLib.PDFDocument.create();
        for (const file of mergeFiles) {
            const ab  = await readFileAsArrayBuffer(file);
            const pdf = await PDFLib.PDFDocument.load(ab);
            const pgs = await merged.copyPages(pdf, pdf.getPageIndices());
            pgs.forEach(p => merged.addPage(p));
        }
        triggerDownload(await merged.save(), filename + '.pdf');
        isDirty = false;
        showToast('Merged PDF saved ✓');
    } catch (e) { console.error(e); showToast('❌ Merge failed'); }
    hideLoader();
}

// ══════════════════════════════════════════
// MODULE 4: SPLIT / EXTRACT
// ══════════════════════════════════════════
let splitSelectedPages = new Set();

document.getElementById('upload-split').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
        showLoader('Loading pages...');
        document.getElementById('split-upload-box').style.display = 'none';
        isDirty = false;
        const ab = await readFileAsArrayBuffer(file);
        orgPdfDoc   = await PDFLib.PDFDocument.load(ab);
        orgPdfJsDoc = await pdfjsLib.getDocument(new Uint8Array(ab)).promise;
        splitSelectedPages.clear();

        const grid = document.getElementById('split-grid');
        grid.innerHTML = '';
        for (let i = 0; i < orgPdfJsDoc.numPages; i++) {
            const page   = await orgPdfJsDoc.getPage(i + 1);
            const vp     = page.getViewport({ scale: 0.3 });
            const fullVP = page.getViewport({ scale: 1.2 });

            const wrap = document.createElement('div');
            wrap.className = 'thumb-card';
            wrap.title = 'Click to select page ' + (i + 1);

            const badge = document.createElement('div');
            badge.className = 'thumb-badge';
            badge.id = `split-badge-${i}`;
            badge.textContent = i + 1;
            wrap.appendChild(badge);

            const tc = document.createElement('canvas');
            tc.width = vp.width; tc.height = vp.height;
            tc.style.borderRadius = '6px';
            await page.render({ canvasContext: tc.getContext('2d'), viewport: vp }).promise;
            wrap.appendChild(tc);

            const preview = document.createElement('div');
            preview.className = 'preview-popup';
            const pc = document.createElement('canvas');
            pc.width = fullVP.width; pc.height = fullVP.height;
            pc.style.maxWidth = '75vw'; pc.style.maxHeight = '65vh';
            page.render({ canvasContext: pc.getContext('2d'), viewport: fullVP });
            preview.appendChild(pc);
            wrap.appendChild(preview);

            wrap.onclick = () => {
                isDirty = true;
                if (splitSelectedPages.has(i)) {
                    splitSelectedPages.delete(i);
                    wrap.classList.remove('selected');
                } else {
                    splitSelectedPages.add(i);
                    wrap.classList.add('selected');
                }
                updateSplitCount();
            };
            grid.appendChild(wrap);
        }
        showToast(orgPdfJsDoc.numPages + ' pages loaded — tap to select');
    } catch (err) {
        console.error(err);
        showToast('❌ Failed to load PDF');
        document.getElementById('split-upload-box').style.display = '';
    } finally {
        hideLoader();
        e.target.value = '';
    }
});

function updateSplitCount() {
    const n = splitSelectedPages.size;
    const btn = document.querySelector('#header-actions .btn-success');
    if (btn) btn.innerHTML = n > 0 ? `✂️ <span class="btn-label">Extract (${n})</span>` : '✂️ <span class="btn-label">Extract</span>';
}

function selectAllSplitPages() {
    const grid  = document.getElementById('split-grid');
    const cards = grid.querySelectorAll('.thumb-card');
    const allSelected = splitSelectedPages.size === cards.length;
    splitSelectedPages.clear();
    cards.forEach((card, i) => {
        if (!allSelected) { splitSelectedPages.add(i); card.classList.add('selected'); }
        else card.classList.remove('selected');
    });
    updateSplitCount();
    showToast(allSelected ? 'All deselected' : `All ${cards.length} pages selected`);
}

async function exportSplitPDF(filename) {
    if (!orgPdfDoc || !splitSelectedPages.size) { showToast('Select at least one page'); return; }
    showLoader('Extracting...');
    try {
        const newPdf = await PDFLib.PDFDocument.create();
        const sorted = [...splitSelectedPages].sort((a, b) => a - b);
        const pages  = await newPdf.copyPages(orgPdfDoc, sorted);
        pages.forEach(p => newPdf.addPage(p));
        triggerDownload(await newPdf.save(), filename + '.pdf');
        isDirty = false;
        showToast(`${sorted.length} page${sorted.length > 1 ? 's' : ''} extracted ✓`);
    } catch (e) { console.error(e); showToast('❌ Extract failed'); }
    hideLoader();
}

// ─── Utils ───
function triggerDownload(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Expose all to window ───
window.navTo               = navTo;
window.attemptNavHome      = attemptNavHome;
window.confirmNavHome      = confirmNavHome;
window.closeModal          = closeModal;
window.openModal           = openModal;
window.openSaveModal       = openSaveModal;
window.openExportModal     = openExportModal;
window.executeExport       = executeExport;
window.setTool             = setTool;
window.setZoom             = setZoom;
window.changePage          = changePage;
window.deleteSelected      = deleteSelected;
window.duplicateSelected   = duplicateSelected;
window.openSignatureModal  = openSignatureModal;
window.clearSignature      = clearSignature;
window.saveSignature       = saveSignature;
window.handleImageUpload   = handleImageUpload;
window.movePage            = movePage;
window.deletePage          = deletePage;
window.moveMergeFile       = moveMergeFile;
window.removeMergeFile     = removeMergeFile;
window.selectAllSplitPages = selectAllSplitPages;
window.undo                = undo;
window.redo                = redo;
window.updateStyle         = updateStyle;
window.selectColor         = selectColor;
window.insertStamp         = insertStamp;