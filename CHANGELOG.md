# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-10-23

- Updated `@modelcontextprotocol/sdk` to 1.32.2 (patch release within the declared range). No tool, schema, or behaviour changes.

## [0.2.1] - 2026-10-23

### Fixed

- Base64 validation for image `assets` no longer uses a single regular
  expression over the whole string: on multi-megabyte inputs (a valid
  image can be several MB of base64) the regex engine could overflow its
  stack and crash validation. The check is now chunked and stack-safe,
  with the same accepted shape (standard alphabet, `=` padding, no
  whitespace, no `data:` prefix).

## [0.2.0] - 2026-10-23

### Added

- **Image support** (TypeSafe "danger zone" feature): all decision tools
  accept an `assets` map of base64-encoded PNG/JPEG images keyed by
  reference string. References are written into the `state`,
  `instructions`, or `criteria` where each image belongs. The client sends
  the `TypeSafe-Danger-Zone-Images: true` header automatically whenever a
  request carries assets or a Box question, and rejects unreferenced
  assets locally with a clear error (the API would return 400).
- **Box question type** and a new `jev_box` tool: locate one target in an
  image and get its bounding-box edges (`top`, `bottom`, `left`, `right`
  as fractions 0..1) plus a confidence value. Box requires Jev 1.14, so
  `jev_box` sends `jev-1.14.0` by default. Box questions can also be mixed
  into `jev_decide` calls.
- **Long context opt-in**: decision tools accept `long_context: true`,
  which sends the `TypeSafe-Danger-Zone-Long-Context: true` header and
  raises the context limits from 64k/32k to 262k tokens.
- Structured `instructions` and `criteria`: per the current TypeSafe docs,
  these fields accept JSON objects/arrays (or null) as well as strings —
  e.g. Choice options and Score levels defined by structured entries
  holding example images.

## [0.1.0] - 2026-10-23

### Added

- Initial release of `typesafe-mcp`, a Model Context Protocol (stdio) server
  wrapping TypeSafe AI's Jev decision model.
- Tools: `jev_decide` (multiple typed questions in one call), `jev_choice`,
  `jev_score`, `jev_noul`, and `jev_list_models`.
- Typed TypeScript Jev client for `POST /v1/systemone` and `GET /v1/models`
  with clear, credential-free error mapping for auth, rate-limit, server,
  network, and timeout failures.
- Configuration via `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, and
  `TYPESAFE_JEV_MODEL` environment variables. The server starts without a key;
  tools return a clear error naming the missing variable.
- Unit tests (vitest) using an injected fake fetch — no live network calls.
- GitHub Actions: CI on Node 20/22 plus a Bun build smoke job, and a publish
  workflow that releases to npm with provenance when a GitHub Release is
  published.
