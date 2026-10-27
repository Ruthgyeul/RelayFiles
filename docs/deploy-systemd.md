# Ubuntu 서버 배포 (systemd + Nginx)

이 문서는 RelayFiles를 Docker 없이 Ubuntu 서버(현재 N95, `192.168.0.100`)에서 운영하는 절차를 다룬다. 앱과 워커는 systemd 서비스로 돌리고, 앞단은 호스트의 Nginx가 맡는다. 아래 예시는 도메인 `relayfiles.io`, 앱 포트 `6000` 기준이다. Docker Compose로 배포하려면 [deploy-ubuntu.md](deploy-ubuntu.md)를 본다(두 방식의 비교도 그 문서 맨 앞에 있다). 운영 중 작업(백업, 복구, 볼륨)은 [runbook.md](runbook.md)에 있다.

각 단계는 **무엇을 하는지 → 명령 → 결과 확인** 순서로 썼다. 막히면 [§12 문제 해결](#12-문제-해결)을 먼저 본다.

## 한눈에 보기

```
[ ] §1  apt 패키지: Nginx, Redis, ffmpeg, Node.js 24, PostgreSQL 16
[ ] §2  /opt/relayfiles에 clone, npm ci, .env 작성
[ ] §3  외장 SSD: LUKS2 암호화·포맷·자동 마운트, relayfiles 계정
[ ] §4  PostgreSQL 역할·DB, Redis 비밀번호·AOF
[ ] §5  install.sh: systemd 유닛·Nginx 사이트 렌더링
[ ] §6  DB 마이그레이션 → 볼륨 등록 → release.sh(빌드·시작) → 관리자 생성
[ ] §7  외부 공개 (Cloudflare Tunnel 또는 포트 포워딩 + Let's Encrypt), 방화벽
[ ] §8  매일 DB 백업 cron
[ ] §10 실서버 확인 목록
[ ] §13 배포 후 보안 점검
```

**누가 무엇을 실행하나.** 이 배포에는 계정이 둘 있다. 헷갈리면 권한 문제가 난다.

| 계정 | 하는 일 | 예 |
|---|---|---|
| 배포 사용자 (예: `ruthgyeul`, sudo 가능) | 코드 소유, `git pull`, `npm ci`, `release.sh`, `rf.sh` 실행 | `/opt/relayfiles` 소유자 |
| `relayfiles` (uid 10001, 로그인 불가) | 서비스 실행, SSD 파일 소유 | `relayfiles-app`, `relayfiles-worker`, `rf.sh`로 실행한 명령 |

`release.sh`, `rf.sh`, `rollback.sh`는 배포 사용자로 실행한다(`sudo` 없이). 안에서 필요한 부분만 `sudo`를 부르므로(서비스 재시작, `relayfiles` 계정으로 실행) 중간에 sudo 비밀번호를 물을 수 있다. `install.sh`, `setup-ssd.sh`만 `sudo`로 실행한다.

## 0. 구성

```
인터넷 ── Cloudflare Tunnel (cloudflared, systemd) ─┐
                                                    ▼
                      nginx :80 (server_name relayfiles.io, systemd)
                                                    │  127.0.0.1:6000
                                                    ▼
             relayfiles-app (Next.js, systemd) ── relayfiles-worker (썸네일·미리보기·메타데이터 제거본·정리·지표·헬스 프로브, systemd)
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

**포트 6000에 대해.** 6000은 X11 포트라서 Chrome·Firefox(`ERR_UNSAFE_PORT`)와 Node의 `fetch`가 접속을 막는다. 그래서 앱은 `127.0.0.1:6000`에만 열고, 브라우저는 항상 Nginx(80/443)로 들어오게 한다. 방화벽이나 공유기에서 6000을 열지 않는다. 워커의 헬스 프로브는 `fetch` 대신 Node http 클라이언트를 쓰므로 6000에서도 동작한다. 다른 포트(예: 3000)를 써도 된다. `APP_PORT`만 바꾸고 `install.sh`를 다시 실행한다.

**X-Accel은 쓰지 않는다.** SSD의 파일은 `relayfiles`만 읽을 수 있고, 호스트 Nginx는 `www-data`로 돈다. 그래서 `STORAGE_ACCEL_ENABLED=false`로 두고 앱이 파일을 직접 보낸다. 영상 탐색(Range)과 혼잡 시 속도 제한은 이 방식에서도 똑같이 동작한다.

### 요청이 흐르는 방식

1. **방문자 → Nginx**: cloudflared(같은 서버의 `127.0.0.1`) 또는 LAN에서 Nginx `:80`으로 들어온다. `server_name`이 `SERVER_NAME`과 같은 요청만 이 사이트가 받는다.
2. **Nginx → 앱**: `127.0.0.1:APP_PORT`로 넘긴다. 업로드(`/api/uploads/tus`)는 버퍼링 없이 바로 흘리고, 다운로드는 Nginx 임시 파일에 쌓지 않는다(`proxy_max_temp_file_size 0`).
3. **클라이언트 주소**: Nginx는 `127.0.0.1`(로컬 cloudflared)이 보낸 `CF-Connecting-IP`만 방문자 주소로 믿고, 그 밖의 요청은 TCP 상대 주소를 쓴다. 확정한 주소를 `X-Real-IP`로 앱에 넘기고, 방문자가 보낸 `CF-Connecting-IP`는 비운다. 앱은 이 값으로 로그인 잠금·가입 제한·관리자 대역을 판단하므로, **앱 포트는 반드시 루프백에만** 열어야 한다(`APP_HOST=127.0.0.1`).
4. **파일 전송**: 앱이 권한을 확인한 뒤 SSD에서 직접 읽어 보낸다.
5. **작업 큐**: 앱은 썸네일·미리보기를 Redis 큐에 넣기만 하고 워커가 처리한다. 워커가 멈춰도 사이트는 돈다.

### 디렉터리 구조 (배포 후)

```
/opt/relayfiles/                 코드 (배포 사용자 소유, 755)
├── .env                         0640 <배포 사용자>:relayfiles
├── .app/
│   ├── current -> 20261027…-abc1234    지금 도는 번들 (relayfiles-app의 ExecStart)
│   └── 20261027…-abc1234/       release.sh가 만든 standalone 번들 (최근 3개)
├── deploy/maintenance/on        있으면 점검 모드
└── scripts/worker.mts           워커는 번들이 아니라 체크아웃의 소스로 돈다
/mnt/relayfilesDB/               STORAGE_ROOT (relayfiles 0700): users/, system/
/var/log/relayfiles/             LOG_DIR (relayfiles 0750): error.log, combined.log
/srv/relayfiles/                 DATA_DIR (배포 사용자 0700): backups/, releases.log
/var/lib/relayfiles/             relayfiles 계정의 홈 (npm 캐시)
/etc/systemd/system/relayfiles-{app,worker}.service   렌더링된 유닛 (직접 고치지 않는다)
/etc/nginx/sites-available/relayfiles.conf            렌더링된 사이트 (직접 고치지 않는다)
```

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

확인:

```bash
node -v && npm -v                          # v24.x, 10.x 이상
psql --version                             # 16.x
ffmpeg -version | head -1
systemctl is-active nginx redis-server postgresql
```

Ubuntu 기본 저장소의 PostgreSQL은 배포판마다 메이저 버전이 다르다. 운영 데이터와 덤프 호환성을 위해 프로젝트 기준(16)을 공식 저장소에서 설치한다. 같은 서버에 다른 버전이 이미 있으면 `pg_lsclusters`로 16 클러스터의 포트를 확인해 `.env`의 `POSTGRES_PORT`에 맞춘다.

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

`/home` 아래에 두면 안 된다. 서비스가 홈 디렉터리를 읽지 못한다(`ProtectHome`). `npm ci`는 배포 사용자로 실행한다(`sudo` 아님). `postinstall`이 Prisma 클라이언트를 만든다. `npm ci`는 devDependencies도 설치해야 한다. 워커(`tsx`)와 마이그레이션(`prisma`)은 dependencies에 있지만, 체크아웃에서 하는 빌드(`npm run build`)가 Tailwind·TypeScript 같은 devDependencies를 쓰기 때문이다. 그래서 셸에 `NODE_ENV=production`을 export한 상태로 `npm ci`를 실행하지 않는다(`.env`의 `NODE_ENV`는 상관없다).

`env:secrets` 출력(`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET`)은 처음 정한 뒤 바꾸지 않는다. `TOKEN_*`와 `COOKIE_SECRET`을 그냥 바꾸면 모든 계정이 로그인할 수 없게 된다. 바꿀 때는 [runbook.md "비밀값 교체"](runbook.md#비밀값-교체)를 따른다. `.env`는 서버 밖에도 보관한다.

`.env`에서 바꿀 값:

| 키 | 값 | 이유 |
|---|---|---|
| `NODE_ENV` | `production` | 에러 마스킹, warn 이상만 로그, 파일 로그 |
| `APP_HOST` | `127.0.0.1` (기본값, 그대로 둔다) | Nginx만 앱에 접속한다. `0.0.0.0`으로 바꾸지 않는다 |
| `APP_PORT` | `6000` | |
| `PUBLIC_URL` | `https://relayfiles.io` | 공유 링크 주소. `https`면 쿠키에 `Secure`가 붙는다 |
| `SERVER_NAME` | `relayfiles.io` | Nginx `server_name` |
| `NGINX_LISTEN_PORT` | `80` | cloudflared가 `127.0.0.1:80`으로 연결한다 |
| `POSTGRES_HOST` / `REDIS_HOST` | `127.0.0.1` | |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET` | `env:secrets` 출력 | |
| `STORAGE_ROOT` | `/mnt/relayfilesDB` | |
| `STORAGE_ACCEL_ENABLED` | `false` | §0 참고 |
| `LOG_DIR` | `/var/log/relayfiles` | 앱 로그 |
| `DATA_DIR` | `/srv/relayfiles` | DB 백업, 릴리스 기록 |
| `ADMIN_ALLOWED_CIDRS` | `192.168.0.0/24` (선택) | 관리자 페이지를 집 LAN에서만 연다 (아래 주의) |
| `HEALTH_PROBE_URL` | 비워 둔다 | 기본값 `http://127.0.0.1:6000` |
| `APP_MEMORY_MAX`·`APP_CPUS`·`WORKER_MEMORY_MAX`·`WORKER_CPUS` | 기본 `2G`·`3`·`2G`·`2` | 유닛의 `MemoryMax`·`CPUQuota`가 된다. 서버 사양에 맞춘다 |

`NGINX_LISTEN_HOST`, `DOCKER_DATA_ROOT`, `DOCKER_SUBNET`, `CLOUDFLARED_IP`, `TRUSTED_PROXY_IP`, `CLOUDFLARE_TUNNEL_TOKEN`, `DOCKER_LOG_MAX_SIZE`, `DOCKER_LOG_MAX_FILE`은 Docker 배포에서만, `POSTGRES_PUBLISH`, `REDIS_PUBLISH`는 개발용 compose에서만 쓴다. 그대로 둬도 된다. 계정 용량·만료·업로드 크기 같은 정책 값은 [deploy-ubuntu.md §3 "상황에 따라 조정할 값"](deploy-ubuntu.md#3-env-작성)과 같다.

> **`ADMIN_ALLOWED_CIDRS`와 Cloudflare Tunnel.** 관리자 대역은 방문자의 실제 주소로 검사한다. 집에서도 `https://relayfiles.io`(Tunnel)로 들어가면 주소가 **집 공인 IP**가 되어 `192.168.0.0/24`에 들지 않는다. 관리자 페이지는 LAN에서 `hosts` 파일로(§6) 들어가거나, VPN 대역(예: Tailscale `100.64.0.0/10`)을 함께 적는다.

```bash
npm run env:check -- --production   # 빠지거나 잘못된 키를 목록으로 보여 준다. env:check passed
```

## 3. 외장 SSD (LUKS2 + ext4)

**장치의 모든 데이터가 지워진다.** 스크립트는 `.env`의 `STORAGE_ROOT`, `STORAGE_UID`/`STORAGE_GID`를 읽는다. 크기·모델·시리얼로 맞는 장치인지, 시스템 디스크가 아닌지(`MOUNTPOINTS`) 확인한다.

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,MOUNTPOINTS
sudo deploy/scripts/setup-ssd.sh /dev/sdX --dry-run
sudo deploy/scripts/setup-ssd.sh /dev/sdX
echo 'ACTION=="add", SUBSYSTEM=="usb", ATTR{power/control}="on"' | sudo tee /etc/udev/rules.d/50-usb-ssd-power.rules
```

스크립트는 다음을 한다.
- 저장소 계정 `relayfiles`를 만든다. 서비스가 이 계정으로 돈다.
- 키 파일 `/etc/relayfiles/ssd.key`를 만들고 복구용 패스프레이즈를 등록한다.
- `crypttab`과 `fstab`에 부팅 시 자동 마운트를 등록한다(`nofail`이라 SSD가 없어도 부팅은 된다).
- `users/`, `system/`을 `0700`으로 만든다.

확인: `findmnt /mnt/relayfilesDB`, `sudo ls -la /mnt/relayfilesDB`(소유자 `relayfiles`), 재부팅 후 자동 마운트.

마운트 옵션의 의미, 결과 확인, 키·LUKS 헤더 백업 방법은 [deploy-ubuntu.md §2](deploy-ubuntu.md#2-외장-ssd-luks2--ext4)를 본다. 키 파일과 패스프레이즈는 서버 밖에도 보관한다.

SSD 대신 이미 마운트된 디스크의 폴더를 쓸 때는 이 스크립트를 실행하지 않는다. 그때는 `relayfiles` 계정을 `install.sh`(§5)가 만들고, 폴더는 직접 만든다: `sudo install -d -o relayfiles -g relayfiles -m 0700 <STORAGE_ROOT>` (§5 다음에).

## 4. PostgreSQL과 Redis

PostgreSQL: `.env`와 같은 이름의 역할과 DB를 만든다. 비밀번호를 물으면 `.env`의 `POSTGRES_PASSWORD`를 넣는다.

```bash
sudo -u postgres createuser --pwprompt relayfiles
sudo -u postgres createdb -O relayfiles relayfiles
```

기본 설정에서는 `127.0.0.1`에서만 접속을 받으므로 따로 열 것이 없다. 접속 확인:

```bash
PGPASSWORD='<POSTGRES_PASSWORD>' psql -h 127.0.0.1 -U relayfiles -d relayfiles -c 'select 1'
```

`password authentication failed`가 나면 비밀번호가 `.env`와 다르다(`sudo -u postgres psql -c "ALTER USER relayfiles PASSWORD '…';"`). `Connection refused`면 16 클러스터의 포트를 `pg_lsclusters`로 확인한다.

Redis: `/etc/redis/redis.conf`에서 아래 세 줄을 확인하거나 고친다.

```conf
bind 127.0.0.1 -::1
requirepass <.env의 REDIS_PASSWORD>
appendonly yes
```

| 설정 | 이유 |
|---|---|
| `bind 127.0.0.1 -::1` | 루프백에서만 받는다 |
| `requirepass` | 같은 서버의 다른 프로세스도 비밀번호 없이 못 쓴다 |
| `appendonly yes` | 재시작해도 작업 큐와 로그인 잠금 카운터가 남는다 |
| `maxmemory-policy noeviction` (기본값) | 작업 큐(BullMQ)에 필요하다. 바꾸지 않는다 |

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

1. 필요한 것(Node 24 이상, npm, nginx, `node_modules`, `/home` 밖의 경로)을 확인하고, `relayfiles` 계정이 없으면 만든다. 계정의 홈(`/var/lib/relayfiles`)을 만든다. npm 캐시용이다.
2. `LOG_DIR`, `DATA_DIR`, `.app/`을 만든다.
3. `.env`를 `0640`, 그룹 `relayfiles`로 바꿔 서비스만 읽게 한다.
4. `deploy/systemd/*.service.template`을 `/etc/systemd/system/relayfiles-{app,worker}.service`로 렌더링하고 `enable`한다. 서비스를 시작하지는 않는다.
5. `deploy/nginx/host/relayfiles.conf.template`을 `/etc/nginx/sites-available/relayfiles.conf`로 렌더링하고 `sites-enabled`에 링크한다. 그 뒤 `nginx -t`를 거쳐 reload한다.

기존 Nginx 사이트(`/var/www/html` 기본 페이지 등)는 그대로 둔다. `relayfiles.io`로 들어온 요청만 이 사이트가 받는다. 렌더링된 파일은 직접 고치지 말고 템플릿을 고친 뒤 `install.sh`를 다시 실행한다. 템플릿에 `.env`에 없는 값이 있으면 렌더링이 멈추고 빠진 키를 알려 준다(반쯤 채워진 설정이 만들어지지 않는다).

서비스 유닛에 들어가는 보호 설정:

| 설정 | 의미 |
|---|---|
| `User=relayfiles`, `UMask=0077` | SSD에 쓰는 파일·폴더가 `0600`/`0700`이 된다 |
| `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome`, `PrivateTmp` | 서비스가 `/usr`·`/etc`와 홈 디렉터리를 바꾸거나 읽지 못하고, 자기 `/tmp`를 따로 쓴다 |
| `MemoryMax`, `CPUQuota`, `TasksMax=512` | 영상 변환·썸네일 작업이 폭주해도 자기 상한에서 멈춘다(PostgreSQL을 굶기지 않는다) |
| `Restart=on-failure`, `RestartSec=5` | 비정상 종료 시 5초 뒤 다시 시작 |
| 워커 `TimeoutStopSec=60` | 멈출 때 진행 중인 작업이 끝날 시간을 준다 |

확인:

```bash
systemctl cat relayfiles-app | grep -E 'ExecStart|User|MemoryMax'
sudo systemd-analyze verify /etc/systemd/system/relayfiles-app.service /etc/systemd/system/relayfiles-worker.service
sudo nginx -t
ls -l /opt/relayfiles/.env                     # -rw-r----- <배포 사용자> relayfiles
```

## 6. 첫 실행

```bash
cd /opt/relayfiles
deploy/scripts/systemd/rf.sh db:deploy          # DB 마이그레이션
deploy/scripts/systemd/rf.sh volume:init        # SSD에 볼륨 표시 파일을 만들고 DB에 등록
deploy/scripts/systemd/release.sh               # 빌드 → .app/<릴리스> → 서비스 시작 → 헬스 체크
deploy/scripts/systemd/rf.sh admin:create       # 첫 관리자. 토큰은 한 번만 출력된다
```

| 명령 | 정상 결과 |
|---|---|
| `rf.sh db:deploy` | `All migrations have been successfully applied.` |
| `rf.sh volume:init` | `Volume <uuid> ready at /mnt/relayfilesDB (layout v1).` |
| `release.sh` | 마지막에 `Release <시각>-<커밋> is live.` |
| `rf.sh admin:create` | `name`, `id`, `token` 세 줄. 토큰은 다시 출력되지 않는다 |

`rf.sh <npm 스크립트>`는 명령을 서비스와 같은 `relayfiles` 계정으로 실행한다. umask 077로 실행하므로 SSD에 만드는 파일의 소유자와 권한(`0600`/`0700`)이 서비스와 같다. 이렇게 실행할 명령은 `admin:create`, `volume:*`, `storage:migrate`, `storage:import`(stdin의 tar: `tar -C <폴더> -cf - . | deploy/scripts/systemd/rf.sh storage:import -- --account <id>`), `storage:fsck`, `data:migrate`, `keys:rotate`, `media:backfill`이다. `sudo npm run …`이나 배포 사용자로 직접 `npm run volume:init`을 실행하면 SSD에 root·배포 사용자 소유 파일이 생겨 서비스가 읽지 못한다.

```bash
curl -fsS http://127.0.0.1:6000/api/health                          # 앱 직접
curl -fsS -H 'Host: relayfiles.io' http://127.0.0.1/api/health      # Nginx 경유
systemctl status relayfiles-app relayfiles-worker
```

두 `curl` 모두 `{"success":true,"data":{"status":"ok",…,"components":{"database":"ok","redis":"ok","storage":"ok"}}}`가 나와야 한다. `degraded`면 HTTP 200이어도 `components`에서 `down`인 항목을 본다. 앱 직접 호출은 되는데 Nginx 경유가 기본 페이지(Welcome to nginx)를 돌려주면 `Host`가 `SERVER_NAME`과 다른 것이다.

LAN에서 바로 보려면 PC의 `hosts` 파일(macOS·Linux `/etc/hosts`, Windows `C:\Windows\System32\drivers\etc\hosts`)에 `192.168.0.100 relayfiles.io`를 넣고 `http://relayfiles.io`를 연다. 출력된 토큰으로 로그인한다(사이드바 Add account → Sign in). `PUBLIC_URL`이 `https`인 상태에서 `http`로 열면 `Secure` 쿠키가 저장되지 않아 로그인이 유지되지 않는다. LAN에서 http로 시험할 때는 외부 공개(§7) 전까지 `PUBLIC_URL=http://relayfiles.io`로 두었다가 바꾸고 `sudo systemctl restart relayfiles-app relayfiles-worker`.

로그인하면 바로: 토큰을 비밀번호 관리자에 저장하고, 관리자 → Server 설정에서 가입 모드(Open / Invite only / Closed)를 정한다.

## 7. 외부 공개: `relayfiles.io`

### Cloudflare Tunnel (권장)

포트를 열지 않고 공개한다. TLS 인증서는 Cloudflare가 관리하고, 집 공인 IP가 드러나지 않는다.

1. Cloudflare에 `relayfiles.io`를 추가한다. 도메인 등록 업체에서 네임서버를 Cloudflare로 바꾼다(반영까지 몇 시간 걸릴 수 있다. Cloudflare 화면에서 Active가 되면 된다).
2. Zero Trust → Networks → Tunnels → Create a tunnel(Cloudflared)을 연다. 이름은 예를 들어 `n95`로 하고 토큰을 복사한다.
3. 서버에 cloudflared를 설치하고 서비스로 등록한다.

   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt update && sudo apt install -y cloudflared
   sudo cloudflared service install <터널 토큰>      # systemd 서비스 cloudflared
   ```

4. 터널의 Public Hostname에서 `relayfiles.io`(서브도메인 없음)의 Service를 `HTTP` / `127.0.0.1:80`으로 지정한다. `localhost`가 아니라 `127.0.0.1`로 적는다(IPv6 `::1`로 붙으면 Nginx가 Cloudflare 헤더를 믿지 않는다).
5. `https://relayfiles.io/api/health`를 확인한다.

확인: `systemctl status cloudflared`, `journalctl -u cloudflared -n 50`에 `Registered tunnel connection`, Zero Trust 화면의 터널 상태 HEALTHY.

cloudflared는 같은 서버의 `127.0.0.1`에서 Nginx로 접속한다. Nginx는 이 주소에서 온 `CF-Connecting-IP`만 실제 방문자 주소로 믿는다. 다른 곳에서 보낸 같은 헤더는 무시한다. 무료 요금제의 요청 크기 제한은 100MB이고, 업로드는 50MB 조각(`UPLOAD_CHUNK_SIZE_MB`)으로 나뉘어 이 제한에 걸리지 않는다.

선택: Zero Trust → Access → Applications에서 `relayfiles.io/admin`과 `relayfiles.io/api/admin` 경로에 Access 정책을 걸면 관리자 페이지 앞에 Cloudflare 로그인을 한 번 더 둘 수 있다. 공유 링크(`/d/…`)에는 걸지 않는다.

### 대안: 포트 포워딩 + Let's Encrypt

집 공인 IP가 드러나고 공유기 포트를 연다. Tunnel을 쓸 수 없을 때만 쓴다.

1. 공유기에서 TCP 80과 443을 `192.168.0.100`으로 포워딩한다.
2. DNS에 A 레코드 `relayfiles.io` → 집 공인 IP를 추가한다. Cloudflare를 쓴다면 회색 구름(DNS only)으로 둔다. 공인 IP가 바뀌는 회선이면 DDNS가 필요하다.
3. 인증서를 발급한다.

   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d relayfiles.io --redirect
   ```

4. `.env`의 `PUBLIC_URL=https://relayfiles.io`, `TLS_CERT_PATH=/etc/letsencrypt/live/relayfiles.io/fullchain.pem`(Status 페이지에 만료일 표시. `relayfiles` 계정이 읽을 수 있어야 한다), 앱·워커 재시작.

인증서 갱신은 certbot의 systemd 타이머가 한다(`systemctl list-timers | grep certbot`, `sudo certbot renew --dry-run`).

`install.sh`를 다시 실행하면 사이트 파일이 다시 렌더링되면서 certbot이 넣은 TLS 줄이 빠진다. 스크립트가 이를 감지하고 복구 명령(`sudo certbot install --nginx --cert-name relayfiles.io --redirect`)을 출력한다.

### 방화벽 (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp          # 포트 포워딩 방식이면 443/tcp도. Tunnel만 쓰면 LAN 접속용
sudo ufw enable
sudo ufw status verbose
```

6000, 5432, 6379는 열지 않는다. 셋 다 `127.0.0.1`에서만 수신한다. `sudo ss -tlnp`로 실제 수신 주소를 확인한다(`0.0.0.0:6000`이 보이면 `APP_HOST`가 잘못됐다). LAN 접속도 필요 없고 Tunnel만 쓴다면 `80/tcp`도 열지 않아도 된다(cloudflared는 루프백으로 붙는다). LAN에서만 열려면 `sudo ufw allow from 192.168.0.0/24 to any port 80 proto tcp`.

## 8. 운영 명령

```bash
sudo systemctl restart relayfiles-app relayfiles-worker
journalctl -u relayfiles-app -u relayfiles-worker -f       # 표준 출력
sudo tail -f /var/log/relayfiles/error.log                  # 앱 로그 (LOG_DIR)
sudo tail -f /var/log/nginx/relayfiles.error.log
touch deploy/maintenance/on    # 점검 모드 (/api/health를 뺀 모든 요청에 503 정적 페이지), rm으로 해제
```

| 하고 싶은 것 | 명령 |
|---|---|
| 상태 한 번에 보기 | `systemctl status relayfiles-app relayfiles-worker nginx postgresql redis-server cloudflared` |
| 최근 에러만 | `journalctl -u relayfiles-app -p warning -n 100` |
| 요청 ID로 찾기 | `sudo grep <요청 ID> /var/log/relayfiles/combined.log` |
| `.env`를 바꾼 뒤 | `sudo systemctl restart relayfiles-app relayfiles-worker` (포트·도메인·자원 상한을 바꿨다면 먼저 `sudo deploy/scripts/systemd/install.sh`) |
| 일회성 명령 | `deploy/scripts/systemd/rf.sh <npm 스크립트> [-- 인자]` |
| DB에 접속 | `PGPASSWORD=… psql -h 127.0.0.1 -U relayfiles relayfiles` |

매일 DB 백업 (`crontab -e`, 배포 사용자):

```cron
15 3 * * * /opt/relayfiles/deploy/scripts/systemd/backup.sh >> /srv/relayfiles/backup.log 2>&1
```

다음 날 `ls -l /srv/relayfiles/backups`로 새 덤프가 생겼는지 확인한다. 사용자 파일(SSD)은 따로 다른 디스크에 `rsync`하고, 덤프·`.env`·SSD 키는 서버 밖에도 보관한다([deploy-ubuntu.md §10](deploy-ubuntu.md#10-백업-자동화), [runbook.md "백업"](runbook.md#백업)). systemd 배포에서 DB 복구는 §9의 `pg_restore` 명령을 쓴다.

## 9. 업데이트와 롤백

```bash
cd /opt/relayfiles
git fetch && git log --oneline HEAD..origin/main   # 무엇이 바뀌는지 먼저 본다
git pull
deploy/scripts/systemd/release.sh
```

`release.sh`는 순서대로 아래를 한다. 하나라도 실패하면 멈춘다.

1. DB를 백업한다(`DATA_DIR/backups`, 최근 14개).
2. `npm ci`와 `npm run build`를 한다. 그동안 실행 중인 앱은 자기 번들(`.app/current`)로 계속 응답한다.
3. 새 번들을 `.app/<시각>-<커밋>`에 복사한다(빌드가 복사해 넣은 `.env`는 지운다. 앱은 체크아웃의 `.env`를 읽는다).
4. 점검 모드를 켜고 마이그레이션을 실행한다: `db:deploy`, `data:migrate`, `storage:migrate`.
5. `.app/current`를 새 번들로 바꾸고 app과 worker를 재시작한다.
6. 앱 포트의 `/api/health`가 `status: "ok"`를 돌려줄 때까지 확인한 뒤(`degraded`는 실패로 본다) 점검 모드를 끄고 `DATA_DIR/releases.log`에 기록한다. 번들은 최근 3개만 남긴다.

`HEALTH_TRIES`(기본 30, 2초 간격), `BUNDLE_KEEP`(기본 3), `BACKUP_KEEP`(기본 14)으로 동작을 바꿀 수 있다.

알아 둘 점:
- 앱은 `.app/` 아래 독립 번들로 돌지만, **워커는 체크아웃(`/opt/relayfiles`)의 소스와 `node_modules`로 돈다**. `git pull`과 2단계의 `npm ci`가 실행 중인 워커의 파일을 바꾸므로, 릴리스 중에 워커 로그에 일시적인 에러가 보일 수 있다. 5단계에서 재시작하면 새 코드로 돈다.
- `.env`를 바꾸고 `install.sh`를 다시 실행해야 하는 경우(포트, 도메인, 자원 상한)는 `release.sh` 전에 한다.

### 단계별로 실패했을 때

| 실패한 단계 | 상태 | 할 일 |
|---|---|---|
| 1 백업 | 아무것도 바뀌지 않았다 | `/srv/relayfiles` 권한, PostgreSQL 접속 확인 후 다시 실행 |
| 2 `npm ci`·빌드 | 이전 번들이 계속 응답한다. 워커는 재시작 전까지 옛 코드로 돈다 | 로그를 보고 고친 뒤 다시 실행 |
| 4 마이그레이션 | 스크립트가 끝나면서 점검 모드가 풀리고 이전 번들이 그대로 돈다. 스키마는 실패한 마이그레이션 직전까지 적용됐을 수 있다 | `deploy/scripts/systemd/rf.sh db:deploy`의 출력과 `npx prisma migrate status`로 상태를 본다. 원인을 고친 뒤 다시 `release.sh`. 실패로 표시된 마이그레이션은 `npx prisma migrate resolve --rolled-back <이름>` 후 다시 적용 |
| 6 헬스 체크 | 새 번들로 바뀌었지만 응답이 없거나 `degraded`다. 스크립트가 끝나면서 점검 모드는 풀린다 | `journalctl -u relayfiles-app -u relayfiles-worker -n 200`으로 원인을 보고, 급하면 아래 롤백 |

뷰어 미리보기가 들어간 릴리스로 처음 올릴 때는 한 번 `deploy/scripts/systemd/rf.sh media:backfill -- --previews`를 실행한다.

### 롤백

```bash
deploy/scripts/systemd/rollback.sh              # 바로 이전 번들로
deploy/scripts/systemd/rollback.sh <번들 이름>    # ls .app
```

롤백할 때는 다음을 알아 둔다.
- 앱 번들만 바뀐다. DB 스키마는 expand → contract로 나눠 넣으므로 바로 이전 릴리스는 새 스키마에서도 동작한다.
- 파괴적 변경이 있었다면 [runbook.md "DB 복구"](runbook.md#db-복구)대로 그 릴리스 직전 백업을 복구한다. systemd 배포에서는 `$C exec -T postgres pg_restore …` 대신 아래를 쓴다.

  ```bash
  touch deploy/maintenance/on
  sudo systemctl stop relayfiles-app relayfiles-worker
  PGPASSWORD=… pg_restore -h 127.0.0.1 -U relayfiles -d relayfiles --clean --if-exists <dump>
  sudo systemctl start relayfiles-app relayfiles-worker
  rm deploy/maintenance/on
  ```

- 워커는 체크아웃된 소스로 돈다. 워커 코드도 되돌려야 하면 `git checkout <커밋> && npm ci` 후 `sudo systemctl restart relayfiles-worker`를 실행한다. 되돌린 뒤 다시 최신으로 올릴 때는 `git checkout main && git pull`부터 한다.

### 패키지 업데이트

Node.js, PostgreSQL, Redis, Nginx, ffmpeg는 apt가 관리한다. `sudo apt upgrade` 뒤에는 `sudo systemctl restart relayfiles-app relayfiles-worker`. Node 메이저 버전은 프로젝트 기준(`.nvmrc`, 24)에 맞춘다. PostgreSQL 메이저 버전 업그레이드(16 → 17)는 `pg_upgradecluster`나 덤프·복원으로 따로 진행한다.

## 10. 확인 목록 (실서버)

[deploy-ubuntu.md §8](deploy-ubuntu.md#8-확인-목록-실서버)의 항목을 그대로 확인한다. 다만 아래 항목은 다르게 확인한다.

| 항목 | systemd 배포에서 |
|---|---|
| X-Accel | 해당 없음. 영상 탐색(Range)이 되는지만 확인한다 |
| 앱 중단 | `sudo systemctl stop relayfiles-app` → Nginx의 "Server unreachable" 페이지 → `start`로 복구 |
| 로그 | `$C logs` 대신 `journalctl -u relayfiles-app` |
| Status 페이지 | 워커가 1분마다 `127.0.0.1:6000`을 확인한다. Website·Storage가 초록색인지 본다 |
| 서비스 보호 설정 | `systemctl show relayfiles-app -p UMask -p MemoryMax -p User`가 `0077`, 설정한 상한, `relayfiles` |
| 노출 포트 | `sudo ss -tlnp`에서 6000·5432·6379가 `127.0.0.1`(또는 `::1`)에만 |
| 재부팅 | `sudo reboot` 뒤 SSD 마운트 → PostgreSQL·Redis → 앱·워커·Nginx·cloudflared가 저절로 올라온다 |

## 11. 참고

- **Disk health**: `smartctl`은 root 권한이 필요하다. 앱은 `relayfiles` 계정으로 돌기 때문에 Server 페이지에 "Unavailable"이 표시된다. 호스트에서 `sudo smartctl -d sat -H /dev/sdX`로 확인한다.
- **두 번째 SSD**: [runbook.md "볼륨 추가·교체"](runbook.md#볼륨-추가교체)의 `$C run --rm tools npm run …` 대신 `deploy/scripts/systemd/rf.sh …`를 쓴다. Docker 오버레이와 Nginx location 파일은 필요 없다. 앱이 파일을 직접 보내기 때문이다.
- **서비스 템플릿**: 경로·계정·포트는 `.env`와 체크아웃 위치에서 온다. 템플릿은 `deploy/systemd/`, `deploy/nginx/host/`에 있고 `scripts/render-template.mjs`가 렌더링한다.
- **SSD가 부팅 뒤에 붙는 경우**: 유닛은 SSD 마운트를 기다리지 않는다. SSD가 늦게 붙으면 앱은 볼륨을 offline으로 보고 쓰지 않으며, 워커가 `VOLUME_WATCH_INTERVAL_SEC`(30초)마다 다시 확인해 돌아오면 `ACTIVE`로 바꾼다([runbook.md "SSD가 빠졌을 때"](runbook.md#ssd가-빠졌을-때)).

## 12. 문제 해결

먼저 볼 것: `systemctl status relayfiles-app relayfiles-worker`, `journalctl -u relayfiles-app -n 100`, `curl -fsS http://127.0.0.1:6000/api/health`, 에러 화면의 요청 ID로 `combined.log` 검색.

| 증상 | 원인 | 해결 |
|---|---|---|
| `install.sh`: `Move the checkout out of home directories` | 코드가 `/home` 아래에 있다 | `/opt/relayfiles`로 옮긴다(§2) |
| `install.sh`: `relayfiles cannot read …` | 체크아웃 권한이 닫혀 있다 | `chmod 755 /opt/relayfiles` |
| `install.sh`: `Set these in .env before rendering …` | 템플릿에 필요한 키가 비어 있다 | 출력된 키를 `.env`에 채운다 |
| `nginx -t` 실패: `duplicate default server` 등 | 다른 사이트와 충돌 | `SERVER_NAME`을 실제 도메인으로, 다른 사이트의 `default_server` 확인 |
| 서비스가 `status=203/EXEC` | `NODE_BIN` 경로가 바뀌었다(Node 재설치) | `sudo deploy/scripts/systemd/install.sh` 다시 실행 |
| 서비스가 바로 죽고 로그에 키 목록 | `.env` 값이 잘못됐다 | `npm run env:check -- --production` |
| `.app/current/server.js not found` | 아직 `release.sh`를 실행하지 않았다 | §6의 `release.sh` |
| `EACCES` (SSD 경로) | `rf.sh` 없이 실행해 다른 소유자의 파일이 생겼다 | `sudo chown -R relayfiles:relayfiles <STORAGE_ROOT>`, 이후 `rf.sh`로 실행 |
| `/api/health`가 `storage: down` | SSD 미마운트 또는 `volume:init` 안 함 | `findmnt <STORAGE_ROOT>` → `rf.sh volume:init` → 재시작 |
| `/api/health`가 `database: down` / `redis: down` | 비밀번호·포트 불일치 | §4의 `psql`, `redis-cli ping`으로 따로 확인 |
| 502 "Server unreachable" | 앱이 멈췄다 | `journalctl -u relayfiles-app -n 200` |
| 브라우저 `ERR_UNSAFE_PORT` | 6000에 직접 접속했다 | Nginx(80/443)로 들어간다 |
| 모든 사용자가 같이 로그인 잠금 | cloudflared가 `127.0.0.1`이 아닌 주소(`::1`, LAN IP)로 Nginx에 붙는다 | 터널 Service를 `http://127.0.0.1:80`으로 |
| `/admin`이 집에서도 403 | Tunnel로 들어와 공인 IP로 보인다 | §2 `ADMIN_ALLOWED_CIDRS` 주의 |
| 로그인 후 바로 풀림 | `PUBLIC_URL`이 https인데 http로 접속 | scheme을 맞춘다(§6) |
| certbot 설정이 사라짐 | `install.sh`가 사이트를 다시 렌더링했다 | 스크립트가 출력한 `certbot install …` 실행 |
| 썸네일이 안 생긴다 | 워커가 멈췄거나 ffmpeg 없음 | `systemctl status relayfiles-worker`, `which ffmpeg` → `rf.sh media:backfill` |
| `npm ci` 후 빌드가 `Cannot find module '@tailwindcss/postcss'` 등으로 실패 | devDependencies 없이 설치됐다 | 셸의 `NODE_ENV`를 풀고(`unset NODE_ENV`) `npm ci` |

## 13. 배포 후 보안 점검

[deploy-ubuntu.md §12](deploy-ubuntu.md#12-배포-후-보안-점검)의 항목에 더해:

| 항목 | 기준 |
|---|---|
| 앱 바인딩 | `APP_HOST=127.0.0.1`, `ss -tlnp`에서 6000이 루프백에만 |
| DB·Redis | 루프백에만, Redis `requirepass` 설정 |
| `.env` | `0640 <배포 사용자>:relayfiles` |
| ufw | 활성화, SSH와 필요한 포트만 |
| cloudflared | `127.0.0.1:80`으로 연결 (`localhost`·LAN IP 아님) |
| 패키지 | `unattended-upgrades`로 보안 업데이트 자동 적용 |
