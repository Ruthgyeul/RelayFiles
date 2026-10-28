# 아키텍처

코드를 쓸 때 지켜야 하는 구조 규칙을 정리한다. 보안 모델은 [security.md](security.md), API 계약은 [api.md](api.md), 디자인 수치는 [design/spec.md](design/spec.md), 운영 절차는 [runbook.md](runbook.md)를 본다.

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
- 기능 사이 import는 순환하지 않는다. `scripts/check-feature-cycles.mjs`(`npm run check:cycles`)가 기능 단위로, `import/no-cycle`이 파일 단위로 검사한다. 여러 기능이 쓰는 노드 종류 아이콘(`shared/ui/node-kind.ts`), 경로(`shared/lib/routes.ts`), 파일 API(`shared/lib/files-api.ts`)는 `src/shared`에 있고, 셸·전송 패널 조립은 `src/app/(app)/layout.tsx`가 한다.
- npm 패키지와 Node 내장 모듈은 레이어 규칙 대상이 아니다. 대신 `src/server` 밖에서 서버 전용 패키지(Prisma, ioredis, fs)를 쓰지 않는다.

## 서버 요청 흐름

```
route handler (src/app/api/**/route.ts): 인증(apiHandler({ auth: "active" | "admin" }) → active), zod 파싱
  → apiHandler로 감싼다: request id, 에러 마스킹(ApiError·ZodError → 표준 응답, 에러 응답은 no-store)
    → service (src/server/services): 업무 규칙, 권한, 트랜잭션
      → repository (src/server/repositories): Prisma 접근만
      → storage (src/server/storage): StorageDriver → /mnt/relayfilesDB
      → cache (src/server/cache): Redis, 파생 데이터만
```

- 공유 링크(`/d/<linkId>`)의 규칙과 응답은 `src/server/share/`에 모여 있다(`share.service.ts` 링크 해석·잠금, `share-files.service.ts` 파일·zip 응답, 쿠키·다운로드 허가·이벤트). 파일 바이트를 보내는 HTTP 도구(`send-file.ts`, `send-thumb.ts`, `throttle.ts`)는 `src/server/http/`에 있다.

- 쿼리는 repository에만 쓴다. 서비스·잡·스크립트에서 `db()`는 repository 함수에 넘기거나 트랜잭션(`$transaction`)을 열 때만 쓴다(`no-restricted-syntax`). `src/app`은 `@/server/db`·`@/server/repositories`를 import하지 않고 서비스를 부른다(`no-restricted-imports`).
- 예외: tus 업로드 라우트(`src/app/api/uploads/tus`)는 `apiHandler`를 거치지 않는다. tus가 자체 평문 프로토콜로 응답하기 때문이며, 같은 방식으로 try-catch와 에러 마스킹을 직접 한다. 볼륨 조회는 `upload.service.tusVolume()`이 한다.

## 백그라운드 워커

웹 앱과 별도 프로세스(`npm run worker`)가 BullMQ 큐를 처리한다. 큐 키는 `REDIS_KEY_PREFIX + "q"` 아래에 있다.

| 큐 | 작업 | 넣는 곳 |
|---|---|---|
| `maintenance` | 매일 `CLEANUP_CRON`(`JOBS_TIMEZONE`): 삭제일이 지난 계정과 만료 항목 삭제, 볼륨 휴지통에서 24시간 지난 항목과 `UPLOAD_TMP_TTL_HOURS`가 지난 미완료 업로드 영구 삭제(`ACTIVE`·`DRAINING` 볼륨). 그 밖에 `METRICS_SAMPLE_INTERVAL_SEC`마다 대역폭 표본(워커 heartbeat 겸), `HEALTH_PROBE_INTERVAL_SEC`마다 Status 페이지 프로브 | 워커 시작 시 스케줄 등록, 관리자 "Run cleanup now"는 계정·항목 정리만 즉시 실행 |
| `media` | 썸네일(이미지: sharp, 영상: ffmpeg 1초 프레임 → WebP 576px), 공개 링크용 메타데이터 제거본(JPEG·PNG·WebP는 픽셀을 다시 인코딩하지 않고 메타데이터 구간만 제거, 방향 정보는 유지. GIF·AVIF·TIFF는 같은 형식으로 다시 쓰기), 뷰어 미리보기(512KB 이상 JPEG·PNG·WebP·AVIF·TIFF → 2560px WebP q92, 원본보다 작을 때만 저장) | 업로드 완료, 복사 |

