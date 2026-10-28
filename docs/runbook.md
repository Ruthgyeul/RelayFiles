# 운영 절차 (runbook)

배포 방법은 [deploy-ubuntu.md](deploy-ubuntu.md)(Docker Compose) 또는 [deploy-systemd.md](deploy-systemd.md)(systemd). 아래 명령은 저장소 루트에서 실행하며 Docker 기준이다. systemd 배포에서는 `$C run --rm tools npm run <명령>` 대신 `deploy/scripts/systemd/rf.sh <명령>`, `$C restart app worker` 대신 `sudo systemctl restart relayfiles-app relayfiles-worker`를 쓴다(백업·롤백은 [deploy-systemd.md §8–9](deploy-systemd.md#8-운영-명령)).

```bash
C="docker compose --env-file .env -f deploy/docker-compose.yml"
# SSD를 더 붙였다면(아래 "볼륨 추가·교체") 오버레이도 함께 쓴다. deploy/scripts/*.sh는 자동으로 붙인다
[ -f deploy/docker-compose.volumes.yml ] && C="$C -f deploy/docker-compose.volumes.yml"
```

## 상태 확인

```bash
$C ps                                  # 서비스 상태 (app은 healthy여야 한다)
curl -fsS http://127.0.0.1:${NGINX_LISTEN_PORT:-80}/api/health
$C logs -f --tail 100 app worker nginx
sudo tail -f /var/log/relayfiles/app-error.log      # 워커: worker-error.log, npm 스크립트: tools-error.log
```

앱 로그(`LOG_DIR`)와 Nginx 접근 로그에는 토큰, 비밀번호, 클라이언트 IP가 남지 않는다. Nginx 에러 로그(`client: …`)에는 주소가 남으므로 공유하지 않는다. 문제를 찾을 때는 에러 화면의 요청 ID로 `combined.log`를 검색한다.

로그 파일은 크기로 순환한다. `LOG_DIR`의 프로세스별 `<app|worker|tools>-error.log`·`-combined.log`(`LOG_SERVICE`)는 각각 20MB × 5개(`src/config/policy.ts`의 `LOGS`), 컨테이너 로그는 `DOCKER_LOG_MAX_SIZE` × `DOCKER_LOG_MAX_FILE`(기본 10MB × 5)까지만 남는다.

### 좀비 프로세스 점검

app·tools 이미지는 tini를 PID 1로 실행한다(Dockerfile `ENTRYPOINT`). tini는 고아가 된 자식 프로세스(ffmpeg, smartctl, 헬스체크)를 회수한다. 이미지를 다시 빌드한 뒤 확인한다.

```bash
docker top relayfiles-app-1 | head -3          # 첫 프로세스가 /usr/bin/tini
docker top relayfiles-worker-1 | head -3
ps -eo stat | grep -c '^Z'                     # 10분 뒤에도 0
```

## 점검 모드

```bash
touch deploy/maintenance/on    # 모든 요청에 503 "Under maintenance" 정적 페이지
rm deploy/maintenance/on       # 해제
```

`release.sh`는 마이그레이션 동안 자동으로 켜고 끈다. Server 페이지의 공지(Maintenance)는 앱이 켜져 있을 때 미리 알리는 용도다.

## 백업

| 대상 | 방법 | 주기 |
|---|---|---|
| PostgreSQL | `deploy/scripts/backup.sh` → `DATA_DIR/backups/relayfiles-*.dump` (최근 `BACKUP_KEEP`=14개) | 매일 (cron) + 릴리스마다 |
| 파일 (SSD) | `rsync -aHAX --delete /mnt/relayfilesDB/ <백업 디스크>/relayfilesDB/` | 매일 또는 매주 |
| `.env`, `/etc/relayfiles/ssd.key` | 서버 밖 안전한 곳 (비밀번호 관리자 등) | 바뀔 때마다 |
| Redis | 백업하지 않는다 (캐시, 세션, 큐. 다시 만들어진다) | — |

매일 새벽 DB 백업 (crontab -e):

```cron
15 3 * * * cd /home/ruthgyeul/RelayFiles && deploy/scripts/backup.sh >> /var/log/relayfiles/backup.log 2>&1
```

백업 디스크로 파일을 복사할 때 앱을 멈출 필요는 없다(파일은 원본 그대로 저장되고 업로드는 임시 폴더에서 완성된 뒤 옮겨진다). 단, DB 백업과 시점을 맞추려면 DB 백업 직후에 실행한다.

## DB 복구

```bash
touch deploy/maintenance/on
$C stop app worker
$C exec -T postgres pg_restore -U relayfiles -d relayfiles --clean --if-exists < /srv/relayfiles/backups/relayfiles-YYYYMMDD-HHMMSS.dump
$C up -d app worker
rm deploy/maintenance/on
```

복구한 DB가 SSD의 파일보다 오래됐으면, 그 사이에 올린 파일은 디스크에만 있고 목록에는 없다. 반대로 지운 파일은 목록에 남고, 열거나 내려받으면 실패한다(Docker는 Nginx 404, systemd는 500). 복구한 뒤에는 아래 ["DB와 디스크 대조"](#db와-디스크-대조-storagefsck)로 차이를 보고(`storage:fsck`), 필요하면 `--fix`로 정리한다.

## 롤백

릴리스마다 이미지가 git 커밋 태그로 남는다(`DATA_DIR/releases.log`에 기록). `autoclean.sh`가 최근 `IMAGE_KEEP`(기본 3)개 릴리스만 남기므로 그 안에서 되돌린다.

```bash
tail -5 /srv/relayfiles/releases.log           # 이전 태그 확인
RELEASE_TAG=<이전 태그> $C up -d --no-build app worker
```

이전 버전으로 되돌릴 때 DB 스키마는 그대로 둔다. 스키마 변경은 expand → migrate → contract 순서로 나눠서 넣기 때문에(CLAUDE.md), 바로 이전 릴리스는 새 스키마에서도 동작한다. 파괴적 변경이 들어간 릴리스를 되돌려야 하면 그 릴리스 직전의 DB 백업을 복구한다(위 "DB 복구").

## 디스크 정리 (autoclean)

`release.sh`가 헬스 체크를 통과한 뒤 자동으로 실행한다. 따로 실행할 때는 `--dry-run`으로 먼저 지울 목록을 본다.

```bash
deploy/scripts/autoclean.sh --dry-run
deploy/scripts/autoclean.sh
IMAGE_KEEP=5 BUILD_CACHE_MAX_AGE=6h deploy/scripts/autoclean.sh
```

| 대상 | 기준 |
|---|---|
| 이 프로젝트의 멈춘 컨테이너 | compose 프로젝트 라벨이 같은 것 (`--rm` 없이 실행한 `run` 등) |
| `relayfiles-app`·`relayfiles-tools` 옛 태그 | `releases.log`의 최근 `IMAGE_KEEP`개, `latest`, 컨테이너가 쓰는 태그는 남긴다. `releases.log`가 없으면 건드리지 않는다 |
| 예전에 고정했던 외부 이미지 | `docker-compose.yml`의 git 기록에 있었지만 지금은 없는 것(예: nginx 1.29). 다른 프로젝트 이미지는 건드리지 않는다 |
| 이름 없는(dangling) 이미지 | 태그도 컨테이너도 없는 것 |
| 빌드 캐시 | `BUILD_CACHE_MAX_AGE`(기본 `24h`) 동안 쓰지 않은 것. `docker buildx ls`의 실행 중인 빌더마다 `buildx prune`을 실행하고(`docker builder prune`은 기본 빌더만 비운다) 전후 크기(`buildx du`)를 출력한다. 멈춘 빌더는 깨우지 않고 건너뛴다. 최근 캐시는 남겨 다음 빌드를 빠르게 한다 |

볼륨, 네트워크, `DATA_DIR`(DB, 백업), SSD는 건드리지 않는다. DB 백업은 `backup.sh`가 최근 `BACKUP_KEEP`개만 남기고, 컨테이너 로그는 `DOCKER_LOG_MAX_SIZE`·`DOCKER_LOG_MAX_FILE`로 회전한다. 마지막에 `docker system df`로 남은 사용량을 보여 준다.

## SSD가 빠졌을 때

증상: Status 페이지 Storage 실패, 업로드·다운로드가 "Storage offline"(503).

```bash
lsblk; sudo cryptsetup status relayfilesDB
sudo cryptsetup open --key-file /etc/relayfiles/ssd.key /dev/sdX relayfilesDB   # 해제가 안 돼 있으면
sudo mount /mnt/relayfilesDB
$C restart app worker nginx
```

컨테이너를 재시작하면 앱이 SSD의 `.relayfiles-volume` 표시 파일을 다시 확인하고(Status 페이지 Storage가 정상으로 돌아온다) 정상으로 동작한다. 빈 마운트 지점(내장 디스크)에는 쓰지 않는다.

워커는 `VOLUME_WATCH_INTERVAL_SEC`(기본 30초)마다 ACTIVE 볼륨의 표시 파일을 확인한다. 없거나 다른 볼륨이면 그 볼륨을 `OFFLINE`으로 바꾸고 `storage volume went offline` 에러 로그를 남긴다. 다시 마운트되면 다음 확인에서 `ACTIVE`로 돌아온다(`READONLY`·`DRAINING`은 건드리지 않는다).

## DB와 디스크 대조 (storage:fsck)

```bash
$C run --rm tools npm run storage:fsck                 # 보고만(종료 코드 1 = 차이 있음)
$C run --rm tools npm run storage:fsck -- --fix        # 디스크에만 있는 항목 → 휴지통, 없어진 파일 → missing 표시
$C run --rm tools npm run storage:fsck -- --account <id>
```

DB 행은 지우지 않는다. 휴지통은 24시간 뒤 비워지므로 그 전에는 되살릴 수 있다. 심볼릭 링크는 옮기지 않고 "not moved"로 보고하니 직접 지운다.

## 관리자 토큰을 잃었을 때

```bash
$C run --rm tools npm run admin:create   # 새 관리자 계정. 이전 관리자 계정은 Accounts에서 정리한다
```

관리자 세션은 로그인 후 7일이 지나면 끝나고, 토큰 보기·계정 관리·가입 모드 변경 전에는 토큰을 다시 묻는다("Confirm it's you"). 토큰을 잃었다면 위처럼 새 관리자를 만든다.

## 감사 로그 보기

관리자 작업(역할·삭제일·용량 변경, 계정 삭제, 가입 모드, 정리 실행, 초대, 관리자 토큰 보기·재발급, 공지, 테마, 장애)은 `AuditEvent`에 1년간 남는다.

```bash
curl -s -b "rf_s=<관리자 쿠키>" https://<도메인>/api/admin/audit | jq '.data.events[:20]'
$C exec postgres psql -U relayfiles -c 'SELECT at, "actorName", action, "targetId", detail FROM "AuditEvent" ORDER BY at DESC LIMIT 50;'
```

## 마이그레이션

### DB 스키마 (Prisma)

- 개발: `npx prisma migrate dev --name <설명>` → `prisma/migrations/` 커밋. 운영: `release.sh`가 `prisma migrate deploy`를 실행한다. `db push`는 쓰지 않는다.
- **expand → migrate → contract**: 열 이름 변경이나 삭제처럼 데이터를 잃는 변경은 한 릴리스에 넣지 않는다.
  1. expand: 새 열·테이블을 추가한다(옛 코드도 계속 동작).
  2. migrate: 앱이 새 열을 쓰게 하고, 기존 값은 데이터 마이그레이션(아래)으로 채운다.
  3. contract: 다음 릴리스에서 옛 열을 지운다. 이 마이그레이션 SQL 맨 위에 `-- relayfiles: contract <이유>`를 적는다.
- `npm run check:migrations`(CI 포함)는 `DROP`, 타입 변경, `RENAME`, `DELETE FROM`, `TRUNCATE`가 있는데 contract 표시가 없는 마이그레이션을 막는다.
- CI는 모든 마이그레이션을 빈 DB에 적용하고, 결과가 `schema.prisma`와 같은지(`prisma migrate diff`) 확인한다.
- 공유 링크(`linkId`)와 계정 토큰은 어떤 마이그레이션에서도 바꾸지 않는다.

### 데이터 마이그레이션 (백필, 값 변환)

`release.sh`가 스키마 마이그레이션 다음에 `npm run data:migrate`를 실행한다.

1. `src/server/migrations/<날짜>-<이름>.ts`에 `DataMigrationStep`을 만든다. `id`는 바꾸지 않는다.
2. `run({ db, cursor, save })`는 `MIGRATION.batchSize`(1,000)행씩 처리하고 배치마다 `save(cursor)`를 부른다. 다시 실행해도 결과가 같아야 한다.
3. `src/server/migrations/registry.ts`의 `DATA_MIGRATIONS` 끝에 추가한다.

진행 상황은 `DataMigration` 테이블에 남는다. 중간에 멈추면 다음 실행이 저장된 커서 다음부터 이어 간다. 끝난 마이그레이션은 다시 실행하지 않는다.

```bash
$C run --rm tools npm run data:migrate      # 수동 실행
$C exec postgres psql -U relayfiles -c 'SELECT * FROM "DataMigration" ORDER BY "startedAt";'
```

### 스토리지 레이아웃 (`storage:migrate`)

SSD 안의 디렉터리 구조(`users/`, `system/…`)는 `.relayfiles-volume`의 `layoutVersion`으로 관리한다. 코드가 기대하는 값(`STORAGE.layoutVersion`)과 다르면 앱은 그 볼륨에 쓰지 않고 Status 페이지 Storage를 실패로 표시한다.

구조를 바꾸는 릴리스는 `src/server/storage/layout-migrations.ts`의 `LAYOUT_MIGRATIONS`에 단계(`from → to`, `up(root)`)를 추가한다. 단계는 같은 파일시스템 안의 `rename` 위주로 쓰고, 다시 실행해도 안전해야 한다(옮기기 전에 이미 옮겨졌는지 확인).

`release.sh`가 데이터 마이그레이션 다음에 자동으로 실행한다(바꿀 것이 없으면 `layout N is up to date.`만 출력). 수동 실행:

```bash
$C run --rm tools npm run storage:migrate
```

1. 볼륨을 `READONLY`로 바꾼다. 업로드·이름 변경·이동·삭제는 "Your files are being moved…"(503 `STORAGE_BUSY`)로 잠시 막히고, 탐색과 다운로드는 계속된다.
2. 단계마다 `system/migration.journal`에 시작·완료를 남기고, 끝난 단계는 표시 파일의 `layoutVersion`에 바로 기록한다.
3. 모든 단계가 끝나면 볼륨을 원래 상태로 되돌린다.

중간에 실패하면 볼륨은 `READONLY`로 남는다. 원인을 고친 뒤 같은 명령을 다시 실행하면 기록된 버전 다음 단계부터 이어 간다. 되돌려야 하면 `migration.journal`의 마지막 `started` 단계를 보고 그 단계의 `rename`을 거꾸로 실행한 뒤 표시 파일의 `layoutVersion`을 이전 값으로 고친다.

## 썸네일·미리보기 다시 만들기

```bash
$C run --rm tools npm run media:backfill               # 썸네일이 없는 이미지·영상 (워커·Redis 장애 뒤)
$C run --rm tools npm run media:backfill -- --previews # 뷰어 미리보기 도입 전에 올린 큰 이미지 (한 번)
```

큐에 넣기만 하고, 워커(`$C ps worker`)가 처리한다.

## 볼륨 추가·교체

볼륨 하나 = SSD 하나(`STORAGE_ROOT`가 첫 번째). 계정은 볼륨 하나에 속하고, 새 계정은 여유 공간이 가장 큰 `ACTIVE` 볼륨에 배정된다.

```bash
$C run --rm tools npm run volume:list      # id, 경로, 상태, layout, 마운트 여부, 계정 수, 여유 공간
```

### SSD 추가

1. 새 SSD를 암호화·포맷·마운트한다. `setup-ssd.sh`는 `STORAGE_ROOT`에 마운트하므로, 두 번째 SSD는 `.env`를 바꾸지 말고 [deploy-ubuntu.md](deploy-ubuntu.md) §2의 명령을 경로만 바꿔(예: `/mnt/relayfilesDB2`, 매퍼 이름 `relayfilesDB2`) 실행한다. 소유자는 `relayfiles`, 권한은 `0700`.
2. 컨테이너에 마운트한다.
   ```bash
   cp deploy/docker-compose.volumes.example.yml deploy/docker-compose.volumes.yml   # 경로 수정
   C="$C -f deploy/docker-compose.volumes.yml"
   ```
3. 볼륨을 등록한다. 표시 파일을 만들고 DB에 등록한 뒤 Nginx `location`(`deploy/nginx/volumes/<volumeId>.conf`)을 쓴다. 컨테이너가 저장소 폴더에 쓸 수 없으면 블록을 출력하므로 그 파일 이름으로 저장한다.
   ```bash
   $C run --rm tools npm run volume:init -- /mnt/relayfilesDB2
   $C up -d app worker nginx
   ```
4. `volume:list`에서 `ACTIVE … online`을 확인한다. 이후 새 계정은 여유 공간이 큰 쪽에 생긴다.

이전 릴리스에서 만든 `deploy/nginx/volumes/*.conf`에 `add_header Cache-Control` 줄이 있으면 지우고(또는 `volume:init -- <경로>`를 다시 실행해 새로 쓴다) `$C up -d nginx`. 앱이 보내는 `Cache-Control`이 X-Accel로 그대로 전달되어야 브라우저의 재생 캐시가 동작한다.

### 계정 하나 옮기기

```bash
$C run --rm tools npm run volume:migrate -- --account <accountId> --to <volumeId>
```

1. 계정을 `migrating`으로 표시한 뒤 원본의 해시를 계산한다. 그 계정의 변경은 503 `STORAGE_BUSY`로 잠시 막히고(업로드 시작 포함), 탐색·다운로드·공유 링크는 계속된다.
2. 사용자 폴더를 새 볼륨에 복사하고(권한 유지), 모든 파일의 SHA-256을 원본과 비교한다(빠진 파일, 다른 파일, 남는 파일). 하나라도 다르면 복사본을 지우고 멈춘다(계정은 원래 볼륨에 그대로).
3. 한 번의 DB 업데이트로 `volumeId`를 바꾸고 표시를 푼다. `linkId`, 노드 id, 토큰은 바뀌지 않는다.
4. 원본은 원래 볼륨의 `system/trash/`로 옮겨져 `STORAGE.trashRetentionHours`(24시간) 뒤 정리된다. 그 전에는 되돌릴 수 있다(같은 명령으로 원래 볼륨을 지정).

이미 대상 볼륨에 있으면 아무것도 하지 않는다("The account is already on that volume.").

자동 테스트(`src/app/api/files/volume-move.int.test.ts`)가 이 경로를 매번 확인한다: 이동 후 내용·권한·`linkId` 유지와 휴지통 보관, 이동 중 변경 503(`STORAGE_BUSY`)과 읽기 유지, 레이아웃 마이그레이션 중단 후 저널로 재개.

### SSD 교체 (볼륨 비우기)

```bash
$C run --rm tools npm run volume:migrate -- --volume <옛 volumeId> --to <새 volumeId>   # --to를 빼면 여유 공간이 큰 볼륨으로
$C run --rm tools npm run volume:list       # 옛 볼륨: DRAINING, 0 accounts
# 24시간 뒤(매일 정리 작업이 DRAINING 볼륨의 휴지통도 비운다) 또는 옛 SSD의 system/trash를 확인한 뒤
$C run --rm tools npm run volume:remove -- <옛 volumeId>
rm deploy/nginx/volumes/<옛 volumeId>.conf   # 있으면. 오버레이에서 마운트도 지운다
$C up -d app worker nginx
```

옛 볼륨은 `DRAINING`이 되어 새 계정을 받지 않고, 계정이 하나씩 옮겨진다. 중간에 멈추면 같은 명령을 다시 실행한다(옮겨진 계정은 건너뛴다). `volume:remove`는 `DRAINING`이고 계정이 없는 볼륨만 지우며 디스크의 파일은 건드리지 않는다.

`STORAGE_ROOT`의 SSD를 바꿀 때는 새 SSD를 다른 경로에 붙여 위처럼 비운 다음, 새 SSD를 `STORAGE_ROOT`에 다시 마운트하고 `volume:init`(인자 없이)을 실행한다. 표시 파일의 volumeId로 같은 볼륨임을 알아보고 경로만 갱신한다. 이때 `deploy/nginx/volumes/`의 그 볼륨 파일은 지운다(기본 location이 처리한다).

## 서버에 있는 파일 가져오기

서버 디스크에 이미 있는 파일(예: `/mnt/RuthVault2T/.private/Movies`)을 한 계정에 넣는다. 심볼릭 링크는 쓸 수 없으므로(경로 검사가 링크를 거부하고, DB에 기록되지 않으며, 계정이 지워질 때 원본까지 지워질 수 있다) 파일을 **복사**한다. 원본 폴더는 컨테이너에 마운트하지 않는다. 원본 소유자 권한으로 `tar`를 만들고 stdin으로 넘긴다.

```bash
tar -C /mnt/RuthVault2T/.private/Movies -cf - . | \
  $C run --rm -T tools npm run -s storage:import -- --account <accountId> [--to "Movies/2026"] [--ignore-quota]
```

- **계정 id**: 관리자 화면 Accounts → 계정 Manage 창의 이름 아래 줄, 또는 `sudo ls <STORAGE_ROOT>/users/`, 또는 `$C exec postgres psql -U relayfiles -c 'SELECT id, name FROM "Account";'`.
- `--to`: 계정 루트 아래의 대상 폴더. 없으면 만든다. 생략하면 루트에 바로 넣는다.
- `--ignore-quota`: 계정 용량 제한을 무시한다. 볼륨의 예비 공간(`reservePct`)은 항상 지킨다.
- 업로드와 같은 방식으로 기록한다. MIME 판별, SHA-256, 폴더 생성, DB 노드를 만들고 파일 권한은 `0600`이다. 이미지·영상 썸네일은 worker가 나중에 만든다(`$C ps worker` 확인).
- **이어하기**: 중간에 멈추면(에러, Ctrl-C) 같은 명령을 다시 실행한다. 같은 경로에 같은 크기의 파일이 있으면 건너뛴다. 이름은 같은데 크기가 다르면 `name (2).ext`로 옆에 둔다. 그래서 내용을 바꾼 파일을 다시 가져오면 사본이 하나 더 생긴다.
- 원본은 읽기만 하고 바꾸지 않는다. 일반 파일과 폴더만 가져오고, 링크·장치 파일은 `ignored`로 출력한 뒤 건너뛴다.
- **멤버 계정**은 만료(TTL)되면 계정과 함께 파일도 지워진다. 명령이 시작할 때 만료일을 경고한다. 오래 둘 파일은 관리자 계정이나 만료 없는 계정에 넣는다.
- 끝에 `Done: N imported (크기), N already there, N ignored.`를 출력한다. 실패하면 종료 코드 1이고, 그때까지 가져온 파일은 남아 있다.

## 서버 이전 (N95 → 새 서버)

모든 주소·경로·포트는 `.env`에 있으므로 코드는 바뀌지 않는다. 앱 서버와 DB 서버를 나눌 때도 `POSTGRES_HOST`·`REDIS_HOST`만 바꾼다.

1. **새 서버 준비**: [deploy-ubuntu.md](deploy-ubuntu.md) §1, §3, §4를 진행한다. `.env`는 옛 서버의 것을 복사한다(비밀값이 같아야 토큰과 쿠키가 그대로 동작한다). 이미지를 빌드해 두고 `$C up -d postgres redis`까지만 실행한다.
2. **옛 서버 점검 모드**: `touch deploy/maintenance/on`, `$C stop app worker`.
3. **DB 이전**:
   ```bash
   # 옛 서버
   $C exec -T postgres pg_dump -Fc -U relayfiles relayfiles > relayfiles.dump
   scp relayfiles.dump <새 서버>:~/RelayFiles/
   # 새 서버
   $C exec -T postgres pg_restore --no-owner -U relayfiles -d relayfiles < relayfiles.dump
   $C run --rm tools npm run db:deploy && $C run --rm tools npm run data:migrate
   ```
   중단 없이 옮겨야 하면 PostgreSQL logical replication(publication/subscription)으로 맞춘 뒤 전환한다.
4. **Redis**: 옮기지 않는다. 캐시·잠금 카운터·큐는 다시 만들어지고, 기기 쿠키는 DB 세션으로 다시 인증된다. 반복 작업은 워커가 시작할 때 다시 등록한다.
5. **SSD**: 옛 서버에서 `sudo umount /mnt/relayfilesDB && sudo cryptsetup close relayfilesDB` → SSD와 키 파일(`/etc/relayfiles/ssd.key`)을 옮기고 `crypttab`·`fstab` 줄을 그대로 추가 → `sudo mount /mnt/relayfilesDB`. 경로가 같으면 다시 등록할 필요가 없다. 경로가 다르면 `.env`의 `STORAGE_ROOT`를 바꾸고 `volume:init`을 실행한다(같은 volumeId로 경로만 갱신). 네트워크로 복사해야 하면 새 서버에 빈 SSD를 볼륨으로 추가한 뒤 위 "SSD 교체"로 옮기거나, `rsync -aHAX --numeric-ids`로 복사하고 `sha256sum`을 대조한다.
6. **시작·확인**: `$C up -d app worker nginx`, `/api/health`, `volume:list`, 아무 파일이나 다운로드해 해시 비교.
7. **전환**: Cloudflare Tunnel은 새 서버에서 같은 토큰으로 `cloudflared`를 올리고 옛 서버의 `cloudflared`를 멈춘다. LAN 주소를 쓰면 DNS·공유기 설정을 바꾼다. `PUBLIC_URL`이 같으면 공유 링크는 그대로다.
8. **롤백 대비**: 옛 서버는 점검 모드인 채로 1주일 둔다. 되돌릴 때는 새 서버를 멈추고 SSD를 다시 옮긴 뒤(또는 그대로) 옛 서버에서 `rm deploy/maintenance/on`, `$C start app worker`. 새 서버에서 생긴 변경은 새 서버의 덤프로 다시 옮긴다.

## 비밀값 교체

### 토큰 키 (`TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`)

토큰 값은 바뀌지 않는다. 저장된 암호문과 조회용 해시만 새 키로 다시 만든다.

1. `.env`에서 지금 값을 `TOKEN_ENC_KEY_PREVIOUS`, `TOKEN_HMAC_KEY_PREVIOUS`로 옮기고, 새 값(`env:secrets`)을 넣는다.
2. `$C up -d app worker` (두 키를 모두 읽을 수 있는 상태가 된다. 로그인할 때 새 키로 다시 저장된다)
3. `$C run --rm tools npm run keys:rotate` (모든 계정을 배치로 다시 암호화한다. 다시 실행해도 안전하다)
4. "Remove the *_PREVIOUS keys"가 나오면 `.env`에서 `*_PREVIOUS`를 지우고 `$C up -d app worker`.

어떤 키로도 풀리지 않는 계정이 있으면 3단계가 그 계정 id를 출력하고 실패한다. 이때는 `*_PREVIOUS`를 지우지 않는다.

### 쿠키 서명 키 (`COOKIE_SECRET`)

지금 값을 `COOKIE_SECRET_PREVIOUS`로 옮기고 새 값을 넣은 뒤 재시작한다. 옛 키로 서명된 기기 쿠키도 계속 받아들이고, 쿠키를 다시 저장할 때(로그인, 계정 추가·전환·로그아웃) 새 키로 서명한다. 한 달쯤 뒤에 `COOKIE_SECRET_PREVIOUS`를 지운다. 그때까지 쿠키가 다시 저장되지 않은 기기는 토큰으로 다시 로그인해야 한다.

### DB 비밀번호 (`POSTGRES_PASSWORD`)

DB 안의 비밀번호도 같이 바꾼다.

```bash
$C exec postgres psql -U relayfiles -c "ALTER USER relayfiles PASSWORD '<새 비밀번호>';"
# .env의 POSTGRES_PASSWORD를 바꾼 뒤
$C up -d app worker
```

## 의존성 업데이트

Dependabot(`.github/dependabot.yml`)이 보안 수정은 바로, 나머지는 매주 월요일에 PR로 올린다. npm은 minor·patch를 한 PR로 묶고, 메이저 버전은 따로 올린다. 대상은 npm, GitHub Actions(커밋 SHA로 고정), Dockerfile 베이스 이미지, `deploy/docker-compose.yml` 이미지다. 이미지는 태그와 digest(`name:tag@sha256:…`)로 고정한다. 같은 태그가 다른 이미지로 바뀌어도 서버에 들어오지 않고, Dependabot이 새 digest를 PR로 올린다. CI `Security` 잡은 런타임 의존성의 high 이상 advisory(`npm audit --omit=dev --audit-level=high`)와 커밋에 들어간 비밀값(gitleaks)을 막고, `docker` 잡은 이미지의 수정판이 있는 critical CVE(grype)를 막고, tools 이미지에 `.dockerignore` 허용 목록 밖의 파일·테스트·devDependencies가 없는지 본다. `Workflows · shell scripts` 잡은 워크플로(actionlint, 체크섬으로 고정한 릴리스)와 배포 셸 스크립트(`shellcheck -x`, 설정은 `.shellcheckrc`)를 검사한다. `arm64 images` 워크플로는 Pi 클러스터용 `app`·`tools` 이미지가 linux/arm64로 빌드되는지 QEMU로 확인한다(`main` push와 `Dockerfile`·`.dockerignore`·`deploy/`·`package*.json`을 바꾼 PR, 푸시는 하지 않는다). CodeQL은 저장소의 기본 코드 스캐닝 설정으로 돈다.
