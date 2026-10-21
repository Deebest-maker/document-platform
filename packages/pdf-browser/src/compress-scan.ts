// Content-stream scanner. It tracks only the graphics-state operators needed to
// find how large each image is drawn: q, Q, cm and Do. Everything else is
// tokenised and ignored. Input is untrusted and may be malformed.

export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = Object.freeze([1, 0, 0, 1, 0, 0]) as Matrix;

// PDF uses row vectors: applying `m` first and then `n` is m x n (ISO 32000-1
// section 8.3.4).
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export interface ScanBudget {
  remaining: number;
}

export type DoCallback = (name: string, ctm: Matrix) => void;

const MAX_STATE_DEPTH = 4096;

const isWhite = (c: number) =>
  c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelimiter = (c: number) =>
  c === 40 ||
  c === 41 ||
  c === 60 ||
  c === 62 ||
  c === 91 ||
  c === 93 ||
  c === 123 ||
  c === 125 ||
  c === 47 ||
  c === 37;
const isRegular = (c: number) => !isWhite(c) && !isDelimiter(c);

function hexValue(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

// Names may carry #xx escapes (ISO 32000-1 section 7.3.5).
export function decodeName(
  bytes: Uint8Array,
  start: number,
  end: number,
): string {
  let out = "";
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (c === 35 && i + 2 < end) {
      const hi = hexValue(bytes[i + 1]);
      const lo = hexValue(bytes[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out += String.fromCharCode(hi * 16 + lo);
        i += 2;
        continue;
      }
    }
    out += String.fromCharCode(c);
  }
  return out;
}

// Parses a PDF number from bytes[start, end). Returns NaN when it is not one.
function parseNumber(bytes: Uint8Array, start: number, end: number): number {
  let i = start;
  let sign = 1;
  if (bytes[i] === 43 || bytes[i] === 45) {
    if (bytes[i] === 45) sign = -1;
    i++;
  }
  let value = 0;
  let digits = 0;
  while (i < end && bytes[i] >= 48 && bytes[i] <= 57) {
    value = value * 10 + (bytes[i] - 48);
    i++;
    digits++;
  }
  if (i < end && bytes[i] === 46) {
    i++;
    let scale = 0.1;
    while (i < end && bytes[i] >= 48 && bytes[i] <= 57) {
      value += (bytes[i] - 48) * scale;
      scale /= 10;
      i++;
      digits++;
    }
  }
  return i === end && digits > 0 ? sign * value : Number.NaN;
}

function isBinaryByte(c: number): boolean {
  return !isWhite(c) && (c < 0x20 || c > 0x7e);
}

// Returns the offset just after the "EI" that ends an inline image whose
// dictionary starts at `from`, or -1 when none is found.
function skipInlineImage(bytes: Uint8Array, from: number): number {
  const n = bytes.length;
  let k = from;
  // Find the "ID" operator that starts the data.
  while (k + 1 < n) {
    if (
      bytes[k] === 73 &&
      bytes[k + 1] === 68 &&
      k > 0 &&
      isWhite(bytes[k - 1]) &&
      (k + 2 >= n || isWhite(bytes[k + 2]))
    )
      break;
    k++;
  }
  if (k + 1 >= n) return -1;
  k += 3;
  while (k + 1 < n) {
    if (
      bytes[k] === 69 &&
      bytes[k + 1] === 73 &&
      isWhite(bytes[k - 1]) &&
      (k + 2 >= n || isWhite(bytes[k + 2]))
    ) {
      // Reject a coincidental "EI" inside binary data: real content follows an
      // inline image as text operators.
      let binaryAfter = false;
      for (let j = k + 2; j < Math.min(n, k + 12); j++)
        if (isBinaryByte(bytes[j])) {
          binaryAfter = true;
          break;
        }
      if (!binaryAfter) return k + 2;
    }
    k++;
  }
  return -1;
}

// Scans a content stream and reports every `Do` with the current transformation
// matrix. Returns false when the result cannot be trusted (budget exhausted,
// unbalanced nesting beyond the cap, or an unterminated inline image).
export function scanContentStream(
  bytes: Uint8Array,
  onDo: DoCallback,
  budget: ScanBudget,
): boolean {
  budget.remaining -= bytes.length;
  if (budget.remaining < 0) return false;
  const n = bytes.length;
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let numbers: number[] = [];
  let lastName: string | undefined;
  let i = 0;
  while (i < n) {
    const c = bytes[i];
    if (isWhite(c)) {
      i++;
      continue;
    }
    if (c === 37) {
      // comment
      while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++;
      continue;
    }
    if (c === 40) {
      // literal string, with balanced parentheses and escapes
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const x = bytes[i];
        if (x === 92) i++;
        else if (x === 40) depth++;
        else if (x === 41) depth--;
        i++;
      }
      numbers = [];
      lastName = undefined;
      continue;
    }
    if (c === 60) {
      if (bytes[i + 1] === 60) {
        i += 2; // dictionary start
        continue;
      }
      while (i < n && bytes[i] !== 62) i++; // hex string
      i++;
      continue;
    }
    if (
      c === 62 ||
      c === 91 ||
      c === 93 ||
      c === 123 ||
      c === 125 ||
      c === 41
    ) {
      i++;
      continue;
    }
    // Name or regular token.
    let j = i + 1;
    while (j < n && isRegular(bytes[j])) j++;
    if (c === 47) {
      lastName = decodeName(bytes, i + 1, j);
      i = j;
      continue;
    }
    const length = j - i;
    const value = parseNumber(bytes, i, j);
    if (!Number.isNaN(value)) {
      numbers.push(value);
      if (numbers.length > 64) numbers = numbers.slice(-6);
      i = j;
      continue;
    }
    // Operator.
    if (length === 1 && c === 113) {
      // q
      if (stack.length >= MAX_STATE_DEPTH) return false;
      stack.push(ctm);
    } else if (length === 1 && c === 81) {
      // Q
      const restored = stack.pop();
      if (restored) ctm = restored;
    } else if (length === 2 && c === 99 && bytes[i + 1] === 109) {
      // cm
      if (numbers.length >= 6) {
        const v = numbers.slice(-6);
        ctm = multiply([v[0], v[1], v[2], v[3], v[4], v[5]], ctm);
      }
    } else if (length === 2 && c === 68 && bytes[i + 1] === 111) {
      // Do
      if (lastName !== undefined) onDo(lastName, ctm);
    } else if (length === 2 && c === 66 && bytes[i + 1] === 73) {
      // BI ... ID <binary> EI
      const end = skipInlineImage(bytes, j);
      if (end < 0) return false;
      j = end;
    }
    numbers = [];
    lastName = undefined;
    i = j;
  }
  return true;
}
