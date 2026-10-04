// 粉專出片機・貼文圖網頁版
// 畫法全部照桌面版 出片機\core.ps1（Draw-BubbleText／Draw-Text／Add-Date／Draw-InFrame／
// Pick-BestRatio／Convert-Overlay45／Get-FitMode），數字一樣，出來的圖才會一樣。
// 照片只在瀏覽器裡處理，不會上傳。
'use strict';

const FRAME_PAD = 26;      // 照片四邊等距內縮
const FRAME_BORDER = 5;    // 外圈白框
const FONT = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
const $ = (s) => document.querySelector(s);

let DATA = null;
let client = null;
let pickedTpl = '';        // '' = 自動
let photos = [];           // File[]
let firstBitmap = null;    // 第一張照片（預覽用）
const imgCache = new Map();

// ───────── 工具 ─────────
// 讀圖：失敗會自動再試一次；失敗的結果不記住，下次重新讀（網路不穩、網站剛更新時都會碰到）
function loadImgOnce(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('圖片讀不到：' + src));
    im.src = src;
  });
}
function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = loadImgOnce(src)
    .catch(() => new Promise((r) => setTimeout(r, 800)).then(() => loadImgOnce(src + (src.includes('?') ? '&' : '?') + 'retry=' + Date.now())));
  imgCache.set(src, p);
  p.catch(() => imgCache.delete(src));
  return p;
}
function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// PowerShell 的 [int] 與 [Math]::Round 遇到 .5 是「捨入到偶數」（116.5→116、117.5→118），
// 跟 JavaScript 的 Math.round（一律進位）不同；差 1px 照片就整張錯位，所以照 .NET 的規則
const R = (v) => {
  const f = Math.floor(v), d = v - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return d > 0.5 ? f + 1 : f;
};

function bbox(ctx, text, font) {
  ctx.font = font;
  const m = ctx.measureText(text);
  return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent,
           d: m.actualBoundingBoxDescent, w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
           h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
}

async function ensureFonts(texts) {
  if (!document.fonts || !document.fonts.load) return;
  const t = texts.join('') + '0123456789.';
  try {
    await Promise.all([
      document.fonts.load(`900 100px "Noto Sans TC"`, t),
      document.fonts.load(`400 100px "Noto Sans TC"`, t),
    ]);
  } catch (e) { /* 載不到就用備用字型 */ }
}

// ───────── 泡泡字（Draw-BubbleText）─────────
function bubbleText(ctx, text, cx, cy, targetW, maxEm, fillHex) {
  if (!text) return;
  const F = (em) => `900 ${em}px ${FONT}`;
  const w0 = Math.max(bbox(ctx, text, F(100)).w, 1);
  const em = Math.min(maxEm, Math.floor(100 * (targetW - 40) / w0));
  const b = bbox(ctx, text, F(em));
  const X = cx - (b.r - b.l) / 2, Y = cy - (b.d - b.a) / 2;
  const top = R(cy - b.h / 2) - 4, bot = R(cy + b.h / 2) + 4;
  ctx.save();
  ctx.font = F(em); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round'; ctx.miterLimit = 1;
  // 陰影
  const so = Math.max(5, R(em * 0.10));
  ctx.strokeStyle = 'rgba(0,0,0,0.3725)'; ctx.lineWidth = Math.max(10, R(em * 0.28));
  ctx.strokeText(text, X, Y + so);
  ctx.fillStyle = 'rgba(0,0,0,0.3725)'; ctx.fillText(text, X, Y + so);
  // 白厚框
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(9, R(em * 0.26));
  ctx.strokeText(text, X, Y);
  ctx.fillStyle = '#fff'; ctx.fillText(text, X, Y);
  // 漸層（上淺下深）
  const [r, g, bl] = hexToRgb(fillHex);
  const light = `rgb(${R(r * .55 + 255 * .45)},${R(g * .55 + 255 * .45)},${R(bl * .55 + 255 * .45)})`;
  const grad = ctx.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, light); grad.addColorStop(1, fillHex);
  ctx.fillStyle = grad; ctx.fillText(text, X, Y);
  ctx.restore();
}

