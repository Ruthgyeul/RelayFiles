# 아키텍처

전체 설계 근거는 [`plan.md`](plan.md) §4를 본다. 이 문서는 코드를 쓸 때 지켜야 하는 구조 규칙만 정리한다.

## 레이어

```
src/app ──────────► features ─► shared ─┐
   │                    │          │    ├─► domain ─► config
   │                    └──────────┴────┤
   └──► server ─────────────────────────┤
                                         └─► contracts ─► domain, config
```

| 레이어 | 경로 | 역할 | import 가능 |
|---|---|---|---|
| app | `src/app` | 라우팅, 레이아웃, route handler(얇게) | 모든 레이어 |
| feature | `src/features/<name>` | 기능 단위 UI, 훅, 클라이언트 API, UI 상태 | feature, shared, domain, contracts, config |
| shared | `src/shared` | 공용 UI 프리미티브, 훅, 유틸, 스타일 | shared, domain, contracts, config |
| server | `src/server` | DB, Redis, 스토리지, 인증, 서비스, 리포지토리 (`server-only`) | server, domain, contracts, config |
| contracts | `src/contracts` | API 요청/응답 zod 스키마, 에러 코드 | contracts, domain, config |
| domain | `src/domain` | 순수 업무 규칙(이름 검증, 가시성, 혼잡도, 포맷) | domain, config |
| config | `src/config` | env 검증, 정책 상수, 테마 목록 | config |

- 위 표는 `eslint.config.mjs`의 `boundaries/dependencies` 정책과 같다. 위반하면 `npm run lint`가 실패한다.
- npm 패키지와 Node 내장 모듈은 레이어 규칙 대상이 아니다. 대신 `src/server` 밖에서 서버 전용 패키지(Prisma, ioredis, fs)를 쓰지 않는다.

## 서버 요청 흐름

```
route handler (src/app/api/**/route.ts)
  → apiHandler: request id, 인증, zod 파싱, 에러 마스킹
    → service (src/server/services): 업무 규칙, 권한, 트랜잭션
      → repository (src/server/repositories): Prisma 접근만
      → storage (src/server/storage): StorageDriver → /mnt/relayfilesDB
      → cache (src/server/cache): Redis, 파생 데이터만
```

## 백그라운드 워커

웹 앱과 별도 프로세스(`npm run worker`)가 BullMQ 큐를 처리한다. 큐 키는 `REDIS_KEY_PREFIX + "q"` 아래에 있다.

| 큐 | 작업 | 넣는 곳 |
|---|---|---|
| `media` | 썸네일(이미지: sharp, 영상: ffmpeg 1초 프레임 → WebP 576px), 공개 링크용 메타데이터 제거본(JPEG·PNG·WebP는 픽셀을 다시 인코딩하지 않고 메타데이터 구간만 제거, 방향 정보는 유지. GIF·AVIF·TIFF는 같은 형식으로 다시 쓰기) | 업로드 완료, 복사 |

- 생성 파일은 `system/thumbs/<accountId>/<nodeId>`, `system/derived/<accountId>/<nodeId>`에 두고, 원본은 건드리지 않는다. 항목을 지우면 함께 지운다.
- 웹 앱은 큐에 넣기만 하고 실패해도 요청을 막지 않는다(Redis 장애 시 썸네일만 늦어짐). 빠진 썸네일은 `npm run media:backfill`로 다시 큐에 넣는다.
- 디코딩할 수 없는 파일은 경고 로그만 남기고 다시 시도하지 않는다.

## 교체 가능한 인터페이스

| 인터페이스 | 현재 구현 | 확장 |
|---|---|---|
| `StorageDriver` | `LocalVolumeDriver` (외장 SSD) | `S3Driver` (MinIO/R2), 다중 볼륨 |
| `MetricsSource` | `systeminformation` | 원격 노드 수집 |
| `GeoLookup` | Cloudflare 헤더 | GeoIP DB |
| `Clock` | 시스템 시계 | 테스트용 고정 시계 |
