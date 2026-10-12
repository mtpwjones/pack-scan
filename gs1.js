/* GS1 and barcode text parsing for pack-scan. No dependencies; runs in the browser and in Node. */
(function (root) {
  var GS = '\x1d';
  var FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
  var VARIABLE = { '10': 20, '21': 20, '22': 20, '30': 8, '37': 8, '240': 30, '241': 30, '242': 6, '250': 30, '251': 30, '253': 30, '254': 20 };
  var NAMES = { '00': 'sscc', '01': 'gtin', '02': 'contentGtin', '10': 'lot', '11': 'productionDate', '15': 'bestBefore', '17': 'expiry', '21': 'serial' };

  function checkDigitOk(digits) {                       // GTIN-8/12/13/14 and SSCC check digit
    if (!/^\d+$/.test(digits) || digits.length < 8) return false;
    var body = digits.slice(0, -1), sum = 0;
    for (var i = 0; i < body.length; i++) {
      var d = +body[body.length - 1 - i];
      sum += d * (i % 2 === 0 ? 3 : 1);
    }
    return ((10 - (sum % 10)) % 10) === +digits.slice(-1);
  }
  function toGtin14(digits) { return digits.length <= 14 ? ('00000000000000' + digits).slice(-14) : digits; }

  function dateFromYYMMDD(s) {                          // DD = 00 means "end of month" in GS1
    if (!/^\d{6}$/.test(s)) return null;
    var y = 2000 + +s.slice(0, 2), m = +s.slice(2, 4), d = +s.slice(4, 6);
    if (m < 1 || m > 12) return null;
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d === 0) d = last;
    if (d > last) return null;
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  function parseParenthesised(text) {
    var out = {}, re = /\((\d{2,4})\)([^(]*)/g, m, any = false;
    while ((m = re.exec(text))) { any = true; out[m[1]] = m[2].replace(GS, ''); }
    return any ? out : null;
  }

  function parseElementString(text) {
    var out = {}, i = 0, n = text.length;
    while (i < n) {
      if (text[i] === GS) { i++; continue; }
      var ai = null, len;
      var two = text.substr(i, 2), three = text.substr(i, 3);
      if (FIXED[two] !== undefined) { ai = two; len = FIXED[two]; }
      else if (VARIABLE[two] !== undefined) { ai = two; len = null; }
      else if (VARIABLE[three] !== undefined) { ai = three; len = null; }
      if (!ai) return { fields: out, rest: text.slice(i) };
      i += ai.length;
      if (len !== null) { out[ai] = text.substr(i, len); i += len; }
      else {
        var end = text.indexOf(GS, i); if (end < 0) end = n;
        var max = VARIABLE[ai];
        var v = text.slice(i, Math.min(end, i + max)); out[ai] = v; i += v.length;
      }
    }
    return { fields: out, rest: '' };
  }

  /* text: what the scanner returned. hint: {format, symbologyIdentifier, contentType} from the scanner, optional. */
  function parseScan(text, hint) {
    hint = hint || {};
    var raw = String(text == null ? '' : text);
    var res = { raw: raw, kind: 'unknown', gtin: null, productCode: null, codeLabel: null, lot: null, expiry: null, expiryRaw: null,
                serial: null, productionDate: null, complete: false, warnings: [], format: hint.format || null };
    var ai = null, rest = '';
    var trimmed = raw.replace(/^\]d2|^\]C1|^\]E0/, '');
    if (/^\(\d{2,4}\)/.test(trimmed)) ai = parseParenthesised(trimmed);
    else if (/^(01|02|00|10|11|17|21)/.test(trimmed) && (trimmed.length > 16 || trimmed.indexOf(GS) >= 0) && /^(01|02)\d{14}/.test(trimmed)) {
      var p = parseElementString(trimmed); ai = p.fields; rest = p.rest;
    }
    if (ai && ai['01']) {
      res.kind = 'gs1';
      res.gtin = toGtin14(ai['01']);
      if (!checkDigitOk(res.gtin)) res.warnings.push('Product code check digit is wrong, so the read may be damaged.');
      res.lot = ai['10'] || null;
      res.serial = ai['21'] || null;
      if (ai['17']) { res.expiryRaw = ai['17']; res.expiry = dateFromYYMMDD(ai['17']); if (!res.expiry) res.warnings.push('Expiry "' + ai['17'] + '" is not a valid date.'); }
      if (ai['11']) res.productionDate = dateFromYYMMDD(ai['11']);
      if (rest) res.warnings.push('Unread trailing data: ' + rest);
      res.productCode = res.gtin;
      res.complete = !!(res.gtin && res.lot && res.expiry);
      return res;
    }
    var digits = trimmed.replace(/\s/g, '');
    if (/^\d{8}$|^\d{12,14}$/.test(digits)) {
      res.kind = 'product-only';
      res.gtin = toGtin14(digits); res.productCode = res.gtin;
      if (!checkDigitOk(digits)) res.warnings.push('Check digit is wrong, so the read may be damaged.');
      if (/^3400\d{9}$/.test(digits) || /^03400\d{9}$/.test(digits)) res.codeLabel = 'French CIP13 (a product code)';
      else if (digits.length === 13) res.codeLabel = 'EAN-13';
      else if (digits.length === 12) res.codeLabel = 'UPC-A';
      else if (digits.length === 8) res.codeLabel = 'EAN-8';
      else res.codeLabel = 'GTIN-14';
      return res;
    }
    res.kind = 'other';
    res.warnings.push('Not a product code or GS1 data. Shown as raw text only.');
    return res;
  }

  var api = { parseScan: parseScan, checkDigitOk: checkDigitOk, toGtin14: toGtin14, dateFromYYMMDD: dateFromYYMMDD, GS: GS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GS1 = api;
})(typeof window !== 'undefined' ? window : globalThis);
