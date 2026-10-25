# 보안 모델

설계 근거는 [plan.md](plan.md) §13.4–13.6. 이 문서는 구현된 내용을 기준으로 갱신한다.

## 파일 스토리지 (M2 구현)

| 위협 | 구현 |
|---|---|
| 경로 조작 | 경로는 클라이언트에서 받지 않고 노드 이름으로 서버가 만든다. 각 이름은 `domain/names.ts`의 `nameError`(빈 값, `.`/`..`, `/`, NUL, 앞뒤 공백, 255바이트 초과 거부)를 통과해야 한다. 결과 경로가 `users/<accountId>` 아래인지 `path.resolve` 뒤 다시 확인한다(`storage/safe-path.ts`) |
| 계정 id 위조 | 계정 id는 12자 base32 형식(`domain/ids.ts`)만 허용한다 |
| 심볼릭 링크 | 계정 루트부터 대상까지 모든 구성요소를 `lstat`으로 확인해 링크가 있으면 거부한다. 파일은 `O_NOFOLLOW`로 연다 |
| 업로드 경로 | 완료된 업로드는 볼륨의 `system/tmp/uploads` 아래에서만 `rename`으로 옮긴다 |
| 권한 | 디렉터리 `0700`, 마커 파일 `0600`. 운영에서는 전용 계정(uid 10001)이 소유한다 |
| SSD 미마운트 | `.relayfiles-volume` 마커가 없으면 볼륨을 offline으로 판단하고 쓰지 않는다. 마커가 다른 볼륨이거나 레이아웃 버전이 다르면 사용하지 않는다 |
| DB·디스크 불일치 | `withStorageTransaction`이 DB 트랜잭션 실패 시 파일 변경을 역순으로 되돌린다. 되돌리기 실패는 `storage rollback step failed` 에러 로그로 남는다. `npm run storage:fsck`가 DB와 디스크를 대조해 디스크에만 있는 항목(휴지통으로 이동), DB에만 있는 파일(`missing` 표시), 크기가 다른 파일을 찾는다(기본은 보고만, `--fix`로 정리) |
| 볼륨 이동 | 이동 중인 계정(`migrating`)과 레이아웃 마이그레이션 중인 볼륨(`READONLY`)은 쓰기를 503 `STORAGE_BUSY`로 막는다. 복사본은 모든 파일의 SHA-256이 원본과 같을 때만 사용하고, 원본은 휴지통에 24시간 남긴다 |
| 분실·도난 | SSD 전체를 LUKS2로 암호화한다(앱은 파일을 따로 암호화하지 않으며, 디스크의 파일은 업로드한 원본과 같다) |

## 로그

- `server/logger.ts`의 `redact()`가 `token`, `password`, `secret`, `authorization`, `cookie`, `ip`, `x-forwarded-for`, `cf-connecting-ip` 키의 값을 `[redacted]`로 바꾼다.
- 운영 로그 레벨은 warn 이상, 파일은 `LOG_DIR`(기본 `/var/log/relayfiles`)에 쓴다.

## API

- 예상하지 못한 예외는 응답에 내용을 싣지 않는다(`apiHandler`). 요청 id로 로그를 찾는다.

## 인증 (M3 구현)