- 생성 파일은 `system/thumbs/`, `system/derived/`, `system/previews/` 아래 `<accountId>/<nodeId>`에 두고(`ASSET_DIRS`), 원본은 건드리지 않는다. 항목을 지우거나 계정을 다른 볼륨으로 옮기면 함께 지우거나 옮긴다.
- ffmpeg·smartctl은 `runCommand`(`src/server/process/run-command.ts`)로 실행한다. 셸 없이, 시간 초과 시 SIGTERM 후 SIGKILL, 출력은 메모리 상한까지, 끝나면 항상 회수한다.
- 웹 앱은 큐에 넣기만 하고 실패해도 요청을 막지 않는다(Redis 장애 시 썸네일만 늦어짐). 빠진 썸네일은 `npm run media:backfill`로 다시 큐에 넣는다. 미리보기가 생기기 전에 올린 이미지는 `npm run media:backfill -- --previews`로 한 번 다시 처리한다.

### 미리보기 전송

뷰어는 원본을 보려고 내려받지 않는다.

- 이미지: 목록에서 이미 받은 썸네일을 흐리게 바로 보여 주고, 워커가 만든 미리보기(`/api/files/<id>/preview`, 공유 링크도 같은 경로)가 오면 바꾼다. 미리보기가 없으면(작은 파일, GIF, 처리 전) 같은 URL이 원본을 보낸다. 앞뒤 이미지는 미리 받아 둔다(공유 링크에서는 `x-relayfiles-prefetch` 헤더로 조회 수에서 뺀다).
- 캐시: 파일의 바이트는 URL(node id)이 같으면 바뀌지 않는다(교체하면 새 id). 그래서 재생(`stream`), 썸네일, 미리보기, 변환 영상은 `private, max-age=1년, immutable`이다. 이미 본 구간으로 되감거나, 다른 영상을 보다가 돌아와도 브라우저 디스크 캐시에서 바로 읽고 서버에는 요청이 가지 않는다. 다운로드(`download`, zip)는 다운로드 제한·횟수 때문에 캐시하지 않고, 에러 응답은 `no-store`다. Nginx의 X-Accel 위치에는 `Cache-Control`을 붙이지 않는다(앱 값이 그대로 전달된다. 둘이 되면 `no-cache`가 이겨 캐시가 꺼진다). 공유 링크 미리보기는 앞뒤 이미지 미리 받기만 조회에서 빠지고, 캐시에서 다시 보는 것은 조회로 다시 세지 않는다.
- 영상: 썸네일을 포스터로 바로 보여 주고 원본을 Range 요청으로 재생한다(Docker 배포는 Nginx X-Accel, systemd 배포는 앱이 직접 전송). 브라우저가 못 여는 컨테이너(AVI, WMV, MPEG-TS 등, `videoNeedsTranscode`)와 재생 오류가 난 MKV·MOV는 `?transcode=1`로 바꾼다. 앱이 ffmpeg로 720p H.264/AAC fragmented MP4를 만들면서 바로 흘려보낸다. 동시에 `VIDEO_TRANSCODE_MAX`개까지, 시청자가 떠나면 즉시 종료(SIGKILL)하고 출력은 4GB로 제한한다. 변환본은 저장하지 않는다.
- 디코딩할 수 없는 파일은 경고 로그만 남기고 다시 시도하지 않는다.
- 문서(미디어가 아닌 파일): 형식은 이름으로 정한다(`src/domain/file-format.ts`, 목록 아이콘도 여기서 나온다). 뷰어는 같은 `stream` URL을 `fetch`로 읽어 브라우저 안에서 그린다. 서버는 이 파일들을 여전히 `attachment`·`nosniff`로만 보내므로(HTML·SVG가 앱 출처에서 실행되지 않음) 서버 쪽 변경이 없다.
  - 텍스트·코드·Markdown·CSV/TSV: Range 요청 하나로 앞 1MB만 받는다(`DOCUMENT_PREVIEW.textMaxBytes`). NUL 바이트가 있으면 바이너리로 보고 "No preview"를 보여 준다. UTF-8이 아니면 UTF-16(BOM), EUC-KR 순으로 해석한다. 코드는 highlight.js(필요한 언어만 지연 로드, Solidity는 `solidity.ts`), Markdown은 react-markdown + GFM으로 그리며 원시 HTML은 글자로 보이고 외부 이미지는 불러오지 않는다. 확장자가 없거나 모르는 파일은 앞 8KB를 먼저 보고 텍스트일 때만 이어 받는다.
  - PDF: pdf.js legacy 빌드(구형 브라우저용 폴리필 포함)를 Web Worker에서 돌리고, 화면 근처 페이지만 canvas에 그렸다가 멀어지면 비운다. Range 요청으로 필요한 부분만 받는다.
  - SVG는 blob URL의 `<img>`(스크립트·네트워크 없음), 글꼴(TTF/OTF/WOFF/WOFF2)은 `FontFace`로 불러 예문을 보여 준다.
  - Word(.docx)는 mammoth로 HTML(제목, 목록, 표, 링크, 내장 그림)로 바꾸고 DOMPurify로 정제해 넣는다. 페이지 레이아웃(글꼴, 단, 머리글·바닥글)은 없다. Excel(.xlsx, .xlsm)은 read-excel-file로 시트마다 표를 만들고 시트 탭으로 바꾼다. 수식은 저장된 결과값을 보여 준다.
  - SVG·글꼴·docx·xlsx는 파일 전체가 필요해서 20MB(`DOCUMENT_PREVIEW.assetMaxBytes`)까지만 미리 본다. 표는 1,000행·100열까지.
  - 압축 파일, 옛 Office 형식(.doc, .xls, .ppt)과 .pptx, .hwp, 디스크 이미지, 패키지 등은 형식 아이콘과 "No preview"만 보인다.
  - 공유 링크에서 문서를 여는 것은 `VIEW`로 기록된다(영상·오디오만 `PLAY`).

