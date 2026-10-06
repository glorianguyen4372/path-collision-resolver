/**
 * Path Collision Resolver — ESM entry point.
 *
 * Re-exports the public surface from ./core.js so consumers can import
 * everything from the package root. Keeping a single source module keeps
 * the internal behaviour in exactly one place; this file is intentionally
 * a flat re-export so there is no divergence between what the tests see
 * and what an application sees.
 */
export {
  resolveName,
  resolveTimestampName,
  buildName,
  buildTimestampName,
  SUFFIX_SEPARATOR,
  DEFAULT_BASE,
  timestampToBase36,
  InvalidArgumentError,
} from './core.js';