- **계정 토큰**(40자)은 평문으로 저장하지 않는다. `Account.tokenLookup` = HMAC-SHA256(`TOKEN_HMAC_KEY`)으로 로그인 시 계정을 찾고, `Account.tokenEnc` = AES-256-GCM(`TOKEN_ENC_KEY`, `[키 id 4B][IV 12B][tag 16B][암호문]`)으로 소유자가 프로필에서 다시 볼 수 있게 한다(`server/auth/token-crypto.ts`).
- **키 교체**: `*_PREVIOUS`를 설정하면 옛 키로 만든 값도 읽힌다. 다음 로그인 때 새 키로 다시 암호화·해시한다. `npm run keys:rotate`가 모든 계정을 새 키로 다시 저장하면 `*_PREVIOUS`를 지운다(절차: [runbook.md](runbook.md#비밀값-교체)).
- **기기 쿠키** `rf_s`: 이 기기에 로그인한 세션 id 목록(최대 10)과 활성 세션만 담고 HMAC으로 서명한다(`COOKIE_SECRET`, 교체 시 `COOKIE_SECRET_PREVIOUS`). `HttpOnly`, `SameSite=Lax`, `PUBLIC_URL`이 https면 `Secure`. 토큰은 쿠키에 넣지 않는다.
- **세션 폐기**: 요청마다 DB에서 `Session.revokedAt`과 계정 만료를 확인하므로 다른 기기에서 로그아웃하거나 만료되면 즉시 무효가 된다. 무효 세션은 쿠키에서 지운다.
- **세션 절대 수명**(`domain/session.ts`): 로그인(`Session.createdAt`)부터 관리자 `AUTH.adminSessionDays`(7일), 일반 `AUTH.memberSessionDays`(14일)가 지나면 세션이 끝난다. 계정이 만료되지 않는 관리자라도 기기 세션은 영구적이지 않다.
- **관리자 재인증**: 토큰 보기·재발급, 계정 관리(역할·삭제일·용량)·삭제, 가입 모드 변경은 관리자 세션이 최근 `AUTH.reauthWindowMin`(10분) 안에 토큰을 입력했을 때만 허용한다(`requireRecentAuth`, 아니면 403 `REAUTH_REQUIRED`). 입력은 `POST /api/auth/reauth`이고 로그인과 같은 잠금 단계를 쓴다. 일반 계정에는 묻지 않는다(토큰을 잃으면 로그인한 기기에서만 다시 볼 수 있기 때문).
- **감사 로그**(`AuditEvent`): 관리자 작업(위 작업 + 정리 실행, 초대 생성·취소)을 행위자 id·이름, 대상, 짧은 설명, 마스킹한 주소와 함께 남긴다. 초대 코드는 앞 4자만 적는다. `AUTH.auditRetentionDays`(365일)가 지나면 매일 정리 작업이 지운다. 조회: `GET /api/admin/audit`.
- **`env:check`**: 운영 모드에서 `ADMIN_ALLOWED_CIDRS`가 비어 있으면 경고한다.
- **로그인 잠금**: 클라이언트 주소(HMAC으로 가린 키, IPv6는 `/64` 단위 — `rateLimitSubject`)마다 Redis에 실패 횟수를 센다. 5회마다 30초 → 120초 → 600초 잠금(`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_SECONDS`). 잠긴 동안에는 올바른 토큰도 429로 거부한다.
- **익명 가입 제한**: 같은 주소에서 시간당 10개(`SIGNUPS_PER_HOUR`, 기본값은 `config/policy.ts`). 크롤러가 디스크에 계정 폴더를 채우는 것을 막는다. 가입 모드(Open/Invite only/Closed)는 `ServerConfig.signupMode`, 초대 코드는 한 번만 쓸 수 있다.
- **계정 생성의 원자성**: 계정 행, 루트 폴더 노드, 기기 세션, 볼륨의 `users/<accountId>/` 디렉터리를 `withStorageTransaction`으로 함께 만든다. 중간에 실패하면 DB는 롤백되고 디렉터리는 휴지통으로 옮긴다.
- **클라이언트 주소**: `CF-Connecting-IP` → `X-Real-IP` 순으로 읽는다. 앱 포트는 Nginx를 통해서만 접근 가능해야 한다(직접 노출하면 헤더 위조로 잠금을 우회할 수 있음). systemd 배포는 `APP_HOST`(기본 `127.0.0.1`, 비어 있어도 루프백)로 루프백에만 열고, Docker 배포의 app 컨테이너는 포트를 공개하지 않는다. 앞단 Nginx는 방문자가 보낸 `CF-Connecting-IP`를 비워서 넘긴다. 세션에는 마스킹한 주소(`a.b.•••.•••`)와 Cloudflare 국가·도시 헤더만 저장한다.
- **`src/proxy.ts`**: 모든 요청에 `x-request-id`를 붙이고, `ADMIN_ALLOWED_CIDRS`가 있으면 `/admin/*`·`/api/admin/*`를 그 대역에서만 허용한다(페이지는 `/error/403`, API는 403 JSON). 다른 사이트 Origin에서 온 API 쓰기 요청(POST 등)은 403으로 거부한다(CSRF 방어). 권한 검사는 각 핸들러에서 다시 한다.
- **첫 관리자**: 서버에서 `npm run admin:create`. 토큰은 터미널에 한 번만 출력된다.

## 업로드 (M7 구현)

- 업로드는 `POST /api/uploads`로 배치를 만든 뒤 tus로 보낸다. 배치(계정, 볼륨, 대상 폴더, 파일 목록, 중복 처리 방식)는 Redis에 `UPLOAD_TMP_TTL_HOURS` 동안 저장되고, tus 업로드는 시작할 때 크기를 밝혀야 하고(`Upload-Defer-Length` 불가) 배치에 적힌 크기와 같아야 시작된다. 그 크기로 용량·여유 공간을 검사하고, 완료 시 받은 바이트 수를 다시 대조한다.
- **진행 중인 업로드 예약**(`server/upload/reservations.ts`, `space.service.ts`): 확정된 파일만 보면 동시에 시작한 업로드가 각각 검사를 통과해 쿼터나 디스크를 넘는다. tus 업로드를 시작할 때 계정·볼륨·익명 계정 전체(`ANON_TOTAL_QUOTA_GB`) 범위마다 남은 공간과 진행 중 예약 합계를 Lua 스크립트 하나로 확인하고 예약한다. 완료(파일이 사용량에 들어감)·거부·취소(tus DELETE) 때 풀고, 남은 예약은 `UPLOAD_TMP_TTL_HOURS` 뒤 저절로 소멸한다(그때 조각도 정리된다). 배치 준비(`POST /api/uploads`)도 예약을 포함해 검사한다.
- tus 업로드 id마다 소유 계정을 Redis에 기록하고, 이어 올리기·조회·취소 요청은 같은 기기에 그 계정이 로그인해 있을 때만 허용한다(다른 계정은 404).
- 조각은 볼륨의 `system/tmp/uploads/`에 쌓이고, 완료되면 같은 파일시스템 안에서 `rename`으로 사용자 폴더에 들어간다(복사 없음). 파일 종류는 내용(매직 바이트)으로 판정하고, SHA-256을 기록한다.
- tus 경로(`/api/uploads/tus/*`)는 `proxy.ts` matcher에서 제외한다. 프록시는 요청 본문을 메모리에 복사(기본 10MB 제한)하기 때문이다. 이 경로는 쿠키(SameSite=Lax)와 배치 소유권으로 보호된다. 배치를 만드는 `POST /api/uploads`는 프록시의 Origin 검사를 거친다.

## 공유 링크·다운로드 (M8–M9 구현)

- 다운로드는 `nosniff`, 미디어 재생 외에는 `attachment`. HTML·SVG는 `application/octet-stream`으로 보낸다.
- 링크 비밀번호는 argon2 해시로 저장한다. 맞히면 서명한 `rf_sh` 쿠키(v2)로 12시간(`SHARE.unlockHours`) 열린다. 쿠키 항목은 `[linkId, until, pwTag]`이고 `pwTag`는 `HMAC(COOKIE_SECRET, passwordHash)` 앞 8바이트다. 비밀번호를 바꾸면 기존 기기는 다시 입력해야 한다(v1 쿠키는 무시). 틀린 비밀번호는 링크·주소마다 600초에 10회(`countInWindow`, INCR+EXPIRE 원자 실행)를 넘으면 429.
- 혼잡도: 10분에 다운로드 5회부터 속도를 제한하고, 10회부터 멈춘다(429 + `Retry-After`).
- 다운로드 횟수(`domain/share-access.ts` `downloadDecision`): Range 헤더 문자열이 아니라 **파싱한 범위**로 판단한다. 첫 바이트를 보내는 요청(Range 없음, `bytes=0-…`, 파일 전체를 덮는 `bytes=-N`)은 시작으로 세고, 그 방문자(ipKey)에게 `dl:grant:<파일>:<ipKey>`를 `SHARE.downloadGrantHours` 동안 준다. 0이 아닌 위치에서 시작하는 Range(이어받기)는 grant가 있을 때만 보낸다(없으면 403, 다시 시작하면 한 번 더 센다).
- 카운트는 원자적이다(`share.repo.ts` `claimDownload`): 파일과 링크 루트를 한 트랜잭션에서 `downloads < downloadLimit`(루트는 burn이면 `downloads = 0`) 조건으로 올리고, 하나라도 실패하면 되돌린다. 한도 N-1에서 동시에 들어온 요청은 하나만 통과한다.
- "Download all"(zip)은 파일마다 단일 다운로드와 같은 규칙(`downloadBlock`: Stream only, 한도 도달, 일시정지·혼잡도 2단계)으로 거르고, 뺀 파일은 사유와 함께 `Not included.txt`에 적는다. 넣은 파일은 각각 한 번씩 센다(`claimEachDownload`, 그 사이 한도에 닿은 파일은 뺀다).
- 공유 재생 경로(`/stream`, `streamReach`)는 뷰어가 읽는 만큼만 보낸다: 미디어와 PDF는 범위 제한 없음, 텍스트·코드·표는 앞 `DOCUMENT_PREVIEW.textMaxBytes`, SVG·폰트·Word·Excel은 앞 `assetMaxBytes`까지(넘으면 403), 미리보기가 없는 형식(압축, 실행 파일, 디스크 이미지 등)은 404. 소유자 본인에게는 적용하지 않는다.
- **Stream only는 DRM이 아니다.** 재생할 수 있는 영상·음악·이미지·PDF는 브라우저가 받은 바이트를 저장하거나 화면을 녹화할 수 있다. 다운로드 버튼과 zip, 미리보기가 없는 형식, 문서 전체 받기를 막을 뿐이다.
- 공개 링크 이미지는 메타데이터 제거본만 보낸다(제거할 수 없는 형식은 415). 뷰어 미리보기도 메타데이터 없이 다시 인코딩한 WebP다.

## 리버스 프록시·헤더

- API 쓰기 요청의 CSRF 검사(`proxy.ts`): `Sec-Fetch-Site: cross-site`이면 거부하고, Origin은 `PUBLIC_URL`의 origin 또는 브라우저가 보낸 `Host`와 같아야 한다. 클라이언트가 보낼 수 있는 `X-Forwarded-Host`는 보지 않는다.
- Nginx는 `X-Forwarded-Host`를 `$host`로 덮어쓴다. Docker 템플릿의 `X-Forwarded-Proto`는 신뢰 피어(cloudflared, `TRUSTED_PROXY_IP`)가 보낸 `http`/`https`만 넘기고, 그 밖에는 이 홉의 scheme을 쓴다.
- X-Accel location은 `disable_symlinks on from=<볼륨 루트>`다. 앱이 `lstat`으로 확인한 뒤 Nginx가 파일을 다시 열기 때문에, 그 사이에 생긴 심볼릭 링크를 거부한다.
- Nginx `limit_req`(앱의 Redis 제한 앞단): `POST /api/auth/*`·`POST /api/share/*/unlock` 분당 20회(버스트 20), `POST /api/uploads` 분당 60회(버스트 30), 클라이언트 주소마다. 넘으면 API 형식 JSON 429와 `Retry-After: 60`.

## 응답 헤더·자원 제한

- 모든 응답(`next.config.ts`): `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`(공유 링크 URL이 다른 사이트로 새지 않게), `Permissions-Policy`(카메라·마이크·위치·결제·USB 끔).
- 캐시: 재생·썸네일·미리보기·변환 영상은 `private, max-age=1년, immutable`, 다운로드는 `private, no-cache`, zip과 API 에러는 `no-store`.
- ffmpeg 입력(`server/media/ffmpeg-input.ts`): 업로드 파일은 `-protocol_whitelist file -format_whitelist <MEDIA.ffmpegDemuxers>`로만 연다. HLS 플레이리스트·concat 목록처럼 다른 파일을 가리키는 형식은 이름이나 내용과 상관없이 거부되므로, 조작한 업로드로 ffmpeg가 서버의 다른 파일을 읽어 변환 결과로 돌려줄 수 없다. Docker 이미지는 `node:24-trixie-slim`(ffmpeg 7.1)이다.
- 프로세스 격리: Compose의 app·worker는 `cap_drop: ALL`, `read_only`(쓰기는 tmpfs `/tmp`, app은 `.next/cache`도), `pids_limit: 512`, `mem_limit`/`cpus`(`APP_MEMORY_MAX`·`APP_CPUS`, `WORKER_MEMORY_MAX`·`WORKER_CPUS`)로 돈다. nginx도 `cap_drop: ALL`. systemd 배포는 같은 값을 `MemoryMax`·`CPUQuota`·`TasksMax=512`로 건다. 폭주한 변환·썸네일 작업은 자기 서비스 상한에서 멈추고 PostgreSQL을 OOM으로 끌고 가지 않는다.
- 영상 변환(`?transcode=1`)은 동시에 `VIDEO_TRANSCODE_MAX`개(0이면 끔)까지만 돌고, 넘으면 429와 `Retry-After`. 출력은 4GB에서 끊는다. ffmpeg·smartctl은 셸 없이 실행하고 시간 초과 시 SIGTERM 후 SIGKILL, 출력은 메모리 상한까지만 받는다(`PROCESS`).
