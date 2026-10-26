#!/usr/bin/env node
/**
 * Tests for the pure detection helpers inside deepseek-latex-rescue.user.js.
 *
 * They are extracted from the userscript rather than duplicated, so the test
 * always exercises the code that ships.
 *
 *   node test/detection.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, '..', 'deepseek-latex-rescue.user.js');
const source = readFileSync(scriptPath, 'utf8');

const start = source.indexOf('const CJK_RE');
const end = source.indexOf('/* ---------- KaTeX 样式');
if (start < 0 || end < 0) {
  throw new Error('Could not locate the detection helpers in the userscript.');
}

const helpers = new Function(
  source.slice(start, end) +
    '\nreturn { isMathPiece, isResidual, looksLikeBareLatex, normalizeLatex, runsFromDescriptors };'
)();

const piece = (text, kind) => ({ node: {}, br: kind === 'br', skip: kind === 'skip', text });

/* The two paragraphs below reproduce the real DOM of the reported conversation. */
const FORMULA_A =
  '\\frac{\\partial f_\\alpha(x)}{\\partial \\alpha} = f_\\alpha(x) \\cdot \\frac{\\partial}{\\partial \\alpha}' +
  ' \\big[\\alpha t(x) - \\psi(\\alpha)\\big] = f_\\alpha(x) \\big[t(x) - \\psi\'(\\alpha)\\big]';

const FORMULA_B = '\\int \\frac{\\partial f_\\alpha(x)}{\\partial \\alpha} \\mathrm{d}x = 0';

const cases = [];

function check(name, actual, expected) {
  const ok = actual === expected;
  cases.push({ name, ok, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function run(descs) {
  return helpers.runsFromDescriptors(descs).map((run) => {
    const text = run.map((d) => d.text).join('');
    return helpers.looksLikeBareLatex(text) ? helpers.normalizeLatex(text) : '(rejected)';
  });
}

/* 1. formula + residual "]" + Chinese italic note in one <p> */
const p1 = [
  piece(FORMULA_A),
  piece('\n', 'br'),
  piece(']'),
  piece('\n', 'br'),
  piece(''),
  piece('(这个式子极其关键，下面全靠它！)')
];
check('mixed paragraph with residual ] is repaired', JSON.stringify(run(p1)), JSON.stringify([FORMULA_A]));

/* 2. formula + residual "]" followed by Chinese prose and rendered inline math */
const p2 = [piece(FORMULA_B), piece('\n', 'br'), piece(']'), piece('\n', 'br'), piece('把刚刚算的 '), piece('', 'skip')];
check('formula followed by prose is repaired', JSON.stringify(run(p2)), JSON.stringify([FORMULA_B]));

/* 3. prose-only paragraph with rendered inline math */
const p3 = [piece('现在，等式两边同时对 '), piece('', 'skip'), piece(' 求导：')];
check('prose paragraph produces no run', JSON.stringify(run(p3)), '[]');

/* 4. English prose that mentions two LaTeX commands must be rejected */
const p4 = [piece('The ratio \\frac{a}{b} and \\sqrt{x} is small here')];
check('English prose is rejected', JSON.stringify(run(p4)), JSON.stringify(['(rejected)']));

/* 5. inline-only paragraph: no \commands at top level */
check('inline math paragraph is ignored', helpers.looksLikeBareLatex('x = 1 and y = 2'), false);

/* 6. single-command short fragment is too weak to act on */
check('single command is too weak', helpers.looksLikeBareLatex('\\frac{a}{b}'), false);

/* 7. $...$ block is normalised */
check('dollar block is unwrapped', helpers.normalizeLatex('$$\\frac{a}{b} = c + \\sqrt{d}$$'), '\\frac{a}{b} = c + \\sqrt{d}');

/* 8. \[...\] around aligned is unwrapped */
check(
  'bracket block is unwrapped',
  helpers.normalizeLatex('\\[\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\\]'),
  '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}'
);

/* 9. code-like and URL text never triggers */
check('code line is ignored', helpers.looksLikeBareLatex('npm install katex --save-dev'), false);
check('URL is ignored', helpers.looksLikeBareLatex('\\frac{a}{b} https://example.com \\sqrt{x}'), false);

const failed = cases.filter((c) => !c.ok);
console.log(`\n${cases.length - failed.length}/${cases.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
