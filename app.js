/* Pack Scan prototype. Decodes with zxing-wasm (vendor/), parses with gs1.js. Everything stays in the browser. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LS_LOG = 'packscan.log.v1', LS_MAP = 'packscan.map.v1';
  var current = null;            // the parsed scan being shown
  var stream = null, camTimer = null, camBusy = false, camSeen = {};
  var OPTS = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 4 };

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function setStatus(msg, cls) { var s = $('status'); s.textContent = msg; s.className = 'status' + (cls ? ' ' + cls : ''); }
  function showGS(t) { return String(t).replace(/\x1d/g, '␝'); }

  try {
    ZXingWASM.prepareZXingModule({ overrides: { locateFile: function (p, prefix) { return p.endsWith('.wasm') ? 'vendor/zxing_reader.wasm' : prefix + p; } } });
  } catch (e) { setStatus('Scanner could not start: ' + e.message, 'err'); }

  /* ---------- reading ---------- */
  function rank(p) { return p.kind === 'gs1' ? (p.complete ? 4 : 3) : p.kind === 'product-only' ? 2 : 1; }

  function interpret(results) {
    var parsed = results.map(function (r) { var p = GS1.parseScan(r.text, r); p.format = r.format; p.contentType = r.contentType; return p; });
    parsed.sort(function (a, b) { return rank(b) - rank(a); });
    return parsed;
  }

  function decodeBlob(blob) { return ZXingWASM.readBarcodes(blob, OPTS); }

  function bitmapToImageData(bmp, maxSide) {
    var s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    var w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), canvas: c };
  }

  async function decodeImageFile(file) {
    setStatus('Reading the image…');
    var bmp = await createImageBitmap(file);
    var attempts = [];
    // Try the full image first, then the full image larger, then overlapping halves (small 2D codes need pixels).
    var base = bitmapToImageData(bmp, 2200);
    var found = await ZXingWASM.readBarcodes(base.data, OPTS);
    if (!found.length || !interpret(found).some(function (p) { return p.kind === 'gs1'; })) {
      var tiles = [[0, 0, 1, 0.6], [0, 0.2, 1, 0.6], [0, 0.4, 1, 0.6], [0, 0.5, 1, 0.5], [0, 0, 0.6, 1], [0.4, 0, 0.6, 1]];
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i], sx = Math.round(bmp.width * t[0]), sy = Math.round(bmp.height * t[1]);
        var sw = Math.round(bmp.width * t[2]), sh = Math.round(bmp.height * t[3]);
        var sub = await createImageBitmap(bmp, sx, sy, sw, sh);
        var big = bitmapToImageData(sub, 1800);
        var more = await ZXingWASM.readBarcodes(big.data, OPTS);
        found = found.concat(more);
        if (interpret(found).some(function (p) { return p.kind === 'gs1'; })) break;
      }
    }
    // de-duplicate by text
    var seen = {}; found = found.filter(function (r) { if (seen[r.text]) return false; seen[r.text] = 1; return true; });
    return found;
  }

  async function onFile(file) {
    if (!file) return;
    try {
      var results = await decodeImageFile(file);
      if (!results.length) { setStatus('No barcode found in that image. Try again closer, straight on, in good light.', 'err'); return; }
      present(interpret(results));
    } catch (e) { setStatus('Could not read that image: ' + e.message, 'err'); }
  }

  /* ---------- camera ---------- */
  async function startCam() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Live camera needs a secure (https) page or localhost. Use "Take photo" instead, which works anywhere.', 'err'); return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
    } catch (e) { setStatus('Camera not available: ' + e.message, 'err'); return; }
    var v = $('video'); v.srcObject = stream; await v.play();
    $('camBox').hidden = false; camSeen = {};
    setStatus('Point the camera at the code. Hold still.');
    camTimer = setInterval(camTick, 300);
  }
  function stopCam() {
    if (camTimer) clearInterval(camTimer); camTimer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
    $('camBox').hidden = true;
  }
  async function camTick() {
    if (camBusy) return; var v = $('video'); if (!v.videoWidth) return;
    camBusy = true;
    try {
      var c = document.createElement('canvas'); var s = Math.min(1, 1600 / v.videoWidth);
      c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
      var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, c.width, c.height);
      var res = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, c.width, c.height), OPTS);
      if (res.length) {
        var parsed = interpret(res), best = parsed[0], key = best.raw;
        camSeen[key] = (camSeen[key] || 0) + 1;
        if (best.complete || camSeen[key] >= 2) { stopCam(); present(parsed); }
      }
    } catch (e) { /* keep trying */ } finally { camBusy = false; }
  }

  /* ---------- showing a result ---------- */
  function kvRow(tbl, k, v, bold) {
    var tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
    a.textContent = k; b.textContent = v; if (bold !== false) b.className = 'val'; tr.appendChild(a); tr.appendChild(b); tbl.appendChild(tr);
  }
  function present(parsedList) {
    var p = parsedList[0]; current = p;
    $('result').hidden = false;
    var tbl = $('resTable'); tbl.textContent = '';
    var badge = $('resBadge');
    if (p.complete) { badge.textContent = 'Complete in one scan'; badge.className = 'badge ok'; }
    else if (p.kind === 'product-only' || p.kind === 'gs1') { badge.textContent = 'Product only: add lot and expiry'; badge.className = 'badge part'; }
    else { badge.textContent = 'Not a product code'; badge.className = 'badge bad'; }
    kvRow(tbl, 'Code type', (p.kind === 'gs1' ? 'GS1 2D / data code' : (p.codeLabel || p.format || 'Unknown')) + (p.format ? ' (' + p.format + ')' : ''));
    if (p.productCode) kvRow(tbl, 'Product code', p.productCode);
    kvRow(tbl, 'Lot', p.lot || 'not in this code');
    kvRow(tbl, 'Expiry', p.expiry ? p.expiry + (p.expiryRaw && /00$/.test(p.expiryRaw) ? ' (end of month)' : '') : 'not in this code');
    kvRow(tbl, 'Serial number', p.serial || 'not in this code');
    if (p.productionDate) kvRow(tbl, 'Made', p.productionDate);
    p.warnings.forEach(function (w) { kvRow(tbl, 'Warning', w, true); });
    $('completeBox').hidden = !(p.kind === 'product-only' || (p.kind === 'gs1' && !p.complete));
    $('manLot').value = p.lot || ''; $('manExp').value = p.expiry ? p.expiry.slice(0, 7) : '';
    var map = lsGet(LS_MAP, {}), known = p.productCode && map[p.productCode];
    $('medInput').value = known || '';
    $('addMsg').textContent = known ? 'Linked to ' + known + ' from an earlier scan.' : (p.productCode ? 'No MedTrack medication linked to this product code yet.' : ''); $('addMsg').className = 'status';
    $('rawText').textContent = showGS(p.raw);
    var o = $('others'); o.textContent = '';
    parsedList.slice(1).forEach(function (q) { var d = document.createElement('p'); d.className = 'hint'; d.textContent = 'Also found: ' + (q.format || '') + ' ' + showGS(q.raw); o.appendChild(d); });
    setStatus('Read ' + parsedList.length + ' code' + (parsedList.length > 1 ? 's' : '') + '.', 'ok');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- link, log ---------- */
  function currentFields() {
    var p = current; if (!p) return null;
    var lot = (p.lot || $('manLot').value || '').trim();
    var expiry = p.expiry;
    if (!expiry && $('manExp').value) { var ym = $('manExp').value.split('-'); expiry = new Date(Date.UTC(+ym[0], +ym[1], 0)).toISOString().slice(0, 10); }
    return { code: p.productCode || '', lot: lot, expiry: expiry || '', serial: p.serial || '', source: p.complete ? '2D scan' : (p.kind === 'gs1' || p.kind === 'product-only' ? 'barcode + typed' : 'raw') };
  }
  $('btnLink').addEventListener('click', function () {
    if (!current || !current.productCode) { $('addMsg').textContent = 'Nothing to link: no product code in this scan.'; return; }
    var v = $('medInput').value.trim(); if (!v) { $('addMsg').textContent = 'Choose a medication first.'; return; }
    var map = lsGet(LS_MAP, {}); map[current.productCode] = v; lsSet(LS_MAP, map);
    $('addMsg').textContent = 'Remembered: ' + current.productCode + ' is ' + v + '.'; $('addMsg').className = 'status ok';
  });
  $('btnAdd').addEventListener('click', function () {
    var f = currentFields(); var msg = $('addMsg');
    if (!f || !f.code) { msg.textContent = 'This scan has no product code, so it cannot be logged.'; msg.className = 'status err'; return; }
    if (!f.lot || !f.expiry) { msg.textContent = 'Add the lot and the expiry before logging.'; msg.className = 'status err'; return; }
    var log = lsGet(LS_LOG, []);
    if (f.serial) {
      var dup = log.filter(function (r) { return r.code === f.code && r.serial === f.serial; })[0];
      if (dup) { msg.textContent = 'This exact box (serial ' + f.serial + ') was already logged at ' + dup.time + ' as ' + dup.mode + '. Not added.'; msg.className = 'status err'; return; }
    }
    log.unshift({ time: (function () { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); })(), mode: $('mode').value, medication: $('medInput').value.trim(), code: f.code, lot: f.lot, expiry: f.expiry, serial: f.serial });
    lsSet(LS_LOG, log); renderLog(); msg.textContent = 'Logged.'; msg.className = 'status ok';
  });
  function renderLog() {
    var log = lsGet(LS_LOG, []), tb = $('logTable').querySelector('tbody'); tb.textContent = '';
    log.forEach(function (r) {
      var tr = document.createElement('tr');
      [r.time, r.mode, r.medication || '(not linked)', r.code, r.lot, r.expiry, r.serial || ''].forEach(function (t) { var td = document.createElement('td'); td.textContent = t; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    $('logEmpty').hidden = log.length > 0;
  }
  $('btnCsv').addEventListener('click', function () {
    var log = lsGet(LS_LOG, []); if (!log.length) return;
    var q = function (s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var rows = [['time', 'movement', 'medication', 'product_code', 'lot', 'expiry', 'serial']].concat(log.map(function (r) { return [r.time, r.mode, r.medication, r.code, r.lot, r.expiry, r.serial]; }));
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(function (r) { return r.map(q).join(','); }).join('\n')], { type: 'text/csv' }));
    a.download = 'pack-scan-log.csv'; document.body.appendChild(a); a.click(); a.remove();
  });
  $('btnClear').addEventListener('click', function () {
    var b = $('btnClear'); if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to clear'; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Clear'; }, 3000); return; }
    lsSet(LS_LOG, []); renderLog(); b.dataset.sure = ''; b.textContent = 'Clear';
  });

  /* ---------- wiring ---------- */
  $('btnCam').addEventListener('click', startCam);
  $('btnStop').addEventListener('click', function () { stopCam(); setStatus('Camera stopped.'); });
  $('filePhoto').addEventListener('change', function () { onFile(this.files[0]); this.value = ''; });
  $('fileChoose').addEventListener('change', function () { onFile(this.files[0]); this.value = ''; });
  function readTyped() { var t = $('typed').value; if (!t.trim()) return; present(interpret([{ text: t.replace(/\\x1d|␝/g, '\x1d'), format: 'typed' }])); $('typed').value = ''; }
  $('btnRead').addEventListener('click', readTyped);
  $('typed').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); readTyped(); } });

  fetch('medications.json').then(function (r) { return r.json(); }).then(function (d) {
    var dl = $('medList'); (d.labels || []).forEach(function (l) { var o = document.createElement('option'); o.value = l; dl.appendChild(o); });
  }).catch(function () { /* list is optional */ });
  renderLog();
  window.PackScan = { present: present, interpret: interpret, decodeImageFile: decodeImageFile };
})();
