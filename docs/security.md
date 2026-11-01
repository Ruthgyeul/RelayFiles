# 보안 모델

코드와 함께 갱신한다. 구조와 저장소 역할은 [architecture.md](architecture.md)를 본다.

## 파일 스토리지

| 위협 | 구현 |
|---|---|
| 경로 조작 | 경로는 클라이언트에서 받지 않고 노드 이름으로 서버가 만든다. 각 이름은 `domain/names.ts`의 `nameError`(빈 값, `.`/`..`, `/`, NUL, 앞뒤 공백, 255바이트 초과 거부)를 통과해야 한다. 결과 경로가 `users/<accountId>` 아래인지 `path.resolve` 뒤 다시 확인한다(`storage/safe-path.ts`) |
| 계정 id 위조 | 계정 id는 12자 base32 형식(`domain/ids.ts`)만 허용한다 |
| 심볼릭 링크 | 계정 루트부터 대상까지 모든 구성요소를 `lstat`으로 확인해 링크가 있으면 거부한다. 파일은 `O_NOFOLLOW`로 연다 |
| 업로드 경로 | 완료된 업로드는 볼륨의 `system/tmp/uploads` 아래에서만 `rename`으로 옮긴다 |
| 중복 제거 | 하드 링크는 같은 계정의 파일 사이에만 만들고, 원본 경로도 같은 경로 검사(`pathOf`)를 거친다. 폴더 복사는 일반 파일과 폴더만 따라가고 그 밖의 항목(심볼릭 링크 등)이 있으면 거부한다. 재업로드는 DB의 SHA-256과 디스크의 크기가 모두 같을 때만 링크한다 |
| 권한 | 디렉터리 `0700`, 마커 파일 `0600`. 운영에서는 전용 계정(uid 10001)이 소유한다 |
| SSD 미마운트 | `.relayfiles-volume` 마커가 없으면 볼륨을 offline으로 판단하고 쓰지 않는다. 마커가 다른 볼륨이거나 레이아웃 버전이 다르면 사용하지 않는다 |
| DB·디스크 불일치 | `withStorageTransaction`이 DB 트랜잭션 실패 시 파일 변경을 역순으로 되돌린다. 되돌리기 실패는 `storage rollback step failed` 에러 로그로 남는다. `npm run storage:fsck`가 DB와 디스크를 대조해 디스크에만 있는 항목(휴지통으로 이동), DB에만 있는 파일(`missing` 표시), 크기가 다른 파일을 찾는다(기본은 보고만, `--fix`로 정리. `--fix`는 볼륨을 `READONLY`로 잡고 진행 중인 쓰기가 끝난 뒤에만 고친다: 커밋 전인 업로드·복사의 파일을 "디스크에만 있음"으로 휴지통에 넣지 않는다) |
| 볼륨 이동 | 이동 중인 계정(`migrating`)과 레이아웃 마이그레이션 중인 볼륨(`READONLY`)은 쓰기를 503 `STORAGE_BUSY`로 막는다. 쓰기는 시작할 때 한 번, 그리고 스토리지 트랜잭션 안에서 계정·볼륨 쓰기 잠금(advisory lock, 공유)을 잡은 뒤 다시 확인한다. 이동·마이그레이션은 같은 잠금을 배타로 잡아 진행 중인 쓰기가 끝난 뒤 표시를 켜므로, 오래 걸린 복사·업로드가 떠나는 볼륨에만 파일을 남기지 않는다([architecture.md "쓰기 잠금"](architecture.md#쓰기-잠금)). 복사본은 모든 파일의 SHA-256이 원본과 같고, 전환 직전에 원본이 해시한 그대로이며 DB의 모든 항목이 복사본에 있을 때만 사용한다. 원본은 휴지통에 24시간 남긴다 |
| 분실·도난 | SSD 전체를 LUKS2로 암호화한다(앱은 파일을 따로 암호화하지 않으며, 디스크의 파일은 업로드한 원본과 같다) |

## 로그

- `server/logger.ts`의 `redact()`가 `token`, `password`, `secret`, `authorization`, `cookie`, `ip`, `x-forwarded-for`, `cf-connecting-ip` 키의 값을 `[redacted]`로 바꾼다.
- 운영 로그 레벨은 warn 이상, 파일은 `LOG_DIR`(기본 `/var/log/relayfiles`)에 쓴다.

## API

- 예상하지 못한 예외는 응답에 내용을 싣지 않는다(`apiHandler`). 요청 id로 로그를 찾는다.

## 인증

- **계정 토큰**(40자)은 평문으로 저장하지 않는다. `Account.tokenLookup` = HMAC-SHA256(`TOKEN_HMAC_KEY`)으로 로그인 시 계정을 찾고, `Account.tokenEnc` = AES-256-GCM(`TOKEN_ENC_KEY`, `[키 id 4B][IV 12B][tag 16B][암호문]`)으로 소유자가 프로필에서 다시 볼 수 있게 한다(`server/auth/token-crypto.ts`).
- **키 교체**: `*_PREVIOUS`를 설정하면 옛 키로 만든 값도 읽힌다. 다음 로그인 때 새 키로 다시 암호화·해시한다. `npm run keys:rotate`가 모든 계정을 새 키로 다시 저장하면 `*_PREVIOUS`를 지운다(절차: [runbook.md](runbook.md#비밀값-교체)).
- **기기 쿠키** `rf_s`: 이 기기에 로그인한 세션 id 목록(최대 10)과 활성 세션만 담고 HMAC으로 서명한다(`COOKIE_SECRET`, 교체 시 `COOKIE_SECRET_PREVIOUS`). `HttpOnly`, `SameSite=Lax`, `PUBLIC_URL`이 https면 `Secure`. 토큰은 쿠키에 넣지 않는다.
- **세션 폐기**: 요청마다 DB에서 `Session.revokedAt`과 계정 만료를 확인하므로 다른 기기에서 로그아웃하거나 만료되면 즉시 무효가 된다. 무효 세션은 쿠키에서 지운다.
- **세션 절대 수명**(`domain/session.ts`): 로그인(`Session.createdAt`)부터 관리자 `AUTH.adminSessionDays`(7일), 일반 `AUTH.memberSessionDays`(14일)가 지나면 세션이 끝난다. 계정이 만료되지 않는 관리자라도 기기 세션은 영구적이지 않다.
- **재인증**: 토큰 보기·재발급, 자기 계정 삭제(마지막 관리자는 지울 수 없다)와 관리자의 계정 관리(역할·삭제일·용량)·삭제, 가입 모드 변경은 세션이 최근 `AUTH.reauthWindowMin`(10분) 안에 로그인했거나 토큰을 다시 입력했을 때만 허용한다(`requireRecentAuth`, 아니면 403 `REAUTH_REQUIRED`). 일반 계정도 같다. 토큰은 만료되지 않고 어디서나 로그인할 수 있어서, 두고 간 기기나 페이지에 주입된 스크립트가 읽으면 계정이 영구히 넘어가기 때문이다. 새 계정은 가입 직후(창 안)에 토큰을 볼 수 있다. 입력은 `POST /api/auth/reauth`이고 로그인과 같은 잠금 단계를 쓴다.
- **감사 로그**(`AuditEvent`): 관리자 작업(위 작업 + 정리 실행, 초대 생성·취소)을 행위자 id·이름, 대상, 짧은 설명, 마스킹한 주소와 함께 남긴다. 초대 코드는 앞 4자만 적는다. `AUTH.auditRetentionDays`(365일)가 지나면 매일 정리 작업이 지운다. 조회: Server 페이지 "Audit log" 카드(`GET /api/admin/audit`).
- **`env:check`**: 운영 모드에서 `ADMIN_ALLOWED_CIDRS`가 비어 있으면 경고한다.
- **관리자 역할 변경 직렬화**: 강등과 관리자 계정 삭제는 트랜잭션 안에서 advisory lock(`lockAdminRoles`)을 잡고 관리자 수를 센다. 두 관리자가 동시에 서로를 강등해도 0명이 되지 않는다.
- **관리자 작업 기록**: 초대 생성·정리 실행은 재인증이 필요하고, 공지 게시·내리기, 테마 변경, 장애 등록·수정·삭제도 감사 로그에 남는다.
- **관리자 Server 스트림(SSE)**: `METRICS.streamSessionCheckMs`(30초)마다 세션을 다시 읽어 로그아웃·강등·대역 밖이면 끊고, 한 연결은 `streamMaxLifetimeMs`(1시간)까지(EventSource가 다시 연결하며 다시 확인), 계정당 동시 `streamMaxPerAccount`(3)개까지.
- **세션 정리**: 기기 쿠키는 세션 10개까지라, 새 로그인이 밀어낸 가장 오래된 세션은 DB에서도 폐기한다. 매일 정리 작업이 폐기된 세션과 가장 긴 세션 수명보다 오래된 세션 행을 지운다.
- **로그인 잠금**: 클라이언트 주소(HMAC으로 가린 키, IPv6는 `/64` 단위 — `rateLimitSubject`)마다 Redis에 시도 횟수를 센다. 5회마다 30초 → 120초 → 600초 잠금(`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_SECONDS`). 잠긴 동안에는 올바른 토큰도 429로 거부한다. 시도는 토큰을 확인하기 **전에** Lua 스크립트 하나로 센다(잠김 확인·증가·잠금이 원자적이라 동시에 보낸 추측이 잠금 전에 모두 통과하지 못한다). 맞는 토큰은 자기 시도 하나만 돌려받고, 같은 주소의 이전 실패는 그대로 남는다(자기 계정으로 로그인해 다른 계정 추측의 실패 기록을 지울 수 없다).
- **익명 가입 제한**: 같은 주소에서 시간당 10개(`SIGNUPS_PER_HOUR`, 기본값은 `config/policy.ts`). 크롤러가 디스크에 계정 폴더를 채우는 것을 막는다. 가입 모드(Open/Invite only/Closed)는 `ServerConfig.signupMode`, 초대 코드는 한 번만 쓸 수 있다.
- **계정 생성의 원자성**: 계정 행, 루트 폴더 노드, 기기 세션, 볼륨의 `users/<accountId>/` 디렉터리를 `withStorageTransaction`으로 함께 만든다. 중간에 실패하면 DB는 롤백되고 디렉터리는 휴지통으로 옮긴다.
- **클라이언트 주소**: `CF-Connecting-IP` → `X-Real-IP` 순으로 읽는다. 앱 포트는 Nginx를 통해서만 접근 가능해야 한다(직접 노출하면 헤더 위조로 잠금을 우회할 수 있음). systemd 배포는 `APP_HOST`(기본 `127.0.0.1`, 비어 있어도 루프백)로 루프백에만 열고, Docker 배포의 app 컨테이너는 포트를 공개하지 않는다. 앞단 Nginx는 방문자가 보낸 `CF-Connecting-IP`를 비워서 넘긴다. 세션에는 마스킹한 주소(`a.b.•••.•••`)와 Cloudflare 국가·도시 헤더만 저장한다.
- **`src/proxy.ts`**: 모든 요청에 `x-request-id`를 붙이고(클라이언트가 보낸 값은 UUID일 때만 쓴다. 로그와 에러 페이지에 임의 문자열이 들어가지 않게), `ADMIN_ALLOWED_CIDRS`가 있으면 `/admin/*`·`/api/admin/*`를 그 대역에서만 허용한다(페이지는 프록시가 직접 보내는 403 HTML, API는 403 JSON. rewrite를 쓰면 상태가 200이 되고 `x-middleware-rewrite`에 내부 주소가 드러난다). 정적 파일 확장자 제외는 `/api` 밖에서만 적용한다(`.png`로 끝나는 API 경로도 CSRF·대역 검사를 받는다). 관리자 대역은 `requireAdmin`과 관리자 레이아웃에서도 다시 확인한다(`DeviceSession.adminNetwork`). 다른 사이트 Origin에서 온 API 쓰기 요청(POST 등)은 403으로 거부한다(CSRF 방어). 권한 검사는 각 핸들러에서 다시 한다.
- **개인 API 토큰**(`/api/v1`): `rfp_<토큰 id 12자>_<난수 43자>`(약 250비트). 평문은 만들 때 한 번만 보여 주고 `ApiToken.secretHash` = argon2id 해시만 저장한다(DB가 새도 토큰을 되살리거나 대조할 수 없다). 요청은 토큰 id로 행을 찾아 argon2로 확인하고, 같은 프로세스는 확인한 토큰을 `API.verifyCacheSec`(5분) 동안 기억해 요청마다 해시하지 않는다(행은 매 요청 다시 읽으므로 폐기·만료는 즉시 반영된다). 없는 id는 해시 계산 없이 401이라 추측 요청으로 CPU를 쓰게 할 수 없다. 키를 쓰지 않으므로 `TOKEN_HMAC_KEY` 교체와 무관하다. `Authorization: Bearer`로만 받고 쿠키는 읽지 않으므로 다른 사이트가 브라우저를 통해 호출할 수 없다(그래서 `/api/v1/files` 업로드는 본문을 버퍼링하지 않게 `proxy.ts`를 거치지 않는다). 범위(`files:read`·`files:write`·`metrics:read`, 마지막은 관리자만)를 매 요청 확인하고(읽기·다운로드·검색·공유 설정 보기는 `files:read`, 업로드·이름 변경·이동·삭제·공유 설정 변경·링크 재발급은 `files:write`, 항목의 만료·첫 다운로드 후 삭제는 웹 앱처럼 관리자 계정만 바꿀 수 있다), 토큰마다 분당 `API.requestsPerMinute`(120)회, 계정당 `API.maxTokensPerAccount`(20)개. 만료일(7·30·90·365일 또는 없음)이 지난 토큰은 거부하고 매일 정리 작업이 지운다. 계정이 삭제일에 닿으면 토큰도 무효. 만들기는 재인증이 필요하고 만들기·폐기는 감사 로그에 남는다. 계정 토큰과 달리 로그인에는 쓸 수 없다.
- **`/metrics`**: 관리자 계정의 `metrics:read` 토큰과 `ADMIN_ALLOWED_CIDRS`(설정된 경우)를 매 요청 확인한다. 토큰을 만든 뒤 멤버로 강등되면 그 토큰으로도 읽지 못한다. 레이블에는 서비스·구성 요소 이름, 디스크 장치 이름, 작업 상태만 쓴다(계정 id·이름, 파일 이름, 주소는 넣지 않는다).
- **첫 관리자**: 서버에서 `npm run admin:create`. 토큰은 터미널에 한 번만 출력된다.

## 업로드

- 업로드는 `POST /api/uploads`로 배치를 만든 뒤 tus로 보낸다. 배치(계정, 볼륨, 대상 폴더, 파일 목록, 중복 처리 방식)는 Redis에 `UPLOAD_TMP_TTL_HOURS` 동안 저장되고, tus 업로드는 시작할 때 크기를 밝혀야 하고(`Upload-Defer-Length` 불가) 배치에 적힌 크기와 같아야 시작된다. 그 크기로 용량·여유 공간을 검사하고, 완료 시 받은 바이트 수를 다시 대조한다.
- **진행 중인 업로드 예약**(`server/upload/reservations.ts`, `space.service.ts`): 확정된 파일만 보면 동시에 시작한 업로드가 각각 검사를 통과해 쿼터나 디스크를 넘는다. tus 업로드를 시작할 때 계정·볼륨·익명 계정 전체(`ANON_TOTAL_QUOTA_GB`) 범위마다 남은 공간과 진행 중 예약 합계를 Lua 스크립트 하나로 확인하고 예약한다. 완료(파일이 사용량에 들어감)·거부·취소(tus DELETE) 때 풀고, 남은 예약은 `UPLOAD_TMP_TTL_HOURS` 뒤 저절로 소멸한다(그때 조각도 정리된다). 배치 준비(`POST /api/uploads`)도 예약을 포함해 검사한다.
- 파일별 취소는 보내는 중인 파일에 tus DELETE를 보내므로 그 파일의 예약이 바로 풀린다(위와 같은 경로). 아직 시작하지 않은 파일은 서버에 아무것도 만들지 않는다.
- tus 업로드 id마다 소유 계정을 Redis에 기록하고, 이어 올리기·조회·취소 요청은 같은 기기에 그 계정이 로그인해 있을 때만 허용한다(다른 계정은 404).
- **새로고침 뒤 이어 올리기**(`POST /api/uploads/resume`, `server/upload/resume.ts`): 새 배치의 파일 하나가 이 기기의 끝나지 않은 tus 업로드를 넘겨받는다. 업로드 소유 계정과 새 배치 계정이 요청한 계정과 같고(업로드 전용 링크의 업로드는 대상 아님), 업로드가 배치 볼륨의 임시 영역에 남아 있으며 받은 바이트 < 길이, 길이·파일 이름이 배치 항목과 같고, 같은 배치의 다른 칸이 이미 가져가지 않았을 때만 허용한다. 하나라도 어긋나면 404(존재 여부를 드러내지 않음)이고 클라이언트는 그 파일을 처음부터 보낸다. 업로드 id가 그대로라 공간 예약은 같은 id로 갱신되고(두 번 세지 않음), 소유자 기록을 새로 고친 뒤 `upload:slot:<id>`에 새 배치·칸을 적는다. tus 완료 단계는 메타데이터의 배치보다 이 값을 먼저 읽어 새 배치의 폴더·중복 처리로 둔다.
- 조각은 볼륨의 `system/tmp/uploads/`에 쌓이고, 완료되면 같은 파일시스템 안에서 `rename`으로 사용자 폴더에 들어간다(복사 없음). 파일 종류는 내용(매직 바이트)으로 판정하고, SHA-256을 기록한다.
- 완료 처리가 실패하면(그 사이 대상 폴더가 지워짐, 이름 충돌 등) 받은 조각을 바로 지운다. 6시간 뒤 정리를 기다리는 동안 어떤 용량 검사에도 잡히지 않기 때문이다. `moveIntoPlace`는 상위 폴더를 다시 만들지 않는다(완료 중 이름이 바뀐 폴더의 옛 경로가 디스크에 되살아나지 않게). 계정 루트 폴더만 다시 만든다.
- Home 업로드도 폴더 깊이(`STORAGE.maxFolderDepth`)를 검사한다.
- **휴지통 바이트도 용량에 들어간다**(`TrashedBytes`): 지운 파일은 매일 정리 전까지 볼륨 휴지통에서 디스크를 차지한다. 그 바이트를 계정 쿼터와 익명 전체 한도에 넣고, 매일 정리 작업이 휴지통과 같은 기준 시각으로 기록을 지운다. "올리고 지우기"를 반복해 볼륨을 채울 수 없다. 지운 바이트는 삭제 트랜잭션 안에서 지울 트리 전체를 `FOR UPDATE`로 잠근 뒤 센다(그 사이 폴더에 들어온 파일도 함께 지워지고 함께 센다). 기록은 휴지통이 있는 볼륨(`TrashedBytes.volumeId`)을 갖고, 매일 정리는 실제로 비운 볼륨(`ACTIVE`·`DRAINING`)의 기록만 지운다(`READONLY`·`OFFLINE` 볼륨의 휴지통은 계속 센다).
- **복사**(`copyNodes`)는 업로드처럼 계정·볼륨·익명 전체 범위에 공간을 예약한다(동시에 보낸 복사가 모두 통과하지 못한다). 바이트는 DB 트랜잭션 밖에서 볼륨의 `system/tmp/uploads/copy-<id>/item`으로 먼저 복사하고(reflink 가능), 짧은 트랜잭션에서 행 삽입과 `rename`만 한다. 큰 복사가 DB 연결을 붙잡거나 트랜잭션 제한 시간을 넘긴 뒤 롤백되지 않는다. 복사는 처음 읽은 DB 행마다 파일을 하나씩 만든다(디스크의 폴더를 통째로 읽지 않는다). 그래서 DB에 없는 디스크 파일은 따라오지 않고, 그 사이 이름이 바뀌거나 지워진 파일이 있으면 409로 멈추며 아무것도 남기지 않는다. 매일 정리는 복사 준비 폴더 자체의 시각을 보므로(하드 링크된 파일은 원본의 옛 mtime을 가진다) 진행 중인 복사를 지우지 않는다.
- 계정당 파일·폴더 수는 `FILES.maxItemsPerAccount`(10만, 관리자는 무제한)까지다. 0바이트 파일은 쿼터를 쓰지 않으므로 개수 제한이 없으면 inode와 DB를 고갈시킬 수 있다.
- 휴지통 항목 이름은 `<시각>-<무작위 8자>-<계정>-<이름>`이다(같은 밀리초에 같은 이름을 지워도 충돌하지 않는다).
- **복원(Recently deleted)**: `DeletedItem`은 계정 범위로만 찾으므로 다른 계정의 id는 404다(목록에도 나오지 않는다). 휴지통 경로는 클라이언트에서 받지 않고 서버가 저장한 값만 쓰며, 드라이버는 그 경로의 항목 이름(형식 검사)만 써서 볼륨 휴지통 바로 아래 항목만 다룬다. 되돌릴 위치는 서버가 원래 부모 id(계정의 폴더일 때만) 또는 계정 루트로 계산하고, `resolveInsideUserRoot`·심볼릭 링크 검사를 그대로 거친다. 복원은 다른 쓰기와 같이 `lockAccountForWrite` 아래에서 하고, 계정이 다른 볼륨으로 옮겨졌으면 409로 거절한다(옛 볼륨에 쓰지 않는다). 디스크에 같은 이름이 있으면 덮어쓰지 않는다. 복원한 항목은 같은 `linkId`와 공유 설정(비밀번호 해시, 공개 범위, 다운로드 수·한도)을 되찾으므로 지우기 전에 보낸 링크가 다시 열린다. 스냅샷에는 Node 행과 같은 정보(비밀번호는 argon2 해시만)가 들어 있다. 만료·첫 다운로드 후 삭제로 지워진 항목은 링크를 되살리지 않도록 복원 대상이 아니다. 복원으로 휴지통 바이트가 파일 바이트로 바뀔 뿐이라 쿼터는 그대로이고, 항목 수 한도(`FILES.maxItemsPerAccount`)는 다시 확인한다.
- tus 서버의 CORS는 `PUBLIC_URL` origin만 허용한다(기본값 `*` 대신). tus 경로는 `apiHandler`를 쓰지 않지만 예외를 잡아 내부 내용 없이 500으로 답하고, 깨진 쿠키 인코딩은 로그아웃 상태로 본다.
- tus 경로(`/api/uploads/tus/*`)는 `proxy.ts` matcher에서 제외한다. 프록시는 요청 본문을 메모리에 복사(기본 10MB 제한)하기 때문이다. 이 경로는 쿠키(SameSite=Lax)와 배치 소유권으로 보호된다. 배치를 만드는 `POST /api/uploads`는 프록시의 Origin 검사를 거친다.
- **업로드 전용 링크**(`/r/<id>`, `FileRequest`): 방문자(계정 없음)가 소유자의 폴더 하나에 파일을 넣는다. 방문자에게는 제목·소유자 이름·남은 한도만 보이고 폴더 id·이름·내용은 보내지 않는다(tus 완료 응답도 파일 이름만). 파일은 이름만 받고(폴더 구조 없음) 같은 이름이 있으면 "name (2)"로 둔다. 비밀번호는 공유 링크와 같이 argon2로 저장하고, 입력한 기기는 `rf_sh` 쿠키에 `req:<id>` 항목(비밀번호 해시 태그 포함)으로 기억한다. 틀린 비밀번호는 요청·주소당 `SHARE.unlockMaxAttempts`회까지. 업로드 배치는 요청·주소당 시간당 `FILE_REQUEST.batchesPerHour`(30)개, 한 번에 `maxFilesPerBatch`(100)개까지. 소유자의 쿼터·항목 수·볼륨 공간이 그대로 적용되고, 링크 자체의 "파일 N개까지"·"총 X MB까지"는 업로드 예약과 같은 Lua 예약(`request-files`·`request-bytes` 범위)으로 지켜 동시에 시작한 업로드가 한도를 함께 넘지 못한다. tus 이어 올리기·완료는 업로드 id에 기록된 요청이 아직 받을 수 있고 이 기기가 비밀번호를 입력했을 때만 허용한다(배치 id만 알아서는 보낼 수 없다). 링크를 지우거나 만료되면 진행 중인 업로드도 멈춘다. 만료된 링크는 `FILE_REQUEST.expiredKeptDays`(30일) 동안 "expired"로 답한 뒤 매일 정리에서 지워지고, 받은 파일은 폴더에 남는다. 소유자 계정이 삭제일에 닿으면 링크도 만료로 본다.

## 순번 정리·중복 찾기

- 두 기능 모두 활성 계정의 폴더만 다룬다(다른 계정 폴더는 404). 경로는 서버가 노드 id로 계산하고, 클라이언트가 보내는 것은 정렬 방식과 미리보기에서 받은 `{ id, to }` 목록뿐이다. 서버는 그 목록을 믿지 않고 잠금 뒤 계획을 다시 계산해 같을 때만 실행한다.
- 이름 변경은 대상 이름이 있으면 실패하는 `renameNoReplace`로만 한다(어떤 경우에도 다른 파일을 덮어쓰지 않는다). 실패하면 모든 이름을 되돌린다.
- 볼륨 이동·레이아웃 마이그레이션 중에는 다른 변경처럼 `STORAGE_BUSY`(503)로 거절한다.
- 폴더로 저장하는 다운로드는 사용자가 고른 폴더에만 쓰고, 이미 있는 파일을 덮어쓰지 않는다. 요청은 같은 출처의 다운로드 URL(`/api/files/<id>/download`, `/api/zip`)만 쓰므로 서버 쪽 권한·제한은 그대로다.

## 공유 링크·다운로드

- 다운로드는 `nosniff`, 미디어 재생 외에는 `attachment`. HTML·SVG는 `application/octet-stream`으로 보낸다.
- 링크 비밀번호는 argon2 해시로 저장한다. 맞히면 서명한 `rf_sh` 쿠키(v2)로 12시간(`SHARE.unlockHours`) 열린다. 쿠키 항목은 `[linkId, until, pwTag]`이고 `pwTag`는 `HMAC(COOKIE_SECRET, passwordHash)` 앞 8바이트다. 비밀번호를 바꾸면 기존 기기는 다시 입력해야 한다(v1 쿠키는 무시). 틀린 비밀번호는 아직 필요한 비밀번호를 가진 항목·주소마다 600초에 10회(`countInWindow`, INCR+EXPIRE 원자 실행)를 넘으면 429. 어느 링크로 시도해도 같은 항목의 횟수에 쌓이므로, 잠긴 폴더 아래 여러 링크를 번갈아 써도 시도 횟수가 늘지 않는다. 맞힌 비밀번호는 그것이 연 항목에서 이번 시도 하나만 돌려받는다(로그인과 같다). 아는 비밀번호로 다른 비밀번호의 실패 기록을 지울 수 없다. 업로드 전용 링크도 같다.
- 혼잡도: 10분에 다운로드 5회부터 속도를 제한하고, 10회부터 멈춘다(429 + `Retry-After`).
- **경로 전체의 설정**(`domain/share.ts` `strictestGuard`, `share.service.ts`): 링크로 연 항목은 계정 루트에서 그 항목까지 위에 있는 모든 폴더(계정 루트 폴더 자신 포함)의 설정을 함께 따른다. 위 폴더가 만료됐거나 첫 다운로드 후 삭제가 이미 쓰였으면 만료, 위 폴더에 비밀번호가 있으면 그것까지 입력해야 열린다(비밀번호를 하나 맞히면 그 비밀번호를 가진 항목들이 열리고, 남은 것이 있으면 다시 묻는다). 소유자 계정이 삭제일에 닿아도 정리 작업 전에 링크가 닫힌다.
  - 반대로 폴더 링크 아래에서 **자기 비밀번호가 있거나 만료된 항목**은 그 폴더 링크에 나오지 않는다(목록·크기·zip에서 빠지고 파일 요청은 404). 그런 항목은 자기 링크로만 연다.
  - Stream only와 관리자의 다운로드 일시정지도 경로 전체를 따른다(`WayAbove`): 위 폴더 하나에 걸려 있으면 그 아래 항목은 어느 링크로 열어도 다운로드·zip이 막힌다. 재생은 그대로 된다.
  - 다운로드는 파일, 링크 루트, 그리고 경로 위에서 다운로드 한도나 첫 다운로드 후 삭제가 걸린 모든 항목에 함께 센다. 첫 다운로드 후 삭제가 걸린 파일은 폴더 링크로 받아도 한 번만 받는다.
  - 비공개·만료·한도 도달 링크 페이지는 항목 이름을 보내지 않는다(열 수 있거나 비밀번호로 열 수 있는 링크, 소유자에게만).
- 다운로드 횟수(`domain/share-access.ts` `downloadDecision`): Range 헤더 문자열이 아니라 **실제로 보낼 범위**로 판단한다(`effectiveRange`). 첫 바이트를 보내는 요청(Range 없음, `bytes=0-…`, 파일 전체를 덮는 `bytes=-N`)은 시작으로 세고, 그 브라우저에 `dl:grant:<파일>:<방문자 id>`를 `SHARE.downloadGrantHours` 동안 준다. 방문자 id는 `rf_dv` 쿠키(무작위 128비트, `Path=/api/share`, HttpOnly)다. IP가 아니므로 같은 NAT 뒤의 다른 사람은 grant를 쓰지 못한다. 0이 아닌 위치에서 시작하는 Range(이어받기)는 grant가 있을 때만 보낸다(없으면 403, 다시 시작하면 한 번 더 센다).
  - `If-Range`가 파일의 ETag와 다르면 Nginx와 `sendFile`은 Range를 무시하고 파일 전체를 보낸다. 그래서 그런 요청은 파일 전체 요청으로 판단한다(만든 `If-Range`로 미리보기 한도나 Stream only, 다운로드 횟수를 넘지 못한다). 이어받기는 앱의 ETag(SHA-256)를 보내므로 범위가 유지된다. Docker 템플릿의 X-Accel location은 Nginx 자체 ETag 대신 앱의 ETag를 보낸다(`etag off; add_header ETag $upstream_http_etag`).
  - 다운로드는 첫 바이트부터 읽는 요청(Range 없음, `bytes=0-…`)마다 센다. 그래서 링크를 가진 사람은 1바이트 요청으로도 한도나 첫 다운로드 후 삭제를 소진하고 혼잡도를 올릴 수 있다. 링크를 가진 사람은 파일을 받을 수 있는 사람이라는 전제로 받아들인 동작이다.
  - 다운로드 한도나 첫 다운로드 후 삭제가 걸린 파일은 재생(`/stream`)도 센다(`limitedStreamDecision`): 첫 요청이 한 번 세고 grant를 받으며, 같은 브라우저의 탐색·재요청은 grant로 통과한다. 변환 재생(`?transcode=1`)도 같은 규칙으로 센다. 실시간 변환은 Range를 무시하고 영상 전체를 보내므로 어떤 파일로도 만족할 수 없는 Range는 전체 요청으로 본다. 이런 이미지는 세지 않는 뷰어 미리보기 대신 세는 재생 경로로 보낸다.
- 카운트는 원자적이다(`share.repo.ts` `claimDownload`): 센 항목 모두를 한 트랜잭션에서 `downloads < downloadLimit`(첫 다운로드 후 삭제면 `downloads = 0`) 조건으로 올리고, 하나라도 실패하면 되돌린다. 한도 N-1에서 동시에 들어온 요청은 하나만 통과한다.
- "Download all"(zip)은 파일마다 단일 다운로드와 같은 규칙(`downloadBlock`: Stream only, 한도 도달, 일시정지·혼잡도 2단계)으로 거르고, 뺀 파일은 사유와 함께 `Not included.txt`에 적는다. 넣은 파일은 각각 한 번씩 센다(`claimEachDownload`, 그 사이 한도에 닿은 파일은 뺀다). zip 항목 이름은 세그먼트마다 `\`·`:`·제어 문자를 `_`로 바꾸고 `.`·`..`을 `_`로 바꿔(`zipEntryName`), 이름에 역슬래시가 든 파일이 압축을 풀 때 대상 폴더 밖으로 나가지 못하게 한다(zip slip).
- 공유 재생 경로(`/stream`, `streamReach`)는 뷰어가 읽는 만큼만 보낸다: 미디어와 PDF는 범위 제한 없음, 텍스트·코드·표는 앞 `DOCUMENT_PREVIEW.textMaxBytes`, SVG·폰트·Word·Excel은 앞 `assetMaxBytes`까지(넘으면 403), 미리보기가 없는 형식(압축, 실행 파일, 디스크 이미지 등)은 404. 소유자 본인에게는 적용하지 않는다.
- **Stream only는 DRM이 아니다.** 재생할 수 있는 영상·음악·이미지·PDF는 브라우저가 받은 바이트를 저장하거나 화면을 녹화할 수 있다. 다운로드 버튼과 zip, 미리보기가 없는 형식, 문서 전체 받기를 막을 뿐이다.
- 공개 링크 이미지는 워커가 만든 메타데이터 제거본만 보낸다. 요청 처리 중에는 이미지를 메모리에 올리거나 디코딩하지 않는다(비로그인 방문자가 큰·깨진 사진 폴더로 앱 메모리를 고갈시킬 수 있었다). 사본이 없으면 503 `MEDIA_NOT_READY` + `Retry-After`, 워커가 파일 자체를 정리하지 못한 파일(`stripFailed`: 디코딩 불가, 너무 큼)과 제거할 수 없는 형식은 415. 디스크 I/O 오류·볼륨 분리·시간 초과 같은 저장소 문제는 `stripFailed`로 기록하지 않고 작업을 다시 시도하므로 그동안 503으로 남는다(원본이 메타데이터째 나가는 일은 어느 쪽이든 없다). PNG·WebP는 허용 목록 청크만 남긴다(이미지 데이터, 색 정보, 애니메이션: C2PA `caBX`·`C2PA`, 텍스트·EXIF·XMP·개인 청크는 모두 지운다). 뷰어 미리보기도 메타데이터 없이 다시 인코딩한 WebP다.
- 변환 재생(`?transcode=1`)은 `-map_metadata -1 -map_chapters -1`로 원본의 메타데이터(휴대폰이 기록한 촬영 위치 `©xyz` 등)를 넘기지 않는다. 변환하지 않는 원본 영상은 그대로 나간다. 워커가 저장하는 변환본(자주 재생되는 영상)도 같은 인자로 만들어 메타데이터가 없다.

## 리버스 프록시·헤더

- API 쓰기 요청의 CSRF 검사(`proxy.ts`): `Sec-Fetch-Site: cross-site`이면 거부하고, Origin은 `PUBLIC_URL`의 origin 또는 브라우저가 보낸 `Host`와 같아야 한다. 클라이언트가 보낼 수 있는 `X-Forwarded-Host`는 보지 않는다.
- Nginx는 `X-Forwarded-Host`를 `$host`로 덮어쓴다. Docker 템플릿의 `X-Forwarded-Proto`는 신뢰 피어(cloudflared, `TRUSTED_PROXY_IP`)가 보낸 `http`/`https`만 넘기고, 그 밖에는 이 홉의 scheme을 쓴다. 호스트 Nginx 템플릿(systemd)도 같은 호스트의 cloudflared(`127.0.0.1`, `$realip_remote_addr`)가 보낸 값만 믿는다.
- 렌더링 스크립트는 `.env` 값에 줄바꿈·`;`·`{}`·따옴표·`$`·`\`가 있으면 거부한다(`render-template.mjs`). `setup-ssd.sh`는 `STORAGE_ROOT`가 평범한 경로인지, UID·GID가 숫자인지 확인한 뒤 fstab·crypttab에 쓴다.
- X-Accel location은 `disable_symlinks on from=<볼륨 루트>`다. 앱이 `lstat`으로 확인한 뒤 Nginx가 파일을 다시 열기 때문에, 그 사이에 생긴 심볼릭 링크를 거부한다.
- Nginx `limit_req`(앱의 Redis 제한 앞단): `POST /api/auth/*`·`POST /api/share/*/unlock` 분당 20회(버스트 20, `NGINX_AUTH_RATE_PER_MIN`·`NGINX_AUTH_BURST`), `POST /api/uploads` 분당 60회(버스트 30, `NGINX_UPLOAD_RATE_PER_MIN`·`NGINX_UPLOAD_BURST`), 개인 API 토큰 요청 `/api/v1/*`·`/metrics` 분당 120회(버스트 60, `NGINX_API_RATE_PER_MIN`·`NGINX_API_BURST`. 있는 토큰 id에 틀린 비밀값을 보내면 앱의 토큰별 제한 전에 argon2가 돈다), 클라이언트 주소마다. 요청 본문은 `NGINX_MAX_BODY_MB`(100)까지. 넘으면 API 형식 JSON 429와 `Retry-After: 60`.
- 호스트 이름(DNS 리바인딩): Nginx는 `SERVER_NAME`(공백으로 여러 개)과 `127.0.0.1`(릴리스 스크립트의 헬스 체크)로 온 요청만 앱에 넘기고, 다른 `Host`는 응답 없이 연결을 끊는다(444). Docker·k3s 템플릿은 `default_server`가 이 일을 하고(`SERVER_NAME=_`이면 모든 이름을 받는다), systemd는 `install.sh`가 다른 기본 사이트가 없을 때 `relayfiles-catchall.conf`를 넣는다.
- k3s: 앱 Pod는 NetworkPolicy로 Nginx Pod와 워커(Status 페이지 프로브)의 연결만 받는다. 앱은 `X-Real-IP`·`CF-Connecting-IP`로 방문자 주소를 정하므로(관리자 대역, 로그인·잠금 해제 제한), 클러스터의 다른 Pod가 앱에 직접 붙어 이 헤더를 꾸미지 못하게 한다. k3s 내장 정책 컨트롤러(kube-router)가 적용한다(`--disable-network-policy`로 띄운 서버에서는 적용되지 않는다).

## 응답 헤더·자원 제한

- 모든 응답(`next.config.ts`): `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`(공유 링크 URL이 다른 사이트로 새지 않게), `Permissions-Policy`(카메라·마이크·위치·결제·USB 끔).
- **Content-Security-Policy**(`src/proxy.ts`, 정책은 `domain/security-headers.ts`): 요청마다 nonce를 새로 만들어 요청 헤더(Next.js가 자기 스크립트에 nonce를 붙인다)와 응답 헤더에 넣는다. `script-src 'self' 'nonce-…' 'strict-dynamic'`(개발 모드만 `'unsafe-eval'`), `style-src 'self' 'unsafe-inline'`(React `style` prop), `img-src 'self' blob: data:`(SVG·docx 미리보기), `media-src 'self' blob:`(브라우저에서 WebVTT로 바꾼 자막 `<track>`), `font-src`·`connect-src`·`worker-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`. SVG 미리보기나 Word HTML, 앞으로 생길 XSS가 페이지에 들어가도 스크립트를 실행하지 못한다.
  - `CSP_MODE=report-only`(기본)는 막지 않고 위반만 `/api/csp-report`로 받는다(같은 위반은 1시간에 한 번 `csp violation` 경고 로그, 쿼리 문자열과 방문자 정보는 남기지 않는다). report-only는 `frame-ancestors`를 무시하므로 액자 삽입은 `X-Frame-Options: DENY`가 막는다. 프록시가 강제 CSP 헤더를 하나 더 보내면 안 된다: Next.js는 프록시 응답 헤더를 렌더링할 요청에도 복사하고 `content-security-policy`를 먼저 읽기 때문에 nonce를 찾지 못한다. 로그에 위반이 없으면 `CSP_MODE=enforce`로 바꾼다([runbook.md "CSP 강제 적용"](runbook.md#csp-강제-적용)). 운영(`NODE_ENV=production`)에서 report-only면 `env:check`가 경고한다.
  - E2E는 `CSP_MODE=enforce`로 돌고, 테스트 페이지에서 CSP 위반이 하나라도 나면 실패한다(`e2e/fixtures.ts`).
  - 클라이언트가 보낸 CSP 요청 헤더는 지우고 프록시가 만든 것만 넘긴다(nonce 위조 방지).
- **Strict-Transport-Security**: `PUBLIC_URL`이 https이고 요청 Host가 그 호스트일 때만 `max-age=HSTS_MAX_AGE_SEC`(기본 1년)를 보낸다. LAN의 `http://192.168.0.100` 접속에는 보내지 않는다. `HSTS_INCLUDE_SUBDOMAINS=true`는 같은 도메인의 모든 서브도메인이 https일 때만 켠다. Cloudflare에서 HSTS를 켰다면 `HSTS_MAX_AGE_SEC=0`으로 한 곳에서만 보낸다.
- SVG 미리보기는 DOMPurify(svg·svgFilters 프로필)로 스크립트·이벤트 핸들러·외부 참조를 지운 뒤 blob `<img>`로 그린다. blob URL을 새 탭에서 열어도 앱 출처에서 스크립트가 돌지 않는다.
- 캐시: 파일 응답은 [architecture.md "미리보기 전송"](architecture.md#미리보기-전송), API 에러는 `no-store`. 다운로드는 한도·횟수 때문에 캐시하지 않는다.
- ffmpeg 입력(`server/media/ffmpeg-input.ts`): 업로드 파일은 `-protocol_whitelist file -format_whitelist <MEDIA.ffmpegDemuxers>`로만 연다. HLS 플레이리스트·concat 목록처럼 다른 파일을 가리키는 형식은 이름이나 내용과 상관없이 거부되므로, 조작한 업로드로 ffmpeg가 서버의 다른 파일을 읽어 변환 결과로 돌려줄 수 없다. Docker 이미지는 `node:24-trixie-slim`(ffmpeg 7.1)이다.
- 프로세스 격리: Compose의 app·worker·tools는 `cap_drop: ALL`, `read_only`(쓰기는 tmpfs `/tmp`, app은 `.next/cache`도), `pids_limit: 512`, `mem_limit`/`cpus`(`APP_MEMORY_MAX`·`APP_CPUS`, `WORKER_MEMORY_MAX`·`WORKER_CPUS`)로 돈다. nginx도 `cap_drop: ALL`. systemd 배포는 같은 값을 `MemoryMax`·`CPUQuota`·`TasksMax=512`로 건다. 폭주한 변환·썸네일 작업은 자기 서비스 상한에서 멈추고 PostgreSQL을 OOM으로 끌고 가지 않는다.
- 영상 변환(`?transcode=1`)은 모든 앱 프로세스를 합쳐 동시에 `VIDEO_TRANSCODE_MAX`개(0이면 끔)까지만 돌고(Redis 슬롯 `redis-semaphore.ts`, 프로세스가 죽으면 `TRANSCODE.slotLeaseMs` 뒤 풀린다. Redis가 안 되면 프로세스마다 같은 수로 제한), 넘으면 429와 `Retry-After`. 워커가 변환본을 저장할 때도 같은 슬롯을 쓴다. 슬롯을 잃은 변환(임대가 지난 사이 다른 프로세스가 모든 슬롯을 잡음)은 갱신이 이를 알아채 멈추므로 상한을 넘기지 않는다. 출력은 4GB에서 끊는다(저장본은 ffmpeg `-fs`). ffmpeg·smartctl은 셸 없이 실행하고 시간 초과 시 SIGTERM 후 SIGKILL, 출력은 메모리 상한까지만 받는다(`PROCESS`). 저장 변환의 시간 제한은 `TRANSCODE.storeTimeoutSec`(6시간)이고, 멈춘 ffmpeg가 슬롯을 영원히 쥐거나 워커 종료를 막지 못한다(종료 시 중단 신호로 멈춘다).
