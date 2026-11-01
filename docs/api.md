# API

모든 API는 `src/app/api/**/route.ts`에 있고, `apiHandler()`(`src/server/http/api-handler.ts`)를 거친다(예외: tus 업로드 경로와 `HEAD /api/health`).

## 응답 형식

```ts
// 성공
{ success: true, data: T }
// 실패
{ success: false, error: string, code: ErrorCode, fields?: Record<string, string>, retryAfter?: number }
```

- 모든 응답에 `x-request-id` 헤더가 붙는다(요청에 있으면 그대로, 없으면 새로 생성). 에러 화면의 "Ref"와 서버 로그를 이 값으로 맞춘다.
- `ApiError(code, message?)`는 지정한 상태 코드와 사용자에게 보여도 안전한 메시지로 응답한다.
- zod 검증 실패는 `400 BAD_REQUEST` + `fields`(필드 경로 → 메시지).
- 그 밖의 예외는 로그에만 전체를 남기고, 응답은 항상 `500 INTERNAL "Something went wrong."`(스택, 쿼리, 내부 경로 노출 없음).
- 429 응답은 `retry-after` 헤더와 `retryAfter` 필드를 함께 보낸다.
- 실패 응답은 항상 `cache-control: no-store`(아직 없는 썸네일의 404가 캐시되지 않게).
- 보안 헤더(CSP, HSTS 등): [security.md "응답 헤더·자원 제한"](security.md#응답-헤더자원-제한).
- 파일 응답의 캐시(`Cache-Control`): [architecture.md "미리보기 전송"](architecture.md#미리보기-전송).

## 에러 코드 (`src/contracts/errors.ts`)

| code | HTTP | 클라이언트 처리 |
|---|---|---|
| `BAD_REQUEST` | 400 | 필드 오류 표시 또는 `/error/400` |
| `UNAUTHORIZED` | 401 | 로그인 모달 / `unauthorized.tsx` |
| `INVALID_TOKEN` | 401 | 로그인 모달에 메시지 표시(남은 시도 횟수 포함) |
| `INVALID_INVITE` | 400 | 로그인 모달에 메시지 표시 |
| `SIGNUP_CLOSED` | 403 | 로그인 모달의 Closed 안내 |
| `FORBIDDEN` | 403 | `forbidden.tsx` |
| `REAUTH_REQUIRED` | 403 | 관리자 세션이 최근 `AUTH.reauthWindowMin`분 안에 토큰을 입력하지 않았다. `apiFetch`가 "Confirm it's you" 대화상자를 열고, 토큰을 입력하면 같은 요청을 한 번 더 보낸다 |
| `NOT_FOUND` | 404 | 다른 계정 리소스도 404(존재 여부 비공개) |
| `CONFLICT` | 409 | 이름 중복 등, 대화상자에 메시지 표시 |
| `ALREADY_SIGNED_IN` | 409 | 로그인 모달에 메시지 표시 |
| `GONE` | 410 | `/error/410`(삭제된 계정·링크) |
| `PAYLOAD_TOO_LARGE` | 413 | 토스트 |
| `UNSUPPORTED_MEDIA` | 415 | 공개 링크에서 위치 정보를 지울 수 없는 사진(HEIC 등, 또는 워커가 정리하지 못한 깨진·너무 큰 사진). 메시지 표시 |
| `RATE_LIMITED` | 429 | `/error/429?retry=<초>&from=<경로>` 또는 모달 카운트다운 |
| `INTERNAL` | 500 | `error.tsx` |
| `MAINTENANCE` | 503 | `/error/503` |
| `STORAGE_OFFLINE` | 503 | `/error/storage-offline` |
| `MEDIA_NOT_READY` | 503 | 공개 링크 사진의 메타데이터 제거본을 워커가 아직 만들지 않았다. `Retry-After`(`MEDIA.stripPendingRetrySec`) 뒤 다시 요청 |
| `STORAGE_BUSY` | 503 | 토스트(계정 이동·레이아웃 마이그레이션 중. 탐색·다운로드는 계속됨) |
| `INSUFFICIENT_STORAGE` | 507 | 토스트 + 용량 배너 |

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `HEAD` | `/api/health` | 생존 확인(204, 백엔드 작업 없음). Status 페이지가 2.5초마다 지연 시간을 잰다 |
| `GET` | `/api/health` | 준비 상태: `{ status, version, time, components: { database, redis, storage } }`. DB가 죽으면 503 |
| `GET` | `/api/status` | 공개 Status 페이지 데이터: `{ latency, components, server, incidents }` |
| `GET` | `/api/auth/session` | 이 기기에 로그인한 계정 목록, 활성 계정 id, 가입 모드, 활성 계정 사용량 `usage { usedBytes, rootItems, storageBusy }`(`SessionState`). `storageBusy`가 true면 파일을 새 저장소로 옮기는 중이라 변경이 잠시 막힌다(배너 표시). 무효 세션이 있으면 쿠키를 정리한다 |
| `POST` | `/api/auth/anonymous` | `{ inviteCode? }` → 201 `{ account, token, session }`. 익명 계정을 만들고 이 기기를 로그인시킨다. 토큰은 이 응답에서만 평문으로 나온다 |
| `POST` | `/api/auth/token` | `{ token }` → `SessionState`. 실패 시 401 `INVALID_TOKEN`, 잠금 시 429 `retryAfter` |
| `POST` | `/api/auth/reauth` | `{ token }` → `{ confirmed: true }`. 활성 계정의 토큰을 다시 입력해 이 세션의 토큰 보기·재발급, 계정 삭제, 관리자 작업을 `AUTH.reauthWindowMin`분 동안 허용한다. 틀리면 401 `INVALID_TOKEN`(로그인과 같은 잠금) |
| `POST` | `/api/csp-report` | 브라우저의 CSP 위반 보고(`application/csp-report`, `application/reports+json`). 인증 없음, 16KB까지만 읽고 같은 위반은 1시간에 한 번 경고 로그. 항상 204 |
| `POST` | `/api/auth/switch` | `{ accountId }` → `SessionState`. 이 기기에 로그인한 다른 계정을 활성화 |
| `POST` | `/api/auth/signout` | `{ accountId? }`(기본: 활성 계정) → `SessionState`. 세션을 DB에서 폐기 |
| `GET` | `/api/me/token?accountId=` | 이 기기에 로그인한 계정(기본: 활성 계정)의 전체 토큰(`cache-control: no-store`). 다른 기기의 계정은 404. 최근 로그인·재인증이 필요하다(`REAUTH_REQUIRED`). 관리자 계정 토큰 보기는 감사 로그에 남는다 |
| `GET` | `/api/folders/:id` | `id` = `root` 또는 폴더 id. `FolderView { folder, isRoot, path, effectiveVisibility, children }`. 폴더 항목은 하위 전체 크기(`size`)와 직계 항목 수(`itemCount`)를 담는다. 각 항목의 `busy`는 공유 링크 다운로드 혼잡도 배지(`Busy`/`Server busy`/`Downloads paused`, 없으면 null). 다른 계정 폴더는 404 |
| `POST` | `/api/folders` | `{ parentId, name }` → 201 `{ folder, requestedName, renamed }`. DB와 볼륨에 함께 만든다. 이름이 겹치면 `Name (2)`로 만들고 `renamed: true` |
| `GET` | `/api/nodes/:id` | Properties 대화상자 정보: 항목, 위치(루트→부모 이름), 실제 공개 범위, 폴더면 하위 파일·폴더 수 |
| `GET` | `/api/folders/tree` | 계정의 모든 폴더 `{ id, name, parentId }`(이동·복사 대상 선택) |
| `PATCH` | `/api/nodes/:id` | `{ name }` 이름 변경(디스크도 함께). 이름이 겹치면 409와 `Suggested:` 문구 |
| `POST` | `/api/nodes/transfer` | `{ ids, targetId, mode: move\|copy }` → `{ done, renamed, targetName }`. 자기 자신·하위로 이동 불가, 겹치는 이름은 `Name (2)`, 복사는 새 id·링크, 다운로드 수 0, 용량 초과 시 507 |
| `POST` | `/api/nodes/delete` | `{ ids }` → `{ deleted }`. DB에서 지우고 볼륨의 `system/trash`로 옮긴다(정리 작업이 비움). 맨 위 항목마다 "Recently deleted" 항목(`DeletedItem`)이 생겨 휴지통이 비워질 때까지 복원할 수 있다. API v1 `DELETE /api/v1/nodes/:id`도 같다 |
| `GET` | `/api/trash` | "Recently deleted": `DeletedItemDto[] { id, name, type, kind, size, itemCount, deletedAt, expiresAt, location }`, 최근 삭제 순, 최대 `STORAGE.recentlyDeletedListMax`(1,000)개. `size`는 하위 파일 바이트 합(문자열), `itemCount`는 자신 포함 항목 수, `expiresAt` = `deletedAt` + `STORAGE.trashRetentionHours`(24시간, 실제 삭제는 그 뒤 첫 매일 정리), `location`은 삭제 당시 있던 폴더의 이름(루트부터). 만료·첫 다운로드 후 삭제로 정리 작업이 지운 항목은 들어오지 않는다 |
| `POST` | `/api/trash/:id/restore` | → `RestoredItem { name, renamed, folderId, folderName, folderIsRoot, inOriginalFolder }`. 같은 id·`linkId`·공유 설정·태그로 행을 되살리고 파일을 휴지통에서 꺼낸다. 원래 폴더가 계정에 있으면 그 안, 없으면 계정 루트(`inOriginalFolder: false`). 이름이 겹치면 `Name (2)`. 링크 활동 기록·업로드 링크는 복원되지 않는다. 다른 계정의 항목·이미 복원한 항목은 404, 계정이 그 뒤 다른 볼륨으로 옮겨졌으면 409, 휴지통이 이미 비워졌으면 410, 항목 수 한도를 넘으면 400 |
| `DELETE` | `/api/trash/:id` | "Delete forever" → `{ deleted: true }`. 항목과 그 휴지통 바이트 기록을 지우고(용량이 바로 돌아온다) 휴지통의 파일을 지운다. 다른 계정은 404, 다른 볼륨으로 옮겨진 계정은 409 |
| `POST` | `/api/nodes/tags` | `{ ids, add, remove }`. 태그는 소문자·공백→`-`·24자, 항목당 20개 |
| `GET` | `/api/nodes/:id/renumber?sort=name\|created\|modified\|taken&order=asc\|desc` | "Renumber files" 미리보기(바뀌는 것 없음). `id` = `root` 또는 폴더 id. `RenumberPreview { entries: [{ id, from, to }], skipped: [{ id, name, reason: hidden\|missing }], changes, conflict }`. 대상은 폴더 바로 아래 파일만(하위 폴더·숨김 파일·디스크에 없는 파일은 그대로). 번호는 최소 2자리(`01`), 파일이 100개 이상이면 자릿수가 늘어난다. 확장자는 원래 표기 그대로. `modified`는 파일 자체의 수정 시각(`modifiedAt`), `taken`은 사진·영상 메타데이터의 촬영일(`takenAt`, 없으면 수정일 → 생성일)이고 그때만 `takenFallbacks`(촬영일이 없어 다른 시각으로 정렬된 파일 수)가 붙는다. 새 이름이 남는 항목과 겹치면 `conflict`에 이유 |
| `POST` | `/api/nodes/:id/renumber` | `{ sort, order, expect: [{ id, to }], count }` → `{ renamed, unchanged }`. `expect`는 미리보기 `entries` 중 이름이 바뀌는 항목(순서 그대로), `count`는 `entries` 개수. 서버가 다시 계산한 계획과 다르면 409 `This folder changed. Review the new order.`(아무것도 바뀌지 않음). `count`가 없으면 `expect`를 전체 `entries`로 본다(첫 릴리스 클라이언트). 바뀌는 파일이 `RENUMBER_MAX_FILES`(기본 10,000)를 넘으면 400(미리보기 `conflict`에도 같은 문구). 노드 id·링크·태그·설정은 그대로 |
| `GET` | `/api/nodes/:id/duplicates?recursive=0\|1` | 내용(SHA-256·크기)이 같은 파일 묶음 `DuplicatesResult { groups: [{ sha256, size, wasted, files: [{ id, name, folderPath, parentId, parentIsRoot, kind, hasThumb, createdAt, modifiedAt }] }], scanned, unchecked, truncated }`. 묶음은 낭비 바이트가 큰 순, 파일은 오래된 순. `recursive=1`이면 하위 폴더까지. 해시가 없는 파일은 `unchecked`. `DUPLICATES_MAX_SCAN`(기본 10,000)개·`DUPLICATES.maxGroups`(500)개를 넘으면 `truncated`. 지우기는 일반 삭제(`/api/nodes/delete`)로 한다 |
| `GET` | `/api/tags` | 계정에서 쓰는 태그와 개수(태그 제안) |
| `PUT` | `/api/nodes/:id/settings` | 공유 설정(공개 범위, 만료·첫 다운로드 후 삭제는 관리자만, 다운로드 한도, 비밀번호(argon2), 접근, 메모, 하위 항목에 적용) |
| `POST` | `/api/nodes/:id/link` | 공유 링크 재발급(옛 링크 즉시 무효, 활동 기록에 남음) |
| `GET` | `/api/nodes/:id/activity` | 링크 활동 최신 200개(폴더는 하위 항목 포함). Activity 대화상자가 이 목록으로 종류별(열기·보기·재생·다운로드) 합계와 최근 7일·30일 수를 센다(`domain/link-activity.ts`) |
| `GET` | `/api/nodes/:id/activity/csv` | 같은 기록을 CSV로 내려받기(`text/csv; charset=utf-8`, UTF-8 BOM, `Content-Disposition: attachment; "<이름> activity.csv"`, `no-store`). 열 `Time (UTC),Event,File,Device,Address,Country`, 최신순 최대 `SHARE.activityExportLimit`(10,000)개. `= + - @`(또는 탭·CR)로 시작하는 칸은 앞에 `'`를 붙여 수식으로 실행되지 않게 한다(`domain/csv.ts`). 소유자만, 다른 계정 항목은 404 |
| `PUT` | `/api/nodes/:id/pause` | 관리자: 다운로드 일시정지/재개 |
| `POST` | `/api/uploads` | 업로드 준비 `{ target: home\|root\|폴더id, files: [{ rel, size }], dup?, fallbackName? }` → `{ kind: duplicates, names }` / `{ kind: nothing }` / `{ kind: ready, batchId, endpoint, folder, files }`. 이름 검증, 용량·볼륨 여유 공간(507), Home 업로드 폴더 생성. `dup`: `replace`(새 내용은 새 node id, 공유 링크·설정·태그·링크 기록은 유지) · `keep`("name (2)") · `skip` |
| `POST` | `/api/uploads/resume` | 새로고침으로 끊긴 업로드 이어 올리기 `{ batchId, slot, uploadId }` → `{ offset }`. 이 계정의 끝나지 않은 업로드이고 길이·파일 이름이 배치의 `slot` 항목과 같으면 그 칸으로 넘겨받는다(이후 같은 업로드 URL로 tus HEAD/PATCH, 완료되면 새 배치의 폴더에 놓인다). 그 밖에는 404 → 처음부터 보낸다 |
| tus | `/api/uploads/tus/:volumeId[/:uploadId]` | 재개 가능한 업로드(tus 1.0, 청크 `UPLOAD_CHUNK_SIZE_MB`). 메타데이터 `batch`, `index`, `filename`, `lastModified`(선택, 파일의 `File.lastModified` ms. 없거나 미래 값이면 업로드 시각을 `modifiedAt`으로 저장). 업로드한 기기의 계정만 이어 올리거나 조회할 수 있다. 완료되면 `{ success, data: { nodeId, name, folderId } }`. `proxy.ts`를 거치지 않는다(본문 버퍼링 방지) |
| `GET` | `/api/search?q=…` | 전역 검색(Ctrl/⌘ K): 빈 값이면 최근 파일 8개, `#태그`로 시작하면 모든 태그를 가진 항목, 그 밖에는 이름 검색(후보 200개를 순위로 정렬해 최대 30개). 결과마다 폴더 경로. `q`는 200자까지 |
| `GET` | `/api/search?tags=a,b` | 계정 전체에서 모든 태그를 가진 항목(최대 500개)과 폴더 경로 |
| `GET`·`HEAD` | `/api/files/:id/download` | 원본 그대로 첨부 파일로 받기. SHA-256 ETag(304), Range(206/416), RFC 6266 파일명(한글). `STORAGE_ACCEL_ENABLED`면 Nginx `X-Accel-Redirect`로 넘긴다. 받은 바이트는 `TrafficDaily`에 기록 |
| `GET`·`HEAD` | `/api/files/:id/stream` | 뷰어·인라인 재생용. 영상·음악·이미지만 inline, SVG·HTML은 항상 첨부(`nosniff`). `?transcode=1`: 브라우저가 못 여는 영상을 ffmpeg로 720p H.264/AAC fragmented MP4로 변환하며 전송(동시 `VIDEO_TRANSCODE_MAX`개, 꽉 차면 429 + `Retry-After`, 0이면 404) |
| `GET`·`HEAD` | `/api/files/:id/preview` | 뷰어용 이미지: 워커가 만든 WebP 미리보기(최대 2560px, 메타데이터 없음). 없으면(작은 파일, GIF, 처리 전) `stream`과 같은 원본 |
| `GET` | `/api/files/:id/thumb` | 워커가 만든 WebP 썸네일(최대 576px, 메타데이터 없음). 아직 없으면 404 |
| `GET` | `/api/zip?ids=a,b` | 파일·폴더를 하나의 zip으로(store 모드, 폴더 구조와 빈 폴더 유지). 이름은 `폴더.zip` / `파일.zip` / `상위 · N items.zip` |

### 내 계정 (My Profile)

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/me/token` | 새 토큰 발급. 최근 로그인·재인증이 필요하다(`REAUTH_REQUIRED`). 기존 토큰은 즉시 무효, 이 기기를 뺀 모든 기기 로그아웃. 새 토큰을 한 번 돌려준다 |
| `GET`·`DELETE` | `/api/me/sessions` | 이 계정에 로그인된 기기 목록(이 기기 먼저) / "Sign out all others" |
| `DELETE` | `/api/me/sessions/:id` | 다른 기기 하나 로그아웃 |
| `PATCH` | `/api/me/preferences` | `{ stripMetadataOnShare }` 공개 링크 사진의 위치·카메라 정보 제거 |
| `POST` | `/api/me/purge` | "Purge now": 만료된 항목(만료 시각이 지났거나 1회 다운로드 후 삭제가 사용됨)을 바로 삭제 → `{ deleted }` |
| `DELETE` | `/api/me` | 계정, 토큰, 모든 파일 삭제(폴더는 볼륨 휴지통으로) 후 이 기기에서 로그아웃. 최근 로그인·재인증이 필요하다(`REAUTH_REQUIRED`). 관리자 계정 삭제는 감사 로그에 남으며, 마지막 관리자는 400 `Keep at least one admin` |
| `GET`·`POST` | `/api/me/api-tokens` | 개인 API 토큰 목록(토큰 값은 없음) / 새 토큰 `{ name, scopes, expiresInDays: 7\|30\|90\|365\|null }` → `{ token, item }`(201, 토큰은 이때 한 번만). 최근 로그인·재인증이 필요하다(`REAUTH_REQUIRED`). `metrics:read`는 관리자만(403). 계정당 `API.maxTokensPerAccount`(20)개. 감사 로그 `apiToken.create` |
| `DELETE` | `/api/me/api-tokens/:id` | 토큰 폐기(즉시 무효). 다른 계정의 토큰은 404. 감사 로그 `apiToken.revoke` |

### API v1 (스크립트·앱용, 개인 API 토큰)

프로필 "API tokens"에서 만든 토큰(`rfp_<id>_<43자>`)을 `Authorization: Bearer <token>`으로 보낸다. 쿠키는 읽지 않는다(브라우저 세션으로는 호출할 수 없다). 응답 형식과 에러 코드는 위와 같다.

- 토큰이 없거나 틀리거나 만료됐거나 계정이 삭제일에 닿으면 401, 범위(scope)가 없으면 403.
- 토큰마다 분당 `API.requestsPerMinute`(120)회를 넘기면 429 + `Retry-After`.
- 범위: `files:read`(보기·다운로드·검색·공유 설정 읽기), `files:write`(업로드·폴더 만들기·이름 변경·이동·공유 설정 변경·링크 재발급·삭제), `metrics:read`(관리자, `/metrics`용).
- 다른 계정의 항목은 404.

| 메서드 | 경로 | 범위 | 설명 |
|---|---|---|---|
| `GET` | `/api/v1/me` | 아무거나 | 계정 id·이름·관리자 여부, `quotaBytes`, `usedBytes`, 이 토큰의 `scopes` |
| `GET` | `/api/v1/folders/:id` | `files:read` | 폴더(`root` 또는 id), 경로, 하위 항목(웹 앱의 `/api/folders/:id`와 같은 형식) |
| `POST` | `/api/v1/folders` | `files:write` | `{ parentId: "root"\|id, name }` 폴더 만들기(201). 이름이 겹치면 "Name (2)" |
| `POST` | `/api/v1/files?folder=root\|id&name=` | `files:write` | 요청 본문 전체가 파일 하나(`Content-Length` 필수). 이름이 겹치면 "name (2)". 용량·항목 수·크기 한도는 tus 업로드와 같다. 201 `{ nodeId, name, folderId, linkId, url }` — `url`은 공유 링크(공개 여부는 폴더 설정을 따른다). 본문은 Nginx `client_max_body_size`(`NGINX_MAX_BODY_MB`)까지, 더 큰 파일은 웹 앱(tus)으로 |
| `GET`·`HEAD` | `/api/v1/files/:id` | `files:read` | 원본 다운로드(Range·ETag는 웹 앱과 같다). `HEAD`는 같은 헤더(`Content-Length`·`ETag`)에 본문 없음, 트래픽으로 세지 않는다 |
| `GET` | `/api/v1/search?q=` | `files:read` | 웹 앱 `/api/search`와 같다: 빈 값이면 최근 파일, `#태그`(URL에서는 `%23`)는 모든 태그를 가진 항목, 그 밖에는 이름. `?tags=a,b`도 받는다. 결과마다 폴더 경로(`TaggedItem[]`) |
| `PATCH` | `/api/v1/nodes/:id` | `files:write` | `{ name?, parentId?: "root"\|id }`(하나 이상) 이름 변경·이동(디스크도 함께) → `NodeItem`. 이동이 먼저라 새 이름은 대상 폴더에서 검사한다. 끝나는 곳에 같은 이름이 있으면 409와 `Suggested:` 문구(웹 앱 이동과 달리 "Name (2)"로 바꾸지 않는다). 자기 자신·하위·루트 이동은 400 |
| `DELETE` | `/api/v1/nodes/:id` | `files:write` | 파일이나 폴더(안의 모든 것 포함) 삭제, 볼륨 휴지통으로 → `{ deleted }` |
| `GET` | `/api/v1/nodes/:id/share` | `files:read` | 공유 링크와 설정 `ApiV1Share { id, name, type, linkId, url, visibility: inherit\|private\|public, effectiveVisibility, access: both\|stream, downloadLimit, downloads, note, hasPassword, expiry, expAt, burn }` |
| `PATCH` | `/api/v1/nodes/:id/share` | `files:write` | 보낸 필드만 바꾼다 `{ visibility?, access?, downloadLimit?(null=없음), note?, password?(문자열=설정, null·""=해제), applyDown?, expiry?, burn? }` → `ApiV1Share`. 모르는 필드는 400. `expiry`·`burn`은 관리자만(그 밖에는 403) |
| `POST` | `/api/v1/nodes/:id/link` | `files:write` | 공유 링크 재발급(옛 링크 즉시 무효, 활동 기록에 남음) → `ApiV1Share` |

ShareX 예: Request URL `https://<도메인>/api/v1/files?name={filename}`, Method `POST`, Body `Binary`, Header `Authorization: Bearer rfp_…`, URL `{json:data.url}`. curl: `curl -H "Authorization: Bearer $TOKEN" --data-binary @a.png "https://<도메인>/api/v1/files?name=a.png"`.

### Prometheus 지표

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/metrics` | Prometheus 텍스트(0.0.4). 관리자의 개인 API 토큰(`metrics:read`)을 `Authorization: Bearer`로, `ADMIN_ALLOWED_CIDRS`가 있으면 그 대역에서만. 토큰 없음 401, 범위 없음·멤버·대역 밖 403. 계정·파일·클라이언트를 레이블에 넣지 않는다. 지표 목록은 [runbook.md "Prometheus·Grafana"](runbook.md#prometheusgrafana) |

### 관리자 (`ADMIN_ALLOWED_CIDRS`로 접근 주소 제한 가능)

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/admin/accounts` | 모든 계정과 파일 수·사용량, 이 기기에 로그인된 계정(`here`)과 활성 계정(`you`) |
| `PATCH` | `/api/admin/accounts/:id` | Manage: `{ isAdmin, days: 0\|7\|30\|90\|365\|"default"\|"never", reset, quotaGb\|null }`. 연장은 현재 삭제일(지났으면 오늘)에 더한다. 마지막 관리자는 강등 불가(400 `Keep at least one admin`) |
| `DELETE` | `/api/admin/accounts/:id` | 멤버 계정과 모든 파일 삭제(관리자는 먼저 멤버로 바꿔야 함) |
| `GET` | `/api/admin/settings` | 가입 모드, 테마, 최근 공지, 초대 코드 |
| `PUT` | `/api/admin/settings/signup` | `{ mode: open\|invite\|closed }` |
| `PUT` | `/api/admin/settings/theme` | `{ theme }` 10종 중 하나. 모든 페이지가 이 테마로 렌더링된다(60초 캐시, 실패 시 `DEFAULT_THEME`) |
| `POST`·`DELETE` | `/api/admin/announcement` | `{ text, level: info\|warn\|maint }` 게시(이전 공지는 내려감) / 내리기. File Manager 상단에 표시, 브라우저별로 닫기 |
| `POST` | `/api/admin/invites` | 일회용 초대 코드 `XXXX-XXXX` 생성 |
| `DELETE` | `/api/admin/invites/:code` | 사용 전 코드 취소(사용된 코드는 404) |
| `POST` | `/api/admin/cleanup` | "Run cleanup now": 삭제일이 지난 계정과 만료 항목 삭제 → `{ accounts, items }` |
| `GET` | `/api/admin/audit` | 감사 로그 최신순 페이지 `{ events: AuditEntry[], nextCursor }`. `?limit=`(기본 `AUTH.auditPageSize` 50, 최대 200) · `?cursor=<이전 페이지 마지막 id>`(없어진 id는 400) · `?group=accounts\|signup\|tokens\|server` · `?account=<계정 id>`(행위자 또는 대상). Server 페이지 "Audit log" 카드가 쓴다(역할·삭제일·용량 변경, 계정 삭제, 가입 모드, 정리 실행, 초대 생성·취소, 관리자 토큰 보기·재발급, 공지 게시·내리기, 테마 변경, 장애 등록·수정·삭제, API 토큰 만들기·폐기) |
| `GET` | `/api/admin/server/stream` | Server 페이지 실측 지표 SSE(1.5초마다 스냅샷, 느린 스냅샷은 겹치지 않고 건너뜀) |
| `POST` | `/api/admin/incidents` | Status 페이지 Incident 등록 `{ title, text, severity, date, duration, resolved }` |
| `PUT`·`DELETE` | `/api/admin/incidents/:id` | Incident 수정 / 삭제 |

### 업로드 전용 링크 (File request)

폴더 메뉴 "Upload links"에서 만든다. 방문자는 `/r/<id>`에서 그 폴더에 파일을 넣을 수 있지만 폴더 내용은 볼 수 없다([security.md](security.md#업로드)).

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/file-requests?folder=root\|id` | 그 폴더의 업로드 링크(`FileRequestDto`: `url`, 제목, 비밀번호 여부, `status: open\|expired\|full`, 만료, 한도, 받은 파일 수·바이트). 로그인 필요 |
| `POST` | `/api/file-requests` | `{ folderId, title, password\|null, expiresInDays: 1\|7\|30\|null, maxFiles\|null, maxMb\|null }` → 201. 다른 계정의 폴더는 404, 계정당 `FILE_REQUEST.maxPerAccount`(50)개 |
| `DELETE` | `/api/file-requests/:id` | 링크 삭제(받은 파일은 남는다). 다른 계정의 링크는 404 |
| `GET` | `/api/r/:id` | 방문자용 `FileRequestView` `{ status: open\|locked\|expired\|full, title, ownerName, filesLeft, bytesLeft, maxFileBytes }`. 없는 링크는 404 |
| `POST` | `/api/r/:id/unlock` | `{ password }`. 맞으면 `rf_sh` 쿠키에 기록, 틀리면 403 `Wrong password`, 주소당 10분에 10회를 넘기면 429 |
| `POST` | `/api/r/:id/uploads` | `{ files: [{ name, size }] }`(최대 100개) → `{ batchId, endpoint }`. 이후 웹 앱과 같은 tus 엔드포인트로 보낸다(배치 순서 = `index`). 잠김 401, 만료·가득 참 410, 한도 초과 400(`This link accepts 2 more files.`), 쿼터·공간 부족 507, 주소당 시간당 30배치 초과 429 |

### 공유 링크 (공개, 로그인 불필요)

페이지 `/d/<linkId>`(하위 폴더는 `?f=<folderId>`)는 서버가 상태를 판정한다. 순서: 만료(링크나 위 폴더의 만료 시각이 지났거나, "다운로드 1회 후 삭제"가 사용됨, 또는 소유자 계정이 삭제일에 닿음) → 다운로드 한도 도달 → 비공개 → 비밀번호(링크와 위 폴더의 비밀번호 모두) → 열림. 비공개이거나 자기 비밀번호가 있거나 만료된 하위 항목은 목록·크기·zip에서 빠진다. 열 수 있거나 비밀번호로 열 수 있는 링크만 `name`을 보낸다([security.md](security.md#공유-링크다운로드)). 링크 소유자가 보면 "Visitor preview" 바가 붙고, 다운로드 수·활동 기록에 남지 않는다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/share/:linkId/unlock` | `{ password }` argon2 확인. 맞으면 서명된 `rf_sh` 쿠키(12시간)에 그 비밀번호를 가진 항목(링크나 위 폴더)을 기록. 다른 비밀번호가 남았으면 페이지가 다시 묻는다. 틀리면 403 `Wrong password`, 주소당 10분에 10회를 넘기면 429 |
| `GET`·`HEAD` | `/api/share/:linkId/files/:id/stream` | 방문자 재생·보기. 처음 요청만 "Played/Viewed"로 기록(30분 중복 제거). 다운로드 한도나 첫 다운로드 후 삭제가 걸린 파일은 브라우저마다 한 번 다운로드로 센다(`rf_dv` 쿠키). `?transcode=1`은 소유자 `stream`과 같은 변환 |
| `GET`·`HEAD` | `/api/share/:linkId/files/:id/preview` | 뷰어용 이미지(WebP 미리보기, 메타데이터 없음, 없으면 `stream`과 같은 응답). "Viewed" 기록, 다음 사진 미리 받기(`x-relayfiles-prefetch` 헤더)는 세지 않는다 |
| — | 만료로 지워진 링크 | 만료(자체 만료일, 첫 다운로드 후 삭제, 계정 삭제일)로 항목이 정리되면 그 링크와 하위 항목의 링크를 `LinkTombstone`에 `SHARE.tombstoneDays`(90일) 동안 남긴다. 그동안 `/d/<linkId>`는 "This link has expired" 카드, 파일 요청은 410. 존재한 적 없는 링크나 새 링크로 바뀐 옛 링크는 계속 404 |
| `GET` | `/api/share/:linkId/files/:id/thumb` | 목록 미리보기(WebP, 메타데이터 없음). 재생과 같은 접근 검사(만료 410, 잠김 401, 비공개 404)이고 Stream only 링크에서도 허용. 세거나 기록하지 않는다. 썸네일이 아직 없으면 404 |
| `GET`·`HEAD` | `/api/share/:linkId/files/:id/download` | 방문자 다운로드. 파일, 링크, 경로 위의 한도·첫 다운로드 후 삭제 항목의 다운로드 수 +1(이어받기 허가는 `rf_dv` 쿠키, `If-Range`가 ETag와 다르면 파일 전체로 판단), "Downloaded" 기록, 10분 창 혼잡도에 반영. 5회 이상이면 속도 제한(`X-Accel-Limit-Rate` 또는 앱 스로틀), 10회 이상이면 429 + `Retry-After`. Stream only 링크는 403. HEAD는 확인만 하고 세지 않는다 |
| `GET`·`HEAD` | `/api/share/:linkId/zip?folder=id` | "Download all": 방문자가 볼 수 있는 내용만 zip으로. HEAD는 확인만. 항목이 `SHARE.zipMaxItems`(100,000)를 넘으면 413 |

- 이미지는 계정 설정 "Strip metadata on public links"(기본 켬)일 때 위치·카메라 정보를 지운 사본으로 나간다(워커가 만든 사본만, 요청 중에는 이미지를 디코딩하지 않는다). 사본이 아직 없으면 503 `MEDIA_NOT_READY`와 `Retry-After`(다시 큐에 넣는다), 지울 수 없는 형식(HEIC 등)이나 워커가 실패한 파일(`Node.stripFailed`)은 415로 거절한다. zip에서는 빼고 `Not included.txt`에 이유와 함께 적는다.
