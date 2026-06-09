# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **IM channels merged into `@gatehouse/core`** — channel bridge logic now lives at `@gatehouse/core/channels` (`packages/core/src/channels/`).
- **OpenCode channels plugin** — `@gatehouse/core/channels/plugin` in project `opencode.jsonc`.
- **Docs** — unified IM guide: [docs/guide/channels.md](./docs/guide/channels.md) / [docs/guide/channels.zh.md](./docs/guide/channels.zh.md).

## [0.1.1] - 2026-06-06

### Fixed

- **`install` TUI registration** — `bunx @gatehouse/core install` now writes `@gatehouse/core` to `~/.config/opencode/tui.json`, matching `opencode plug @gatehouse/core --global`. The previous `@gatehouse/core/tui` subpath spec is not resolved correctly by OpenCode's npm plugin loader, so the TUI sidebar and client guard did not load.
- **`doctor`** — treats `@gatehouse/core` in `tui.json` as a valid TUI plugin registration (still accepts the legacy `/tui` subpath for existing configs).

### Changed

- Installation docs now describe the OpenCode-native `tui.json` plugin spec (`@gatehouse/core` with `exports["./tui"]` resolution).

## [0.1.0] - 2026-06-06

**Early preview release.** APIs, config layout, and agent prompts may change in patch or minor releases while the project is in `0.x`.

### Added

- **`@gatehouse/core`** — OpenCode server + TUI plugin with Lead / Architect / Curator / Arbiter outer team
- **Mission lifecycle** — queue, start, execution, retrospective, skill distillation, and completion
- **Registry & messaging** — SQLite-backed agent registry, scoped `gatehouse_send_message`, delivery queue, execution-tree watchdogs
- **Permission arbiter** — automated handling of OpenCode permission prompts via the Arbiter agent
- **Portal office UI** — pixel-art office view, blog publishing, and skill browser (bundled in core as `dist/portal/`)
- **`gatehouse` CLI** — `install`, `doctor`, and IM channel management commands
- **IM channels** — WeChat / Feishu / QQ routing, `/agent` switching, attachments (`@gatehouse/core/channels`)
- **Bundled IM bridges** — WeChat, Feishu, and QQ bridge sources copied into `@gatehouse/core` at build time
- **Bilingual templates** — English and Chinese `.gatehouse/` agent prompts and config scaffolding
- **Documentation** — README, Getting Started, and installation guides in English and Chinese

### Known limitations (0.1.0)

- **Not production-ready.** Treat this release as an early preview; behavior and on-disk formats may change.
- **TUI only.** The terminal TUI workflow is verified. OpenCode Desktop and IDE extensions are not yet tested.
- **OpenCode version range.** Requires OpenCode `>=1.14.40` and `<1.17.0` (see `@gatehouse/core` `engines.opencode`).
- **IM channels are optional.** Bridges support text and images (plus WeChat voice via CDN decrypt); file/video and some media types are not fully supported.
- **Portal is local-first.** Use `http://127.0.0.1:18471/` after starting the plugin; a standalone public Portal hub is planned but not shipped in this release.
- **Portal UI has no dedicated test suite.** Core integration tests cover Portal API snapshots and static serving; the Phaser frontend is not separately tested in CI.
- **npm scope setup required.** Publishers must create the `@gatehouse` npm organization before the first release (see [PUBLISH.md](./packages/core/docs/PUBLISH.md)).

[0.1.1]: https://github.com/doee-hc/gatehouse/releases/tag/v0.1.1
[0.1.0]: https://github.com/doee-hc/gatehouse/releases/tag/v0.1.0
