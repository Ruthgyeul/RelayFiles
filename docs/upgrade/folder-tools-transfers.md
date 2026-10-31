# 업데이트 가이드 — 순번 정리 · 중복 찾기 · 파일별 전송 진행률

이미 운영 중인 서버(이전 버전, `deploy/scripts/release.sh` 한 번으로 업데이트하던 환경)에 이번 버전을 올리는 절차다. **결론부터: 지금까지와 똑같이 `git pull` 후 `release.sh`를 한 번 실행하면 끝난다.** `.env`, Nginx, SSD 구조는 손대지 않는다. DB 컬럼 추가와 기존 파일 데이터 채우기는 `release.sh`가 자동으로 한다.

아래는 그 한 번의 실행 안에서 무슨 일이 일어나는지, 실행 전후에 무엇을 확인하면 되는지, 문제가 생기면 어떻게 하는지를 순서대로 적은 것이다. Docker Compose 배포 기준이고, systemd·k3s 배포는 [§8](#8-systemd--k3s-배포인-경우)을 본다.

---

## 0. 이번 버전에서 바뀌는 것

| 대상 | 변경 | 자동 처리 | 직접 할 일 |
|---|---|---|---|
| DB 스키마 | `Node.modifiedAt` 컬럼 추가 (`20261031120000_node_modified_at`, NULL 허용 컬럼 추가만) | `release.sh` → `npm run db:deploy` | 없음 |
| DB 데이터 | 기존 파일의 수정 시각 채우기, SHA-256 없는 파일 해시 (`20261101-backfill-modified-at`, `20261101-backfill-sha256`) | `release.sh` → `npm run data:migrate` | 없음 |
| SSD 디렉터리 구조 | 변경 없음 (`layoutVersion` 그대로) | `storage:migrate`는 할 일 없이 끝남 | 없음 |
| Redis | 변경 없음 (새 키 없음, `REDIS_KEY_PREFIX` 그대로) | — | 없음 |
| `.env` | 변경 없음 (새 키 없음) | — | 없음 |
| Nginx 설정 | 변경 없음 | — | 없음 |
| 앱·워커 이미지 | 새 코드로 다시 빌드 | `release.sh` → `docker compose build` | 없음 |
| 브라우저 | 새 화면(JS) | 페이지를 새로 열 때 받음 | 열어 둔 탭은 새로고침 |

- 컬럼은 **추가만** 하므로 이전 버전 앱도 새 스키마에서 그대로 동작한다. 그래서 문제가 생기면 DB를 건드리지 않고 이전 이미지로 바로 되돌릴 수 있다([§7](#7-롤백-이전-버전으로-되돌리기)).
- 공유 링크(`/d/<linkId>`), 계정 토큰, 태그, 공유 설정은 어떤 단계에서도 바뀌지 않는다.

### 새로 생기는 기능

1. **Renumber files**: 폴더 메뉴(⋮)에서 폴더 바로 아래 파일 이름을 `01, 02, 03…`(확장자 유지)으로 일괄 변경. 정렬은 이름 / 생성일 / 수정일, 오름·내림차순. 바꾸기 전에 새 이름을 미리 보여 준다.
2. **Find duplicates**: 폴더(선택하면 하위 폴더까지)에서 이름이 아닌 **내용(SHA-256)** 이 같은 파일 묶음을 보여 주고, 골라서 지운다.
3. **전송 패널 파일별 목록**: 2개 이상 업로드·다운로드 카드의 ▾(Show files)를 누르면 파일마다 진행 막대, 속도 그래프, 개별 취소 버튼.
4. **폴더로 저장하는 다운로드**: 여러 항목을 선택하고 Download를 누르면 Chrome·Edge에서는 저장할 폴더를 고르고, 파일별 진행률·취소가 된다.

---

## 1. 실행 전 점검 (약 5분)

서버에 SSH로 접속해 저장소 폴더로 이동한다. 아래 명령은 모두 **저장소 루트**에서 실행한다.

```bash
ssh ruthgyeul@192.168.0.100
cd ~/RelayFiles        # 실제 clone 위치
C="docker compose --env-file .env -f deploy/docker-compose.yml"
[ -f deploy/docker-compose.volumes.yml ] && C="$C -f deploy/docker-compose.volumes.yml"
```

### 1-1. 지금 버전 기록 (되돌릴 때 필요)

```bash
git log --oneline -1
tail -3 /srv/relayfiles/releases.log     # DATA_DIR이 다르면 그 경로
```

마지막 줄의 태그(예: `4726a90`)를 메모해 둔다. 롤백할 때 이 값을 쓴다.

### 1-2. 작업 트리가 깨끗한지

```bash
git status --short
```

아무것도 안 나와야 한다. 서버에서 직접 고친 파일이 있으면 `git stash`로 치우거나 커밋한 뒤 진행한다(`.env`는 git이 무시하므로 상관없다).

### 1-3. 디스크 여유

```bash
df -h /srv/relayfiles /mnt/relayfilesDB
docker system df
```

- 이미지 빌드에 수 GB가 필요하다. 시스템 디스크가 부족하면 먼저 `deploy/scripts/autoclean.sh`를 실행한다.
- `release.sh`는 시작하자마자 DB 백업을 만든다. `DATA_DIR/backups`에 백업 하나 크기만큼 여유가 있어야 한다.

### 1-4. SSD(볼륨)가 붙어 있는지

```bash
$C run --rm tools npm run volume:list
```

모든 볼륨이 `ACTIVE`인지 본다. 데이터 백필은 디스크의 파일을 읽으므로, `OFFLINE` 볼륨의 파일은 건너뛴다(그 파일들은 생성일로 대신 정렬된다. [§6-3](#6-3-볼륨이-빠진-채로-업데이트했을-때)).

### 1-5. 큰 업로드가 진행 중인지

릴리스 중에는 점검 모드(503 안내 페이지)가 수십 초~수 분 켜진다. 진행 중이던 업로드는 끊겼다가 점검 모드가 풀리면 브라우저가 이어서 올린다(tus 재개). 수십 GB를 올리는 중이라면 끝난 뒤에 실행하는 편이 낫다.

---

## 2. 새 코드 받기

```bash
git pull origin main
git log --oneline -3
```

맨 위에 이번 PR의 merge 커밋(`Merge pull request … admiring-wozniak …`)이 보이면 된다.

---

## 3. 릴리스 실행 (이것 하나)

```bash
deploy/scripts/release.sh
```

스크립트가 아래 순서로 진행한다. 화면에 나오는 줄과 그때 일어나는 일을 짝지어 두었다.

| 순서 | 화면에 나오는 줄 | 하는 일 | 이번 버전에서 특별한 점 |
|---|---|---|---|
| 1 | `Release <커밋>` | PostgreSQL·Redis 컨테이너가 떠 있는지 확인 | — |
| 2 | `Backup` | DB 덤프(`backup.sh`) | 실패하면 여기서 멈추고 아무것도 바뀌지 않는다 |
| 3 | `Build images` | `app`·`worker`·`tools` 이미지 빌드 (수 분) | 빌드 중에도 기존 앱은 계속 서비스 |
| 4 | (점검 모드 켜짐) | 방문자에게 503 안내 페이지 | — |
| 5 | `Migrations (schema, data, storage layout)` | ① `db:deploy` | `Applying migration 20261031120000_node_modified_at` → 컬럼 추가 (즉시 끝남) |
| | | ② `data:migrate` | `20261101-backfill-modified-at: …`, `20261101-backfill-sha256: …`, 마지막에 `Data migrations: 2 ran, 0 already done.` |
| | | ③ `storage:migrate` | 구조 변경 없음 → 바로 끝남 |
| 6 | `Restart app, worker and nginx` | 새 이미지로 교체 | — |
| 7 | `Health check` | `/api/health`가 `ok`일 때까지 대기 | — |
| 8 | `Release <커밋> is live.` | 점검 모드 해제, 태그 `:latest`, 릴리스 기록 | — |
| 9 | (autoclean) | 오래된 이미지·빌드 캐시 정리 | — |

### 데이터 백필에 걸리는 시간

- **수정 시각 채우기**: 파일마다 DB 조회 한 번과 디스크 `stat` 한 번. 파일 1만 개에 수 초, 10만 개에 1분 안팎이다(N95 + USB SSD 기준 추정).
- **SHA-256 채우기**: 해시가 없는 파일만 읽는다. RelayFiles는 처음부터 업로드할 때 해시를 기록했으므로 **대부분 0개라 즉시 끝난다.** 예전에 DB에 직접 넣은 파일이 있다면 그 크기만큼 읽는다.
- 두 작업 모두 1,000개마다 진행 위치(커서)를 저장한다. 중간에 끊겨도 다음 실행이 그 자리부터 이어 가고, 끝난 작업은 다시 실행하지 않는다.

---

## 4. 적용 확인

### 4-1. 서버 상태

```bash
curl -s http://127.0.0.1/api/health | head -c 300; echo
$C ps
```

`"status":"ok"`와 `app`·`worker`·`nginx`가 `running (healthy)`이면 된다.

### 4-2. DB

```bash
$C run --rm tools npx prisma migrate status
$C exec postgres psql -U relayfiles -c 'SELECT id, "finishedAt" FROM "DataMigration" ORDER BY "startedAt";'
$C exec postgres psql -U relayfiles -c $'SELECT count(*) FILTER (WHERE "modifiedAt" IS NULL) AS no_mtime, count(*) FILTER (WHERE sha256 IS NULL) AS no_hash FROM "Node" WHERE type = \'FILE\';'
```

- `migrate status`: `Database schema is up to date!`
- `DataMigration`: 두 줄 모두 `finishedAt`에 시각이 있다.
- 마지막 쿼리: 보통 `no_mtime = 0`, `no_hash = 0`. 0이 아니면 그 파일은 OFFLINE 볼륨에 있거나 디스크에서 없어진 파일이다 → `$C run --rm tools npm run storage:fsck`로 확인([runbook "DB와 디스크 대조"](../runbook.md#db와-디스크-대조-storagefsck)).

`POSTGRES_USER`를 바꿨다면 `-U` 값을 맞춘다.

### 4-3. 화면

1. 열어 둔 RelayFiles 탭은 **새로고침**한다(Ctrl+Shift+R / ⌘+Shift+R). 옛 탭도 계속 동작하지만 새 메뉴는 새로고침 뒤에 보인다.
2. 아무 폴더에서 제목 옆 ⋮(Folder menu) → **Renumber files**, **Find duplicates**가 보인다.
3. 파일 2개 이상을 올리면 전송 카드 오른쪽에 ▾(Show files) 버튼이 생기고, 누르면 파일별 진행 막대가 보인다.

---

## 5. 새 기능 사용법과 주의점

### Renumber files

1. 폴더 ⋮ → **Renumber files**.
2. **Order by**: Name / Date created / Date modified, **Direction**: A → Z(Oldest first) / Z → A(Newest first).
3. 목록에서 `원래 이름 → 01.jpg`를 확인하고 **Renumber N files**.

- 대상은 그 폴더 **바로 아래 파일만**이다. 하위 폴더, 점(`.`)으로 시작하는 숨김 파일은 이름을 바꾸지 않는다.
- 번호는 최소 2자리(`01`). 파일이 100개 이상이면 `001`, 1,000개 이상이면 `0001`처럼 자릿수가 늘어난다(정렬이 깨지지 않게).
- 확장자는 원래 표기 그대로다(`IMG.JPG` → `01.JPG`).
- 공유 링크, 태그, 공유 설정, 썸네일은 그대로 유지된다(이름만 바뀐다).
- 미리 본 뒤에 다른 사람이 파일을 올리거나 바꾸면 "This folder changed. Review the new order."가 나오고 아무것도 바뀌지 않는다. 새 목록을 확인하고 다시 누르면 된다.
- 중간에 실패해도 모든 파일이 원래 이름으로 돌아간다. 하지만 **성공한 뒤 원래 이름으로 되돌리는 기능은 없다.** 바꾸기 전에 목록을 확인한다.
- "Date modified"는 파일 자체의 수정 시각이다. 이번 버전부터 올리는 파일은 원본 파일의 수정 시각(브라우저가 알려 주는 값)이 저장된다. 그 전에 올린 파일은 SSD에 저장된 시각(대개 업로드 시각)으로 채워졌다.
- 한 번에 2,000개까지.

### Find duplicates

1. 폴더 ⋮ → **Find duplicates**. 하위 폴더까지 보려면 **Include subfolders**.
2. 묶음마다 가장 오래된 파일은 남기고 나머지가 선택된 상태로 열린다. 눈 아이콘으로 해당 파일 위치를 열 수 있다.
3. **Delete selected** → 확인.

- 묶음의 모든 사본을 선택하면 삭제 버튼이 꺼진다(내용을 통째로 잃지 않게).
- 같은 내용을 다시 올린 파일은 이미 SSD에서 바이트를 공유(하드 링크)하고 있을 수 있다. 이때 지우면 계정 사용량은 줄지만 SSD 공간은 마지막 사본을 지울 때 돌아온다.

### 전송 패널 파일별 진행률·취소

- 2개 이상인 업로드·다운로드 카드의 ▾를 누르면 파일마다 진행 막대, `12 MB of 40 MB · 5.2 MB/s`, 속도 그래프, X(취소) 버튼이 보인다.
- 올라가는 중인 파일을 취소하면 서버가 그 파일의 조각과 예약 공간을 바로 지운다. 대기 중인 파일은 건너뛴다. 나머지 파일은 계속 올라간다.
- 파일 하나가 실패해도 나머지는 계속 올라가고, 끝나면 `N of M files failed`로 표시된다.

### 폴더로 저장하는 다운로드

- 여러 항목을 선택 → 툴바 **Download** → (Chrome·Edge) 저장할 폴더 선택 → 브라우저의 "파일 수정 허용" 질문에 허용.
- 같은 이름의 파일이 이미 있으면 덮어쓰지 않고 `이름 (2).확장자`로 저장한다. 폴더는 `폴더이름.zip`으로 저장된다.
- 이 기능은 **https 주소나 localhost**에서만 동작한다(브라우저 보안 정책). `http://192.168.0.100`처럼 LAN IP를 http로 열면, Safari·Firefox처럼 예전 방식(브라우저 다운로드)으로 받는다.

---

## 6. 문제가 생겼을 때

### 6-1. `release.sh`가 중간에 멈췄을 때

| 멈춘 단계 | 상태 | 할 일 |
|---|---|---|
| Backup | 아무것도 바뀌지 않음 | 백업 경로 권한·디스크 여유 확인 후 다시 `release.sh` |
| Build images | 기존 앱이 그대로 돈다 | 빌드 로그 확인. 디스크 부족이면 `deploy/scripts/autoclean.sh` 후 다시 |
| Migrations | 스크립트가 끝나며 점검 모드가 풀리고 **기존 앱이 그대로 돈다** | 아래 6-2 |
| Health check | 새 컨테이너가 떴지만 `ok`가 아님 | `$C logs --tail 200 app worker`로 원인 확인, 급하면 [§7](#7-롤백-이전-버전으로-되돌리기) |

### 6-2. 마이그레이션에서 실패했을 때

```bash
$C run --rm tools npx prisma migrate status
$C run --rm tools npm run data:migrate
```

- 스키마(`db:deploy`)는 컬럼 하나 추가라 실패할 일이 거의 없다. 실패로 표시됐다면 원인을 고친 뒤 `npx prisma migrate resolve --rolled-back 20261031120000_node_modified_at`로 정리하고 `release.sh`를 다시 실행한다.
- 데이터 백필(`data:migrate`)이 실패하면 오류 메시지에 원인이 나온다(대개 SSD 권한·읽기 오류). 원인을 고친 뒤 **그냥 `release.sh`를 다시 실행**하면 저장된 위치부터 이어서 한다. 위 명령처럼 백필만 따로 실행해도 된다.
- 백필이 끝나지 않아도 이전 앱은 정상 동작한다(새 컬럼을 쓰지 않으므로).

### 6-3. 볼륨이 빠진 채로 업데이트했을 때

OFFLINE 볼륨의 파일은 백필에서 건너뛰고 로그에 `modification times not recorded: volume offline`이 남는다. 이 파일들은 "Date modified" 정렬에서 생성일을 대신 쓰고, 중복 찾기에서는 원래 해시로 정상 비교된다. 백필은 한 번 끝나면 다시 돌지 않으므로, 정확한 수정 시각이 꼭 필요하면 볼륨을 다시 붙인 뒤 해당 행만 지우고 다시 실행한다.

```bash
$C exec postgres psql -U relayfiles -c $'DELETE FROM "DataMigration" WHERE id = \'20261101-backfill-modified-at\';'
$C run --rm tools npm run data:migrate
```

(이미 값이 있는 파일은 건드리지 않으므로 다시 실행해도 안전하다.)

### 6-4. 새 메뉴가 안 보일 때

- 브라우저 새로고침(Ctrl+Shift+R).
- `git log --oneline -1`이 이번 커밋인지, `tail -1 /srv/relayfiles/releases.log`가 그 커밋 태그인지 확인.

---

## 7. 롤백 (이전 버전으로 되돌리기)

```bash
tail -5 /srv/relayfiles/releases.log                 # 1-1에서 메모한 이전 태그 확인
RELEASE_TAG=<이전 태그> $C up -d --no-build app worker
```

- DB는 그대로 둔다. 추가된 `modifiedAt` 컬럼은 이전 버전이 무시하므로 문제없다.
- 롤백한 동안 이전 버전으로 올린 파일은 `modifiedAt`이 비어 있게 된다. 다시 이번 버전으로 올리면 그 파일들은 "Date modified" 정렬에서 생성일(= 업로드 시각)을 쓴다. 정확히 맞추고 싶으면 6-3의 두 명령을 실행한다.
- 다시 올릴 때는 평소처럼 `git pull && deploy/scripts/release.sh`.

---

## 8. systemd / k3s 배포인 경우

### systemd (`docs/deploy-systemd.md`)

```bash
git pull origin main
deploy/scripts/systemd/release.sh
```

같은 순서(백업 → 빌드 → 점검 모드 → `db:deploy` → `data:migrate` → `storage:migrate` → 재시작 → 헬스 체크)로 자동 처리된다. 확인 명령은 `$C run --rm tools npm run <명령>` 대신 `deploy/scripts/systemd/rf.sh <명령>`을 쓴다.

```bash
deploy/scripts/systemd/rf.sh data:migrate      # 백필만 다시 실행할 때
```

### k3s (`docs/deploy-k3s.md`)

1. `main`에 merge되면 GitHub Actions(`images.yml`)가 `sha-<12자리>` 태그로 멀티 아키텍처 이미지를 GHCR에 올린다. Actions가 끝날 때까지 기다린다.
2. 클러스터에 접근할 수 있는 체크아웃에서:

```bash
git pull origin main
deploy/scripts/k3s/deploy.sh
```

마이그레이션 Job(`relayfiles-migrate-<릴리스>`)이 `db:deploy && data:migrate && storage:migrate`를 실행한 뒤 앱·워커·Nginx를 교체한다. 롤백은 같은 명령에 이전 태그를 준다(`deploy/scripts/k3s/deploy.sh sha-<이전>`).

---

## 요약 체크리스트

```
[ ] 1-1 현재 태그 메모 (tail -3 releases.log)
[ ] 1-2 git status 깨끗함
[ ] 1-3 디스크 여유 확인
[ ] 1-4 볼륨 ACTIVE 확인 (volume:list)
[ ] 2   git pull origin main
[ ] 3   deploy/scripts/release.sh  →  "Release … is live."
[ ] 4-1 /api/health ok
[ ] 4-2 migrate status up to date, DataMigration 2줄 finishedAt
[ ] 4-3 브라우저 새로고침 → 폴더 ⋮에 Renumber files / Find duplicates
```
