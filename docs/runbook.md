# 운영 절차 (runbook)

배포 방법은 [deploy-ubuntu.md](deploy-ubuntu.md). 아래 명령은 저장소 루트에서 실행한다.

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
sudo tail -f /var/log/relayfiles/error.log
```

앱 로그(`LOG_DIR`)와 Nginx 로그에는 토큰, 비밀번호, 클라이언트 IP가 남지 않는다. 문제를 찾을 때는 에러 화면의 요청 ID로 `combined.log`를 검색한다.

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

복구한 DB가 SSD의 파일보다 오래됐으면, 그 사이에 올린 파일은 디스크에만 있고 목록에는 없다. 반대로 지운 파일은 목록에 남지만 열 때 "missing"으로 처리된다.

## 롤백

릴리스마다 이미지가 git 커밋 태그로 남는다(`DATA_DIR/releases.log`에 기록).

```bash
tail -5 /srv/relayfiles/releases.log           # 이전 태그 확인
RELEASE_TAG=<이전 태그> $C up -d --no-build app worker
```

이전 버전으로 되돌릴 때 DB 스키마는 그대로 둔다. 스키마 변경은 expand → migrate → contract 순서로 나눠서 넣기 때문에(CLAUDE.md), 바로 이전 릴리스는 새 스키마에서도 동작한다. 파괴적 변경이 들어간 릴리스를 되돌려야 하면 그 릴리스 직전의 DB 백업을 복구한다(위 "DB 복구").

## SSD가 빠졌을 때

증상: Status 페이지 Storage 실패, 업로드·다운로드가 "Storage offline"(503).

```bash
lsblk; sudo cryptsetup status relayfilesDB
sudo cryptsetup open --key-file /etc/relayfiles/ssd.key /dev/sdX relayfilesDB   # 해제가 안 돼 있으면
sudo mount /mnt/relayfilesDB
$C restart app worker nginx
```

앱은 SSD의 `.relayfiles-volume` 표시 파일이 보이면 30초 안에(`VOLUME_WATCH_INTERVAL_SEC`) 정상으로 돌아온다. 빈 마운트 지점(내장 디스크)에는 쓰지 않는다.

## 관리자 토큰을 잃었을 때

```bash
$C run --rm tools npm run admin:create   # 새 관리자 계정. 이전 관리자 계정은 Accounts에서 정리한다
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

```bash
$C run --rm tools npm run storage:migrate
```

1. 볼륨을 `READONLY`로 바꾼다. 업로드·이름 변경·이동·삭제는 "Your files are being moved…"(503 `STORAGE_BUSY`)로 잠시 막히고, 탐색과 다운로드는 계속된다.
2. 단계마다 `system/migration.journal`에 시작·완료를 남기고, 끝난 단계는 표시 파일의 `layoutVersion`에 바로 기록한다.
3. 모든 단계가 끝나면 볼륨을 원래 상태로 되돌린다.

중간에 실패하면 볼륨은 `READONLY`로 남는다. 원인을 고친 뒤 같은 명령을 다시 실행하면 기록된 버전 다음 단계부터 이어 간다. 되돌려야 하면 `migration.journal`의 마지막 `started` 단계를 보고 그 단계의 `rename`을 거꾸로 실행한 뒤 표시 파일의 `layoutVersion`을 이전 값으로 고친다.

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

### 계정 하나 옮기기

```bash
$C run --rm tools npm run volume:migrate -- --account <accountId> --to <volumeId>
```

1. 계정을 `migrating`으로 표시한 뒤 원본의 해시를 계산한다. 그 계정의 변경은 503 `STORAGE_BUSY`로 잠시 막히고(업로드 시작 포함), 탐색·다운로드·공유 링크는 계속된다.
2. 사용자 폴더를 새 볼륨에 복사하고(권한 유지), 모든 파일의 SHA-256을 원본과 비교한다(빠진 파일, 다른 파일, 남는 파일). 하나라도 다르면 복사본을 지우고 멈춘다(계정은 원래 볼륨에 그대로).
3. 한 번의 DB 업데이트로 `volumeId`를 바꾸고 표시를 푼다. `linkId`, 노드 id, 토큰은 바뀌지 않는다.
4. 원본은 원래 볼륨의 `system/trash/`로 옮겨져 `STORAGE.trashRetentionHours`(24시간) 뒤 정리된다. 그 전에는 되돌릴 수 있다(같은 명령으로 원래 볼륨을 지정).

이미 대상 볼륨에 있으면 아무것도 하지 않는다("The account is already on that volume.").

### SSD 교체 (볼륨 비우기)

