# Ubuntu 서버 배포 (systemd + Nginx)

이 문서는 RelayFiles를 Docker 없이 Ubuntu 서버(현재 N95, `192.168.0.100`)에서 운영하는 절차를 다룬다. 앱과 워커는 systemd 서비스로 돌리고, 앞단은 호스트의 Nginx가 맡는다. 아래 예시는 도메인 `relayfiles.io`, 앱 포트 `6000` 기준이다. Docker Compose로 배포하려면 [deploy-ubuntu.md](deploy-ubuntu.md)를 본다. 운영 중 작업(백업, 복구, 볼륨)은 [runbook.md](runbook.md)에 있다.

## 0. 구성

```
인터넷 ── Cloudflare Tunnel (cloudflared, systemd) ─┐
                                                    ▼
                      nginx :80 (server_name relayfiles.io, systemd)
                                                    │  127.0.0.1:6000
                                                    ▼
             relayfiles-app (Next.js, systemd) ── relayfiles-worker (썸네일·정리·지표·헬스 프로브, systemd)
                   │            │                        │
                   ▼            ▼                        ▼
         postgresql (16)   redis-server        /mnt/relayfilesDB (외장 SSD, LUKS2)
```

| 구성 요소 | 설치 | 사용자 | 위치 |
|---|---|---|---|
| 코드 | `git clone` | 배포 사용자(예: `ruthgyeul`) 소유 | `/opt/relayfiles` |
| `relayfiles-app` | `deploy/systemd/relayfiles-app.service.template` | `relayfiles` (uid 10001) | `127.0.0.1:6000`에서만 수신 |
| `relayfiles-worker` | `deploy/systemd/relayfiles-worker.service.template` | `relayfiles` | 포트 없음 |
| Nginx | apt | `www-data` | `/etc/nginx/sites-available/relayfiles.conf` |
| PostgreSQL 16 / Redis | apt | `postgres` / `redis` | `127.0.0.1`에서만 수신 |
| 파일 | `deploy/scripts/setup-ssd.sh` | `relayfiles` (디렉터리 `0700`, 파일 `0600`) | `/mnt/relayfilesDB` |

**포트 6000에 대해.** 6000은 X11 포트라서 Chrome·Firefox(`ERR_UNSAFE_PORT`)와 Node의 `fetch`가 접속을 막는다. 그래서 앱은 `127.0.0.1:6000`에만 열고, 브라우저는 항상 Nginx(80/443)로 들어오게 한다. 방화벽이나 공유기에서 6000을 열지 않는다. 워커의 헬스 프로브는 `fetch` 대신 Node http 클라이언트를 쓰므로 6000에서도 동작한다.

**X-Accel은 쓰지 않는다.** SSD의 파일은 `relayfiles`만 읽을 수 있고, 호스트 Nginx는 `www-data`로 돈다. 그래서 `STORAGE_ACCEL_ENABLED=false`로 두고 앱이 파일을 직접 보낸다. 영상 탐색(Range)과 혼잡 시 속도 제한은 이 방식에서도 똑같이 동작한다.

## 1. 패키지

```bash
sudo apt update
sudo apt install -y git curl ca-certificates gnupg nginx redis-server ffmpeg cryptsetup smartmontools

# Node.js 24 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v                                    # v24.x

# PostgreSQL 16 (PostgreSQL 공식 저장소, 프로젝트 기준 버전)
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-16
```

## 2. 코드와 `.env`

```bash
sudo install -d -o "$USER" -g "$USER" -m 0755 /opt/relayfiles
git clone https://github.com/Ruthgyeul/RelayFiles.git /opt/relayfiles
cd /opt/relayfiles
npm ci
cp .env.example .env && chmod 600 .env
npm run env:secrets          # 비밀값 5개를 출력만 한다. .env에 붙여 넣는다
nano .env
```

`/home` 아래에 두면 안 된다. 서비스가 홈 디렉터리를 읽지 못한다(`ProtectHome`).

`.env`에서 바꿀 값:

