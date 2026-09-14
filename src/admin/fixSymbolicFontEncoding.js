/**
 * Works around a real pdf.js bug that showed up with PDFs from at least one
 * real-world producer (this file's fonts are named e.g. "EAAAAA+LiberationSans"
 * — LibreOffice's own subsetting naming scheme): a Symbolic TrueType font
 * with no /Encoding dictionary, whose codes are just a compact 0..N index
 * into its own embedded (1,0) Mac-Roman cmap subtable (a construction the
 * PDF spec explicitly allows). Verified by hand — extracting and rendering
 * this file's actual embedded glyph outlines directly, bypassing pdf.js
 * entirely, reproduces every letter correctly — so the file's font data is
 * fine; a spec-literal reader would show it correctly.
 *
 * pdf.js's own fallback for "Symbolic TrueType, no /Encoding" instead
 * assumes the *standard* MacRomanEncoding table applies to interpret each
 * code (pdf.worker.mjs, the `encoding = MacRomanEncoding` branch for
 * symbolic fonts with no baseEncodingName), which is wrong for a font like
 * this one where code 33 is simply "whichever glyph got subset-index 33"
 * — coincidentally NOT what MacRomanEncoding's fixed table says code 33
 * means ("exclam"). That wrong glyph NAME then gets converted back to a
 * Unicode value and silently overrides the correct one from the font's own
 * (also embedded, and correct) ToUnicode CMap — see toFontChar in
 * pdf.worker.mjs. This is the same for every engine (Chrome, Safari, or
 * anything else pdf.js runs on), which is why switching browsers, and
 * disableFontFace, never changed anything about it.
 *
 * The fix: an explicit /Differences array takes priority over that fallback
 * (`this.differences[charCode] || this.defaultEncoding[charCode]` in
 * pdf.worker.mjs) — so this finds any font shaped like the one above and
 * appends one, built straight from that font's own (correct) ToUnicode
 * data, using pdf.js's own supported "uniXXXX" glyph-name convention
 * (confirmed in its getUnicodeForGlyph) so no glyph-name table is needed.
 *
 * Appended as a PDF incremental update — new revised copies of just the
 * affected font objects, plus a new xref/trailer pointing at them — which
 * is how PDF readers are meant to receive amendments: it never rewrites or
 * removes a single existing byte, so a bug here can at worst leave a
 * preview looking like it did before, never touch the real stored PDF (this
 * only ever runs on an in-memory copy for generating the shop's preview
 * images), and falls back to the unpatched bytes automatically if anything
 * about a given file doesn't match what it expects.
 */

const isDigit = (c) => c >= 0x30 && c <= 0x39;

function bytesToBinaryString(bytes) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return out;
}

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Byte offset range [start, end) of "N 0 obj<<...>>" (dict only, no stream) for a given object number. */
function findObjectDict(text, objNum) {
  const re = new RegExp(`(^|[^0-9])${objNum}\\s+0\\s+obj\\s*<<`, "g");
  const m = re.exec(text);
  if (!m) return null;
  const dictStart = m.index + m[0].length; // just after "<<"
  const dictEnd = text.indexOf(">>", dictStart);
  if (dictEnd === -1) return null;
  return { headerStart: m.index + m[1].length, dictStart, dictEnd };
}

/** Raw bytes of "N 0 obj<<...>>stream\r?\n...\r?\nendstream", decompressed if FlateDecode. */
async function getStreamData(bytes, text, objNum) {
  const loc = findObjectDict(text, objNum);
  if (!loc) return null;
  const dictText = text.slice(loc.dictStart, loc.dictEnd);
  const streamKwStart = text.indexOf("stream", loc.dictEnd);
  if (streamKwStart === -1) return null;
  let dataStart = streamKwStart + "stream".length;
  if (text[dataStart] === "\r") dataStart++;
  if (text[dataStart] === "\n") dataStart++;
  const dataEnd = text.indexOf("endstream", dataStart);
  if (dataEnd === -1) return null;
  let raw = bytes.subarray(dataStart, dataEnd);
  // trailing EOL before "endstream" isn't part of the data
  while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
    raw = raw.subarray(0, raw.length - 1);
  }
  if (dictText.includes("/FlateDecode")) raw = await inflate(raw);
  return raw;
}