```bash
$C run --rm tools npm run volume:migrate -- --volume <옛 volumeId> --to <새 volumeId>   # --to를 빼면 여유 공간이 큰 볼륨으로
$C run --rm tools npm run volume:list       # 옛 볼륨: DRAINING, 0 accounts
# 24시간 뒤(휴지통 정리 후) 또는 옛 SSD의 system/trash를 확인한 뒤
$C run --rm tools npm run volume:remove -- <옛 volumeId>
rm deploy/nginx/volumes/<옛 volumeId>.conf   # 있으면. 오버레이에서 마운트도 지운다
$C up -d app worker nginx
```

옛 볼륨은 `DRAINING`이 되어 새 계정을 받지 않고, 계정이 하나씩 옮겨진다. 중간에 멈추면 같은 명령을 다시 실행한다(옮겨진 계정은 건너뛴다). `volume:remove`는 `DRAINING`이고 계정이 없는 볼륨만 지우며 디스크의 파일은 건드리지 않는다.

`STORAGE_ROOT`의 SSD를 바꿀 때는 새 SSD를 다른 경로에 붙여 위처럼 비운 다음, 새 SSD를 `STORAGE_ROOT`에 다시 마운트하고 `volume:init`(인자 없이)을 실행한다. 표시 파일의 volumeId로 같은 볼륨임을 알아보고 경로만 갱신한다. 이때 `deploy/nginx/volumes/`의 그 볼륨 파일은 지운다(기본 location이 처리한다).

## 서버 이전 (N95 → 새 서버)

모든 주소·경로·포트는 `.env`에 있으므로 코드는 바뀌지 않는다. 앱 서버와 DB 서버를 나눌 때(MS-A2 + MS-01)도 `POSTGRES_HOST`·`REDIS_HOST`만 바꾼다.

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

## 리허설 기록

### 2026-10-06 — 볼륨 간 이동, 볼륨 비우기, 레이아웃 마이그레이션, DB 덤프·복원

개발 환경(로컬 PostgreSQL 16, Redis 7, `next dev`)에서 실제 명령으로 진행했다. 두 번째·세 번째 볼륨은 임시 디렉터리(`relayfilesDB2`, `relayfilesDB3`)로 대신했다.

준비: 앱에서 익명 계정 두 개(A `tw75havn4rxn`, B `c853aph8bbyb`)를 만들고 브라우저로 `clip.bin`(3,000,000바이트 무작위), `메모 notes.txt`(한글·공백 이름)를 업로드했다.

| 단계 | 명령 | 결과 |
|---|---|---|
| 1 | `volume:init -- …/relayfilesDB2`, `… /relayfilesDB3` | 볼륨 등록, Nginx location 파일 생성 |
| 2 | `volume:list` | 세 볼륨 모두 `ACTIVE layout 1 online` |
| 3 | `volume:migrate -- --account A --to V2` | `copying 2 files (3000012 bytes)` → `switched`, 1.0초. 원본은 V1 `system/trash/` |
| 4 | `sha256sum` V1(이전) / V2(이후) | 두 파일 모두 같음 (`3e438b91…`, `ce65bc04…`) |
| 5 | 다운로드 API · `/d/<linkId>` | 모두 200, `linkId` 그대로 |
| 6 | 3번 다시 실행 | `The account is already on that volume.` |
| 7 | `volume:migrate -- --account B --to V3` 후 `--volume V3 --to V2` | V3 `DRAINING`, B가 V2로 이동, 해시 같음, 다운로드·공유 링크 200 |
| 8 | `storage:migrate` | 세 볼륨 `layout 1 is up to date.` (아직 레이아웃 단계 없음) |
| 9 | `volume:migrate -- --volume V2 --to V1` | A, B 원래 볼륨으로 복귀 |
| 10 | `volume:remove -- V1` / `-- V2`, `-- V3` | V1은 `ACTIVE`라 거부, V2·V3 제거(디스크 파일 유지) |
| 11 | `pg_dump -Fc` → `pg_restore --no-owner` (새 DB) | 덤프 628KB, 0.15초 / 복원 0.17초. 계정 2,058, 노드 5,652, `linkId` 전체 md5가 원본과 같음 |

자동 테스트(`src/app/api/files/volume-move.int.test.ts`)가 같은 경로를 매번 확인한다: 이동 후 내용·권한·`linkId` 유지와 휴지통 보관, 이동 중 변경 503(`STORAGE_BUSY`)과 읽기 유지, 레이아웃 마이그레이션 중단 후 저널로 재개.

실서버(N95, 실제 두 번째 SSD)에서는 위 "SSD 추가" → "계정 하나 옮기기"를 테스트 계정으로 한 번 해 보고 이 표에 한 줄 추가한다.

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
