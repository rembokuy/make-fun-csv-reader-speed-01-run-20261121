// solve.js — a fast drop-in for csv-reader 1.0.0.
//
// Hand-written from the competition's prose spec (RULES.txt), no
// dependencies, no copied code. run(input) answers for {text, header}
// exactly what csv-reader 1.0.0 returns: {columns, rows, errors}.
//
// How it stays fast:
// - One left-to-right pass; unquoted field ends are found with indexOf
//   (no per-field match object), and a lone CR inside a field falls
//   back to a careful scan that runs only when one is really there.
// - Field values are sliced whole, never built character by character.
// - A quoted field is scanned for its closing quote with indexOf;
//   its content is only re-processed when it actually holds a CR, a
//   LF, or a doubled quote.
// - Error objects are created only when an error really happens; while
//   a record is being read only its error codes are collected, and they
//   are stamped with the record's start line and row index when the
//   record ends.

const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const QUOTE = 34; // "
const BOM = 0xfeff;

export function run(input) {
  let s = input.text;
  if (typeof s !== "string") s = String(s);
  const header = input.header === true;
  const N = s.length;

  let i = 0;
  if (s.charCodeAt(0) === BOM) i = 1;
  let line = 1;

  const rows = [];
  const errors = [];
  let columns = null;
  let width = 0;
  let haveWidth = false;

  // Finds the next field/record delimiter: comma, CR, or LF.
  const delim = /[,\r\n]/g;
  // Line breaks inside a quoted field: CRLF and lone CR each become one
  // LF in the value and count as one line.
  const brk = /\r\n?|\n/g;

  // Reused out-box for the unquoted reader, so no object is allocated
  // per field. u.end: 0 = comma, 1 = LF, 2 = CRLF, 3 = EOF.
  // u.pos is the delimiter's index (or N at EOF).
  const u = { value: "", end: 3, pos: N };

  // True once the record being read has consumed a character that is
  // not a lone CR. A record of one empty field that consumed only lone
  // CRs is no record at all (see the discard check below).
  let touched = false;

  // Read one unquoted field starting at `start`, beginning with the
  // value `init`. Appends "stray_cr" to `errs` for every lone CR it
  // drops. Sets u.value / u.end / u.pos. A quote inside is literal.
  // Delimiters are found with indexOf (no per-field match object),
  // and a lone CR inside the field falls back to the careful scan.
  function readUnquoted(start, init, errs) {
    let val = init;
    let p = start;
    for (;;) {
      const c = s.indexOf(",", p);
      const n = s.indexOf("\n", p);
      if (c === -1 && n === -1) {
        if (p < N) {
          const rest = s.slice(p);
          if (rest.indexOf("\r") === -1) {
            val += rest;
            touched = true;
          } else {
            return readUnquotedSlow(p, val, errs);
          }
        }
        u.value = val;
        u.end = 3;
        u.pos = N;
        return u;
      }
      let m;
      let kind;
      if (n === -1 || (c !== -1 && c < n)) {
        m = c;
        kind = 0;
      } else {
        m = n;
        kind = 1;
      }
      let end = m;
      if (kind === 1 && m > p && s.charCodeAt(m - 1) === CR) {
        end = m - 1;
        kind = 2;
      }
      if (end > p) {
        const seg = s.slice(p, end);
        if (seg.indexOf("\r") === -1) {
          val += seg;
          touched = true;
        } else {
          return readUnquotedSlow(p, val, errs);
        }
      }
      u.value = val;
      u.pos = end;
      u.end = kind;
      return u;
    }
  }

  // Careful unquoted read, used only when a lone CR sits inside the
  // field. Same contract as readUnquoted.
  function readUnquotedSlow(start, init, errs) {
    let val = init;
    let p = start;
    for (;;) {
      delim.lastIndex = p;
      const m = delim.exec(s);
      if (m === null) {
        if (p < N) {
          val += s.slice(p);
          touched = true;
        }
        u.value = val;
        u.end = 3;
        u.pos = N;
        return u;
      }
      const d = m.index;
      const c = s.charCodeAt(d);
      if (c === CR && s.charCodeAt(d + 1) !== LF) {
        errs.push("stray_cr");
        if (d > p) {
          val += s.slice(p, d);
          touched = true;
        }
        p = d + 1;
        continue;
      }
      if (d > p) {
        val += s.slice(p, d);
        touched = true;
      }
      u.value = val;
      u.pos = d;
      u.end = c === COMMA ? 0 : c === LF ? 1 : 2;
      return u;
    }
  }

  // Error codes carried over from discarded record(s): a line holding
  // only lone CRs makes no record, but its stray_cr errors are still
  // recorded, stamped with the next record that is actually read.
  let pending = null;

  for (;;) {
    // Before each record, skip blank lines (LF alone, or CRLF),
    // counting lines. A lone CR here is not a line break: it goes
    // into the field reading below and is dropped as stray_cr.
    while (i < N) {
      const c = s.charCodeAt(i);
      if (c === LF) {
        i++;
        line++;
      } else if (c === CR && s.charCodeAt(i + 1) === LF) {
        i += 2;
        line++;
      } else {
        break;
      }
    }
    if (i >= N) break;

    const startLine = line;
    touched = false;
    const fields = [];
    const recErrs = [];
    let endKind = 3; // 0 = comma, 1 = LF, 2 = CRLF, 3 = EOF

    // Read the record's fields until it ends.
    for (;;) {
      let value;
      if (s.charCodeAt(i) === QUOTE) {
        // ---- quoted field ----
        touched = true;
        let pos = i + 1;
        let hasDoubles = false;
        let close = -1;
        for (;;) {
          const q = s.indexOf('"', pos);
          if (q === -1) break;
          if (s.charCodeAt(q + 1) === QUOTE) {
            hasDoubles = true;
            pos = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close === -1) {
          // Unterminated quote: the opening quote becomes a literal
          // character and the text after it is re-read as an unquoted
          // field. The scan above never moved `line`, so the line
          // number is already the line the quote opened on.
          recErrs.push("unterminated_quote");
          readUnquoted(i + 1, '"', recErrs);
          value = u.value;
          endKind = u.end;
          i = u.pos;
        } else {
          // Build the value from the content [i+1, close). The fast
          // path is a plain slice; only content holding a CR, a LF,
          // or doubled quotes needs re-processing.
          let c = s.slice(i + 1, close);
          const hasCR = c.indexOf("\r") !== -1;
          const hasNL = c.indexOf("\n") !== -1;
          if (hasCR) {
            let breaks = 0;
            c = c.replace(brk, () => {
              breaks++;
              return "\n";
            });
            line += breaks;
          } else if (hasNL) {
            let breaks = 0;
            let p = -1;
            while ((p = c.indexOf("\n", p + 1)) !== -1) breaks++;
            line += breaks;
          }
          if (hasDoubles) c = c.split('""').join('"');
          value = c;

          const after = close + 1;
          if (after >= N) {
            i = N;
            endKind = 3;
          } else {
            const nc = s.charCodeAt(after);
            if (nc === COMMA) {
              i = after;
              endKind = 0;
            } else if (nc === LF) {
              i = after;
              endKind = 1;
            } else if (nc === CR && s.charCodeAt(after + 1) === LF) {
              i = after;
              endKind = 2;
            } else {
              // Junk after the closing quote: appended as it stands,
              // read with the unquoted rules (a stray_cr in the tail
              // is recorded before quote_junk). It only counts as
              // quote_junk when it adds at least one character.
              const beforeLen = value.length;
              readUnquoted(after, value, recErrs);
              value = u.value;
              if (value.length > beforeLen) recErrs.push("quote_junk");
              endKind = u.end;
              i = u.pos;
            }
          }
        }
      } else {
        // ---- unquoted field ----
        readUnquoted(i, "", recErrs);
        value = u.value;
        endKind = u.end;
        i = u.pos;
      }
      fields.push(value);
      if (endKind === 0) {
        i++; // comma: read one more field
        continue;
      }
      if (endKind === 1) {
        i++;
        line++;
        break;
      }
      if (endKind === 2) {
        i += 2;
        line++;
        break;
      }
      break; // EOF
    }

    // A line holding only lone CRs makes no record. Its field-level
    // errors are carried over to the next record that is read.
    if (fields.length === 1 && !touched) {
      if (pending === null) pending = recErrs;
      else pending.push(...recErrs);
      continue;
    }

    // Stamp this record's field-level errors (carried ones first, in
    // scan order) with the line the record started on and its index
    // in rows (null while the header is being read).
    const rowIdx = header && !haveWidth ? null : rows.length;
    if (pending !== null) {
      for (let k = 0; k < pending.length; k++) {
        errors.push({ code: pending[k], line: startLine, row: rowIdx });
      }
      pending = null;
    }
    for (let k = 0; k < recErrs.length; k++) {
      errors.push({ code: recErrs[k], line: startLine, row: rowIdx });
    }

    // Commit the record. The first record sets the width; later
    // records are padded (short_row) or cut (long_row) to it, and the
    // width error is recorded when the record ends, after its
    // field-level errors.
    if (!haveWidth) {
      width = fields.length;
      haveWidth = true;
      if (header) {
        columns = fields;
        continue;
      }
      rows.push(fields);
      continue;
    }
    if (fields.length < width) {
      const n = fields.length;
      while (fields.length < width) fields.push("");
      errors.push({ code: "short_row", line: startLine, row: rowIdx, fields: n });
    } else if (fields.length > width) {
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: "long_row", line: startLine, row: rowIdx, extra });
    }
    rows.push(fields);
  }

  if (!haveWidth) columns = header ? [] : null;
  return { columns, rows, errors };
}
