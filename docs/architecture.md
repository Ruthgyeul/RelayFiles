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
route handler (src/app/api/**/route.ts): 인증(deviceOf/requireActive), zod 파싱
  → apiHandler로 감싼다: request id, 에러 마스킹(ApiError·ZodError → 표준 응답, 에러 응답은 no-store)
    → service (src/server/services): 업무 규칙, 권한, 트랜잭션
      → repository (src/server/repositories): Prisma 접근만
      → storage (src/server/storage): StorageDriver → /mnt/relayfilesDB
      → cache (src/server/cache): Redis, 파생 데이터만
```

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

지표(`systeminformation`), 위치(Cloudflare 헤더), 시각(`now` 인자)은 아직 인터페이스로 나누지 않았다.
