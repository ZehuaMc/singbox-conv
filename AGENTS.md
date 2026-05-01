# Repository Guidelines

## Project Structure & Module Organization

This is a private Node.js service for converting upstream subscription links into a sing-box JSON configuration. Runtime source lives in `src/`: `server.js` handles HTTP routes and sessions, `generator.js` builds output configs, `parse.js` parses share links, `store.js` persists sources, and `config.js` centralizes paths and environment variables. Browser UI files live in `public/` (`index.html`, `app.js`, `style.css`). Tests live in `test/` and mirror the main modules with `*.test.js` files. `config.example.json` is the committed template; local `config.json` and `data/` are intentionally ignored.

## Build, Test, and Development Commands

- `cp config.example.json config.json`: create a local sing-box template before running the service.
- `ADMIN_PASSWORD='change-me' npm start`: start the HTTP server with `node src/server.js`.
- `npm test`: run all tests with Node's built-in test runner.

There is no separate build step or bundler. The app runs directly on Node.js 20 or newer and serves static files from `public/`.

## Coding Style & Naming Conventions

Use ES modules, explicit imports from `node:*` built-ins, two-space indentation, semicolons, and single quotes for strings unless interpolation is needed. Prefer small, named functions for route handlers, parsing helpers, and normalization logic. Use camelCase for variables and functions, UPPER_SNAKE_CASE for exported environment-derived constants, and lowercase kebab-free file names such as `generator.js` or `server.test.js`.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Place new tests in `test/` with the `*.test.js` suffix. Stub network behavior locally, as in `generator.test.js`, rather than depending on live subscription URLs. Run `npm test` before submitting changes, especially when touching parsing, config generation, session handling, or file persistence.

## Commit & Pull Request Guidelines

The current history only contains `Initial commit`, so no strict commit convention is established. Use short imperative commit subjects such as `Add vless parser test` or `Fix source persistence error`. Pull requests should include a concise summary, the commands run for verification, any affected environment variables, and UI screenshots when changing files under `public/`.

## Security & Configuration Tips

Do not commit `config.json`, `data/sources.json`, generated tokens, or real upstream subscription URLs. Keep `ADMIN_PASSWORD` and `SUB_TOKEN` out of source control and pass them through the environment. When adding new configuration, document the variable in `README.md` and provide safe defaults in `src/config.js`.
