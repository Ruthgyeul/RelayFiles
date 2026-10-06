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

## 비밀값 교체

`TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET`을 바꿀 때는 기존 값을 `*_PREVIOUS`로 옮기고 새 값을 넣은 뒤 `release.sh`를 실행한다. 옛 키로 만든 값도 계속 읽히고, 로그인할 때 새 키로 다시 저장된다. 일괄 재암호화와 `*_PREVIOUS` 제거는 M16의 키 회전 스크립트에서 다룬다.

`POSTGRES_PASSWORD`를 바꿀 때는 DB 안의 비밀번호도 같이 바꾼다.

```bash
$C exec postgres psql -U relayfiles -c "ALTER USER relayfiles PASSWORD '<새 비밀번호>';"
# .env의 POSTGRES_PASSWORD를 바꾼 뒤
$C up -d app worker
```
