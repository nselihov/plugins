// Token Inspector — поиск использования переменных Figma (цвет, spacing, radius, типографика и т.д.).
// Режим 1: токен → какие компоненты используют (+ клик = выделить компонент, + «из выделения»).
// Режим 2: выделенный компонент → какие токены использует.
// Кнопка: мёртвые токены (0 консумеров среди мастер-компонентов).

figma.showUI(__html__, { width: 380, height: 600, themeColors: true });

const GLYPH = ['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'STAR', 'POLYGON', 'LINE'];

function classify(node, prop) {
  if (prop === 'strokes') return 'stroke';
  if (node.type === 'TEXT') return 'text';
  if (GLYPH.indexOf(node.type) !== -1) return 'icon';
  return 'fill';
}
function hexOf(c) {
  if (!c || typeof c !== 'object' || !('r' in c)) return null;
  const h = n => Math.round(n * 255).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}
// резолв значения переменной по первому/Light режиму (следуем алиасам) — для свотча/подписи
function resolveRaw(v, byId, colById, guard) {
  guard = guard || 0;
  if (!v || guard > 10) return undefined;
  const col = colById[v.variableCollectionId];
  if (!col) return undefined;
  let modeId = col.modes[0].modeId;
  const light = col.modes.find(m => m.name === 'Light');
  if (light) modeId = light.modeId;
  const val = v.valuesByMode[modeId];
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    return resolveRaw(byId[val.id], byId, colById, guard + 1);
  }
  return val;
}
async function getMasters() {
  await figma.loadAllPagesAsync();
  const all = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
  return all.filter(m => !(m.type === 'COMPONENT' && m.parent && m.parent.type === 'COMPONENT_SET'));
}
function eachBoundPaint(node, cb) {
  for (const prop of ['fills', 'strokes']) {
    if (!(prop in node)) continue;
    const ps = node[prop];
    if (!ps || ps === figma.mixed) continue;
    for (const p of ps) {
      if (p && p.type === 'SOLID' && p.boundVariables && p.boundVariables.color) {
        cb(p.boundVariables.color.id, classify(node, prop));
      }
    }
  }
}
const PROP_LABEL = {
  itemSpacing: 'gap', counterAxisSpacing: 'gap',
  paddingLeft: 'padding', paddingRight: 'padding', paddingTop: 'padding', paddingBottom: 'padding',
  cornerRadius: 'radius', topLeftRadius: 'radius', topRightRadius: 'radius', bottomLeftRadius: 'radius', bottomRightRadius: 'radius',
  width: 'size', height: 'size', minWidth: 'size', maxWidth: 'size', minHeight: 'size', maxHeight: 'size',
  strokeWeight: 'stroke-w', strokeTopWeight: 'stroke-w', strokeBottomWeight: 'stroke-w', strokeLeftWeight: 'stroke-w', strokeRightWeight: 'stroke-w',
  opacity: 'opacity',
  fontSize: 'font-size', lineHeight: 'line-height', letterSpacing: 'tracking', paragraphSpacing: 'para-spacing', paragraphIndent: 'indent',
  visible: 'visible', characters: 'text-content'
};
// не-paint привязки (spacing/radius/size/opacity/типографика/visible) лежат плоско в node.boundVariables
function eachScalarVar(node, cb) {
  const bv = node.boundVariables;
  if (!bv) return;
  for (const key of Object.keys(bv)) {
    if (key === 'fills' || key === 'strokes') continue; // эти — через eachBoundPaint
    const val = bv[key];
    const label = PROP_LABEL[key] || key;
    if (Array.isArray(val)) { for (const it of val) if (it && it.id) cb(it.id, label); }
    else if (val && val.id) cb(val.id, label);
  }
}
function eachBoundVar(node, cb) {
  eachBoundPaint(node, cb);
  eachScalarVar(node, cb);
}