// ───────── 平字（Draw-Text，無描邊）─────────
function plainText(ctx, text, cx, cy, targetW, maxEm, fill) {
  if (!text) return;
  const F = (em) => `400 ${em}px ${FONT}`;
  const w0 = Math.max(bbox(ctx, text, F(100)).w, 1);
  const em = Math.min(maxEm, Math.floor(100 * targetW / w0));
  const b = bbox(ctx, text, F(em));
  ctx.save();
  ctx.font = F(em); ctx.textBaseline = 'alphabetic'; ctx.fillStyle = fill;
  ctx.fillText(text, cx - (b.r - b.l) / 2, cy - (b.d - b.a) / 2);
  ctx.restore();
}

// ───────── 日期膠囊（Add-Date）─────────
function dateLabel(ctx, dateText, spot) {
  const F = `900 28px ${FONT}`;
  const b = bbox(ctx, dateText, F);
  const pillW = R(b.w + 40), pillH = 50;
  let px = 12, py = 1908 - pillH;
  if (spot && spot.length >= 2) { px = spot[0]; py = spot[1]; }
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4706)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, py, pillW, pillH, 25);
  else ctx.rect(px, py, pillW, pillH);
  ctx.fill();
  ctx.font = F; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(255,255,255,0.902)';
  ctx.fillText(dateText, px + 20 + b.l, py + pillH / 2 - (b.d - b.a) / 2);
  ctx.restore();
}

// ───────── 圖層：模板 + 文字框 + 日期（Build-TemplateOverlay）─────────
async function buildOverlay(cl, tpl, title, dateText) {
  const im = await loadImg(tpl.png);
  const c = canvas(1080, 1920), ctx = c.getContext('2d');
  ctx.drawImage(im, 0, 0, 1080, 1920);
  for (const bx of tpl.boxes || []) {
    let txt = String(bx.text).replace('@title', title).replace('@slogan', cl.slogan || '')
      .replace('@name', cl.name || '').replace('@short', cl.short || '');
    if (!txt.trim()) continue;
    const maxEm = bx.maxEm ? +bx.maxEm : 120;
    const cx = R(+bx.x + +bx.w / 2), cy = R(+bx.y + +bx.h / 2);
    if ('stroke' in bx && !bx.stroke) plainText(ctx, txt, cx, cy, +bx.w - 20, maxEm, bx.color || '#FFFFFF');
    else bubbleText(ctx, txt, cx, cy, +bx.w, maxEm, bx.color || cl.color);
  }
  dateLabel(ctx, dateText, tpl.dateSpot);
  return { cv: c, top: tpl.top, bot: tpl.bot, left: tpl.left, right: tpl.right, matte: tpl.matte, shiftY: tpl.shiftY, H: 1920 };
}

// ───────── 9:16 → 4:5（Convert-Overlay45）─────────
function to45(ov) {
  const H45 = 1350, botH = 1920 - ov.bot, topH = ov.top;
  const c = canvas(1080, H45), ctx = c.getContext('2d');
  if (topH > 0) ctx.drawImage(ov.cv, 0, 0, 1080, topH, 0, 0, 1080, topH);
  if (botH > 0) ctx.drawImage(ov.cv, 0, ov.bot, 1080, botH, 0, H45 - botH, 1080, botH);
  return { ...ov, cv: c, top: topH, bot: H45 - botH, H: H45 };
}

// ───────── 自動挑比例（Pick-BestRatio）─────────
function pickRatio(imgW, imgH, ov) {
  const winW = ov.right - ov.left, h916 = ov.bot - ov.top;
  const h45 = 1350 - ov.top - (1920 - ov.bot);
  if (h45 < 200) return 'reels';
  const waste = (w, h) => { const s = Math.min(w / imgW, h / imgH); return 1 - (imgW * s) * (imgH * s) / (w * h); };
  return waste(winW, h45) < waste(winW, h916) - 0.02 ? 'feed' : 'reels';
}

