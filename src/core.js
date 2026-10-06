/**
 * Core implementation of the Path Collision Resolver.
 *
 * The library appends a distinguishing suffix to a filename when the
 * intended path is already taken. There are two strategies:
 *
 *   - Numeric: tries "name", "name~1", "name~2", ... using a stable,
 *     queryable ordering so retries on the same collision set are
 *     deterministic rather than depending on filesystem listing order.
 *   - Timestamp: tries "name", then "name~<base36-clock>". The clock
 *     is injected so tests can drive the exact value without touching
 *     wall-clock time.
 *
 * A few deliberate decisions, documented up front because they are the
 * most likely source of surprise:
 *
 *   1. The separator is '~'. Many tools use '.', '_', '-' or ' (1)'.
 *      We pick '~' because it is filename-safe on every common
 *      filesystem, rarely appears in human-authored names, and does
 *      not collide with extension splitting ('photo.png~1' keeps the
 *      extension visible, unlike 'photo.png.1').
 *
 *   2. Collisions are described by an injected `exists(path)` function.
 *      The library never touches the filesystem itself. That makes the
 *      behaviour pure given (exists, clock), which is what lets the tests
 *      be deterministic. Real callers wrap fs.existsSync or a remote
 *      object-store HEAD request — the library does not care which.
 *
 *   3. The numeric strategy does NOT scan the filesystem for existing
 *      'name~N' siblings. It only asks `exists` about candidate names it
 *      generates itself, starting from N=1. This means a pre-existing
 *      'name~5' created by some other tool is treated as opaque: we will
 *      happily return 'name~1' even if 'name~5' is taken, because we
 *      only know what `exists` tells us about the names we probe.
 *      Scanning for siblings would require a `list(dir)` injection and a
 *      much larger surface; that is a different library.
 *
 *   4. Timestamp mode uses base36 encoding of the millisecond clock so
 *      the suffix is short, sortable as a string for monotonically
 *      increasing clocks, and case-insensitively safe. The injected clock
 *      returns a non-negative integer; we do not try to format Date
 *      objects.
 */

/**
 * Separator inserted between the base name and a distinguishing suffix.
 * Exposed as a named export so callers can parse results back if needed.
 */
export const SUFFIX_SEPARATOR = '~';

/**
 * Default base string returned when an empty/whitespace-only input is
 * passed to buildName/buildTimestampName. The empty-string case is a
 * real edge (a caller trimming a filename to nothing), and returning ''
 * would produce a path like '/dir/~1' which is surprising. 'file' is a
 * neutral, safe fallback.
 */
export const DEFAULT_BASE = 'file';

/**
 * Thrown when a numeric argument is not a safe non-negative integer, or
 * when a non-function is passed where a callable is required. Using a
 * custom Error subclass keeps the `name` stable across environments
 * (some transpilers rename Error subclasses).
 */
export class InvalidArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

/**
 * Convert a non-negative integer to a lowercase base36 string.
 *
 * Base36 keeps timestamp suffixes short (a year-2038 millisecond clock
 * encodes in ~8 chars) and is a strict superset of decimal, so numeric
 * suffixes produced by buildName are also valid base36 — useful if a
 * caller ever switches strategies on the same file set.
 *
 * @param {number} n - non-negative integer
 * @returns {string} base36 encoding, at least one digit
 * @throws {InvalidArgumentError} if n is not a safe non-negative integer
 */
export function timestampToBase36(n) {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new InvalidArgumentError(
      `timestampToBase36 expects a non-negative safe integer, got ${String(n)}`,
    );
  }
  return n.toString(36);
}

/**
 * Split a filename into base and extension.
 *
 * Extension splitting uses the last dot. `archive.tar.gz` becomes base
 * `archive.tar`, ext `.gz`, so a collision yields `archive.tar.gz~1` —
 * the `.gz` stays visible. A leading-dot file like `.gitignore` is
 * treated as having no extension, so its decorated form is
 * `.gitignore~1`.
 *
 * @param {string} name
 * @returns {{base: string, ext: string}}
 */
function splitExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return { base: name, ext: '' };
  }
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Produce the candidate filename for a given base, extension, and numeric
 * suffix index. index === 0 means "no suffix" (the original name). For
 * index >= 1 the result is `${base}${ext}${SEP}${index}` — the suffix is
 * appended after the extension so 'photo.png~1' still ends in '.png'.
 *
 * @param {string} base - filename without extension
 * @param {string} ext - extension including leading dot, or ''
 * @param {number} index - non-negative integer
 * @returns {string}
 */
export function buildName(base, ext, index) {
  if (typeof base !== 'string' || typeof ext !== 'string') {
    throw new InvalidArgumentError('buildName: base and ext must be strings');
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new InvalidArgumentError(
      `buildName: index must be a non-negative integer, got ${String(index)}`,
    );
  }
  const safeBase = base.trim().length > 0 ? base : DEFAULT_BASE;
  const safeExt = ext.startsWith('.') || ext === '' ? ext : `.${ext}`;
  if (index === 0) {
    return `${safeBase}${safeExt}`;
  }
  return `${safeBase}${safeExt}${SUFFIX_SEPARATOR}${index}`;
}

