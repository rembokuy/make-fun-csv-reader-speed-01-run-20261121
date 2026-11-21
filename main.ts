// main.ts — driver for the csv-reader-speed-01-run-20261121 entry.
//
// Reads every case from /input/cases.json (or $MAKEFUN_INPUT_DIR), answers
// each one on its own with run() from solve.js, and writes the answers in
// case order to /output/answers.json (or $MAKEFUN_OUTPUT_DIR), with no
// extra indentation. V8's incremental marking is switched off before
// solve.js is imported, so all of the parser's work runs under it.
import { setFlagsFromString } from "node:v8";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

setFlagsFromString("--no-incremental-marking");

const { run } = await import("./solve.js");

// JIT warm-up: the grader runs the six cases once, so the parser would
// otherwise run most of its first pass unoptimized. A short synthetic
// input that walks every branch (quoted, doubled quotes, embedded
// LF/CR, junk tail, unterminated quote, stray CR, short/long rows,
// blank lines, BOM, both header modes) gets the hot code compiled
// before the real cases run. Its answers are thrown away; it changes
// nothing about the cases' answers.
const WARM_BLOCK =
  'a,b,"c""d",e\r\n' +
  '"x\ny",2,3,4\r\n' +
  '"p\rq",5,6,7\r\n' +
  '"r\r\ns",8,9,10\r\n' +
  '"t"junk,11,12,13\r\n' +
  '"unterminated,14,15\r\n' +
  "plain\rlone,16,17,18\r\n" +
  "\r\n" +
  "19,20\r\n" +
  "21,22,23,24,25,26\r\n";
run({ text: "\ufeff" + WARM_BLOCK.repeat(40), header: true });
run({ text: WARM_BLOCK.repeat(10), header: false });

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const cases = JSON.parse(readFileSync(`${inputDir}/cases.json`, "utf8"));
const answers = [];
for (let k = 0; k < cases.length; k++) answers.push(run(cases[k].input));
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/answers.json`, JSON.stringify(answers));