// ───────── 裁或不裁（Get-FitMode）─────────
function fitMode(imgW, imgH, winW, winH, fit) {
  if (fit === 'cover' || fit === 'contain') return fit;
  const s = Math.max(winW / imgW, winH / imgH);
  const loss = 1 - (winW / (imgW * s)) * (winH / (imgH * s));
  return loss > 0.08 ? 'contain' : 'cover';
}

// ───────── 照片放進框裡（Draw-InFrame）─────────
function drawInFrame(ctx, img, x, y, w, h, fit, shiftY) {
  const W = img.width, H = img.height;
  let iw = w - 2 * FRAME_PAD, ih = h - 2 * FRAME_PAD;
  if (iw < 40 || ih < 40) { iw = w; ih = h; }
  const mode = fitMode(W, H, iw, ih, fit);
  let dx, dy, dw, dh;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (mode === 'cover') {
    dw = iw; dh = ih; dx = x + FRAME_PAD; dy = y + FRAME_PAD + shiftY;
    const s = Math.max(iw / W, ih / H), sw = iw / s, sh = ih / s;
    ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh, dx, dy, dw, dh);
  } else {
    const s = Math.min(iw / W, ih / H);
    dw = R(W * s); dh = R(H * s);
    dx = R(x + (w - dw) / 2); dy = R(y + (h - dh) / 2) + shiftY;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  if (FRAME_BORDER > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8824)'; ctx.lineWidth = FRAME_BORDER;
    ctx.strokeRect(dx + FRAME_BORDER / 2, dy + FRAME_BORDER / 2, dw - FRAME_BORDER, dh - FRAME_BORDER);
  }
  return mode;
}

// ───────── 合成一張（Build-PreviewImage）─────────
function compose(img, ov, fit, target) {
  const c = target || canvas(1080, ov.H);
  c.width = 1080; c.height = ov.H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ov.matte; ctx.fillRect(0, 0, 1080, ov.H);
  const mode = drawInFrame(ctx, img, ov.left, ov.top, ov.right - ov.left, ov.bot - ov.top, fit, ov.shiftY);
  ctx.drawImage(ov.cv, 0, 0);
  return { canvas: c, mode };
}