/**
 * Produce the candidate filename for a timestamp (base36) suffix.
 * stamp === 0 means "no suffix" — the original name. This is deliberate:
 * a clock that starts at zero (common in tests) should not immediately
 * produce a decorated name for a path that does not collide.
 *
 * @param {string} base
 * @param {string} ext
 * @param {number} stamp - non-negative integer millisecond count
 * @returns {string}
 */
export function buildTimestampName(base, ext, stamp) {
  if (typeof base !== 'string' || typeof ext !== 'string') {
    throw new InvalidArgumentError(
      'buildTimestampName: base and ext must be strings',
    );
  }
  if (!Number.isSafeInteger(stamp) || stamp < 0) {
    throw new InvalidArgumentError(
      `buildTimestampName: stamp must be a non-negative integer, got ${String(stamp)}`,
    );
  }
  const safeBase = base.trim().length > 0 ? base : DEFAULT_BASE;
  const safeExt = ext.startsWith('.') || ext === '' ? ext : `.${ext}`;
  if (stamp === 0) {
    return `${safeBase}${safeExt}`;
  }
  return `${safeBase}${safeExt}${SUFFIX_SEPARATOR}${timestampToBase36(stamp)}`;
}

/**
 * Find a non-colliding name using incrementing numeric suffixes.
 *
 * Probes candidates in index order 0,1,2,... and returns the first for
 * which `exists(candidate)` is falsy. `maxAttempts` caps the probe count
 * (including index 0) so a pathological `exists` that always returns true
 * cannot loop forever. The default of 1000 is large enough for any
 * realistic collision set and small enough to fail fast on a stuck
 * filesystem entry.
 *
 * @param {string} name - desired filename (may include an extension)
 * @param {(path: string) => boolean} exists - predicate, must be callable
 * @param {{maxAttempts?: number}} [options]
 * @returns {string} the first non-colliding candidate
 * @throws {InvalidArgumentError} on bad arguments
 * @throws {Error} if every candidate within maxAttempts collides
 */
export function resolveName(name, exists, options = {}) {
  if (typeof name !== 'string') {
    throw new InvalidArgumentError('resolveName: name must be a string');
  }
  if (typeof exists !== 'function') {
    throw new InvalidArgumentError('resolveName: exists must be a function');
  }
  const maxAttempts = options.maxAttempts ?? 1000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new InvalidArgumentError(
      `resolveName: maxAttempts must be a positive integer, got ${String(maxAttempts)}`,
    );
  }
  const { base, ext } = splitExtension(name);
  for (let index = 0; index < maxAttempts; index++) {
    const candidate = buildName(base, ext, index);
    if (!exists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `resolveName: exhausted ${maxAttempts} attempts for "${name}"`,
  );
}

/**
 * Find a non-colliding name using a single timestamp suffix.
 *
 * Strategy: try the bare name, then try `name~<stamp>` once. If that
 * also collides, increment the stamp and try again, up to `maxAttempts`
 * total probes. Because the stamp comes from the injected clock, two
 * near-simultaneous calls with the same clock will produce the same
 * candidate — the caller is responsible for advancing the clock between
 * attempts if it wants uniqueness across concurrent resolvers. This is
 * documented as a deliberate limitation: a true concurrency-safe resolver
 * would need an atomic compare-and-set, which a pure library cannot
 * provide.
 *
 * @param {string} name
 * @param {(path: string) => boolean} exists
 * @param {() => number} clock - returns a non-negative integer
 * @param {{maxAttempts?: number}} [options]
 * @returns {string}
 * @throws {InvalidArgumentError} on bad arguments
 * @throws {Error} if every candidate within maxAttempts collides
 */
export function resolveTimestampName(name, exists, clock, options = {}) {
  if (typeof name !== 'string') {
    throw new InvalidArgumentError(
      'resolveTimestampName: name must be a string',
    );
  }
  if (typeof exists !== 'function') {
    throw new InvalidArgumentError(
      'resolveTimestampName: exists must be a function',
    );
  }
  if (typeof clock !== 'function') {
    throw new InvalidArgumentError(
      'resolveTimestampName: clock must be a function',
    );
  }
  const maxAttempts = options.maxAttempts ?? 1000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new InvalidArgumentError(
      `resolveTimestampName: maxAttempts must be a positive integer, got ${String(maxAttempts)}`,
    );
  }
  const { base, ext } = splitExtension(name);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stamp = attempt === 0 ? 0 : clock();
    if (!Number.isSafeInteger(stamp) || stamp < 0) {
      throw new InvalidArgumentError(
        `resolveTimestampName: clock must return a non-negative integer, got ${String(stamp)}`,
      );
    }
    const candidate = buildTimestampName(base, ext, stamp);
    if (!exists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `resolveTimestampName: exhausted ${maxAttempts} attempts for "${name}"`,
  );
}
