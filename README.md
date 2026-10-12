# Pack Scan (prototype)

A phone-friendly web page that reads a medicine pack's code and shows the product code, lot, expiry and serial number. Static files only. Nothing is sent anywhere: the scan log and any saved links stay in the browser on the device.

Live page (once GitHub Pages is on): https://mtpwjones.github.io/pack-scan/

## What it reads
- GS1 2D codes (DataMatrix, QR): product code, lot, expiry, made date, serial, when the maker printed them.
- Ordinary barcodes (EAN-13, UPC, CIP13): product code only. The printed lot and expiry are typed in.
- Camera scan, "Take photo", "Choose image", or typed/pasted text (hand scanners type into the text box).
- Live camera needs a secure (https) page. Photo mode works anywhere.

## Files
- `index.html`, `style.css`, `app.js`: the page.
- `gs1.js`: GS1 parsing, check digit, end-of-month rule. Runs in the browser and in Node.
- `vendor/`: zxing-wasm 3.1.4 (reader build, unmodified, Apache-2.0 licence included).

## Tested (2026-10-12, headless Chromium, real photos)
A French pack's 2D code was read in one scan (product, lot, expiry, made date; that code held no serial). An ordinary EAN-13 was read as product only. Not tested: the live camera, and phones.

## Not built
Offline use, stock tracking, connection to any inventory system, label printing.
