# Pack Scan (prototype)

A phone-friendly web page that identifies a medicine pack: medication, expiry, dose and pack size, from its barcode or QR code or from text you type. Static files only. Nothing is sent anywhere: the scan log and any saved links stay in the browser on the device.

Live page (once GitHub Pages is on): https://mtpwjones.github.io/pack-scan/

## Two modes
- **Barcode / QR:** camera, photo or hand scanner. A 2D code can give product, lot and expiry; an ordinary barcode gives the product code only. The medication, dose and pack size come from a saved link between the product code and a line in your own list.
- **Free text:** type or paste what is on the box (for example `Sertraline 50 mg, 28 tablets, exp 03/2029`). The app reads the expiry, dose, pack size and lot, and suggests matching lines from your list.

The list of medication and pack names ("Name dose | 30 Tab" per line, or a JSON `labels` array) is loaded from a file on the device and never leaves it. It is not part of this repository.

## What it reads
- GS1 2D codes (DataMatrix, QR): product code, lot, expiry, made date, serial, when the maker printed them.
- Ordinary barcodes (EAN-13, UPC, CIP13): product code only. The printed lot and expiry are typed in.
- Camera scan, "Take photo", "Choose image", or typed/pasted text (hand scanners type into the text box).
- Live camera needs a secure (https) page. Photo mode works anywhere.

## Files
- `index.html`, `style.css`, `app.js`: the page.
- `gs1.js`: GS1 parsing, check digit, end-of-month rule. Runs in the browser and in Node.
- `freetext.js`: reads expiry, dose, pack size and lot from text and matches against the list (typos tolerated). Browser and Node.
- `vendor/`: zxing-wasm 3.1.4 (reader build, unmodified, Apache-2.0 licence included).

## Tested (2026-10-12, headless Chromium, real photos)
A French pack's 2D code was read in one scan (product, lot, expiry, made date; that code held no serial). An ordinary EAN-13 was read as product only. Not tested: the live camera, and phones.

## Not built
Offline use, stock tracking, connection to any inventory system, label printing.
