/**
 * Tests for the Path Collision Resolver core.
 *
 * Every test is deterministic: `exists` is a plain predicate over a Set,
 * and the timestamp clock is a hand-rolled counter. No wall-clock time,
 * no sleeps, no floats compared with ===.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveName,
  resolveTimestampName,
  buildName,
  buildTimestampName,
  SUFFIX_SEPARATOR,
  DEFAULT_BASE,
  timestampToBase36,
  InvalidArgumentError,
} from '../src/index.js';

/** Build an `exists` predicate whose "taken" set is the given names. */
function makeExists(taken) {
  const set = new Set(taken);
  return (path) => set.has(path);
}

/** Clock that returns successive integers starting at `start`. */
function makeCounterClock(start = 1) {
  let n = start;
  return () => n++;
}

test('resolveName returns the original name when nothing collides', () => {
  const exists = makeExists([]);
  assert.equal(resolveName('report.pdf', exists), 'report.pdf');
});

test('resolveName appends ~1 on a single collision', () => {
  const exists = makeExists(['report.pdf']);
  assert.equal(resolveName('report.pdf', exists), 'report.pdf~1');
});

test('resolveName keeps the extension after the suffix', () => {
  const exists = makeExists(['photo.tar.gz']);
  assert.equal(resolveName('photo.tar.gz', exists), 'photo.tar.gz~1');
});

test('resolveName skips taken numeric suffixes', () => {
  const exists = makeExists(['data.bin', 'data.bin~1', 'data.bin~2']);
  assert.equal(resolveName('data.bin', exists), 'data.bin~3');
});

test('resolveName treats a leading-dot filename as having no extension', () => {
  const exists = makeExists(['.gitignore']);
  assert.equal(resolveName('.gitignore', exists), '.gitignore~1');
});

test('resolveName handles names with no extension', () => {
  const exists = makeExists(['README']);
  assert.equal(resolveName('README', exists), 'README~1');
});

test('resolveName throws when maxAttempts is exceeded', () => {
  // Every candidate collides, so the loop runs out of room.
  const exists = () => true;
  assert.throws(
    () => resolveName('doc.txt', exists, { maxAttempts: 5 }),
    /exhausted 5 attempts/,
  );
});

test('resolveName rejects a non-function exists', () => {
  assert.throws(
    () => resolveName('doc.txt', null),
    (err) => err instanceof InvalidArgumentError,
  );
});

test('resolveName rejects a non-positive maxAttempts', () => {
  const exists = makeExists([]);
  assert.throws(
    () => resolveName('doc.txt', exists, { maxAttempts: 0 }),
    (err) => err instanceof InvalidArgumentError,
  );
});

test('resolveTimestampName returns the original name when nothing collides', () => {
  const exists = makeExists([]);
  const clock = makeCounterClock();
  assert.equal(resolveTimestampName('note.md', exists, clock), 'note.md');
});

test('resolveTimestampName uses the clock value on collision', () => {
  const exists = makeExists(['note.md']);
  const clock = makeCounterClock(100);
  // clock() returns 100 -> base36 is '2s'
  assert.equal(resolveTimestampName('note.md', exists, clock), 'note.md~2s');
});

test('resolveTimestampName advances the clock until a free slot is found', () => {
  const taken = new Set(['app.log', 'app.log~2s']);
  const exists = (p) => taken.has(p);
  const clock = makeCounterClock(100); // 100 -> '2s' (taken), 101 -> '2t' (free)
  assert.equal(resolveTimestampName('app.log', exists, clock), 'app.log~2t');
});

test('timestampToBase36 encodes zero and small values', () => {
  assert.equal(timestampToBase36(0), '0');
  assert.equal(timestampToBase36(1), '1');
  assert.equal(timestampToBase36(35), 'z');
  assert.equal(timestampToBase36(36), '10');
});

test('timestampToBase36 rejects non-safe-integers', () => {
  assert.throws(
    () => timestampToBase36(-1),
    (err) => err instanceof InvalidArgumentError,
  );
  assert.throws(
    () => timestampToBase36(Number.MAX_SAFE_INTEGER + 1),
    (err) => err instanceof InvalidArgumentError,
  );
});

test('buildName with index 0 returns the bare name', () => {
  assert.equal(buildName('file', '.txt', 0), 'file.txt');
});

test('buildName appends the separator and index', () => {
  assert.equal(buildName('file', '.txt', 3), `file.txt${SUFFIX_SEPARATOR}3`);
});

test('buildName falls back to DEFAULT_BASE for empty input', () => {
  assert.equal(buildName('   ', '', 1), `${DEFAULT_BASE}${SUFFIX_SEPARATOR}1`);
});

test('buildTimestampName with stamp 0 returns the bare name', () => {
  assert.equal(buildTimestampName('file', '.log', 0), 'file.log');
});

test('buildTimestampName with a positive stamp encodes it', () => {
  // 1000 in base36 is 'rs'
  assert.equal(
    buildTimestampName('file', '.log', 1000),
    `file.log${SUFFIX_SEPARATOR}rs`,
  );
});