| 키 | 값 | 이유 |
|---|---|---|
| `NODE_ENV` | `production` | |
| `APP_HOST` | `127.0.0.1` | Nginx만 앱에 접속한다 |
| `APP_PORT` | `6000` | |
| `PUBLIC_URL` | `https://relayfiles.io` | 공유 링크 주소 |
| `SERVER_NAME` | `relayfiles.io` | Nginx `server_name` |
| `NGINX_LISTEN_PORT` | `80` | cloudflared가 `127.0.0.1:80`으로 연결한다 |
| `POSTGRES_HOST` / `REDIS_HOST` | `127.0.0.1` | |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET` | `env:secrets` 출력 | |
| `STORAGE_ROOT` | `/mnt/relayfilesDB` | |
| `STORAGE_ACCEL_ENABLED` | `false` | §0 참고 |
| `LOG_DIR` | `/var/log/relayfiles` | 앱 로그 |
| `DATA_DIR` | `/srv/relayfiles` | DB 백업, 릴리스 기록 |
| `ADMIN_ALLOWED_CIDRS` | `192.168.0.0/24` (선택) | 관리자 페이지를 집 LAN에서만 연다 |
| `HEALTH_PROBE_URL` | 비워 둔다 | 기본값 `http://127.0.0.1:6000` |

`POSTGRES_PUBLISH`, `REDIS_PUBLISH`, `DOCKER_SUBNET`, `CLOUDFLARED_IP`, `CLOUDFLARE_TUNNEL_TOKEN`은 Docker 배포에서만 쓴다. 그대로 둬도 된다.

```bash
npm run env:check            # 빠지거나 잘못된 키를 목록으로 보여 준다
```

## 3. 외장 SSD (LUKS2 + ext4)