// ───────── 畫面資料 ─────────
function currentName() {
  const v = $('#cls').value;
  return v === '__custom' ? $('#clsCustom').value.trim() : v;
}
function currentDate() {
  const v = $('#date').value;           // YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function currentFit() { return document.querySelector('input[name=fit]:checked').value; }
function resolveTemplate() {
  const list = client.templates;
  if (pickedTpl) return list.find((t) => t.id === pickedTpl) || list[0];
  const name = currentName();
  for (const t of list) for (const k of t.keys || []) if (k && name.includes(k)) return t;
  return list[0];
}
function safeName(s) { return (s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30) || '貼文'; }

function placeholder() {
  const c = canvas(900, 1200), ctx = c.getContext('2d');
  ctx.fillStyle = '#C9D6D9'; ctx.fillRect(0, 0, 900, 1200);
  ctx.fillStyle = '#44546A'; ctx.font = `700 64px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText('選照片後', 450, 560); ctx.fillText('會出現在這裡', 450, 650);
  return c;
}

// ───────── 預覽 ─────────
let pvSeq = 0;
async function renderPreview() {
  const seq = ++pvSeq;
  const tpl = resolveTemplate();
  const name = currentName();
  const date = currentDate();
  const title = $('#title').value.trim() || name || '標題';
  const dateText = date ? date.replace(/-/g, '.') : '----.--.--';
  await ensureFonts([title, client.slogan, client.name]);
  try {
    let ov = await buildOverlay(client, tpl, title, dateText);
    const img = firstBitmap || placeholder();
    const ratio = pickRatio(img.width, img.height, ov);
    if (ratio === 'feed') ov = to45(ov);
    if (seq !== pvSeq) return;
    const { mode } = compose(img, ov, currentFit(), $('#pv'));
    if ($('#status').classList.contains('err')) showStatus('');   // 恢復正常就把舊錯誤清掉
    const rTxt = ratio === 'feed' ? '4:5（1080×1350）' : '9:16（1080×1920）';
    const mTxt = mode === 'contain' ? '完整不裁' : '填滿裁切';
    $('#pvInfo').textContent = `模板：${tpl.label}｜比例：${rTxt}｜照片：${mTxt}`;
    $('#pv').setAttribute('aria-label', `預覽：${client.short} ${tpl.label} 模板，標題「${title}」，日期 ${dateText}，比例 ${rTxt}`);
  } catch (e) {
    showStatus('預覽失敗：' + e.message + '。請檢查網路，再換一下模板或重新整理頁面。', true);
  }
}
let pvTimer = 0;
function queuePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 150); updateGo(); }

function showStatus(msg, err) {
  const s = $('#status'); s.textContent = msg; s.classList.toggle('err', !!err);
}
function updateGo() {
  $('#go').disabled = !(photos.length && currentName() && currentDate());
}

// ───────── 產生 ─────────
async function bitmapOf(file) {
  try {
    if (window.createImageBitmap) return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) { /* 改用 Image */ }
  return await new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const im = new Image();
    im.onload = () => res(im); im.onerror = () => rej(new Error('這張照片讀不出來（可能是 HEIC 格式）'));
    im.src = u;
  });
}

let outFiles = [];
async function generate() {
  const name = currentName(), date = currentDate();
  if (!photos.length) return showStatus('請先選照片', true);
  if (!name) return showStatus('請先選或填「類型／活動」', true);
  if (!date) return showStatus('請先填日期', true);
  $('#go').disabled = true;
  outFiles.forEach((f) => URL.revokeObjectURL(f.url)); outFiles = [];
  $('#resultList').innerHTML = ''; $('#results').hidden = true;

  const tpl = resolveTemplate();
  const title = $('#title').value.trim() || name;
  const dateText = date.replace(/-/g, '.');
  const ymd = date.replace(/-/g, '');
  await ensureFonts([title, client.slogan, client.name]);
  const base = await buildOverlay(client, tpl, title, dateText);
  // 跟桌面版一樣：比例用第一張照片決定，整組一致
  const first = await bitmapOf(photos[0]);
  const ratio = pickRatio(first.width, first.height, base);
  const ov = ratio === 'feed' ? to45(base) : base;

  for (let i = 0; i < photos.length; i++) {
    showStatus(`產生中… ${i + 1} / ${photos.length}`);
    let img;
    try { img = i === 0 ? first : await bitmapOf(photos[i]); }
    catch (e) { showStatus(`第 ${i + 1} 張：${e.message}，已跳過`, true); continue; }
    const { canvas: c } = compose(img, ov, currentFit());
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
    const suffix = photos.length > 1 ? '_' + String(i + 1).padStart(2, '0') : '';
    const fname = `${client.short}_${safeName(name)}_${ymd}${suffix}.jpg`;
    const file = new File([blob], fname, { type: 'image/jpeg' });
    outFiles.push({ file, url: URL.createObjectURL(blob) });
  }
  const ul = $('#resultList');
  for (const f of outFiles) {
    const li = document.createElement('li');
    const im = document.createElement('img'); im.src = f.url; im.alt = '';
    const a = document.createElement('a'); a.href = f.url; a.download = f.file.name;
    a.textContent = '下載 ' + f.file.name;
    li.append(im, a); ul.append(li);
  }
  $('#results').hidden = outFiles.length === 0;
  const canShare = !!(navigator.canShare && outFiles.length && navigator.canShare({ files: outFiles.map((f) => f.file) }));
  $('#share').hidden = !canShare;
  showStatus(!outFiles.length ? '沒有產生任何圖'
    : canShare ? `完成 ${outFiles.length} 張。按「分享／存到相簿」就能存進手機，或按下面的檔名下載。`
    : `完成 ${outFiles.length} 張。按下面的檔名下載。`, !outFiles.length);
  updateGo();
  $('#results').querySelector('h2').setAttribute('tabindex', '-1');
  $('#results').querySelector('h2').focus();
}

async function shareAll() {
  try { await navigator.share({ files: outFiles.map((f) => f.file), title: '粉專貼文圖' }); }
  catch (e) { if (e.name !== 'AbortError') showStatus('分享失敗，請改用下面的下載連結', true); }
}

// ───────── 介面組裝 ─────────
function buildClientChoices() {
  const box = $('#clientChoices'); box.innerHTML = '';
  DATA.clients.forEach((cl, i) => {
    const lab = document.createElement('label'); lab.className = 'choice';
    lab.innerHTML = `<input type="radio" name="client" value="${cl.slug}"${i === 0 ? ' checked' : ''}><span></span>`;
    lab.querySelector('span').textContent = cl.short;
    box.append(lab);
  });
  box.addEventListener('change', (e) => { if (e.target.name === 'client') selectClient(e.target.value); });
}
function selectClient(slug) {
  client = DATA.clients.find((c) => c.slug === slug);
  pickedTpl = '';
  const sel = $('#cls'); sel.innerHTML = '';
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '請選擇'; sel.append(o0);
  for (const c of client.classes) { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.append(o); }
  const oc = document.createElement('option'); oc.value = '__custom'; oc.textContent = '其他（自己填）'; sel.append(oc);
  $('#clsCustomWrap').hidden = true;
  buildGallery();
  queuePreview();
}
function buildGallery() {
  const g = $('#gallery'); g.innerHTML = '';
  const mk = (id, label, thumb) => {
    const lab = document.createElement('label'); lab.className = 'tpl';
    const inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'tpl'; inp.value = id; inp.checked = id === pickedTpl;
    const span = document.createElement('span');
    if (thumb) { const im = document.createElement('img'); im.src = thumb; im.alt = ''; im.loading = 'lazy'; span.append(im); }
    else { const f = document.createElement('span'); f.className = 'auto-face'; f.textContent = '自動'; span.append(f); }
    span.append(document.createTextNode(label));
    lab.append(inp, span); g.append(lab);
  };
  mk('', '照類型自動配', null);
  client.templates.forEach((t) => mk(t.id, t.label, t.thumb));
}

async function init() {
  try {
    const r = await fetch('data/templates.json', { cache: 'no-store' });
    DATA = await r.json();
  } catch (e) { showStatus('模板資料載入失敗，請重新整理頁面', true); return; }
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  $('#date').value = today.toISOString().slice(0, 10);
  buildClientChoices();
  selectClient(DATA.clients[0].slug);

  $('#cls').addEventListener('change', () => {
    $('#clsCustomWrap').hidden = $('#cls').value !== '__custom';
    if (!$('#clsCustomWrap').hidden) $('#clsCustom').focus();
    queuePreview();
  });
  ['#clsCustom', '#title', '#date'].forEach((s) => $(s).addEventListener('input', queuePreview));
  $('#gallery').addEventListener('change', (e) => { if (e.target.name === 'tpl') { pickedTpl = e.target.value; queuePreview(); } });
  $('#fitChoices').addEventListener('change', queuePreview);
  $('#photos').addEventListener('change', async (e) => {
    photos = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    firstBitmap = null;
    $('#photoNote').textContent = photos.length ? `已選 ${photos.length} 張照片` : '還沒選照片';
    if (photos.length) {
      try { firstBitmap = await bitmapOf(photos[0]); showStatus(''); }
      catch (err) { showStatus(err.message, true); }
    }
    queuePreview();
  });
  $('#go').addEventListener('click', generate);
  $('#share').addEventListener('click', shareAll);
}
init();
