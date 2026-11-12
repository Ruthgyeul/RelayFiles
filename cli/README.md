# relayfiles CLI

A command-line client for a RelayFiles server, using API v1 with a personal API token. It has no runtime dependencies (Node.js 24).

## 설치

```bash
cd cli
npm ci
npm run build
npm link            # puts `relayfiles` on the PATH (or run node cli/dist/main.js)
```

## 로그인

Create a token under My Profile → API tokens. `files:read` is enough for reading; uploads, share settings and favorites also need `files:write`.

```bash
relayfiles login --server https://files.example
```

It asks for the token, checks it with `/api/v1/me`, and saves it to `~/.config/relayfiles/config.json` (mode 0600). `RELAYFILES_SERVER` and `RELAYFILES_TOKEN` override the saved login, and `RELAYFILES_CONFIG` changes where the file goes.

## 명령

| 명령 | 하는 일 |
|---|---|
| `relayfiles whoami` | The token's account, storage use and scopes |
| `relayfiles ls [folderId]` | Items of a folder (root by default): type, size, id, name |
| `relayfiles download <fileId> [-o path]` | Downloads a file. It writes `<name>.part` first, so running the command again continues from where it stopped (Range and If-Range) |
| `relayfiles upload <file…> [--folder id] [--replace] [--chunk-mb 50]` | Uploads files with tus (`POST /api/v1/uploads`). A failed chunk is retried after checking the server's offset. Without `--replace`, a name that is already taken is kept as "name (2)". With `--replace`, the old file is kept as a version |
| `relayfiles share <id> [--public\|--private\|--inherit] [--password pw\|--no-password] [--limit n\|--no-limit] [--note text]` | Shows the share link. With options, it changes the settings first |
| `relayfiles shares` | Everything shared from the account ("Shared by me") |
| `relayfiles versions <fileId>` | Earlier versions of a file |
| `relayfiles favorite <id> [--remove]` | Adds the item to the top of Favorites, or takes it out |

Keep `--chunk-mb` below the server's Nginx body limit (`NGINX_MAX_BODY_MB`).

## 개발

```bash
npm run generate    # src/openapi.ts from ../docs/openapi.json (commit it with API changes)
npm run typecheck
npm test            # node --test
npm run build
```

The API types are generated from `docs/openapi.json`. CI checks that `npm run generate` leaves `src/openapi.ts` unchanged, so an API change must come with regenerated types.
