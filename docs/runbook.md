# 운영 절차 (runbook)

배포 방법은 [deploy-ubuntu.md](deploy-ubuntu.md). 아래 명령은 저장소 루트에서 실행한다.

```bash
C="docker compose --env-file .env -f deploy/docker-compose.yml"
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
