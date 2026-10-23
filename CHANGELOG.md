# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