**장치의 모든 데이터가 지워진다.** 스크립트는 `.env`의 `STORAGE_ROOT`, `STORAGE_UID`/`STORAGE_GID`를 읽는다.

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL
sudo deploy/scripts/setup-ssd.sh /dev/sdX --dry-run
sudo deploy/scripts/setup-ssd.sh /dev/sdX
echo 'ACTION=="add", SUBSYSTEM=="usb", ATTR{power/control}="on"' | sudo tee /etc/udev/rules.d/50-usb-ssd-power.rules
```

스크립트는 다음을 한다.
- 저장소 계정 `relayfiles`를 만든다.
- 키 파일 `/etc/relayfiles/ssd.key`를 만들고 복구용 패스프레이즈를 등록한다.
- `crypttab`과 `fstab`에 부팅 시 자동 마운트를 등록한다.
- `users/`, `system/`을 `0700`으로 만든다.

자세한 내용은 [deploy-ubuntu.md §2](deploy-ubuntu.md#2-외장-ssd-luks2--ext4)를 본다. 키 파일과 패스프레이즈는 서버 밖에도 보관한다.

## 4. PostgreSQL과 Redis

PostgreSQL: `.env`와 같은 이름의 역할과 DB를 만든다. 비밀번호를 물으면 `.env`의 `POSTGRES_PASSWORD`를 넣는다.

```bash
sudo -u postgres createuser --pwprompt relayfiles
sudo -u postgres createdb -O relayfiles relayfiles
```

기본 설정에서는 `127.0.0.1`에서만 접속을 받으므로 따로 열 것이 없다.

Redis: `/etc/redis/redis.conf`에서 아래 세 줄을 확인하거나 고친다.

```conf
bind 127.0.0.1 -::1
requirepass <.env의 REDIS_PASSWORD>
appendonly yes
```

`maxmemory-policy`는 기본값 `noeviction`으로 둔다. 작업 큐(BullMQ)에 이 설정이 필요하다.

```bash
sudo systemctl restart redis-server
REDISCLI_AUTH='<REDIS_PASSWORD>' redis-cli ping      # PONG
sudo systemctl enable --now postgresql redis-server nginx
```

## 5. 서비스와 Nginx 등록

```bash
cd /opt/relayfiles
sudo deploy/scripts/systemd/install.sh
```

다시 실행해도 안전하다. `.env`나 템플릿을 바꾸면 다시 실행한다. 하는 일은 다음과 같다.

1. `relayfiles` 계정의 홈(`/var/lib/relayfiles`)을 만든다. npm 캐시용이다.
2. `LOG_DIR`, `DATA_DIR`, `.app/`을 만든다.
3. `.env`를 `0640`, 그룹 `relayfiles`로 바꿔 서비스만 읽게 한다.
4. `deploy/systemd/*.service.template`을 `/etc/systemd/system/relayfiles-{app,worker}.service`로 렌더링하고 `enable`한다. 서비스를 시작하지는 않는다.
5. `deploy/nginx/host/relayfiles.conf.template`을 `/etc/nginx/sites-available/relayfiles.conf`로 렌더링하고 `sites-enabled`에 링크한다. 그 뒤 `nginx -t`를 거쳐 reload한다.

기존 Nginx 사이트(`/var/www/html` 기본 페이지 등)는 그대로 둔다. `relayfiles.io`로 들어온 요청만 이 사이트가 받는다. 렌더링된 파일은 직접 고치지 말고 템플릿을 고친 뒤 `install.sh`를 다시 실행한다.

## 6. 첫 실행

```bash
cd /opt/relayfiles
deploy/scripts/systemd/rf.sh db:deploy          # DB 마이그레이션
deploy/scripts/systemd/rf.sh volume:init        # SSD에 볼륨 표시 파일을 만들고 DB에 등록
deploy/scripts/systemd/release.sh               # 빌드 → .app/<릴리스> → 서비스 시작 → 헬스 체크
deploy/scripts/systemd/rf.sh admin:create       # 첫 관리자. 토큰은 한 번만 출력된다
```

`rf.sh <npm 스크립트>`는 명령을 서비스와 같은 `relayfiles` 계정으로 실행한다. umask 077로 실행하므로 SSD에 만드는 파일의 소유자와 권한(`0600`/`0700`)이 서비스와 같다. 이렇게 실행할 명령은 `admin:create`, `volume:*`, `storage:migrate`, `data:migrate`, `keys:rotate`, `media:backfill`이다.

```bash
curl -fsS http://127.0.0.1:6000/api/health                          # 앱 직접
curl -fsS -H 'Host: relayfiles.io' http://127.0.0.1/api/health      # Nginx 경유
systemctl status relayfiles-app relayfiles-worker
```

LAN에서 바로 보려면 PC의 `hosts` 파일에 `192.168.0.100 relayfiles.io`를 넣고 `http://relayfiles.io`를 연다. 출력된 토큰으로 로그인한다(사이드바 Add account → Sign in).

## 7. 외부 공개: `relayfiles.io`

### Cloudflare Tunnel (권장)

포트를 열지 않고 공개한다. TLS 인증서는 Cloudflare가 관리한다.

1. Cloudflare에 `relayfiles.io`를 추가한다. 도메인 등록 업체에서 네임서버를 Cloudflare로 바꾼다.
2. Zero Trust → Networks → Tunnels → Create a tunnel(Cloudflared)을 연다. 이름은 예를 들어 `n95`로 하고 토큰을 복사한다.
3. 서버에 cloudflared를 설치하고 서비스로 등록한다.

   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt update && sudo apt install -y cloudflared
   sudo cloudflared service install <터널 토큰>      # systemd 서비스 cloudflared
   ```

4. 터널의 Public Hostname에서 `relayfiles.io`(서브도메인 없음)의 Service를 `HTTP` / `127.0.0.1:80`으로 지정한다.
5. `https://relayfiles.io/api/health`를 확인한다.

cloudflared는 같은 서버의 `127.0.0.1`에서 Nginx로 접속한다. Nginx는 이 주소에서 온 `CF-Connecting-IP`만 실제 방문자 주소로 믿는다. 다른 곳에서 보낸 같은 헤더는 무시한다. 무료 요금제의 요청 크기 제한은 100MB이고, 업로드는 50MB 조각(`UPLOAD_CHUNK_SIZE_MB`)으로 나뉘어 이 제한에 걸리지 않는다.

### 대안: 포트 포워딩 + Let's Encrypt

1. 공유기에서 TCP 80과 443을 `192.168.0.100`으로 포워딩한다.
2. DNS에 A 레코드 `relayfiles.io` → 집 공인 IP를 추가한다. Cloudflare를 쓴다면 회색 구름(DNS only)으로 둔다.
3. 인증서를 발급한다.

   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d relayfiles.io --redirect
   ```

`install.sh`를 다시 실행하면 사이트 파일이 다시 렌더링되면서 certbot이 넣은 TLS 줄이 빠진다. 스크립트가 이를 감지하고 복구 명령(`sudo certbot install --nginx --cert-name relayfiles.io --redirect`)을 출력한다.

### 방화벽 (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp          # 포트 포워딩 방식이면 443/tcp도. Tunnel만 쓰면 LAN 접속용
sudo ufw enable
```

6000, 5432, 6379는 열지 않는다. 셋 다 `127.0.0.1`에서만 수신한다.

## 8. 운영 명령

```bash
sudo systemctl restart relayfiles-app relayfiles-worker
journalctl -u relayfiles-app -u relayfiles-worker -f       # 표준 출력
sudo tail -f /var/log/relayfiles/error.log                  # 앱 로그 (LOG_DIR)
sudo tail -f /var/log/nginx/relayfiles.error.log
touch deploy/maintenance/on    # 점검 모드 (모든 요청에 503 정적 페이지), rm으로 해제
```

매일 DB 백업 (`crontab -e`, 배포 사용자):

```cron
15 3 * * * /opt/relayfiles/deploy/scripts/systemd/backup.sh >> /srv/relayfiles/backup.log 2>&1
```

## 9. 업데이트와 롤백

```bash
cd /opt/relayfiles
git pull
deploy/scripts/systemd/release.sh
```

`release.sh`는 순서대로 아래를 한다. 하나라도 실패하면 멈춘다.

1. DB를 백업한다(`DATA_DIR/backups`, 최근 14개).
2. `npm ci`와 `npm run build`를 한다. 그동안 실행 중인 앱은 자기 번들(`.app/current`)로 계속 응답한다.
3. 새 번들을 `.app/<시각>-<커밋>`에 복사한다.
4. 점검 모드를 켜고 마이그레이션을 실행한다: `db:deploy`, `data:migrate`, `storage:migrate`.
5. `.app/current`를 새 번들로 바꾸고 app과 worker를 재시작한 뒤 점검 모드를 끈다.
6. `127.0.0.1:6000/api/health`를 확인하고 `DATA_DIR/releases.log`에 기록한다. 번들은 최근 3개만 남긴다.

롤백:

```bash
deploy/scripts/systemd/rollback.sh              # 바로 이전 번들로
deploy/scripts/systemd/rollback.sh <번들 이름>    # ls .app
```

롤백할 때는 다음을 알아 둔다.
- 앱 번들만 바뀐다. DB 스키마는 expand → contract로 나눠 넣으므로 바로 이전 릴리스는 새 스키마에서도 동작한다.
- 파괴적 변경이 있었다면 [runbook.md "DB 복구"](runbook.md#db-복구)대로 그 릴리스 직전 백업을 복구한다. systemd 배포에서는 `$C exec -T postgres pg_restore …` 대신 아래를 쓴다.

  ```bash
  sudo systemctl stop relayfiles-app relayfiles-worker
  PGPASSWORD=… pg_restore -h 127.0.0.1 -U relayfiles -d relayfiles --clean --if-exists <dump>
  ```

- 워커는 체크아웃된 소스로 돈다. 워커 코드도 되돌려야 하면 `git checkout <커밋> && npm ci` 후 `sudo systemctl restart relayfiles-worker`를 실행한다.

## 10. 확인 목록 (실서버)

[deploy-ubuntu.md §8](deploy-ubuntu.md#8-확인-목록-실서버)의 항목을 그대로 확인한다. 다만 아래 항목은 다르게 확인한다.

| 항목 | systemd 배포에서 |
|---|---|
| X-Accel | 해당 없음. 영상 탐색(Range)이 되는지만 확인한다 |
| 앱 중단 | `sudo systemctl stop relayfiles-app` → Nginx의 "Server unreachable" 페이지 → `start`로 복구 |
| 로그 | `docker compose logs` 대신 `journalctl -u relayfiles-app` |
| Status 페이지 | 워커가 1분마다 `127.0.0.1:6000`을 확인한다. Website·Storage가 초록색인지 본다 |

## 11. 참고

- **Disk health**: `smartctl`은 root 권한이 필요하다. 앱은 `relayfiles` 계정으로 돌기 때문에 Server 페이지에 "Unavailable"이 표시된다. 호스트에서 `sudo smartctl -d sat -H /dev/sdX`로 확인한다.
- **두 번째 SSD**: [runbook.md "볼륨 추가·교체"](runbook.md#볼륨-추가교체)의 `$C run --rm tools npm run …` 대신 `deploy/scripts/systemd/rf.sh …`를 쓴다. Docker 오버레이와 Nginx location 파일은 필요 없다. 앱이 파일을 직접 보내기 때문이다.
- **서비스 템플릿**: 경로·계정·포트는 `.env`와 체크아웃 위치에서 온다. 템플릿은 `deploy/systemd/`, `deploy/nginx/host/`에 있고 `scripts/render-template.mjs`가 렌더링한다.
