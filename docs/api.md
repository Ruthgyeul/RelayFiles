# API

모든 API는 `src/app/api/**/route.ts`에 있고, `apiHandler()`(`src/server/http/api-handler.ts`)를 거친다.

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

## 에러 코드 (`src/contracts/errors.ts`)

| code | HTTP | 클라이언트 처리 |
|---|---|---|
| `BAD_REQUEST` | 400 | 필드 오류 표시 또는 `/error/400` |
| `UNAUTHORIZED` | 401 | 로그인 모달 / `unauthorized.tsx` |
| `FORBIDDEN` | 403 | `forbidden.tsx` |
| `NOT_FOUND` | 404 | 다른 계정 리소스도 404(존재 여부 비공개) |
| `CONFLICT` | 409 | 이름 중복 등, 대화상자에 메시지 표시 |
| `GONE` | 410 | `/error/410`(삭제된 계정·링크) |
| `PAYLOAD_TOO_LARGE` | 413 | 토스트 |
| `RATE_LIMITED` | 429 | `/error/429?retry=<초>&from=<경로>` 또는 모달 카운트다운 |
| `INTERNAL` | 500 | `error.tsx` |
| `MAINTENANCE` | 503 | `/error/503` |
| `STORAGE_OFFLINE` | 503 | `/error/storage-offline` |
| `INSUFFICIENT_STORAGE` | 507 | 토스트 + 용량 배너 |

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `HEAD` | `/api/health` | 생존 확인(204, 백엔드 작업 없음). Status 페이지가 2.5초마다 지연 시간을 잰다 |
| `GET` | `/api/health` | 준비 상태: `{ status, version, time, components: { database, redis, storage } }`. DB가 죽으면 503 |

이후 마일스톤에서 추가되는 엔드포인트는 [plan.md](plan.md) §13.3을 따른다.
