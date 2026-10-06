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

## 다음 단계

- M3: 토큰 저장(HMAC 조회 + AES-256-GCM 암호화), 로그인 잠금, 세션 쿠키 서명, `proxy.ts` 접근 제어
- M8–M9: 다운로드 응답 헤더(`nosniff`, attachment), 공유 링크 비밀번호(argon2), 혼잡도 제한
