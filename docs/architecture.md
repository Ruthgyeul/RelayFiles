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
| `maintenance` | 매일 `CLEANUP_CRON`(`JOBS_TIMEZONE`): 삭제일이 지난 계정과 만료 항목 삭제, 볼륨 휴지통에서 24시간 지난 항목과 `UPLOAD_TMP_TTL_HOURS`가 지난 미완료 업로드 영구 삭제(`ACTIVE`·`DRAINING` 볼륨), 비운 볼륨의 휴지통 바이트 기록과 "Recently deleted" 항목 정리. 이 작업만 있는 큐다(동시 1개) | 워커 시작 시 스케줄 등록, 관리자 "Run cleanup now"는 계정·항목 정리만 즉시 실행 |
| `probes` | `METRICS_SAMPLE_INTERVAL_SEC`마다 대역폭·디스크 표본(워커 heartbeat 겸), `HEALTH_PROBE_INTERVAL_SEC`마다 Status 페이지 프로브, `VOLUME_WATCH_INTERVAL_SEC`마다 볼륨 확인. 별도 큐·워커(`JOBS.probeConcurrency` = 종류마다 1개)라 매일 정리가 오래 걸려도 SSD 분리를 제때 알아챈다 | 워커 시작 시 스케줄 등록(예전 릴리스가 `maintenance` 큐에 둔 스케줄은 지운다) |
| `notify` | 소유자 알림(`NOTIFY_WEBHOOK_URL`, [runbook.md "알림 설정"](runbook.md#알림-설정)): 업로드 링크로 들어온 파일(링크마다 `NOTIFY.fileRequestGroupSec` 동안 Redis에 모았다가 지연 작업 하나로), 예비 공간 아래로 내려간·쓰기를 거부하는·`OFFLINE`이 되거나 돌아온 볼륨, 실패한 백업 검증. 형식(`domain/notify.ts`: json, ntfy, Discord, Telegram)으로 바꿔 `server/http/webhook.ts`가 POST한다(`NOTIFY.requestTimeoutMs`, 리디렉트 따라가지 않음, 응답 본문 읽지 않음). 동시 1개, `NOTIFY.jobAttempts`번 지수 backoff, 4xx(408·429 제외)·3xx는 `UnrecoverableError`로 끝낸다. 반복 경보는 `notify:throttle:<종류>:<볼륨>` 키(`SET NX PX`)로 기간마다 한 번만 큐에 넣고, 작업 id(`<종류>-<대상>-<시각>`, 업로드 링크는 `file-request-<요청 id>-<시각>`, 백업은 `backup-failed-<시각>`)로 같은 알림을 두 번 넣지 않는다. 모은 업로드는 첫 시도에서 작업 데이터에 옮겨 적어 재시도가 같은 내용을 보낸다 | tus 업로드 완료(업로드 링크), 볼륨 확인(`probes` 큐), `backup:verify` 스크립트. 알림이 꺼져 있으면 아무것도 넣지 않는다 |
| `media` | 썸네일(이미지: sharp, 영상: ffmpeg 1초 프레임 → WebP 576px), 공개 링크용 메타데이터 제거본(JPEG·PNG·WebP는 픽셀을 다시 인코딩하지 않고 메타데이터 구간만 제거, 방향 정보는 유지. GIF·AVIF·TIFF는 같은 형식으로 다시 쓰기), 뷰어 미리보기(512KB 이상 JPEG·PNG·WebP·AVIF·TIFF → 2560px WebP q92, 원본보다 작을 때만 저장), 자주 재생되는 영상의 저장된 변환본(`task: "transcode"`, 아래 "미리보기 전송"), 촬영일(`takenAt`, 아래 "순번 정리". 처리할 때마다 함께 읽고, `task: "taken"`은 촬영일만) | 업로드 완료, 복사, 실시간 변환 재생 횟수, 릴리스 데이터 마이그레이션(`taken`) |

- 생성 파일은 `system/thumbs/`, `system/derived/`, `system/previews/`, `system/transcoded/` 아래 `<accountId>/<nodeId>`에 두고(`ASSET_DIRS`), 원본은 건드리지 않는다. 항목을 지우거나 계정을 다른 볼륨으로 옮기면 함께 지우거나 옮긴다.
- ffmpeg·smartctl은 `runCommand`(`src/server/process/run-command.ts`)로 실행한다. 셸 없이, 시간 초과나 중단(`signal`) 시 SIGTERM 후 SIGKILL, 출력은 메모리 상한까지, 끝나면 항상 회수한다. 실시간 변환(`?transcode=1`)만 응답 스트림 때문에 직접 `spawn`한다(시청자가 떠나면 SIGKILL).
- 작업 기록: `maintenance`·`probes`·`notify` 큐는 끝난 작업을 최근 `JOBS.keepCompleted`(100)개, 실패한 작업을 `keepFailed`(1,000)개만 Redis에 남긴다(프로브만 하루 5,700개쯤 끝난다). 워커가 시작할 때 이 한도 전에 쌓인 하루 넘은 작업을 `JOBS.trimBatch`개씩 지운다(한 번에 지우면 Redis가 멈춘다). `media` 큐는 끝나거나 실패한 작업을 바로 지운다. 작업 id가 노드 id라 남겨 두면 같은 파일을 다시 큐에 넣을 수 없기 때문이다.
- 미디어 작업 실패: 파일 자체를 디코딩·정리할 수 없으면(sharp·ffmpeg 오류, 원본과 볼륨은 정상) 그 단계만 건너뛰고 기록한다(제거본이 없으면 `stripFailed`, 공개 링크 415). 저장소·시스템 문제(`server/media/failure.ts`: EIO·ENOSPC·EROFS·ENOENT 같은 errno, `STORAGE_OFFLINE`·`STORAGE_BUSY`, 명령 시간 초과·중단·실행 실패, 또는 디코더 오류인데 원본을 읽을 수 없거나 볼륨 표시 파일이 없을 때)는 예외를 던져 작업 전체를 BullMQ가 `MEDIA.jobAttempts`(6)번까지 지수 backoff(10초부터, 약 5분)로 다시 시도한다. 그동안 아무것도 영구 기록하지 않으므로 공개 링크는 503 `MEDIA_NOT_READY`이고, 끝내 실패하면 `npm run media:backfill`로 다시 넣는다.
- 종료: `npm run worker`는 SIGTERM/SIGINT에 새 작업을 받지 않고 실행 중인 작업이 끝나기를 기다린다. 저장 변환(`task: "transcode"`)만 BullMQ 중단 신호로 ffmpeg를 멈추고(작업은 실패로 남아 재시작 뒤 다시 시도), 나머지는 짧다(ffmpeg `MEDIA.ffmpegTimeoutSec`).
- 웹 앱은 큐에 넣기만 하고 실패해도 요청을 막지 않는다(Redis 장애 시 썸네일만 늦어짐). 빠진 썸네일은 `npm run media:backfill`로 다시 큐에 넣는다. 미리보기가 생기기 전에 올린 이미지는 `npm run media:backfill -- --previews`로 한 번 다시 처리한다.

### 미리보기 전송

뷰어는 원본을 보려고 내려받지 않는다.

- 이미지: 목록에서 이미 받은 썸네일을 흐리게 바로 보여 주고, 워커가 만든 미리보기(`/api/files/<id>/preview`, 공유 링크도 같은 경로)가 오면 바꾼다. 미리보기가 없으면(작은 파일, GIF, 처리 전) 같은 URL이 원본을 보낸다. 앞뒤 이미지는 미리 받아 둔다(공유 링크에서는 `x-relayfiles-prefetch` 헤더로 조회 수에서 뺀다).
- 캐시: 파일의 바이트는 URL(node id)이 같으면 바뀌지 않는다(교체하면 새 id. 공유 링크(`linkId`)·공유 설정·태그·다운로드 수·링크 기록은 새 행으로 넘어가 이미 보낸 링크가 그대로 동작한다). 그래서 재생(`stream`), 썸네일, 미리보기, 변환 영상은 `private, max-age=1년, immutable`이다. 이미 본 구간으로 되감거나, 다른 영상을 보다가 돌아와도 브라우저 디스크 캐시에서 바로 읽고 서버에는 요청이 가지 않는다. 다운로드(`download`, zip)는 다운로드 제한·횟수 때문에 캐시하지 않고, 에러 응답은 `no-store`다. Nginx의 X-Accel 위치에는 `Cache-Control`을 붙이지 않는다(앱 값이 그대로 전달된다. 둘이 되면 `no-cache`가 이겨 캐시가 꺼진다). 공유 링크 미리보기는 앞뒤 이미지 미리 받기만 조회에서 빠지고, 캐시에서 다시 보는 것은 조회로 다시 세지 않는다.
- 영상: 썸네일을 포스터로 바로 보여 주고 원본을 Range 요청으로 재생한다(Docker 배포는 Nginx X-Accel, systemd 배포는 앱이 직접 전송). 브라우저가 못 여는 컨테이너(AVI, WMV, MPEG-TS 등, `videoNeedsTranscode`)와 재생 오류가 난 MKV·MOV는 `?transcode=1`로 바꾼다. 앱이 ffmpeg로 720p H.264/AAC fragmented MP4를 만들면서 바로 흘려보낸다. 동시에 `VIDEO_TRANSCODE_MAX`개까지, 시청자가 떠나면 즉시 종료(SIGKILL)하고 출력은 4GB로 제한한다.
  - **저장된 변환본**(`server/media/transcode-cache.ts`): 같은 영상이 `TRANSCODE.cacheWindowSec`(7일) 안에 `cacheAfterPlays`(3)번 실시간 변환되면 워커가 한 번 변환해 `system/transcoded/<accountId>/<nodeId>`에 MP4(`+faststart`, 메타데이터 없음)로 저장한다. 그 뒤 `?transcode=1`은 이 파일을 일반 파일처럼 Range 요청(206)으로 보내므로 되감기가 되고 CPU를 쓰지 않는다. 워커도 같은 `VIDEO_TRANSCODE_MAX` 슬롯을 쓰고(모두 사용 중이면 작업을 나중에 다시 시도), 볼륨 예비 공간을 넘길 것 같으면 만들지 않는다. ffmpeg는 `runCommand`로 돌고 `TRANSCODE.storeTimeoutSec`(6시간, 720p는 N95에서 실시간보다 빠르다)이 지나면 멈춘다. 시간 초과는 다시 시도하지 않는다(또 시간 초과가 날 뿐이다. 실시간 변환은 그대로 되고, 다음 기간에 다시 자주 재생되면 큐에 다시 들어간다). 워커 종료와 슬롯을 잃은 경우(아래)는 실패로 처리해 나중에 다시 시도한다.
  - 변환 슬롯(`redis-semaphore.ts`): 쥔 쪽이 임대의 1/3마다 갱신하고, 갱신은 항목의 만료 시각과 키의 만료를 함께 늘린다. 갱신할 때 항목이 없으면(임대가 지나 다른 프로세스가 지웠거나 Redis가 키를 잃음) 빈 슬롯이 있을 때만 같은 Lua 스크립트 안에서 다시 잡는다. 빈 슬롯이 없으면 갱신을 멈추고 `slot.signal`을 중단시킨다. 이때 실시간 변환은 ffmpeg를 SIGKILL로 끝내고(시청자에게는 스트림이 끊긴다), 저장 변환은 ffmpeg를 멈추고 작업을 다시 시도한다. 그래서 `VIDEO_TRANSCODE_MAX`를 넘겨 돌지 않는다. Redis에 닿지 않아 갱신하지 못한 것은 로그만 남긴다(임대는 아직 유효할 수 있다).
  - 변환본은 계정 용량에 넣지 않는다(썸네일·미리보기처럼 서버가 만든 파일이다). 만든 지 `TRANSCODE.cacheKeepDays`(30일)가 지나면 매일 정리에서 지우고, 여전히 자주 보는 영상이면 다시 만든다. 원본을 지우면 함께 지운다.
- 디코딩할 수 없는 파일은 경고 로그만 남기고 다시 시도하지 않는다. 저장소 오류는 다시 시도한다(위 "미디어 작업 실패").
- 문서(미디어가 아닌 파일): 형식은 이름으로 정한다(`src/domain/file-format.ts`, 목록 아이콘도 여기서 나온다). 뷰어는 같은 `stream` URL을 `fetch`로 읽어 브라우저 안에서 그린다. 서버는 이 파일들을 여전히 `attachment`·`nosniff`로만 보내므로(HTML·SVG가 앱 출처에서 실행되지 않음) 서버 쪽 변경이 없다.
  - 텍스트·코드·Markdown·CSV/TSV: Range 요청 하나로 앞 1MB만 받는다(`DOCUMENT_PREVIEW.textMaxBytes`). NUL 바이트가 있으면 바이너리로 보고 "No preview"를 보여 준다. UTF-8이 아니면 UTF-16(BOM), EUC-KR 순으로 해석한다. 코드는 highlight.js(필요한 언어만 지연 로드, Solidity는 `solidity.ts`), Markdown은 react-markdown + GFM으로 그리며 원시 HTML은 글자로 보이고 외부 이미지는 불러오지 않는다. 확장자가 없거나 모르는 파일은 앞 8KB를 먼저 보고 텍스트일 때만 이어 받는다.
  - PDF: pdf.js legacy 빌드(구형 브라우저용 폴리필 포함)를 Web Worker에서 돌리고, 화면 근처 페이지만 canvas에 그렸다가 멀어지면 비운다. Range 요청으로 필요한 부분만 받는다.
  - SVG는 blob URL의 `<img>`(스크립트·네트워크 없음), 글꼴(TTF/OTF/WOFF/WOFF2)은 `FontFace`로 불러 예문을 보여 준다.
  - Word(.docx)는 mammoth로 HTML(제목, 목록, 표, 링크, 내장 그림)로 바꾸고 DOMPurify로 정제해 넣는다. 페이지 레이아웃(글꼴, 단, 머리글·바닥글)은 없다. Excel(.xlsx, .xlsm)은 read-excel-file로 시트마다 표를 만들고 시트 탭으로 바꾼다. 수식은 저장된 결과값을 보여 준다.
  - SVG·글꼴·docx·xlsx는 파일 전체가 필요해서 20MB(`DOCUMENT_PREVIEW.assetMaxBytes`)까지만 미리 본다. 표는 1,000행·100열까지.
  - 압축 파일, 옛 Office 형식(.doc, .xls, .ppt)과 .pptx, .hwp, 디스크 이미지, 패키지 등은 형식 아이콘과 "No preview"만 보인다.
  - 공유 링크에서 문서를 여는 것은 `VIEW`로 기록된다(영상·오디오만 `PLAY`).
- 자막: 영상을 열면 같은 폴더 목록에서 이름이 같은 `.vtt`·`.srt`(`movie.vtt`, `movie.mp4.srt`, 언어 태그 `movie.en.srt` → "English")를 찾는다(`domain/subtitles.ts` `subtitlesFor`, 뷰어 `withSubtitles`). 파일은 텍스트 미리보기와 같은 `stream` URL을 Range 요청 하나(`VIEWER.subtitleMaxBytes` = 텍스트 미리보기 한도 1MB, 공유 링크의 `streamReach` 텍스트 한도 안)로 읽고, `.srt`는 브라우저에서 WebVTT로 바꿔(`srtToVtt`: 시간의 `,`→`.`, `<font>` 제거, `&`·`<` 이스케이프) `blob:` URL의 `<track kind="subtitles">`로 붙인다. CSP는 `media-src 'self' blob:`이라 다른 출처는 여전히 막힌다. 한도를 넘거나 바이너리인 파일은 건너뛴다. 뷰어는 자막을 읽을 때 `?subtitle=1`(`SUBTITLE_PARAM`)을 붙인다. 공유 링크는 이 표시가 있고 이름이 자막 파일이면 그 읽기를 `VIEW`로 기록하지 않는다. 다운로드 한도가 걸린 자막 파일은 표시가 있어도 재생처럼 센다(표시만으로 한도를 피할 수 없다).
- 슬라이드쇼: 그림을 보고 있고 그림이 둘 이상이면 머리글에 재생 버튼이 생긴다(Space도 같다). `VIEWER.slideshowIntervalMs`(4초)마다 목록 순서로 다음 그림을 열고(`domain/slideshow.ts`, 그림이 아닌 파일은 건너뜀), 마지막 그림에서 멈춘다. 사용자가 앞뒤로 넘기거나(버튼·화살표·N/P) 뷰어를 닫으면 멈춘다. 그림은 페이드인하지만 `prefers-reduced-motion: reduce`이면 전환 효과가 없다(`motion-safe:`). 공유 페이지의 폴더 뷰어도 같은 뷰어라 그대로 쓴다.

### 전송 패널 (파일별 진행률·취소)

- 2개 이상인 배치(`TRANSFERS.fileListMin`)는 카드의 "Show files"로 파일 목록을 연다. 파일마다 진행 막대(`Meter`), 받은/보낸 바이트, 속도 스파크라인(`LineChart`, 1초 간격 최근 30개), 취소 버튼.
- 상태는 `features/transfers/transfer-items.ts`의 순수 함수로 바꾼다. 바이트 수는 `TRANSFERS.progressFlushMs`마다 모아서 반영하고(파일 1만 개 배치에서도 렌더가 밀리지 않게), 시작·완료·실패·취소는 바로 반영한다. 행은 `memo`라 바뀐 파일만 다시 그린다.
- 업로드(`BatchUploader`): 대기 중인 파일을 취소하면 건너뛰고, 보내는 중인 파일은 `abort(true)`(tus DELETE → 서버가 예약을 풀고 조각을 지움) 후 다음 파일로 넘어간다. 다 올라간 파일은 취소 대상이 아니다(지우기로 지운다). 웹 앱 배치는 파일 하나가 실패해도 멈추지 않고 나머지를 보낸 뒤 "N of M files failed"로 끝난다(`continueOnError`). 업로드 링크 페이지(`/r/<id>`)는 예전처럼 첫 실패에서 멈춘다. 웹 앱 배치는 tus 지문(`tus-js-client` 기본 지문 + 계정 id, localStorage)을 저장해 두고, 새로고침 뒤 같은 파일을 다시 고르면 파일마다 `findPreviousUploads()`에서 크기·엔드포인트가 같은 최근 업로드(`UPLOAD.resumeCandidates`개까지)를 `POST /api/uploads/resume`으로 넘겨받은 뒤 `resumeFromPreviousUpload()`로 이어 보낸다. 서버가 거절한 저장 항목은 지운다. 업로드가 보내는 중이거나 일시 정지인 동안에만 `beforeunload`로 페이지를 떠나기 전에 확인한다(`shared/hooks/useLeaveGuard`, 업로드 링크 페이지도 같다).
- 다운로드: 단일 파일·zip은 예전처럼 브라우저 다운로드에 맡긴다(진행률을 볼 수 없어 "saving in your browser"). 여러 항목을 선택해 Download를 누르면 File System Access API가 있는 브라우저(Chromium, https 또는 localhost)에서는 저장할 폴더를 고르게 하고(`FolderDownloader`), 파일마다 `fetch` 응답을 `createWritable()`로 바로 흘려 쓴다(메모리에 쌓지 않음). 폴더는 `<이름>.zip`으로 받고 크기는 추정치다. 같은 이름이 있으면 덮어쓰지 않고 `name (2).ext`로 저장한다. 취소·실패한 파일의 부분 파일은 지운다. Safari·Firefox는 예전 방식.

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

- 앱을 여러 프로세스(복제본)로 띄워도 같이 지켜야 하는 상태는 Redis에 둔다: tus 업로드 잠금(`upload/redis-locker.ts`, 임대 `UPLOAD.lockLeaseMs`를 쥔 쪽이 갱신, 기다리는 요청은 해제 요청을 publish), 영상 변환 슬롯(`redis-semaphore.ts`), 업로드 예약, 로그인 잠금, 다운로드 허가. 서버 지표의 직전 값(속도 계산용)만 프로세스마다 따로다.
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
- **중복 제거**(`STORAGE_DEDUPE`, 기본 켬): 원본을 수정하지 않으므로 같은 내용의 파일은 바이트를 공유해도 된다. 복사(`copyNodes`, 폴더 안의 파일까지, 처음 읽은 DB 행마다 하나씩 `system/tmp/uploads/copy-<id>/item`에 준비)는 하드 링크로, 재업로드는 같은 계정에 SHA-256과 크기가 같은 파일이 있으면 그 파일의 하드 링크로 둔다(받은 바이트는 버린다). 하드 링크를 못 만드는 곳(다른 파일시스템, 링크 수 한도)에서는 reflink 또는 일반 복사로 돌아간다.
  - 삭제·휴지통은 링크 하나만 옮기므로 다른 사본은 그대로다. 디스크 공간은 마지막 링크가 지워질 때 돌아온다.
  - 계정 용량·휴지통 용량은 사본마다 논리 크기로 센다(사용자가 보는 크기와 같다). 볼륨 여유 공간 검사만 실제 사용량을 본다.
  - 다른 계정의 파일과는 공유하지 않는다(계정 사이에 어떤 연결도 만들지 않는다).
  - `volume:migrate`는 파일마다 복사하므로 새 볼륨에서는 링크가 풀린다(내용은 SHA-256으로 대조). 백업 `rsync`에는 `-H`를 넣어 링크를 유지한다(runbook의 예시는 `-aHAX`).
- **수정 시각**(`Node.modifiedAt`): 파일 내용이 마지막으로 바뀐 시각. 업로드는 브라우저의 `File.lastModified`(tus 메타데이터 `lastModified`), `storage:import`는 tar 항목의 mtime, 값이 없으면 업로드 시각을 쓴다. 복사본은 원본 값을 그대로 가진다. `updatedAt`은 이름·태그·설정 변경에도 바뀌므로 "수정일"로 쓰지 않는다. 이 컬럼이 생기기 전 파일은 데이터 마이그레이션 `20261101-backfill-modified-at`이 디스크 mtime으로 채운다(이름 변경·하드 링크는 mtime을 바꾸지 않는다).

### 쓰기 잠금

쓰기 허용 여부(`driverForAccount(…, "write")`)는 작업을 시작할 때 확인하지만, 복사 준비(`stageCopy`)나 업로드 해시처럼 오래 걸리는 일은 그 뒤에 쓴다. 그 사이 `volume:migrate`가 해시·복사·전환을 끝내면 새 파일이 떠나는 볼륨에만 남고 휴지통과 함께 지워진다. 그래서 PostgreSQL advisory lock(트랜잭션 단위, `repositories/advisory-lock.repo.ts`)으로 순서를 정한다.

- **쓰는 쪽**: 파일을 바꾸는 모든 스토리지 트랜잭션은 첫 문장으로 `lockAccountForWrite(tx, accountId, driver.volumeId)`(`services/volume.service.ts`)를 부른다. 볼륨 → 계정 순으로 쓰기 잠금을 **공유**로 잡고(쓰기끼리는 막지 않는다) 계정의 `migrating`, 볼륨 상태(`READONLY`·`OFFLINE`), 계정이 아직 그 볼륨에 있는지를 다시 읽는다. 아니면 503 `STORAGE_BUSY`(또는 `STORAGE_OFFLINE`)로 롤백한다. 이름 변경, 이동, 복사, 삭제, 폴더 만들기, 순번 정리, 계정 삭제가 이렇게 한다. 업로드(tus, 업로드 링크, API v1 `POST /files`, `storage:import`)는 모두 `upload.service.ts`의 `ensureFolders`·`placeUpload` 트랜잭션을 거친다.
- **이동**(`volume:migrate`): 계정 잠금을 **배타**로 잡은 트랜잭션에서 `migrating`을 켠다(`startAccountMove`). 진행 중인 쓰기 트랜잭션이 끝날 때까지 기다리고(최대 `STORAGE.writeDrainTimeoutSec`, 넘으면 아무것도 바꾸지 않고 실패), 그 뒤의 쓰기는 잠금을 잡은 다음 표시를 보고 거절된다. 전환 직전에 원본이 해시한 그대로인지(추가·삭제·크기 변화 없음), DB의 모든 항목(`missing` 표시 파일 제외)이 복사본에 있는지 다시 확인하고, 같은 배타 잠금 아래에서 `volumeId`를 바꾼다(`finishAccountMove`).
- **레이아웃 마이그레이션·`storage:fsck --fix`**: 볼륨 잠금을 배타로 잡은 트랜잭션에서 볼륨을 `READONLY`로 바꾸고 돌아갈 상태를 `StorageVolume.resumeStatus`에 적는다(`startMaintenanceHold`). 끝나면 그 상태로 되돌린다(`endMaintenanceHold`, `setVolumeLayout`). 관리자가 `READONLY`로 둔 볼륨은 `READONLY`로 남고, 중단 뒤 다시 실행해도 첫 실행 전 상태(`DRAINING` 등)를 안다.
- **삭제**는 같은 트랜잭션에서 지울 트리를 위에서 아래로 `FOR UPDATE` 잠그고(`lockSubtrees`) 잠근 행으로 휴지통 바이트를 센다. 잠긴 폴더 아래에는 외래 키 확인 때문에 새 행이 들어올 수 없다.
- **중복 제거 링크**: 업로드가 같은 내용의 파일(twin)에 하드 링크할 때는 트랜잭션 안에서 `lockedLocationOf(tx, accountId, twinId)`(`services/node-location.ts`)로 twin과 조상 폴더를 `FOR SHARE`로 잠그고 경로를 계산한다. 커밋 전에는 그 경로의 이름 변경·이동·삭제가 기다린다. 잠금 순서는 삭제와 같이 루트에서 아래로라 서로 교착되지 않는다.
- **데이터 마이그레이션**: `npm run data:migrate` 한 번이 advisory lock(`run:data-migrations`)을 쥐고 돈다(`MIGRATION.runLockHours`까지). 두 번째 실행(k3s Job과 수동 실행)은 기다렸다가 끝난 단계를 건너뛴다.
- 생성 파일(썸네일·미리보기·변환본) 쓰기는 이 잠금을 쓰지 않는다. 이동 중에 만들어져 빠지더라도 다시 만들 수 있다.

### 휴지통 (Recently deleted)

File Manager 툴바의 시계 아이콘(`/files/deleted`)이 지운 항목을 보여 준다(`features/trash`, `services/trash.service.ts`, `repositories/deleted-item.repo.ts`).

- **삭제**(`deleteItems`): 지금처럼 한 스토리지 트랜잭션에서 트리를 `lockSubtrees`로 잠그고 행을 지운 뒤 맨 위 항목마다 `moveToTrash`한다. 같은 트랜잭션에서 잠근 행의 모든 컬럼을 읽어(`nodeRowsByIds`) 맨 위 항목별로 나누고(`domain/trash.ts` `groupByTop`), 항목마다 `TrashedBytes` 행 하나(그 항목의 파일 바이트, `addTrashedBytes`가 id를 돌려준다)와 `DeletedItem`(볼륨, `moveToTrash`가 돌려준 휴지통 경로, 그 `TrashedBytes` id, 이름·종류·크기·항목 수, 원래 부모 id와 당시 폴더 이름, `nodes` = 행 스냅샷 JSON)을 쓴다. 항목별 바이트의 합은 예전의 한 행과 같아서 쿼터 계산은 바뀌지 않는다.
- **스냅샷**: 다시 넣는 데 필요한 Node 컬럼 전부(id, parentId, 이름, 종류, 크기, sha256, `missing`, `linkId`, 공유 설정, 다운로드 수, 태그, 생성·수정·촬영 시각). 계정은 `DeletedItem`의 것을 쓰고, 생성 파일 표시(`hasThumb`·`hasDerived`·`stripFailed`)는 복원할 때 false(생성 파일은 삭제 때 지워진다), `updatedAt`은 복원 시각. 나중에 Node에 컬럼을 더하면 옛 스냅샷에는 없으므로 기본값을 가져야 한다(zod 스키마가 모르는 키는 버린다).
- **복원**(`POST /api/trash/:id/restore`): 항목의 볼륨이 계정의 현재 볼륨과 다르면 409(파일은 옛 볼륨의 휴지통에 있고 그 휴지통과 함께 지워진다). `assertItemRoom`으로 항목 수를 확인한 뒤 `withStorageTransaction`에서 `lockAccountForWrite` → `DeletedItem` 삭제(행 잠금이라 같은 항목의 두 번째 복원·영구 삭제는 기다렸다가 없음을 보고 404) → 대상 폴더 결정(원래 부모가 계정의 폴더로 남아 있으면 그 폴더, 아니면 계정 루트. `lockedLocationOf`로 대상과 조상을 `FOR SHARE` 잠가 그 사이 이름 변경·이동·삭제를 막는다) → `uniqName` → 같은 id·`linkId`로 행 삽입(이미 쓰이는 `linkId`가 있으면 그 행만 새 링크) → 그 `TrashedBytes` 행 삭제 → 마지막에 `restoreFromTrash`(실패하면 `returnToTrash`가 같은 휴지통 항목으로 되돌린다). `restoreFromTrash`는 대상 이름에 디스크의 무엇이든 있으면 덮어쓰지 않고 실패한다. 커밋 뒤 이미지·영상을 미디어 큐에 다시 넣는다. 폴더를 먼저 복원하면 그 폴더에서 지웠던 항목은 id가 같으므로 원래 자리로 돌아간다.
- **복원되지 않는 것**: 링크 활동 기록(`LinkEvent`)과 지운 폴더의 업로드 링크(`FileRequest`)는 삭제 때 cascade로 지워진다. 썸네일·제거본·미리보기·변환본은 다시 만든다. 만료(`expAt`)나 첫 다운로드 후 삭제로 정리 작업이 지운 항목(`recoverable: false`)은 링크가 끝났으므로(`LinkTombstone`) 목록에 넣지 않는다.
- **영구 삭제**(`DELETE /api/trash/:id`): 같은 잠금 아래 `DeletedItem`과 그 `TrashedBytes`를 지우고, 커밋 뒤 `removeFromTrash`로 디스크에서 지운다(실패하면 매일 정리가 지운다).
- **정리**: 매일 정리가 `forgetTrashedBefore`와 같은 기준 시각·같은 규칙(실제로 비운 `ACTIVE`·`DRAINING` 볼륨만)으로 `forgetDeletedBefore`를 부른다. `deletedAt`은 휴지통으로 옮긴 뒤의 시각이라 기록이 지워지는 항목은 파일도 이미 지워졌다. 그 반대(파일만 먼저 지워진 짧은 틈)는 복원이 410으로 답한다. 계정을 지우면 `DeletedItem`도 cascade로 지워진다. 휴지통 경로는 항목 이름만 보므로(`trashEntry`) 볼륨 마운트 경로가 바뀌어도 찾는다.

### 순번 정리 (Renumber files)

폴더 메뉴의 "Renumber files"는 `scripts/sortNumbered.sh`처럼 폴더 바로 아래 파일 이름을 `01, 02, 03…`(확장자 유지)으로 바꾼다(`domain/renumber.ts` 계획, `services/renumber.service.ts` 실행).

- 정렬: 이름(자연 정렬), 생성일(`createdAt`), 수정일(`modifiedAt`), 촬영일(`takenAt`), 오름·내림차순. 같은 값은 이름 → id 순이라 계획이 매번 같다.
- **촬영일**(`Node.takenAt`): 워커가 미디어 자체의 메타데이터에서 읽는다(`domain/media-date.ts`, `server/media/date-taken.ts`).
  - 사진: sharp가 헤더만 읽어 준 EXIF에서 `DateTimeOriginal` → `DateTimeDigitized` → IFD0 `DateTime` 순, 시간대는 `OffsetTimeOriginal`. 오프셋이 없으면 `JOBS_TIMEZONE`(기본 Asia/Seoul)의 시각으로 본다.
  - 영상: `ffmpeg -map_metadata 0 -c copy -t 0 -f ffmetadata`(디코딩 없음, 입력은 기존 `ffmpegInput` 허용 목록 그대로)로 `com.apple.quicktime.creationdate`(현지 시각+오프셋) → `creation_time`(UTC) 순.
  - 1971년 이전(시계가 설정되지 않은 카메라의 0값)과 미래 값은 버린다. 메타데이터가 없으면 null이고, 정렬은 수정일 → 생성일로 대신하며 미리보기가 그 개수를 알려 준다.
  - 업로드·복사·`storage:import` 뒤 `processMedia`가 함께 읽는다. 이 기능 전에 올린 파일은 데이터 마이그레이션 `20261101-queue-date-taken`이 `task: "taken"` 작업을 큐에 넣고(파일당 하나, `taken-<nodeId>`), 워커가 릴리스 뒤 백그라운드로 읽는다.
- 건드리지 않는 것: 하위 폴더, 숨김(점으로 시작하는) 파일(`.env`가 `05`가 되지 않게), 디스크에 없는 파일(`missing`). 새 이름이 이들과 겹치면 실행하지 않는다.
- 이름만 바뀌고 노드 id는 그대로다. 태그, 공유 링크(`linkId`), 공유 설정, 링크 활동, 썸네일·미리보기(`system/*/<nodeId>`)는 모두 id 기준이라 영향이 없다.
- 실행은 `withStorageTransaction` 하나: ① `pg_advisory_xact_lock(hashtext('renumber:'||folderId))`로 같은 폴더의 실행을 줄 세우고, 잠금 뒤 계획을 다시 계산해 클라이언트가 본 계획(`expect`)과 다르면 409. ② 바뀌는 파일마다 숨김 임시 이름(`.relayfiles-renumber-<무작위>-<n>`)으로, ③ 그다음 번호 이름으로 바꾼다(DB 행과 디스크를 함께). `(parentId, name)` 유일 인덱스가 지연되지 않고 `fs.rename`은 대상을 덮어쓰므로 두 단계가 필요하다.
- 디스크 이름 변경은 `StorageDriver.renameNoReplace`: `link()` 뒤 `unlink()`라 대상 이름이 이미 있으면 `EEXIST`로 실패하고 아무것도 덮어쓰지 않는다(하드 링크가 안 되는 곳에서는 존재 확인 후 `rename`). 같은 순간 그 이름으로 업로드가 들어와도 파일을 잃지 않고 실행이 실패한다.
- 어느 단계에서든 실패하면 DB는 롤백되고 undo 스택이 디스크 이름을 역순으로 되돌린다(스크립트의 `rollback`/`rollback_stage2`와 같은 결과). 한 번에 바꾸는 파일 수는 `RENUMBER_MAX_FILES`(기본 10,000, `.env`에서 변경)까지다. 넘으면 미리보기에 이유가 나오고 실행 버튼이 꺼진다. DB 이름은 단계마다 SQL 한 번(`renameChildren`, `unnest`로 일괄 UPDATE)으로 바꾸고 디스크만 파일마다 바꾼다. 트랜잭션 제한 시간은 `max(STORAGE.transactionTimeoutSec, 바뀌는 파일 수 × RENUMBER.transactionMsPerFile(20ms))`이다(개발 환경 측정: 2만 개 10초, 파일당 약 0.5ms). Nginx 응답 대기 시간은 1시간이고, Cloudflare Tunnel을 거치면 100초가 넘는 요청은 브라우저에 524가 보여도 서버에서는 끝까지 실행된다.
- 클라이언트는 바뀌는 파일만(`expect`)과 번호 대상 전체 수(`count`)를 보낸다. 서버는 잠금 뒤 계획을 다시 계산해 바뀌는 목록과 개수가 같을 때만 실행한다(그 사이 파일이 추가·삭제되면 409).

### 중복 파일 찾기 (Find duplicates)

- 한 번에 비교하는 파일 수는 `DUPLICATES_MAX_SCAN`(기본 10,000, `.env`에서 변경)까지이고, 넘으면 결과에 "only part of the folder was scanned"가 붙는다.
- 폴더(선택하면 하위 폴더까지)의 파일을 SHA-256과 크기로 묶는다(`domain/duplicates.ts`, `services/duplicates.service.ts`). 이름은 보지 않는다. 읽기만 하고, 지우기는 일반 삭제를 쓴다.
- 처음에는 묶음마다 가장 오래된 파일을 남기고 나머지를 선택한다. 묶음의 모든 사본을 선택하면 삭제 버튼이 꺼진다.
- 중복 제거(`STORAGE_DEDUPE`)로 이미 하드 링크를 공유하는 사본은 지워도 쿼터만 줄고 디스크 공간은 마지막 링크가 지워질 때 돌아온다(대화상자에 안내).
- SHA-256이 없는 파일(처음 커밋부터 업로드는 해시를 기록했으므로 보통 없음)은 비교하지 않고 `unchecked`로 센다. 데이터 마이그레이션 `20261101-backfill-sha256`이 릴리스 때 채운다.

## 설정과 환경 변수

- 정책 값(기간, 임계값, 크기)은 `src/config/policy.ts`에 이름을 붙여 둔다. 배포마다 다른 값(포트, 호스트, 경로, 도메인, 비밀값)은 env로 빼고, env는 `policy.ts`의 기본값을 덮어쓰기만 한다.
- 앱은 `src/config/env.ts`의 그룹별 getter(`getAppEnv()`, `getEnv("database")` 등)로만 env를 읽는다. 그룹(`app`, `database`, `redis`, `storage`, `uploads`, `secrets`, `policy`, `jobs`, `observability`, `deploy`, `offsite`, `notify`, `testing`)은 처음 쓰일 때 검증되므로, 빌드는 DB 비밀번호 없이 통과하고 실행 시 빠진 키는 목록으로 바로 실패한다.
- 커밋되는 env 파일은 `.env.example` 하나다. 스키마의 키 집합과 `.env.example`의 키 집합이 같은지 `env.test.ts`가 검사하므로, 새 설정은 두 곳을 같은 PR에서 바꾼다.
- compose는 `${VAR}`, Nginx 설정은 템플릿(Docker·k3s: nginx 이미지의 envsubst, systemd: `scripts/render-template.mjs`), k3s 매니페스트는 `deploy/k3s/*.yaml.template`(`render-template.mjs`)으로 같은 `.env` 값을 쓴다. 코드·compose·Nginx 설정에 값을 하드코딩하지 않는다.
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
