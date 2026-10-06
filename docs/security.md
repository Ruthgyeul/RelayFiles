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
| DB·디스크 불일치 | `withStorageTransaction`이 DB 트랜잭션 실패 시 파일 변경을 역순으로 되돌린다. 되돌리기 실패는 로그에 남기고 reconcile 작업이 정리한다 |
| 분실·도난 | SSD 전체를 LUKS2로 암호화한다(앱은 파일을 따로 암호화하지 않으며, 디스크의 파일은 업로드한 원본과 같다) |

## 로그

- `server/logger.ts`의 `redact()`가 `token`, `password`, `secret`, `authorization`, `cookie`, `ip`, `x-forwarded-for`, `cf-connecting-ip` 키의 값을 `[redacted]`로 바꾼다.
- 운영 로그 레벨은 warn 이상, 파일은 `LOG_DIR`(기본 `/var/log/relayfiles`)에 쓴다.

## API

- 예상하지 못한 예외는 응답에 내용을 싣지 않는다(`apiHandler`). 요청 id로 로그를 찾는다.

## 인증 (M3 구현)

- **계정 토큰**(40자)은 평문으로 저장하지 않는다. `Account.tokenLookup` = HMAC-SHA256(`TOKEN_HMAC_KEY`)으로 로그인 시 계정을 찾고, `Account.tokenEnc` = AES-256-GCM(`TOKEN_ENC_KEY`, `[키 id 4B][IV 12B][tag 16B][암호문]`)으로 소유자가 프로필에서 다시 볼 수 있게 한다(`server/auth/token-crypto.ts`).
- **키 교체**: `*_PREVIOUS`를 설정하면 옛 키로 만든 값도 읽힌다. 다음 로그인 때 새 키로 다시 암호화·해시한다. 모든 계정이 로그인하거나 회전 스크립트(M16)가 끝나면 `*_PREVIOUS`를 지운다.
- **기기 쿠키** `rf_s`: 이 기기에 로그인한 세션 id 목록(최대 10)과 활성 세션만 담고 HMAC으로 서명한다(`COOKIE_SECRET`, 교체 시 `COOKIE_SECRET_PREVIOUS`). `HttpOnly`, `SameSite=Lax`, `PUBLIC_URL`이 https면 `Secure`. 토큰은 쿠키에 넣지 않는다.
- **세션 폐기**: 요청마다 DB에서 `Session.revokedAt`과 계정 만료를 확인하므로 다른 기기에서 로그아웃하거나 만료되면 즉시 무효가 된다. 무효 세션은 쿠키에서 지운다.
- **로그인 잠금**: 클라이언트 주소(HMAC으로 가린 키)마다 Redis에 실패 횟수를 센다. 5회마다 30초 → 120초 → 600초 잠금(`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_SECONDS`). 잠긴 동안에는 올바른 토큰도 429로 거부한다.
- **익명 가입 제한**: 같은 주소에서 시간당 10개(`config/policy.ts` `AUTH.signupsPerHour`). 크롤러가 디스크에 계정 폴더를 채우는 것을 막는다. 가입 모드(Open/Invite only/Closed)는 `ServerConfig.signupMode`, 초대 코드는 한 번만 쓸 수 있다.
- **계정 생성의 원자성**: 계정 행, 루트 폴더 노드, 기기 세션, 볼륨의 `users/<accountId>/` 디렉터리를 `withStorageTransaction`으로 함께 만든다. 중간에 실패하면 DB는 롤백되고 디렉터리는 휴지통으로 옮긴다.
- **클라이언트 주소**: `CF-Connecting-IP` → `X-Real-IP` 순으로 읽는다. 앱 포트는 Nginx를 통해서만 접근 가능해야 한다(직접 노출하면 헤더 위조로 잠금을 우회할 수 있음). 세션에는 마스킹한 주소(`a.b.•••.•••`)와 Cloudflare 국가·도시 헤더만 저장한다.
- **`src/proxy.ts`**: 모든 요청에 `x-request-id`를 붙이고, `ADMIN_ALLOWED_CIDRS`가 있으면 `/admin/*`·`/api/admin/*`를 그 대역에서만 허용한다(페이지는 `/error/403`, API는 403 JSON). 다른 사이트 Origin에서 온 API 쓰기 요청(POST 등)은 403으로 거부한다(CSRF 방어). 권한 검사는 각 핸들러에서 다시 한다.
- **첫 관리자**: 서버에서 `npm run admin:create`. 토큰은 터미널에 한 번만 출력된다.

## 다음 단계

- M8–M9: 다운로드 응답 헤더(`nosniff`, attachment), 공유 링크 비밀번호(argon2), 혼잡도 제한