/** Parses a ToUnicode CMap's beginbfchar/beginbfrange blocks into a Map<code, unicodeCodePoint>. */
function parseToUnicodeCMap(text) {
  const map = new Map();
  const hex = (s) => parseInt(s, 16);

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      // A multi-UTF-16-unit destination (surrogate pair etc.) isn't something
      // "uniXXXX" can express — skip rather than emit a wrong single value.
      if (m[2].length > 4) continue;
      map.set(hex(m[1]), hex(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (m[3].length > 4) continue;
      const lo = hex(m[1]), hi = hex(m[2]), dst = hex(m[3]);
      for (let c = lo; c <= hi; c++) map.set(c, dst + (c - lo));
    }
  }
  return map;
}

/**
 * @param {Uint8Array} bytes Original PDF bytes.
 * @returns {Promise<Uint8Array>} The same bytes, or — if any font matching
 *   the broken pattern was found — those bytes plus an appended incremental
 *   update correcting them. Never throws; falls back to the original bytes
 *   on absolutely anything unexpected, since this is a best-effort patch of
 *   an in-memory copy only, not something that should ever block an upload.
 */
export async function fixSymbolicFontEncoding(bytes) {
  try {
    const text = bytesToBinaryString(bytes);
    const patches = []; // { objNum, newDictText }

    for (const m of text.matchAll(/(\d+)\s+0\s+obj\s*<</g)) {
      const objNum = m[1];
      const loc = findObjectDict(text, objNum);
      if (!loc) continue;
      const dict = text.slice(loc.dictStart, loc.dictEnd);
      if (!/\/Subtype\s*\/TrueType/.test(dict)) continue;
      if (/\/Encoding\b/.test(dict)) continue; // already has one — nothing to override
      const tuMatch = dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
      if (!tuMatch) continue;

      const tuBytes = await getStreamData(bytes, text, tuMatch[1]);
      if (!tuBytes) continue;
      const tuText = bytesToBinaryString(tuBytes);
      const codeMap = parseToUnicodeCMap(tuText);
      if (codeMap.size === 0) continue;

      const maxCode = Math.max(...codeMap.keys());
      const names = [];
      for (let code = 0; code <= maxCode; code++) {
        const u = codeMap.get(code);
        names.push(u === undefined ? "/.notdef" : `/uni${u.toString(16).toUpperCase().padStart(4, "0")}`);
      }
      const differences = `/Encoding<</Differences[0 ${names.join(" ")}]>>`;
      patches.push({ objNum, newDictText: differences + dict });
    }

    if (patches.length === 0) return bytes;

    const rootMatch = text.match(/trailer\s*<<[^]*?\/Root\s+(\d+\s+0\s+R)/);
    const startxrefMatches = [...text.matchAll(/startxref\s+(\d+)/g)];
    if (!rootMatch || startxrefMatches.length === 0) return bytes; // unexpected shape — don't guess

    const prevStartXref = startxrefMatches[startxrefMatches.length - 1][1];
    const sizeMatch = text.match(/trailer\s*<<[^]*?\/Size\s+(\d+)/);
    const size = sizeMatch ? Math.max(parseInt(sizeMatch[1], 10), ...patches.map((p) => parseInt(p.objNum, 10) + 1)) : Math.max(...patches.map((p) => parseInt(p.objNum, 10) + 1));

    let appended = "\n";
    const offsets = [];
    for (const { objNum, newDictText } of patches) {
      offsets.push({ objNum, offset: bytes.length + appended.length });
      appended += `${objNum} 0 obj<<${newDictText}>>endobj\n`;
    }
    const xrefOffset = bytes.length + appended.length;
    appended += "xref\n";
    for (const { objNum, offset } of offsets) {
      appended += `${objNum} 1\n${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    appended += `trailer\n<</Size ${size}/Root ${rootMatch[1]}/Prev ${prevStartXref}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    const appendedBytes = new Uint8Array(appended.length);
    for (let i = 0; i < appended.length; i++) appendedBytes[i] = appended.charCodeAt(i);

    const out = new Uint8Array(bytes.length + appendedBytes.length);
    out.set(bytes, 0);
    out.set(appendedBytes, bytes.length);
    return out;
  } catch {
    return bytes; // best-effort — never block a real upload over this
  }
}
