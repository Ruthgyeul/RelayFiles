# 개선 로드맵 (2026-11 감사 후속)

## Context

2026-11-21 전체 감사(정리 작업은 [#141](https://github.com/Ruthgyeul/RelayFiles/pull/141))에서 다음이 확인됐다.

- 코드 품질과 레이어 규칙 준수는 높다.
- 앞으로의 비용은 두 곳에서 나온다.
  - **운영 안전성의 빈틈**: dav 재시작 누락, Nginx 버퍼링, CI와 상관없는 이미지 publish, k3s 백업 없음, worker 감시 없음.
  - **한 가지 일을 여러 곳에서 하는 구조**: 에러 문구 26벌, fetch effect 19벌, 파일 액션을 추가하려면 6~7곳, 배포 기본값 5곳.
- 이 계획은 그 결과를 PR 단위의 실행 순서로 바꾼 것이다.
- 목표는 ① 운영 사고 위험 제거 → ② 기능 추가 비용 축소 → ③ 성능 → ④ 신규 기능 순이다.

## 진행 방법

- 위에서 아래 순서로 PR 하나씩 진행한다. 각 항목의 PR 제목은 그대로 커밋·PR 제목으로 쓴다.
- 끝난 항목은 제목 옆에 PR 링크를 적는다(예: `— #150`). Phase가 모두 끝나면 해당 절을 CHANGELOG로 넘기고 이 문서에서는 요약만 남긴다.
- 계획을 바꿀 때는 이 문서를 같은 PR에서 고친다.

## 공통 규칙 (모든 PR)

- PR 하나에 주제 하나. 브랜치는 `fix/…`·`refactor/…`·`feat/…`, base는 `main`, Merge Commit으로 병합한다.
- 머지 전에 `npm run check`를 통과해야 한다. DB나 스토리지를 건드리면 `npm run test:integration`도 통과해야 한다. 사용자가 보는 변경은 `CHANGELOG.md` Unreleased에 한 줄 적는다.
- 동작을 바꾸지 않는 리팩터링(Phase 2·3)은 기존 테스트를 먼저 보강해 보호한 뒤 옮긴다. 쿼리 수가 바뀌는 작업은 `test/query-counter.ts`로 고정한다.
- 스키마를 바꿀 때는 expand → migrate → contract 순서를 따른다(`npm run check:migrations`).

## 확정된 결정

| 항목 | 기본안 |
|---|---|
| Nginx 이미지 1.31(mainline) ↔ 주석 "1.30 stable" | 주석의 의도대로 **1.30-alpine stable**로 되돌리고 digest를 고정한다(PR 1-2에 포함) |
| archiver → minimatch moderate 3건 | archiver 7로 내리지 않는다. `overrides.minimatch`가 readdir-glob과 호환되는지 시험하고, 호환되면 적용하고 아니면 상위 패치를 기다린다(PR 1-6) |
| `/api/health`에 worker 추가 | `components.worker`로 보고하고 전체 상태는 degraded로 한다. 다만 release의 `wait_healthy`가 worker 시작 전에 실패하지 않게 아래 PR 1-4의 순서를 지킨다 |

---

## Phase 1: 운영 안전성 (배포·CI·감시)

### PR 1-1 `fix(deploy): restart webdav with releases and rollbacks` — [#142](https://github.com/Ruthgyeul/RelayFiles/pull/142)
- **문제**: 릴리스와 롤백이 dav를 다시 시작하지 않아, 옛 코드가 새 스키마 위에서 계속 돈다.
- **대상 파일**: `deploy/scripts/release.sh:71`(`up -d --no-build app worker nginx`), `deploy/scripts/rollback.sh`, `deploy/scripts/systemd/release.sh:86`(`systemctl restart relayfiles-app relayfiles-worker`), `deploy/scripts/systemd/rollback.sh`
- **Compose**: dav 컨테이너가 있으면(`compose ps -q dav`) `--profile dav up -d --no-build dav`를 실행한다.
- **systemd**: `systemctl is-enabled --quiet relayfiles-dav`이면 restart 목록에 넣는다.
- **함께 처리**: `deploy/scripts/lib.sh`에 `dav_enabled` 헬퍼를 둔다.
- **검증**: shellcheck(CI `scripts` job). 개발 compose에서 `--profile dav`로 띄운 뒤 release를 dry run해서 dav가 재생성되는지 확인한다.

### PR 1-2 `fix(nginx): stream zip and tar downloads without temp files` — [#144](https://github.com/Ruthgyeul/RelayFiles/pull/144)
- **문제**: 컨테이너 Nginx만 `proxy_max_temp_file_size 0`이 없다. zip·tar 다운로드가 tmpfs(RAM)에 최대 1GB까지 쌓인다.
- **변경**: `deploy/nginx/templates/relayfiles-site.inc.template`의 `location /`에 `proxy_max_temp_file_size 0;`을 넣는다. host 템플릿 `deploy/nginx/host/relayfiles.conf.template:170`과 같게 만든다.
- **이중 안전장치**: 앱 응답에도 `x-accel-buffering: no`를 붙인다. 대상은 zip(`src/server/services/zip.service.ts`, `src/server/share/share-files.service.ts`의 zip 응답)과 tar(`src/server/services/account-export.service.ts`)이고, `src/server/http/sse.ts:96`과 같은 방식으로 붙인다.
- **함께 처리**: Nginx 이미지를 1.30 stable로 되돌리고 주석을 정리한다(`deploy/docker-compose.yml:216`, k3s 템플릿의 nginx 이미지, `check:ci-images` 대상 확인).
- **검증**: `deploy:error-pages`와 템플릿 render 테스트(`scripts/*.test.ts`), e2e `downloads.spec.ts`

### PR 1-3 `ci(images): publish only after ci passes on main` — [#146](https://github.com/Ruthgyeul/RelayFiles/pull/146)
- **문제**: main push 때 CI 결과와 상관없이 GHCR에 이미지를 올린다. 연속으로 merge하면 앞 커밋의 publish가 취소된다.
- **`.github/workflows/images.yml`**:
  - publish 경로를 `workflow_run`(workflows: CI, types: completed, `conclusion == 'success'`, branch main)과 tags push로 바꾼다.
  - `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`
- **`.github/workflows/ci.yml:13`**: concurrency를 같은 방식으로 바꾼다.
- **e2e job**: `if: failure()`일 때 `actions/upload-artifact`(SHA 고정)로 `playwright-report/`와 `test-results/`를 올린다.
- **검증**: actionlint(CI `scripts` job). 병합 후 main에서 CI → Images 순서로 실행되는지 확인한다.

### PR 1-4 `feat(status): report the worker in health and alert when it stops` — [#147](https://github.com/Ruthgyeul/RelayFiles/pull/147)
- **재사용**:
  - `workerAlive()`(`src/server/metrics/history.ts:64`, heartbeat 키 `jobs:heartbeat`)
  - `checkHealth`(`src/server/services/health.service.ts`)
  - Status 프로브(`src/server/jobs/health-probe.ts`)
  - 알림(`src/server/jobs/notify-queue.ts`)
- **변경 1**: `contracts/health.ts`의 `components`에 `worker?`를 추가한다. `checkHealth`는 `workerAlive()`로 채운다.
- **변경 2**: release가 실패하지 않게 한다. release는 app과 worker를 함께 재시작한 뒤 `wait_healthy`를 한다. 그러니 `health_ok`(`deploy/scripts/lib.sh:38`, `status_ok`)가 heartbeat 첫 기록(`METRICS_SAMPLE_INTERVAL_SEC`) 전에 실패하지 않도록, `status_ok`는 계속 전체 status를 보되 **worker가 down이어도 전체 status에는 반영하지 않는다**(degraded가 아니라 보고만 한다).
- **변경 3**: 전체 상태 판정은 Status 페이지와 알림에서만 쓴다.
- **변경 4**: compose와 k3s의 worker에 healthcheck·livenessProbe를 추가한다(`node -e`로 Redis heartbeat를 확인하는 스크립트 `scripts/worker-health.mts`).
- **알림의 한계**: worker가 멈추면 worker 자신은 알림을 못 보낸다. 그래서 **app 쪽 Status 프로브 경로**에서 이 상태를 감지해 webhook을 보낸다. 감지 위치는 `src/server/services/status.service.ts`와 maintenance 큐의 소비자 사이에서 확인한다.
- **검증**:
  - 단위 테스트(health 계약, overall 판정)
  - integration(heartbeat 키가 없으면 `components.worker`가 down)
  - e2e `status.spec.ts`

### PR 1-5 `fix(k3s): back up the database before migrations` — [#148](https://github.com/Ruthgyeul/RelayFiles/pull/148)
- **변경 1**: `deploy/scripts/k3s/deploy.sh`의 마이그레이션 Job 전에 `kubectl exec <postgres pod> -- pg_dump -Fc`로 백업한다.
- **변경 2**: compose의 `backup.sh`와 systemd의 `backup.sh`(pg_dump 한 줄만 다름)를 `DUMP_CMD` 분기 하나로 합친다. 저장 방식도 `.partial` → `mv`로 원자적으로 하고, k3s도 이것을 쓴다.
- **변경 3**: `docs/deploy-k3s.md:84`의 cron 한 줄을 스크립트 호출로 바꾼다.
- **검증**: shellcheck, `docs/runbook.md`의 복구 절차와 대조한다.

### PR 1-6 `fix(deploy): run systemd workers from the release bundle` — [#149](https://github.com/Ruthgyeul/RelayFiles/pull/149)
- **문제**: worker와 dav가 체크아웃에서 직접 돈다. `git pull`·`npm ci`가 실행 중인 코드와 `node_modules`를 바로 바꾼다.
- **변경 1**: `deploy/scripts/systemd/release.sh`가 `src`, `scripts`, `prisma`, `node_modules`, `package.json`을 `.app/<release>/tools`로 복사(가능하면 `cp -al` hardlink)한다.
- **변경 2**: `relayfiles-worker.service.template`과 `relayfiles-dav.service.template`의 `WorkingDirectory`와 `ExecStart`를 `.app/current/tools`로 바꾼다. 세 유닛에 `Environment=NODE_ENV=production`을 넣는다.
- **변경 3**: rollback이 worker도 되돌리게 한다(`rollback.sh:8`의 한계 해소).
- **함께 처리**: minimatch override 시험(위 결정).
- **검증**: shellcheck. 테스트 VM이나 N95에서 install → release → rollback을 한 번씩 돌려 본다(절차를 `docs/deploy-systemd.md`에 기록).

### PR 1-7 `fix(nginx): mask share link ids in access logs` — [#150](https://github.com/Ruthgyeul/RelayFiles/pull/150)
- **변경**: 두 템플릿(`deploy/nginx/templates/default.conf.template:92`, `deploy/nginx/host/relayfiles.conf.template:64`)에 `map $request_uri $relay_log_uri`를 둔다. `/d/<id>`, `/api/share/<id>`, `/r/<id>`의 id를 `•`로 바꾸고 `log_format`에서 `$request` 대신 쓴다.
- **함께 처리**: `docs/security.md`의 로그 절에 한 줄을 추가한다.

---

## Phase 2: 프론트 기반 정리 (기능 추가 비용 축소)

| PR | 내용 | 재사용·대상 |
|---|---|---|
| 2-1 `fix(ui): report clipboard failures` — [#151](https://github.com/Ruthgyeul/RelayFiles/pull/151) | `shared/lib/clipboard.ts` `copyText(): Promise<boolean>`(실패하면 선택 fallback, 실패 토스트). 16곳을 교체한다 | 예외 처리가 있는 유일한 곳인 `features/viewer/TextDocument.tsx:79`를 기준으로 삼는다. 대상 예: `files/useCopyLink.ts`, `account/ApiTokensCard.tsx` |
| 2-2 `refactor(ui): one error message helper` — [#152](https://github.com/Ruthgyeul/RelayFiles/pull/152) | `shared/lib/api-client.ts`에 `errorMessage(caught)`를 둔다. `errorText` 26벌을 교체하고 `ShellProvider.tsx:139`의 DOMException 노출을 막는다 | 기존 export `share/api.ts:51` |
| 2-3 `refactor(ui): useApiQuery and useMutation` — [#153](https://github.com/Ruthgyeul/RelayFiles/pull/153) | `shared/hooks/useApiQuery(key, fetcher)` → `{status,data,error,reload}`(AbortController). 손으로 쓴 effect 19곳을 차례로 바꾼다. 검색이 에러를 "결과 없음"으로 보이던 문제도 고친다 | `files/useTagSearch.ts`, `search/useGlobalSearch.ts`, debounce는 `SEARCH.debounceMs`로 통일 |
| 2-4 `fix(files): per-item parent visibility and drop targets` — [#154](https://github.com/Ruthgyeul/RelayFiles/pull/154) | `TaggedItem`에 effective visibility를 싣고 `useNodeActions`·Favorites가 항목별로 계산한다. `FileList`의 `onDropFiles`를 optional로 바꾼다. 모바일 `MediaViewer`에 `useDialogFocus`와 `onDownload`를 준다 | `shared/hooks/useDialogFocus.ts` |
| 2-5 `refactor(files): one action registry` — [#155](https://github.com/Ruthgyeul/RelayFiles/pull/155) | `{id,label,icon,group,danger,when(item,ctx),run}` 레지스트리 하나에서 `node-menu`, `favorite-menu`, `ToolbarActions`를 파생한다. `label === "Delete"` 판정을 없애고 Preview 규칙을 하나로 맞춘다 | `files/node-menu.ts`, `favorites/favorite-menu.ts` |
| 2-6 `refactor(files): shared list page` — [#156](https://github.com/Ruthgyeul/RelayFiles/pull/156) | `useListPage()`와 `<ListChrome>`로 `FileManager`와 `FavoritesPage`가 함께 쓰는 조립을 뽑는다. `useFileDialogs`는 keyed 조건부 마운트 + 대화상자별 훅으로 나눈다. `deleteText`·`labelOf`는 domain으로 옮긴다 | 목표 200줄 이하 |
| 2-7 `perf(ui): split hot contexts` — [#157](https://github.com/Ruthgyeul/RelayFiles/pull/157) | `TransfersProvider`를 actions와 state로, `ShellProvider`를 notice store와 `useAccountActions`로 나눈다 | 업로드 중 목록 재렌더 측정(React Profiler) 전후 비교 |
| 2-8 `refactor(ui): reuse primitives` — [#158](https://github.com/Ruthgyeul/RelayFiles/pull/158) | 손으로 짠 버튼을 Button·IconButton으로, `FilterChip`과 `useSelection`을 shared로, private `Tile`을 `StatTile`로, 원시 `var(--…)`를 `palette.ts` 상수로 바꾼다. `CLOCK_TICK_MS`·`SEEN_TICK_MS`는 policy로 옮긴다 | `shared/ui/Display.tsx`, `shared/styles/palette.ts` |
| 2-9 `refactor(app): page helpers and routes` — [#159](https://github.com/Ruthgyeul/RelayFiles/pull/159) | `requireActiveAccount()`(서버 페이지 9곳), `routes.shareUrl()`(`/d/${id}` 6곳), `FILES_SUBPAGES`(Toolbar 하드코딩)를 만든다. `publicUrl` prop drilling을 없애고 `useShell().config`를 쓴다 | `src/features/shell/nav.ts` |

---

## Phase 3: 서버 구조 정리 (동작 변화 없음)

| PR | 내용 |
|---|---|
| 3-1 `refactor(server): node dto module` — [#160](https://github.com/Ruthgyeul/RelayFiles/pull/160) | `toNodeItem`·`VISIBILITY`(9개 모듈이 import)를 `services/node-dto.ts`로 옮긴다. `visibilityFromDb/ToDb`와 `kindOf`를 하나로 만든다. `requireNode`·`requireFolder`는 `services/node-access.ts`로 옮긴다(`resolveFolder` 중복 제거). Owner 타입 4벌을 공용 export 하나로 합친다 |
| 3-2 `refactor(share): split share services` — [#161](https://github.com/Ruthgyeul/RelayFiles/pull/161) | `share.service.ts`를 `share-link` / `share-view` / `share-access` / `share-unlock`으로, `share-files.service.ts`의 zip 부분을 `share-zip.service.ts`로 나눈다. busy 수준에 `BUSY` 상수를 쓰고, 다운로드 소진 판정은 `downloadsUsedUp`(`domain/share-limits.ts`) 하나로 모은다 |
| 3-3 `refactor(repo): split node repo` — [#163](https://github.com/Ruthgyeul/RelayFiles/pull/163) | `node-backfill.repo.ts`와 `node-usage.repo.ts`를 만들고, keyset 페이지네이션을 `id > afterId` 한 방식으로 맞춘다. `tagUsage`의 `LIMIT 100`은 정책 값으로 옮긴다 |
| 3-4 `refactor(media): one media enqueue helper` — [#164](https://github.com/Ruthgyeul/RelayFiles/pull/164) | `MEDIA.processedKinds`와 `queueMediaFor(rows)`로 11곳을 교체한다. `kindFromMime(...).toUpperCase()` 캐스트를 제거한다 |
| 3-5 `refactor(storage): staging in the driver` — [#165](https://github.com/Ruthgyeul/RelayFiles/pull/165) | `StorageDriver`에 `stagingWrite`, `stagedSize`, `discardStaged`를 둔다. 서비스 5곳의 `layoutOf().uploads`·`fs` 직접 사용을 없애고, direct-upload와 import의 같은 흐름을 `placeStream()`과 `spaceOf(volume)`로 합친다 |
| 3-6 `refactor(jobs): job and probe registry` — [#166](https://github.com/Ruthgyeul/RelayFiles/pull/166) | `{id, every, run}` 등록표로 `scheduleMaintenance`와 `runProbe`를 합치고, media task 분기를 맵으로 바꾼다. `runScript`가 큐를 닫게 한다(`scripts/lib/bootstrap.mts`) |
| 3-7 `refactor(domain): shared helpers` — [#167](https://github.com/Ruthgyeul/RelayFiles/pull/167) | `utcDay` 5벌, `plural` 5벌(프론트 포함), `BYTES_PER_GB`(number와 bigint), `utf8Length` 2벌, `hashTree` → `sha256Of`를 정리한다. `contracts/shares.ts`는 `contracts/shared-items.ts`로 이름을 바꾼다 |
| 3-8 `refactor(deploy): single source for defaults` — [#168](https://github.com/Ruthgyeul/RelayFiles/pull/168) | `scripts/print-env-defaults.mjs`(zod 스키마의 기본값)를 만들어 `install.sh`와 k3s `deploy.sh`가 읽게 한다. host-only 키 목록은 `scripts/lib/host-only-env.mjs` 하나에서 읽는다. nginx 공통 location을 `locations.inc.template`로 뺀다. 이 값들이 같은지 보는 parity 테스트를 `scripts/*.test.ts`에 둔다 |

---

## Phase 4: 성능 (측정 → 수정 → 고정)

| PR | 내용 | 측정·고정 |
|---|---|---|
| 4-1 `perf(photos): index the timeline order` — [#170](https://github.com/Ruthgyeul/RelayFiles/pull/170) | `("accountId", COALESCE(takenAt,modifiedAt,createdAt) DESC, id DESC) WHERE type='FILE' AND kind IN ('IMAGE','VIDEO')` 식 인덱스(raw SQL 마이그레이션). 먼저 CI `prisma migrate diff --exit-code`가 이 인덱스를 차이로 보는지 확인한다 | `EXPLAIN` 전후 비교 |
| 4-2 `perf(upload): check duplicates for batch paths only` — [#171](https://github.com/Ruthgyeul/RelayFiles/pull/171) | `prepareUpload`의 `relativePaths` 전체 트리 읽기 대신 배치 경로 배열을 CTE로 거른다 | `tree-queries.int.test.ts` 방식의 쿼리 수 검사 |
| 4-3 `perf(files): batch tag and visibility updates` — [#172](https://github.com/Ruthgyeul/RelayFiles/pull/172) | `updateTags`를 `unnest` UPDATE로, `inheritVisibilityBelow`를 재귀 CTE UPDATE로 바꾼다 | 쿼리 수 검사 |
| 4-4 `perf(ui): lighter lists` — [#173](https://github.com/Ruthgyeul/RelayFiles/pull/173) | `reactCompiler`를 켜거나 `memo(NodeRow/NodeCard)`와 고정 콜백을 쓴다. 썸네일 없는 영상은 IntersectionObserver로 화면에 들어온 뒤 마운트한다 | `large-folder.spec.ts`, `check:bundle` |
| 4-5 `perf(health): index health sample cleanup` — [#169](https://github.com/Ruthgyeul/RelayFiles/pull/169) | `HealthSample`에 `[at]` 인덱스를 추가한다 | 마이그레이션 검사 |

---

## Phase 5: 신규 기능

| 순서 | 기능 | 전제 | 핵심 설계 |
|---|---|---|---|
| 5-1 — [#174](https://github.com/Ruthgyeul/RelayFiles/pull/174) | 휴지통 일괄 작업 + Undo 토스트 | 2-3 | `RecentlyDeletedPage`에 다중 선택, 모두 복원, 비우기를 넣는다. `NoticePill`에 action을 추가하고, 삭제 후 Undo는 복원 API를 재사용한다 |
| 5-4 — [#177](https://github.com/Ruthgyeul/RelayFiles/pull/177) | 공유 페이지 탐색 | 2-6 | `/d/…`에 정렬, 검색, 그리드 전환을 넣는다. FileList와 `sortNodes`를 재사용한다 |
| 5-5 — [#178](https://github.com/Ruthgyeul/RelayFiles/pull/178), [#179](https://github.com/Ruthgyeul/RelayFiles/pull/179) | 파일 목록 키보드 탐색 | 2-5, 4-4 | 방향키, Enter, Space, Home/End. 단축키 시스템(`features/shortcuts`)을 쓴다. 이름 영역을 `<button>`으로 바꾼다 |
| 5-6 — 진행 안 함(사용자 결정) | 관리자 패스키(WebAuthn) | — | 관리자 계정에 두 번째 로그인 수단을 둔다. 스키마는 expand로 시작한다 |
| 5-7 — 진행 안 함(사용자 결정) | S3 호환 오프사이트 드라이버 | 3-5 | 예약된 `StorageDriver.S3`를 쓴다. 우선 백업과 콜드 데이터용 |
| 5-8 — [#180](https://github.com/Ruthgyeul/RelayFiles/pull/180) | HEIC 사진 썸네일·미리보기 | 3-4 | 아래 상세 |
| 5-9 — [#181](https://github.com/Ruthgyeul/RelayFiles/pull/181), [#182](https://github.com/Ruthgyeul/RelayFiles/pull/182) | 컬렉션 공유 링크 | 3-1, 3-2 | 아래 상세 |
| 5-10 — [#175](https://github.com/Ruthgyeul/RelayFiles/pull/175), [#176](https://github.com/Ruthgyeul/RelayFiles/pull/176) | 저장된 검색 · 폴더 자동 정리 규칙 | 2-3, 3-6 | 아래 상세 |

진행한 순서: 5-8(소) → 5-1 → 5-10 → 5-4 → 5-9 → 5-5. 5-6·5-7은 진행하지 않았다(사용자 결정). 5-8은 전제 3-4가 끝나기 전에 해도 되고, 그때는 3-4에서 함께 옮긴다.

### 5-8 `feat(media): thumbnails and previews for heic photos`
- **현재 상태**: `src/domain/upload.ts:60`이 `heic`의 MIME만 인식한다. `MEDIA.previewTypes`(`src/config/policy/media.ts:19`)에 HEIC가 없어서 썸네일·미리보기가 없고, Chrome·Firefox에서는 원본도 보이지 않는다.
- **디코딩**: worker에서 ffmpeg(이미지에 7.1. tile grid HEIF 지원)로 첫 이미지를 PNG 버퍼로 풀고, 기존 `imageThumbnail(buffer)`·`imagePreview`(`src/server/media/thumbnail.ts:12`, Buffer 입력을 이미 받는다)에 넘긴다. ffmpeg 호출은 `videoFrame`처럼 `ffmpeg-input.ts`와 `process/run-command.ts`를 쓴다.
- **뷰어**: HEIC는 크기와 상관없이 항상 WebP 미리보기를 보여 준다. 원본은 Download로만 받는다.
- **공유 링크**: 지금은 `strippedCopy`(`src/server/media/process.ts:34`)가 모르는 형식이면 null을 돌려주고, 그러면 공개 페이지가 원본을 내보내지 않는다(안전). HEIC는 메타데이터 없는 JPEG 사본을 만들어 공개 미리보기와 다운로드 사본으로 쓴다(mode `all`). 촬영일은 `domain/image-metadata.ts`가 HEIC EXIF를 읽을 수 있는지 확인하고, 못 읽으면 ffprobe로 읽는다.
- **기존 파일**: 이미 올라간 HEIC는 `npm run media:backfill`과 `-- --previews`로 다시 처리한다.
- **systemd 배포**: 호스트 ffmpeg 버전이 7.1 이상인지 `docs/deploy-systemd.md`에 적는다. 낮으면 HEIC 처리를 건너뛰고 Server 페이지에 표시한다.
- **검증**:
  - 작은 HEIC fixture(수 KB, tile grid 포함)를 `test/file-fixtures.ts`에 둔다.
  - integration: 썸네일·미리보기·공유 사본이 생성되는지, EXIF GPS가 없는지 확인한다.
  - e2e: `media.spec.ts`·`photos.spec.ts`에 HEIC 행을 추가한다.

### 5-9 `feat(share): share several items as one collection link`
- **스키마(expand)**:
  - `ShareCollection { id, accountId, linkId @unique, name, note, 공유 설정(visibility 대신 항상 공개, password, expiry, downloadLimit, burn, access, dailyCapGb, dlPaused), createdAt }`
  - `ShareCollectionItem { collectionId, nodeId, position, @@id([collectionId, nodeId]) }`
  - 노드가 영구 삭제되면 해당 항목만 cascade로 빠지고, 휴지통에 있는 항목은 숨긴다.
- **링크 id**:
  - 생성기는 `domain/ids.ts`를 그대로 쓴다.
  - 만들 때 Node와 ShareCollection 두 테이블에서 충돌 여부를 확인한다.
  - `/d/<linkId>`는 Node를 먼저 찾고, 없으면 컬렉션을 찾는다.
  - 기존 `linkId`는 절대 바뀌지 않는다(CLAUDE.md 규칙).
- **로직 재사용**: 3-2에서 나눈 `share-access`·`share-view`·`share-zip`에 "공유 대상 = 노드 목록" 추상화를 넣어 단일 노드와 컬렉션이 함께 쓴다. 다음 기능을 그대로 쓴다.
  - 공유 설정 가드(`domain/share.ts`, `domain/share-limits.ts`)
  - 트래픽 상한(`share/traffic-cap.ts`)
  - busy
  - 메타데이터 제거본
  - "Download all" zip
  - 링크 활동(`share/events.ts`)
- **폴더 항목**: 기존 폴더 공유처럼 안으로 들어가 탐색한다. 폴더 자체의 공유 설정은 컬렉션 설정이 대신한다(더 엄격한 쪽을 쓰는 규칙은 `StrictestGuard`를 재사용).
- **UI**:
  - File Manager·Favorites 선택 툴바에 "Share as collection"(2-5의 액션 레지스트리에 등록)
  - Photos 타임라인에 다중 선택과 같은 액션
  - Shared by me에 컬렉션 목록, 설정, 항목 편집
- **API**: v1 `POST /api/v1/collections`. `npm run openapi`로 갱신하고, CLI 명령은 나중에 추가한다.
- **보안 검증**:
  - 다른 계정의 nodeId를 넣으면 404
  - 휴지통 항목은 보이지 않음
  - 비밀번호 추측 예산 공유
  - 위 내용을 integration 테스트(`src/app/api/share/*.int.test.ts` 방식)로 확인한다.

### 5-10 `feat(files): saved searches and folder auto-clean rules`
- **저장된 검색**:
  - 모델은 `SavedSearch { id, accountId, name, query Json, position }`이다. query는 zod 계약(`contracts/`)으로 검증하고, 내용은 태그, 이름 텍스트, 종류 필터(`FILTER_KEYS`), 수정일 범위다.
  - `domain/search.ts`의 `parseSearchQuery`에 종류·기간 조건을 추가하고 테스트한다. 실행은 기존 검색 서비스와 리포지토리를 넓혀서 한다.
  - Files 툴바와 전역 검색(`GlobalSearchDialog`)에서 저장하고 연다.
- **폴더 자동 정리 규칙**:
  - 모델은 `FolderRule { folderId @id, olderThanDays, basis: CREATED | MODIFIED }`이다.
  - root와 Favorites에는 걸 수 없다.
  - maintenance의 daily cleanup(`src/server/jobs/maintenance.ts`의 `runCleanup` 뒤)에서 규칙마다 커서 배치로 오래된 파일을 **휴지통으로 옮긴다**(되돌릴 수 있게, `deleteItems` 재사용).
  - 한 번에 처리할 상한은 `config/policy`에 둔다. 결과는 `recordCleanup`과 보안 로그에 남긴다.
  - Folder settings 대화상자에 "Auto clean" 절을 추가한다. 저장 전에 "지금 기준 N개가 옮겨진다"는 미리보기를 domain 순수 함수와 count 쿼리로 보여 주고, 폴더 헤더에 배지를 단다.
- **검증**:
  - 단위 테스트: 규칙 판정, 미리보기
  - integration: cleanup이 규칙대로 휴지통으로 옮기는지, 다른 계정에 영향이 없는지, 상한을 넘으면 다음 날 이어지는지
  - e2e: 설정 대화상자

---

## 상시 정리 · 후속 작업 (2026-11-25)

Phase 1–5가 끝난 뒤 남은 정리를 PR 다섯 개로 나눠 진행한다. 5-2·5-3·5-6·5-7은 진행하지 않는다(사용자 결정).

| PR | 내용 | 상태 |
|---|---|---|
| A `chore(repo): standing cleanup and roadmap status` | `docs/upgrade/` 파일 이름을 규칙(`v<버전>.md`)에 맞춘다. `docs/runbook.md` cron 예시의 개인 경로를 `<checkout>`으로 바꾼다. `.gitignore`의 안 쓰는 항목(`.vercel`, `/.pnp`, `/deploy/backups/`)을 지운다. `BACKUP_KEEP`·`IMAGE_KEEP`·`BUNDLE_KEEP`를 `.env`에서 읽는다(`env_value`, deploy 스키마). 로컬 `npm run check`에 `check:cli`를 넣고, 이모지 검사에 `cli/src`를 넣는다 | 이 PR |
| F `feat(files): all files view` | root의 Favorites 아래에 "All Files" 가상 폴더를 둔다. 하위 폴더까지 모든 파일을 폴더 없이 한 목록으로 보여 주고, 서버에서 정렬·종류·검색·태그로 거른 keyset 페이지와 Load more를 쓴다 | 예정 (사용자 추가 요청, A 다음) |
| B `test(e2e): wider accessibility checks and shared fixtures` | a11y 검사에 `/files/favorites`, `/files/deleted`, `/r/[id]`를 추가한다. 1×1 PNG 상수를 `e2e/helpers.ts`로 모은다. `waitForTimeout`을 없앤다 | 예정 |
| C `fix(files): recheck auto clean rules under the lock` | 자동 정리가 잠금을 잡은 뒤 폴더와 날짜 조건을 다시 확인한다. 고른 뒤 옮겨지거나 날짜가 바뀐 파일은 남긴다 | 예정 |
| D `perf(files): memoize list rows` | `NodeRow`·`NodeCard`를 `memo`로 감싸고 고정 핸들러를 넘긴다. 선택을 바꿔도 다른 행은 다시 렌더하지 않는다 | 예정 |
| E `test(nginx): keep shared locations of both templates in step` | 컨테이너와 호스트 Nginx 템플릿의 공통 location을 parity 테스트로 맞춘다(3-8에서 남은 부분) | 예정 |
| — | Prisma 이름 정리(`expAt` → `@map`) | 보류: 운영 DB 컬럼 이름을 바꾸는 파괴적 마이그레이션이 필요하다. 예정된 contract는 `docs/upgrade/README.md` 표에서 관리한다 |

## 검증 (계획 전체)

- PR마다 `npm run check`, 해당 시 `npm run test:integration`, CI 전체(e2e 360/768/1280, docker, arm64)를 통과해야 한다.
- Phase 1이 끝나면 N95에서 운영 리허설을 한다:
  - compose `release.sh` → `rollback.sh`
  - systemd install → release → rollback
  - worker를 멈췄을 때 Status 표시와 webhook 알림 확인
  - zip 1GB 다운로드 중 nginx 메모리 확인
- Phase 2·3은 리팩터링 전후 e2e와 쿼리 수 검사가 같아야 한다. 커버리지 임계값(`vitest.config.mts` thresholds)이 떨어지면 안 된다.
- Phase 4는 항목마다 전후 수치(쿼리 수, EXPLAIN, 렌더 횟수)를 PR 본문에 남긴다.
