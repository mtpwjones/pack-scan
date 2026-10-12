/* Free-text reading and matching against MedTrack labels ("Name dose | count Unit"). No dependencies; browser and Node. */
(function (root) {
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
                 janv: 1, 'févr': 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, 'août': 8, aout: 8, 'déc': 12 };
  var COUNT_UNITS = [ // [regex source, canonical class]
    ['tablets?|tabs?|comprim[eé]s?|comp\\.?|табл[іи]?[а-я]*\\.?', 'tab'], ['capsules?|caps?|g[eé]lules?|капс[а-я]*\\.?', 'tab'],
    ['pcs|pieces?|шт\\.?', 'pcs'], ['ampoules?|amps?|амп[а-я]*\\.?', 'amp'], ['vials?|фл[а-я]*\\.?|bottles?|fl', 'fl'],
    ['sachets?|sach\\.?|пакет[а-я]*', 'sach'], ['tubes?|oint(?:ment)?s?|gel|cream', 'tube'] ];
  var DOSE_UNIT = '(?:mg|mcg|µg|ug|g|ml|iu|ui|ме|мг|мкг|мл|%)';

  function norm(s) { return String(s).toLowerCase().replace(/[µ]/g, 'u').replace(/\s+/g, ' ').trim(); }
  function normDose(s) { return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/,/g, '.').replace('µg', 'mcg').replace('ug', 'mcg').replace('мг', 'mg').replace('мкг', 'mcg').replace('мл', 'ml'); }
  function tokens(s) { return norm(s).replace(/[^a-z0-9а-яіїєґ\/.% ]+/g, ' ').split(/[\s\/]+/).filter(function (t) { return t.length > 1 && !/^\d/.test(t); }); }
  function unitClass(u) {
    u = norm(u).replace(/\.$/, '');
    for (var i = 0; i < COUNT_UNITS.length; i++) if (new RegExp('^(?:' + COUNT_UNITS[i][0] + ')$', 'i').test(u)) return COUNT_UNITS[i][1];
    if (/^(tab|tabs|tablet|capsule|caps|cap)$/.test(u)) return 'tab';
    if (/^(pcs|fl|amp|oint|gel|tube|sach)$/.test(u)) return u === 'oint' || u === 'gel' ? 'tube' : u;
    return u;
  }

  /* "Sertraline 50mg | 30 Tab" -> {label, name, dose, packCount, packUnit, packClass} */
  function parseLabel(label) {
    var parts = String(label).split('|'), left = parts[0].trim(), right = (parts[1] || '').trim();
    var words = left.split(/\s+/), i = 0;
    while (i < words.length && !/^\d/.test(words[i])) i++;
    var name = words.slice(0, i).join(' ').replace(/[,\s]+$/, ''), dose = words.slice(i).join(' ');
    if (!name) { name = left; dose = ''; }
    var m = right.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/), cnt = m ? parseFloat(m[1].replace(',', '.')) : null, unit = m ? m[2].trim() : right;
    return { label: String(label), name: name, dose: dose, packCount: cnt, packUnit: unit, packClass: unit ? unitClass(unit) : '' };
  }

  function endOfMonth(y, m) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + new Date(Date.UTC(y, m, 0)).getUTCDate()).slice(-2); }
  function fixYear(y) { y = +y; return y < 100 ? 2000 + y : y; }

  function findExpiry(text) {
    var t = text, m, key = '(?:exp(?:iry|ires)?\\.?|use by|best before|bb|ex|до|придатн[а-я]* до|годен до|date de p[eé]remption|p[eé]remption|per\\.?)';
    var res = [
      [new RegExp(key + '\\s*[:.]?\\s*(\\d{1,2})\\s*[\\/.\\- ]\\s*(\\d{4}|\\d{2})\\b', 'i'), function (a) { return [fixYear(a[2]), +a[1]]; }],
      [new RegExp(key + '\\s*[:.]?\\s*(\\d{4})\\s*[\\/.\\-]\\s*(\\d{1,2})\\b', 'i'), function (a) { return [+a[1], +a[2]]; }],
      [new RegExp(key + '\\s*[:.]?\\s*([a-zéû]{3,5})\\.?\\s*[\\/.\\- ]?\\s*(\\d{4}|\\d{2})\\b', 'i'), function (a) { var mo = MONTHS[a[1].toLowerCase()]; return mo ? [fixYear(a[2]), mo] : null; }],
      [/\b(\d{1,2})\s*[\/.]\s*(20\d{2})\b/, function (a) { return [+a[2], +a[1]]; }],
      [/\b(20\d{2})\s*[\/.\-]\s*(\d{1,2})\b/, function (a) { return [+a[1], +a[2]]; }]
    ];
    for (var i = 0; i < res.length; i++) {
      m = t.match(res[i][0]); if (!m) continue;
      var ym = res[i][1](m); if (!ym || ym[1] < 1 || ym[1] > 12) continue;
      return { iso: endOfMonth(ym[0], ym[1]), matched: m[0] };
    }
    return null;
  }

  function parseFreeText(text) {
    var raw = String(text || ''), work = ' ' + raw + ' ', out = { raw: raw, expiry: null, lot: null, dose: null, packCount: null, packUnit: null, packClass: '', nameWords: [] };
    var ex = findExpiry(raw); if (ex) { out.expiry = ex.iso; work = work.replace(ex.matched, ' '); }
    var lot = work.match(/(?:lot|batch|серія|партія|lot n[°o]|ser\.)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,19})/i);
    if (lot) { out.lot = lot[1].toUpperCase(); work = work.replace(lot[0], ' '); }
    var dm = work.match(new RegExp('(\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+(?:[.,]\\d+)?)?)\\s*(' + DOSE_UNIT + '(?:\\s*\\/\\s*' + DOSE_UNIT + ')?)(?![a-zа-яіїє])', 'i'));
    if (dm) { out.dose = (dm[1].replace(/\s+/g, '') + dm[2].replace(/\s+/g, '')).replace(',', '.'); work = work.replace(dm[0], ' '); }
    for (var i = 0; i < COUNT_UNITS.length && out.packCount === null; i++) {
      var cm = work.match(new RegExp('(?:^|[^\\d.,])(\\d{1,4})\\s*(?:film[- ]coated\\s+|coated\\s+|film[- ]coated\\s+)?(' + COUNT_UNITS[i][0] + ')(?![a-zа-яіїє])', 'i'));
      if (cm) { out.packCount = +cm[1]; out.packUnit = cm[2]; out.packClass = COUNT_UNITS[i][1]; work = work.replace(cm[0], ' '); }
    }
    out.nameWords = tokens(work);
    return out;
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function tokMatch(a, b) {            // a: label token, b: query token
    if (a === b) return 1;
    if (a.length >= 5 && b.length >= 5 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return 0.9;
    if (a.length >= 6 && b.length >= 6 && lev(a, b, 2) <= (a.length >= 9 ? 2 : 1)) return 0.8;
    return 0;
  }

  /* labels: array of label strings or parsed labels. Returns top candidates with a 0-100 score and notes. */
  function matchLabels(parsedText, labels, limit) {
    var q = parsedText, qTok = q.nameWords, out = [];
    labels.forEach(function (L) {
      var p = typeof L === 'string' ? parseLabel(L) : L, lt = tokens(p.name);
      if (!lt.length || !qTok.length) return;
      var hit = 0, matched = 0;
      lt.forEach(function (t) { var best = 0; qTok.forEach(function (u) { best = Math.max(best, tokMatch(t, u)); }); if (best > 0) matched++; hit += best; });
      if (!matched) return;
      var cover = hit / lt.length;                                   // how much of the label's name the text contains
      if (cover < 0.5) return;
      var score = cover * 60, notes = [];
      if (q.dose && p.dose) { if (normDose(q.dose) === normDose(p.dose)) { score += 25; } else { score -= 15; notes.push('dose differs: text ' + q.dose + ', MedTrack ' + p.dose); } }
      else if (!q.dose && p.dose) score += 0;
      if (q.packCount !== null && p.packCount !== null) {
        if (q.packCount === p.packCount && (!q.packClass || !p.packClass || q.packClass === p.packClass)) score += 15;
        else { score -= 3; notes.push('pack size differs: text ' + q.packCount + ' ' + (q.packUnit || '') + ', MedTrack ' + p.packCount + ' ' + p.packUnit); }
      }
      out.push({ label: p.label, parsed: p, score: Math.max(0, Math.min(100, Math.round(score))), notes: notes.filter(Boolean) });
    });
    out.sort(function (a, b) { return b.score - a.score || a.label.length - b.label.length; });
    return out.slice(0, limit || 5);
  }

  var api = { parseLabel: parseLabel, parseFreeText: parseFreeText, matchLabels: matchLabels, findExpiry: findExpiry, normDose: normDose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FreeText = api;
})(typeof window !== 'undefined' ? window : globalThis);
