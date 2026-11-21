[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/rembokuy/make-fun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/rembokuy/make-fun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# Read broken CSV files faster

A fast drop-in for make.fun's own csv-reader 1.0.0: `solve.js` reads a
broken CSV text exactly the way csv-reader does — same `{columns, rows,
errors}` for every `{text, header}` — and does it in clearly less CPU
time than the house baseline.

## How it works

`run(input)` makes a single left-to-right pass over the text:

- A U+FEFF at the very start is dropped; `header` counts only when it
  is exactly `true`.
- Blank lines (LF alone, or CRLF) are skipped before each record; a lone
  CR is not a line break — it is dropped with a `stray_cr` error.
- A record is comma-separated fields ending at LF, CRLF, or end of text;
  after a comma one more field is always read, even at end of text.
- A field that opens with a quote runs to the next quote that is not
  doubled (`""` inside is one quote); CRLF or a lone CR inside becomes
  one LF and counts one line. Junk after the closing quote is appended
  as it stands (`quote_junk`, when it adds a character); a quote that
  never closes becomes a literal character and the rest is re-read as
  an unquoted field (`unterminated_quote`).
- The first record sets the width; later records are padded with empty
  strings (`short_row`, with `fields`) or cut (`long_row`, with `extra`).
  A line holding only lone CRs makes no record, but its `stray_cr`
  errors are still recorded against the next record read.
- Every error is `{code, line, row}` in scan order, with `line` the
  1-based line its record started on and `row` its index in `rows`
  (`null` for the header).

## How it stays fast

- Delimiters are found with one native regex scan per field instead of
  a per-character loop; field values are sliced whole, never built
  character by character.
- A quoted field is scanned for its closing quote with `indexOf`; its
  content is only re-processed when it actually holds a CR, a LF, or a
  doubled quote.
- Error objects are created only when an error really happens; while a
  record is being read only its error codes are collected.
- `main.ts` switches V8's incremental marking off before importing
  `solve.js`, so all of the parser's work runs under it.

## Files

- `solve.js` — the parser, an ES module with no dependencies.
- `main.ts` — the driver: reads `/input/cases.json`, answers each case
  with `run`, writes `/output/answers.json`. Outside the container the
  directories move with `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR`.

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```