## 교체 가능한 인터페이스

| 인터페이스 | 현재 구현 | 확장 |
|---|---|---|
| `StorageDriver` | `LocalVolumeDriver` (외장 SSD, 볼륨 여러 개) | `S3Driver` (MinIO/R2) |

지표(`systeminformation`), 위치(Cloudflare 헤더)는 인터페이스 없이 직접 쓴다. 시각은 함수의 `now` 인자로 받아 테스트에서 고정한다.

## 데이터 저장소

| 저장소 | 담는 것 | 원천 여부 |
|---|---|---|
| PostgreSQL 16 | 계정, 세션, 노드 인덱스(트리, 설정, 태그, 링크), 이벤트 로그, 집계, 서버 설정 | 원천 |
| 스토리지 볼륨 (외장 SSD) | 사용자 원본 파일, 썸네일·제거본·미리보기, 업로드 임시 조각, 휴지통 | 원천 (파일 바이트) |
| Redis 7 | 로그인·가입·비밀번호 시도 카운터, 다운로드 혼잡도·이어받기 허가, 업로드 배치·소유자·예약, 캐시, BullMQ 큐 | 짧게 사는 상태 (TTL) |

- Redis에는 잃어도 원천 데이터가 손상되지 않는 값만 둔다. 다만 비우면 영향이 있다: 캐시·카운터는 다시 만들어지지만, 진행 중인 업로드(배치·tus 소유자)는 처음부터 다시 올려야 하고, 공유 링크 다운로드의 이어받기 허가가 사라져 다시 시작하면 한 번 더 센다. 그래서 운영 중에는 비우지 않고 백업도 하지 않는다(AOF로 재시작에는 살아남는다).
- 캐시는 `server/cache/`의 `cached(key, ttl, loader)`로만 읽고, TTL과 변경 시 무효화를 함께 쓴다.
- 데이터 모델은 `prisma/schema.prisma`가 기준이다.

## 스토리지

볼륨 하나 = 마운트된 디스크 하나. 디렉터리 구조는 `server/storage/layout.ts`가 기준이다.

```
<볼륨 루트>/
├─ .relayfiles-volume          볼륨 표시 파일 {volumeId, layoutVersion}
├─ users/<accountId>/…         계정의 루트 폴더. 앱의 폴더 트리와 1:1, 원본 바이트 그대로
└─ system/                     사용자 영역과 분리 (tmp/uploads, thumbs, derived, previews, trash)
```

