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
- 모든 페이지·API 응답에 보안 헤더(`next.config.ts`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`. 프록시를 거치는 응답에는 요청마다 nonce가 다른 Content-Security-Policy(`CSP_MODE`)와 https 사이트의 HSTS가 붙는다([security.md](security.md#응답-헤더자원-제한)).
- 캐시: 파일 바이트는 URL이 같으면 바뀌지 않으므로 재생(`stream`)·썸네일·미리보기·변환 영상은 `private, max-age=1년, immutable`, 다운로드는 `private, no-cache`(한도·횟수 집계를 위해 매번 요청).

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
| `POST` | `/api/nodes/delete` | `{ ids }` → `{ deleted }`. DB에서 지우고 볼륨의 `system/trash`로 옮긴다(정리 작업이 비움) |
| `POST` | `/api/nodes/tags` | `{ ids, add, remove }`. 태그는 소문자·공백→`-`·24자, 항목당 20개 |
| `GET` | `/api/tags` | 계정에서 쓰는 태그와 개수(태그 제안) |
| `PUT` | `/api/nodes/:id/settings` | 공유 설정(공개 범위, 만료·첫 다운로드 후 삭제는 관리자만, 다운로드 한도, 비밀번호(argon2), 접근, 메모, 하위 항목에 적용) |
| `POST` | `/api/nodes/:id/link` | 공유 링크 재발급(옛 링크 즉시 무효, 활동 기록에 남음) |
| `GET` | `/api/nodes/:id/activity` | 링크 활동 최신 200개(폴더는 하위 항목 포함) |
| `PUT` | `/api/nodes/:id/pause` | 관리자: 다운로드 일시정지/재개 |
| `POST` | `/api/uploads` | 업로드 준비 `{ target: home\|root\|폴더id, files: [{ rel, size }], dup?, fallbackName? }` → `{ kind: duplicates, names }` / `{ kind: nothing }` / `{ kind: ready, batchId, endpoint, folder, files }`. 이름 검증, 용량·볼륨 여유 공간(507), Home 업로드 폴더 생성 |
| tus | `/api/uploads/tus/:volumeId[/:uploadId]` | 재개 가능한 업로드(tus 1.0, 청크 `UPLOAD_CHUNK_SIZE_MB`). 메타데이터 `batch`, `index`, `filename`. 업로드한 기기의 계정만 이어 올리거나 조회할 수 있다. 완료되면 `{ success, data: { nodeId, name, folderId } }`. `proxy.ts`를 거치지 않는다(본문 버퍼링 방지) |
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
| `GET` | `/api/admin/audit` | 감사 로그 최신 200건 `{ events: AuditEntry[] }`(역할·삭제일·용량 변경, 계정 삭제, 가입 모드, 정리 실행, 초대 생성·취소, 관리자 토큰 보기·재발급, 공지 게시·내리기, 테마 변경, 장애 등록·수정·삭제) |
| `GET` | `/api/admin/server/stream` | Server 페이지 실측 지표 SSE(1.5초마다 스냅샷, 느린 스냅샷은 겹치지 않고 건너뜀) |
| `POST` | `/api/admin/incidents` | Status 페이지 Incident 등록 `{ title, text, severity, date, duration, resolved }` |
| `PUT`·`DELETE` | `/api/admin/incidents/:id` | Incident 수정 / 삭제 |

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
| `GET`·`HEAD` | `/api/share/:linkId/zip?folder=id` | "Download all": 방문자가 볼 수 있는 내용만 zip으로. HEAD는 확인만 |

- 이미지는 계정 설정 "Strip metadata on public links"(기본 켬)일 때 위치·카메라 정보를 지운 사본으로 나간다(워커가 만든 사본만, 요청 중에는 이미지를 디코딩하지 않는다). 사본이 아직 없으면 503 `MEDIA_NOT_READY`와 `Retry-After`(다시 큐에 넣는다), 지울 수 없는 형식(HEIC 등)이나 워커가 실패한 파일(`Node.stripFailed`)은 415로 거절한다. zip에서는 빼고 `Not included.txt`에 이유와 함께 적는다.
