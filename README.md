# Path Collision Resolver

Generate non-clobbering filenames by appending a distinguishing suffix when the intended path is already taken. Pure functions only — the filesystem (or object store, or wherever names live) is accessed through an `exists(path)` predicate you inject, so the behaviour is fully deterministic and testable without touching disk.

## Usage

```js
import {
  resolveName,
  resolveTimestampName,
  SUFFIX_SEPARATOR,
} from 'path-collision-resolver';

// Numeric strategy: name, name~1, name~2, ...
const taken = new Set(['report.pdf']);
const exists = (p) => taken.has(p);
const next = resolveName('report.pdf', exists);
// => 'report.pdf~1'

// Timestamp strategy: name, then name~<base36-clock>
const clock = () => Date.now();
const stamp = resolveTimestampName('report.pdf', exists, clock);
// => 'report.pdf~lrt8w'   (value depends on clock)
```

## Why this exists

When a process writes many outputs to the same directory — logs, exports, cache shards — picking a unique name up front is usually impossible without a global lock. This library gives you a small, dependency-free resolver that asks only "is this name taken?" and returns the first free candidate. Because it never opens a file, it works identically against a local `fs.existsSync`, a remote HEAD request, or an in-memory set in tests.

The trade-off: the library does not atomically reserve the name it returns. Between the `exists` check and the caller's write, another process could grab the same path. For true concurrency safety the caller must wrap the resolved name in an atomic create (e.g. `fs.open(..., 'wx')` and retry on `EEXIST`). The resolver gets you a good candidate; the caller closes the race.

## Strategies

- **Numeric** (`resolveName`): probes `name`, `name~1`, `name~2`, … in order. Good when you want short, human-scannable suffixes and collisions are rare.
- **Timestamp** (`resolveTimestampName`): probes `name`, then `name~<base36>` using an injected `clock()` function. Good when you want the suffix to be sortable by creation time. The clock is injected so tests can pass a counter instead of `Date.now`.

## Exports

| Name | Kind | Purpose |
| --- | --- | --- |
| `resolveName(name, exists, options?)` | function | Numeric-suffix resolver. |
| `resolveTimestampName(name, exists, clock, options?)` | function | Timestamp-suffix resolver. |
| `buildName(base, ext, index)` | function | Compose a single numeric candidate. |
| `buildTimestampName(base, ext, stamp)` | function | Compose a single timestamp candidate. |
| `SUFFIX_SEPARATOR` | string | The `'~'` inserted between base and suffix. |
| `DEFAULT_BASE` | string | `'file'` — fallback when the input trims to empty. |
| `timestampToBase36(n)` | function | Encode a non-negative integer as base36. |
| `InvalidArgumentError` | class | Thrown on bad argument types. |

`options.maxAttempts` (default `1000`) caps the probe count for both resolvers so a stuck `exists` cannot loop forever.

## Edge cases worth knowing

- **Extension splitting uses the last dot.** `archive.tar.gz` becomes base `archive.tar`, ext `.gz`, so a collision yields `archive.tar.gz~1` — the `.gz` stays visible. A leading-dot file like `.gitignore` is treated as having no extension, so its decorated form is `.gitignore~1`.
- **The numeric resolver does not scan for existing `name~N` siblings.** If some other tool already created `name~5`, this library will still return `name~1` for a collision on `name`, because it only asks `exists` about the candidates it generates itself. If you need to honour pre-existing numbered siblings, feed an `exists` that knows about them, or scan the directory first.
- **The timestamp clock is not advanced for you across concurrent calls.** Two calls sharing the same clock object will produce the same candidate on the same tick. For serial use that is fine; for parallel use, either advance the clock between calls or fall back to the numeric strategy, which is stateless by construction.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