- 디렉터리 이름은 바뀌지 않는 accountId다. 물리 경로는 볼륨 루트 + `users/<accountId>` + 조상 노드 이름으로 서버가 계산한다. 경로 문자열을 클라이언트에서 받지 않는다.
- PostgreSQL은 인덱스, 디스크는 파일의 원천이다. 이름 변경·이동은 같은 파일시스템 안의 `rename` 한 번이다. DB와 디스크를 함께 바꾸는 작업은 `withStorageTransaction`으로 감싸고, DB가 실패하면 파일 작업을 역순으로 되돌린다.
- 볼륨 표시 파일이 없거나 `layoutVersion`이 코드와 다르면 그 볼륨에 쓰지 않는다(빈 마운트 지점에 쓰는 사고 방지). 워커가 `VOLUME_WATCH_INTERVAL_SEC`마다 확인해 `ACTIVE` ↔ `OFFLINE`을 바꾼다.
- 계정은 볼륨 하나에 속하고, 새 계정은 여유 공간이 가장 큰 `ACTIVE` 볼륨에 배정된다. `StorageVolume.mountPath`에 마운트 경로를 저장하므로 경로를 바꾸면 `volume:init`으로 갱신한다.
- 원본 파일은 수정하지 않는다. 공개 링크용 메타데이터 제거본과 미리보기는 `system/` 아래 별도 파일이다.

## 설정과 환경 변수

- 정책 값(기간, 임계값, 크기)은 `src/config/policy.ts`에 이름을 붙여 둔다. 배포마다 다른 값(포트, 호스트, 경로, 도메인, 비밀값)은 env로 빼고, env는 `policy.ts`의 기본값을 덮어쓰기만 한다.
- 앱은 `src/config/env.ts`의 그룹별 getter(`getAppEnv()`, `getEnv("database")` 등)로만 env를 읽는다. 그룹(`app`, `database`, `redis`, `storage`, `uploads`, `secrets`, `policy`, `jobs`, `observability`, `deploy`, `testing`)은 처음 쓰일 때 검증되므로, 빌드는 DB 비밀번호 없이 통과하고 실행 시 빠진 키는 목록으로 바로 실패한다.
- 커밋되는 env 파일은 `.env.example` 하나다. 스키마의 키 집합과 `.env.example`의 키 집합이 같은지 `env.test.ts`가 검사하므로, 새 설정은 두 곳을 같은 PR에서 바꾼다.
- compose는 `${VAR}`, Nginx 설정은 템플릿(Docker: nginx 이미지의 envsubst, systemd: `scripts/render-template.mjs`)으로 같은 `.env` 값을 쓴다. 코드·compose·Nginx 설정에 값을 하드코딩하지 않는다.
- `DATABASE_URL`, `REDIS_URL`은 개별 키를 `${VAR}`로 조합한다(Next `@next/env`, Docker Compose, Prisma 설정이 같은 `.env`를 읽는다).

## 버전 관리 (호환성 규칙)

운영 중에 바뀌는 형식은 버전을 붙이고, 다시 실행해도 안전하게, 중단 후 이어서 할 수 있게 바꾼다.

| 대상 | 규칙 | 절차 |
|---|---|---|
| DB 스키마 | expand → migrate → contract. 파괴적 SQL에는 `-- relayfiles: contract <이유>` | [runbook.md "DB 스키마"](runbook.md#db-스키마-prisma) |
| 데이터 값 | `src/server/migrations/`의 `DATA_MIGRATIONS`, 배치마다 커서 저장 | [runbook.md "데이터 마이그레이션"](runbook.md#데이터-마이그레이션-백필-값-변환) |
| 디스크 레이아웃 | 볼륨 표시 파일의 `layoutVersion`, `LAYOUT_MIGRATIONS` | [runbook.md "스토리지 레이아웃"](runbook.md#스토리지-레이아웃-storagemigrate) |
| 비밀 키 | 암호문 앞의 키 id, `*_PREVIOUS`로 교체 기간 동안 함께 읽기 | [runbook.md "비밀값 교체"](runbook.md#비밀값-교체) |
| Redis 키 | `REDIS_KEY_PREFIX`(`rf:v1:`). 형식이 바뀌면 접두사 버전을 올려 옛 키를 자연 만료시킨다 | — |
| API 계약 | `src/contracts/`는 하위 호환으로만 바꾼다(필드 추가는 가능, 삭제·의미 변경은 새 필드로). 배포 중 남아 있는 옛 클라이언트도 동작해야 한다 | — |
| 브라우저 저장값 | localStorage는 `{ v, data }`로 저장하고 버전이나 형식이 다르면 버린다(`shared/lib/local-setting.ts`) | — |
| 공유 링크 | `/d/<linkId>` 형식과 `linkId`, 계정 토큰은 어떤 변경에서도 바뀌지 않는다 | — |
