/* Pack Scan prototype. Decodes with zxing-wasm (vendor/), parses with gs1.js. Everything stays in the browser. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LS_LOG = 'packscan.log.v2', LS_MAP = 'packscan.map.v1', LS_MEDS = 'packscan.meds.v1';
  var cur = null;                // what is being identified
  var LIST = [];                 // parsed MedTrack labels
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

  /* ---------- MedTrack list ---------- */
  function parseListText(text) {
    var t = String(text).trim(), labels = [];
    if (t[0] === '{' || t[0] === '[') {
      try { var j = JSON.parse(t); labels = Array.isArray(j) ? j : (j.labels || []); } catch (e) { labels = []; }
    } else labels = t.split(/\r?\n/).map(function (l) { return l.replace(/^"|"$/g, '').trim(); });
    return labels.filter(function (l) { return typeof l === 'string' && l.indexOf('|') > 0; });
  }
  function setList(labels) {
    LIST = labels.map(FreeText.parseLabel);
    $('listStatus').textContent = LIST.length ? LIST.length + ' lines loaded' : 'no list loaded';
  }
  $('fileList').addEventListener('change', function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var labels = parseListText(rd.result);
      if (!labels.length) { setStatus('That file has no "Name | pack" lines. Expected the medications.json list or one "Name | 30 Tab" per line.', 'err'); return; }
      if (!lsSet(LS_MEDS, labels)) { setStatus('List read, but this browser would not save it.', 'err'); }
      setList(labels); setStatus('Loaded ' + labels.length + ' medication lines.', 'ok'); if (cur) renderAll();
    };
    rd.readAsText(f);
  });
  $('btnListClear').addEventListener('click', function () { try { localStorage.removeItem(LS_MEDS); } catch (e) {} setList([]); setStatus('List removed from this device.'); if (cur) renderAll(); });

  /* ---------- the identified card ---------- */
  function packText(l) { return l && l.packCount !== null ? (l.packCount + (l.packUnit ? ' ' + l.packUnit : '')) : ''; }
  function row(tbl, k, v, src) {
    var tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
    a.textContent = k; b.className = 'val'; b.textContent = v || '—';
    if (src && v) { var s = document.createElement('span'); s.className = 'src'; s.textContent = src; b.appendChild(s); }
    tr.appendChild(a); tr.appendChild(b); tbl.appendChild(tr);
  }
  function startCur(kind) { return { kind: kind, gs: null, tx: null, label: null, labelSrc: '', code: '', expiry: '', expirySrc: '', lot: '', serial: '', cands: [], raw: '' }; }

  function typedName(c) { return c.tx && c.tx.nameWords.length ? c.tx.nameWords.join(' ') : ''; }
  function medName(c) { return c.label ? c.label.name : typedName(c); }
  function doseOf(c) { return c.label && c.label.dose ? c.label.dose : (c.tx && c.tx.dose) || ''; }
  function packOf(c) { return c.label && packText(c.label) ? packText(c.label) : (c.tx && c.tx.packCount !== null ? c.tx.packCount + ' ' + (c.tx.packUnit || '') : ''); }

  function renderAll() {
    var c = cur; if (!c) return;
    $('result').hidden = false;
    var tbl = $('idTable'); tbl.textContent = '';
    row(tbl, 'Medication', medName(c) || (c.kind === 'code' && !c.label ? 'not identified yet' : ''), c.label ? (c.labelSrc === 'linked' ? 'from your saved link' : 'chosen from the MedTrack list') : (typedName(c) ? 'as typed, not matched' : ''));
    row(tbl, 'Dose', doseOf(c), c.label && c.label.dose ? 'from the MedTrack line' : (c.tx && c.tx.dose ? 'from the text' : ''));
    row(tbl, 'Pack size', packOf(c), c.label && packText(c.label) ? 'from the MedTrack line' : (c.tx && c.tx.packCount !== null ? 'from the text' : ''));
    row(tbl, 'Expiry', c.expiry, c.expiry ? c.expirySrc : '');
    if (c.lot) row(tbl, 'Lot', c.lot);
    if (c.serial) row(tbl, 'Serial number', c.serial, 'unique to this box');
    if (c.code) row(tbl, 'Product code', c.code, c.gs && c.gs.codeLabel ? c.gs.codeLabel : (c.gs && c.gs.kind === 'gs1' ? 'GS1 data code' : ''));

    // warnings
    var w = $('warns'); w.textContent = '';
    var add = function (t) { var d = document.createElement('div'); d.className = 'warn'; d.textContent = t; w.appendChild(d); };
    if (c.gs) c.gs.warnings.forEach(add);
    if (c.label && c.tx) {
      if (c.tx.dose && c.label.dose && FreeText.normDose(c.tx.dose) !== FreeText.normDose(c.label.dose)) add('Dose differs: the text says ' + c.tx.dose + ', the MedTrack line says ' + c.label.dose + '.');
      if (c.tx.packCount !== null && c.label.packCount !== null && c.tx.packCount !== c.label.packCount) add('Pack size differs: the box says ' + c.tx.packCount + ' ' + (c.tx.packUnit || '') + ', the MedTrack line says ' + packText(c.label) + '. Pick the right line, or ask for a new one to be added.');
    }

    // badge
    var ok = !!(medName(c) && c.expiry), b = $('resBadge');
    var needs = []; if (!c.label) needs.push('medication'); if (!c.expiry) needs.push('expiry');
    if (ok && c.label) { b.textContent = 'Identified'; b.className = 'badge ok'; }
    else if (ok) { b.textContent = 'Not matched to the list'; b.className = 'badge part'; }
    else { b.textContent = 'Need: ' + needs.join(' and '); b.className = 'badge part'; }

    // candidates and identify box
    var showPick = !c.label || c.cands.length > 0;
    $('pickBox').hidden = !showPick;
    var cd = $('cands'); cd.textContent = '';
    $('idLabel').hidden = !(c.kind === 'code' && !c.label);
    $('rememberRow').hidden = !(c.kind === 'code' && c.code && (c.cands.length > 0 || c.label));
    if (showPick) {
      if (!LIST.length) { var n = document.createElement('p'); n.className = 'hint'; n.textContent = 'Load the MedTrack list (below) to match this to a medication line.'; cd.appendChild(n); }
      c.cands.forEach(function (m) {
        var bt = document.createElement('button'); bt.type = 'button'; bt.className = 'cand' + (c.label && c.label.label === m.label ? ' sel' : '');
        bt.textContent = m.label + ' (' + m.score + '%)';
        if (m.notes.length) { var s = document.createElement('small'); s.textContent = m.notes.join('; '); bt.appendChild(s); }
        bt.addEventListener('click', function () { chooseLabel(m.label, 'chosen'); });
        cd.appendChild(bt);
      });
      if (LIST.length && !c.cands.length && (c.kind === 'text' || c.tx)) { var h = document.createElement('p'); h.className = 'hint'; h.textContent = 'No close match in the MedTrack list. The text is kept as typed.'; cd.appendChild(h); }
    }
    $('pickTitle').textContent = c.label ? 'Other possible lines' : 'Which MedTrack line is this?';

    // manual inputs
    $('manualBox').hidden = !!(c.expiry && c.expirySrc !== 'typed' && c.lot);
    if (!c.expiry) $('manExp').value = ''; else if (c.expirySrc === 'typed') $('manExp').value = c.expiry.slice(0, 7);
    $('rawText').textContent = c.raw;
    setStatus(ok && c.label ? 'Identified.' : 'Check the details below.', ok && c.label ? 'ok' : '');
  }

  function chooseLabel(labelStr, src) {
    var p = FreeText.parseLabel(labelStr); cur.label = p; cur.labelSrc = src;
    if (cur.kind === 'code' && cur.code && src === 'chosen' && $('remember').checked) {
      var map = lsGet(LS_MAP, {}); map[cur.code] = labelStr; lsSet(LS_MAP, map);
    }
    renderAll();
  }

  function runMatch(tx) {
    cur.tx = tx; cur.cands = LIST.length ? FreeText.matchLabels(tx, LIST, 5) : [];
    return cur.cands;
  }

  /* ---------- barcode flow ---------- */
  function present(parsedList) {
    var p = parsedList[0]; cur = startCur('code'); cur.gs = p; cur.raw = showGS(p.raw);
    cur.code = p.productCode || ''; cur.lot = p.lot || ''; cur.serial = p.serial || '';
    if (p.expiry) { cur.expiry = p.expiry; cur.expirySrc = 'from the code' + (p.expiryRaw && /00$/.test(p.expiryRaw) ? ' (end of month)' : ''); }
    var o = $('others'); o.textContent = '';
    parsedList.slice(1).forEach(function (q) { var d = document.createElement('p'); d.className = 'hint'; d.textContent = 'Also found: ' + (q.format || '') + ' ' + showGS(q.raw); o.appendChild(d); });
    var map = lsGet(LS_MAP, {}), known = cur.code && map[cur.code];
    if (known) { cur.label = FreeText.parseLabel(known); cur.labelSrc = 'linked'; }
    $('idText').value = ''; $('manLot').value = cur.lot;
    renderAll();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('idText').addEventListener('input', function () {
    if (!cur) return; var tx = FreeText.parseFreeText(this.value); runMatch(tx);
    if (tx.expiry && !cur.expiry) { cur.expiry = tx.expiry; cur.expirySrc = 'from the text'; }
    renderAll();
  });

  /* ---------- free-text flow ---------- */
  function readText() {
    var t = $('freeText').value; if (!t.trim()) { setStatus('Type or paste some text first.', 'err'); return; }
    var tx = FreeText.parseFreeText(t); cur = startCur('text'); cur.raw = t; cur.lot = tx.lot || '';
    runMatch(tx);
    if (tx.expiry) { cur.expiry = tx.expiry; cur.expirySrc = 'from the text (end of month)'; }
    var top = cur.cands[0], second = cur.cands[1];
    if (top && top.score >= 90 && (!second || top.score - second.score >= 10)) { cur.label = top.parsed; cur.labelSrc = 'chosen'; }
    $('manLot').value = cur.lot; renderAll(); $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('btnParse').addEventListener('click', readText);

  function readTyped() { var t = $('typed').value; if (!t.trim()) return; present(interpret([{ text: t.replace(/\\x1d|␝/g, '\x1d'), format: 'typed' }])); $('typed').value = ''; }
  $('btnRead').addEventListener('click', readTyped);
  $('typed').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); readTyped(); } });

  /* ---------- manual expiry and lot ---------- */
  $('manExp').addEventListener('change', function () {
    if (!cur) return; if (!this.value) { if (cur.expirySrc === 'typed') { cur.expiry = ''; cur.expirySrc = ''; } renderAll(); return; }
    var ym = this.value.split('-'); cur.expiry = new Date(Date.UTC(+ym[0], +ym[1], 0)).toISOString().slice(0, 10); cur.expirySrc = 'typed'; renderAll();
  });
  $('manLot').addEventListener('input', function () { if (cur) cur.lot = this.value.trim(); });

  /* ---------- log ---------- */
  $('btnAdd').addEventListener('click', function () {
    var msg = $('addMsg'), c = cur; if (!c) return;
    if (!medName(c)) { msg.textContent = 'Identify the medication first.'; msg.className = 'status err'; return; }
    if (!c.expiry) { msg.textContent = 'Add the expiry first.'; msg.className = 'status err'; return; }
    var log = lsGet(LS_LOG, []);
    if (c.serial) {
      var dup = log.filter(function (r) { return r.code === c.code && r.serial === c.serial; })[0];
      if (dup) { msg.textContent = 'This exact box (serial ' + c.serial + ') was already logged at ' + dup.time + ' as ' + dup.mode + '. Not added.'; msg.className = 'status err'; return; }
    }
    var d = new Date(), p2 = function (n) { return ('0' + n).slice(-2); };
    var onBox = c.tx && c.tx.packCount !== null ? c.tx.packCount + ' ' + (c.tx.packUnit || '') : '';
    log.unshift({ time: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()),
      mode: $('mode').value, medication: medName(c), dose: doseOf(c), pack: c.label ? packText(c.label) : '', onBox: onBox, expiry: c.expiry, lot: c.lot, code: c.code, serial: c.serial, matched: c.label ? 'yes' : 'no' });
    lsSet(LS_LOG, log); renderLog(); msg.textContent = 'Logged.'; msg.className = 'status ok';
  });
  function renderLog() {
    var log = lsGet(LS_LOG, []), tb = $('logTable').querySelector('tbody'); tb.textContent = '';
    log.forEach(function (r) {
      var tr = document.createElement('tr');
      [r.time, r.mode, r.medication, r.dose, r.pack, r.onBox, r.expiry, r.lot, r.code, r.serial].forEach(function (t) { var td = document.createElement('td'); td.textContent = t || ''; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    $('logEmpty').hidden = log.length > 0;
  }
  $('btnCsv').addEventListener('click', function () {
    var log = lsGet(LS_LOG, []); if (!log.length) return;
    var q = function (s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var rows = [['time', 'movement', 'medication', 'dose', 'pack_size', 'pack_on_box', 'expiry', 'lot', 'product_code', 'serial', 'matched_to_list']]
      .concat(log.map(function (r) { return [r.time, r.mode, r.medication, r.dose, r.pack, r.onBox, r.expiry, r.lot, r.code, r.serial, r.matched]; }));
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(function (r) { return r.map(q).join(','); }).join('\n')], { type: 'text/csv' }));
    a.download = 'pack-scan-log.csv'; document.body.appendChild(a); a.click(); a.remove();
  });
  $('btnClear').addEventListener('click', function () {
    var b = $('btnClear'); if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to clear'; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Clear'; }, 3000); return; }
    lsSet(LS_LOG, []); renderLog(); b.dataset.sure = ''; b.textContent = 'Clear';
  });

  /* ---------- modes and wiring ---------- */
  function setMode(m) {
    var code = m === 'code';
    $('tabCode').classList.toggle('on', code); $('tabText').classList.toggle('on', !code);
    $('tabCode').setAttribute('aria-selected', code); $('tabText').setAttribute('aria-selected', !code);
    $('paneCode').hidden = !code; $('paneText').hidden = code; if (!code) stopCam();
  }
  $('tabCode').addEventListener('click', function () { setMode('code'); });
  $('tabText').addEventListener('click', function () { setMode('text'); });
  $('btnCam').addEventListener('click', startCam);
  $('btnStop').addEventListener('click', function () { stopCam(); setStatus('Camera stopped.'); });
  $('filePhoto').addEventListener('change', function () { onFile(this.files[0]); this.value = ''; });
  $('fileChoose').addEventListener('change', function () { onFile(this.files[0]); this.value = ''; });

  setList(lsGet(LS_MEDS, []));
  renderLog();
  window.PackScan = { present: present, interpret: interpret, decodeImageFile: decodeImageFile, readText: readText };
})();