async function sendTokenList() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const colById = {}; cols.forEach(c => { colById[c.id] = c; });
  const vars = await figma.variables.getLocalVariablesAsync();
  const byId = {}; vars.forEach(v => { byId[v.id] = v; });
  const tokens = vars
    .map(v => {
      const raw = resolveRaw(v, byId, colById, 0);
      const isColor = v.resolvedType === 'COLOR';
      return {
        id: v.id, name: v.name,
        collection: (colById[v.variableCollectionId] || {}).name || '?',
        type: v.resolvedType,
        swatch: isColor ? hexOf(raw) : null,
        value: isColor || raw === undefined || raw === null ? null : String(raw)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const collections = cols.map(c => c.name).sort();
  figma.ui.postMessage({ type: 'token-list', tokens, collections });
}

function compOf(n) { // ближайший мастер (COMPONENT_SET или COMPONENT) над слоем, иначе null
  let c = n, comp = null;
  while (c && c.type !== 'PAGE') {
    if (c.type === 'COMPONENT_SET') return c;
    if (c.type === 'COMPONENT') comp = c;
    c = c.parent;
  }
  return comp;
}
async function scanToken(tokenId, allPages) {
  figma.skipInvisibleInstanceChildren = true;
  const comps = {};
  let seen = 0, curPage = 1, curTotal = 1;
  function tickMsg() { figma.ui.postMessage({ type: 'progress', page: curPage, total: curTotal, seen: seen }); }
  async function walkPage(page) {
    const stack = page.children.slice(); // ручной обход — не атомарный, можно прерывать
    while (stack.length) {
      const n = stack.pop();
      if ((++seen & 1023) === 0) { tickMsg(); await new Promise(function (r) { setTimeout(r, 0); }); }
      eachBoundVar(n, (id, cls) => {
        if (id !== tokenId) return;
        const comp = compOf(n);
        if (!comp) return;
        let e = comps[comp.name];
        if (!e) e = comps[comp.name] = { name: comp.name, id: comp.id, count: 0, kinds: {} };
        e.count++; e.kinds[cls] = (e.kinds[cls] || 0) + 1;
      });
      // НЕ спускаемся внутрь инстансов — там ячейки матриц, они наследуют от мастеров
      if ('children' in n && n.children && n.type !== 'INSTANCE') for (const c of n.children) stack.push(c);
    }
  }
  if (allPages) {
    const pages = figma.root.children;
    curTotal = pages.length;
    for (let i = 0; i < pages.length; i++) {
      curPage = i + 1; tickMsg();
      await pages[i].loadAsync();
      await walkPage(pages[i]);
    }
  } else {
    await walkPage(figma.currentPage);
  }
  const rows = Object.keys(comps).map(k => comps[k]).sort((a, b) => b.count - a.count);
  figma.ui.postMessage({ type: 'token-result', rows, total: rows.reduce((s, r) => s + r.count, 0) });
}

async function scanSelection() {
  const sel = figma.currentPage.selection;
  const vars = await figma.variables.getLocalVariablesAsync();
  const nameById = {}; vars.forEach(v => { nameById[v.id] = v.name; });
  const used = {};
  for (const root of sel) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      eachBoundVar(n, (id, cls) => {
        if (!used[id]) used[id] = { id: id, name: nameById[id] || null, deleted: !nameById[id], count: 0, kinds: {} };
        used[id].count++; used[id].kinds[cls] = (used[id].kinds[cls] || 0) + 1;
      });
      if ('children' in n && n.children) for (const c of n.children) stack.push(c);
    }
  }
  // повисшие/remote id: попробовать достать имя асинхронно
  for (const id of Object.keys(used)) {
    if (used[id].deleted) {
      try { const v = await figma.variables.getVariableByIdAsync(id); used[id].name = v ? v.name : id; }
      catch (e) { used[id].name = id; }
    }
  }
  const rows = Object.keys(used).map(k => used[k]).sort((a, b) => b.count - a.count);
  figma.ui.postMessage({ type: 'selection-result', rows, name: sel.length ? (sel.length === 1 ? sel[0].name : sel.length + ' узлов') : null });
}

// токены, встречающиеся в выделении — для «Из выделения» (режим 1)
async function selectionTokens() {
  const sel = figma.currentPage.selection;
  const vars = await figma.variables.getLocalVariablesAsync();
  const nameById = {}; vars.forEach(v => { nameById[v.id] = v.name; });
  const found = {};
  for (const root of sel) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      eachBoundVar(n, (id) => { if (nameById[id]) found[id] = nameById[id]; });
      if ('children' in n && n.children) for (const c of n.children) stack.push(c);
    }
  }
  const tokens = Object.keys(found).map(id => ({ id, name: found[id] })).sort((a, b) => a.name.localeCompare(b.name));
  figma.ui.postMessage({ type: 'selection-tokens', tokens });
}

async function scanDead() {
  figma.skipInvisibleInstanceChildren = true;
  const vars = await figma.variables.getLocalVariablesAsync();
  const usedIds = {};
  let seen = 0;
  const pages = figma.root.children;
  for (let i = 0; i < pages.length; i++) {
    figma.ui.postMessage({ type: 'progress-dead', page: i + 1, total: pages.length, seen: seen });
    await pages[i].loadAsync();
    const stack = pages[i].children.slice();
    while (stack.length) {
      const n = stack.pop();
      if ((++seen & 1023) === 0) { figma.ui.postMessage({ type: 'progress-dead', page: i + 1, total: pages.length, seen: seen }); await new Promise(function (r) { setTimeout(r, 0); }); }
      eachBoundVar(n, (id) => { usedIds[id] = 1; });
      if ('children' in n && n.children && n.type !== 'INSTANCE') for (const c of n.children) stack.push(c);
    }
  }
  const dead = vars.filter(v => !usedIds[v.id]).map(v => v.name).sort();
  figma.ui.postMessage({ type: 'dead-result', dead });
}

async function selectNode(id) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node) return;
  let p = node; while (p && p.type !== 'PAGE') p = p.parent;
  if (p && p.type === 'PAGE') await figma.setCurrentPageAsync(p);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'scan-token') await scanToken(msg.id, msg.allPages);
    else if (msg.type === 'scan-selection') await scanSelection();
    else if (msg.type === 'selection-tokens') await selectionTokens();
    else if (msg.type === 'scan-dead') await scanDead();
    else if (msg.type === 'select-node') await selectNode(msg.id);
    else if (msg.type === 'refresh') await sendTokenList();
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};

sendTokenList();
