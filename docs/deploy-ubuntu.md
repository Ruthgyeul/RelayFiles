# Ubuntu 서버 배포 (Docker Compose)

RelayFiles를 Ubuntu 서버(현재 N95, `192.168.0.100`)에 Docker Compose로 올리는 절차다. Docker 없이 systemd 서비스와 호스트 Nginx로 운영하려면 [deploy-systemd.md](deploy-systemd.md)를 본다. 구조는 [architecture.md](architecture.md), 보안 모델은 [security.md](security.md). 운영 중 작업(백업, 복구, 롤백, 점검 모드, 볼륨)은 [runbook.md](runbook.md)를 본다.

이 문서는 처음 배포하는 사람이 위에서 아래로 그대로 따라 하면 되도록 썼다. 각 단계는 **무엇을 하는지 → 명령 → 결과 확인 → 자주 나는 문제** 순서다. 막히면 [§11 문제 해결](#11-문제-해결)을 먼저 본다.

## 한눈에 보기

### 어떤 배포 방식을 고를까

| | Docker Compose (이 문서) | systemd + 호스트 Nginx ([deploy-systemd.md](deploy-systemd.md)) |
|---|---|---|
| 설치할 것 | Docker만 (Node, PostgreSQL, Redis, Nginx, ffmpeg는 이미지 안) | Node 24, PostgreSQL 16, Redis, Nginx, ffmpeg를 apt로 |
| 파일 전송 | Nginx가 X-Accel로 직접 보낸다 (앱 부하가 적다) | 앱이 직접 보낸다 |
| 격리 | 컨테이너마다 읽기 전용 루트, capability 없음, 메모리·CPU 상한 | systemd 샌드박스(`ProtectSystem`, `ProtectHome`) + 메모리·CPU 상한 |
| 디스크 이전 | 디스크 하나에 DB·이미지·파일이 다 있어서 옮기기 쉽다 | 호스트 패키지 데이터(`/var/lib/postgresql`)가 시스템 디스크에 있다 |
| 업데이트 | `git pull && deploy/scripts/release.sh` (이미지 빌드) | `git pull && deploy/scripts/systemd/release.sh` (번들 빌드) |
| 맞는 경우 | 서버를 RelayFiles 전용으로 쓰거나, 디스크째 다른 서버로 옮길 계획이 있을 때 | 이미 호스트 Nginx·PostgreSQL을 쓰고 있거나 Docker를 쓰고 싶지 않을 때 |

### 전체 순서 (체크리스트)

```
[ ] §1  패키지 설치, 저장소 clone, 저장 디스크 폴더 구조 정하기
[ ] §2  (SSD를 RelayFiles 전용으로 쓸 때만) LUKS2 암호화·포맷·자동 마운트
[ ] §3  .env 작성 (비밀값 생성, 경로·도메인·관리자 대역)
[ ] §4  setup-docker.sh: Docker 설치, data-root, 호스트 폴더 생성
[ ] §5  이미지 빌드 → DB 마이그레이션 → 볼륨 등록 → 서비스 시작 → 관리자 생성
[ ] §6  외부 공개 (Cloudflare Tunnel / 호스트 Nginx 뒤 / LAN만)
[ ] §8  실서버 확인 목록
[ ] §10 백업 자동화 (cron) — 빠뜨리기 쉽다
[ ] §12 배포 후 보안 점검
```

### 사전 준비물

| 항목 | 기준 |
|---|---|
| OS | Ubuntu Server LTS (24.04 이상 권장), amd64 또는 arm64 |
| 메모리 | 8GB 이상 권장 (기본 상한: app 2G + worker 2G + PostgreSQL·Redis·Nginx). 이미지 빌드(`next build`) 중에 메모리를 가장 많이 쓴다 |
| 디스크 | 시스템 디스크와 별개의 저장 디스크(외장 SSD/HDD). 파일, DB, Docker 이미지를 모두 이 디스크에 둔다 |
| 네트워크 | 서버에 고정 LAN 주소 (공유기 DHCP 예약). 외부 공개는 Cloudflare Tunnel을 권장하므로 공유기 포트를 열 필요가 없다 |
| 도메인 (외부 공개 시) | Cloudflare에 등록된 도메인과 Zero Trust 계정 (무료 요금제로 충분) |
| 접속 | 서버에 SSH(공개키 인증)로 접속할 수 있는 sudo 계정 |

## 0. 구성

```
인터넷 ── Cloudflare Tunnel(cloudflared) ─┐
LAN ─────────────── :NGINX_LISTEN_PORT ───┤
                                          ▼
                                       nginx ── X-Accel ──▶ /mnt/relayfilesDB (외장 SSD, LUKS2, 읽기 전용 마운트)
                                          │
                                          ▼
                     app (Next.js) ── worker (썸네일, 뷰어 미리보기, 메타데이터 제거본, 정리, 지표, 헬스 프로브)
                          │                │
                          ▼                ▼
                   postgres (DATA_DIR/pg)   redis (DATA_DIR/redis)
```

| 서비스 | 이미지 | 외부 공개 | 데이터 |
|---|---|---|---|
| nginx | `nginxinc/nginx-unprivileged:1.30-alpine` | `NGINX_LISTEN_PORT` 하나만 | 없음 (설정은 `deploy/nginx/templates`) |
| app | `Dockerfile` `app` 타깃 (ffmpeg 포함: 브라우저가 못 여는 영상을 재생 중 변환, 동시 `VIDEO_TRANSCODE_MAX`개) | 없음 | SSD (`STORAGE_ROOT`), 로그 (`LOG_DIR`) |
| worker | `Dockerfile` `tools` 타깃 | 없음 | SSD, 로그 |
| postgres / redis | `postgres:16`, `redis:7` | 없음 | `DATA_DIR` (저장 디스크) |
| tools | `tools` 타깃 (`--profile tools`) | 없음 | 마이그레이션, `volume:init`, `admin:create` 같은 일회성 명령 |
| cloudflared | `cloudflare/cloudflared:2026.10.0` (`--profile tunnel`) | 없음 (아웃바운드만) | 없음 |

app·worker·nginx는 모두 저장소 계정(`STORAGE_UID`, 기본 10001)으로 실행한다. SSD의 파일은 이 계정만 읽을 수 있다(디렉터리 `0700`, 파일 `0600`). 빌드 컨텍스트는 `.dockerignore` 허용 목록(Dockerfile이 쓰는 파일만)이라 `.env`, `.app/`, 인증서 같은 파일은 이미지에 들어가지 않는다. tools 이미지는 운영 의존성만 설치한다(`npm ci --omit=dev`). app·tools 이미지는 tini를 PID 1로 실행해 고아 프로세스를 회수하고, 모든 서비스의 컨테이너 로그는 `DOCKER_LOG_MAX_SIZE` × `DOCKER_LOG_MAX_FILE`(기본 10m × 5)까지만 남는다.

compose 명령은 항상 **저장소 루트에서** `--env-file .env -f deploy/docker-compose.yml`로 실행한다(§5의 `$C`). `deploy/` 안에서 그냥 `docker compose`를 실행하면 루트의 `.env`를 읽지 못해 `STORAGE_ROOT`가 없다는 오류로 멈춘다.

### 요청이 흐르는 방식

이 구조를 알고 있으면 설정값의 의미와 문제의 원인을 찾기 쉽다.

1. **일반 페이지·API**: 방문자 → (Cloudflare → cloudflared) → nginx `:8080` → app `:APP_PORT`. app은 compose 내부 네트워크(`DOCKER_SUBNET`)에만 있고 호스트 포트를 열지 않는다.
2. **파일 다운로드·재생**: app이 로그인, 공유 링크 권한, 다운로드 한도를 확인한 뒤 본문 대신 `X-Accel-Redirect: /_protected/<volumeId>/<accountId>/<경로>` 헤더만 돌려준다. nginx가 이 헤더를 보고 SSD(읽기 전용 마운트)에서 파일을 직접 보낸다. `/_protected/`는 `internal`이라 바깥에서 직접 요청하면 404다. 앱 프로세스가 대용량 전송에 묶이지 않고, Range(영상 탐색)도 nginx가 처리한다.
3. **업로드**: tus 프로토콜로 `UPLOAD_CHUNK_SIZE_MB`(기본 50MB) 조각씩 `/api/uploads/tus`에 보낸다. nginx는 이 경로를 버퍼링하지 않고 그대로 앱에 흘린다. 조각은 볼륨의 `system/tmp/uploads/`에 쌓이고 완료되면 사용자 폴더로 `rename`된다.
4. **클라이언트 주소 신뢰 체인**: 로그인 잠금·가입 제한·관리자 대역 검사는 방문자 주소를 쓴다. nginx는 고정 주소의 cloudflared(`CLOUDFLARED_IP`)가 보낸 `CF-Connecting-IP`와, 지정한 호스트 프록시(`TRUSTED_PROXY_IP`)가 보낸 `X-Real-IP`만 믿는다. 그 밖의 출처가 보낸 같은 헤더는 버리고 TCP 상대 주소를 쓴다. nginx는 확정한 주소를 `X-Real-IP`로 앱에 넘기고 `CF-Connecting-IP`는 비운다. 그래서 **app 포트를 nginx 밖으로 열면 안 된다**(헤더 위조로 잠금을 우회할 수 있다).
5. **백그라운드 작업**: app은 썸네일·미리보기 작업을 Redis(BullMQ) 큐에 넣기만 한다. worker가 꺼내 처리하므로 worker가 멈춰도 사이트는 동작하고 썸네일만 늦어진다.

## 1. 서버 준비

```bash
sudo apt update
sudo apt install -y git cryptsetup smartmontools curl   # Docker는 §4 setup-docker.sh가 data-root를 먼저 정한 뒤 설치한다
git clone https://github.com/Ruthgyeul/RelayFiles.git ~/RelayFiles
cd ~/RelayFiles
```

> Docker를 직접 설치한다면 `docker.io`·`docker-compose-v2`·`docker-buildx`(또는 공식 저장소의 `docker-ce`·`docker-compose-plugin`·`docker-buildx-plugin`)를 쓴다. 이미지 빌드에 BuildKit이 필요하다(`Dockerfile`의 `RUN --mount=type=secret`). `docker compose version`이 2.20 이상이면 된다.

> Docker를 이미 설치해 `/var/lib/docker`에 이미지가 있다면 그대로 둬도 된다. §4의 스크립트가 새 data-root가 비어 있을 때 한 번 복사한다.

서비스가 쓰는 모든 것(파일, DB, Redis, 백업, 로그, Docker 이미지·컨테이너)은 저장 디스크의 한 폴더 아래에 둔다. 그래야 디스크만 옮겨 다른 서버에서 그대로 이어서 운영할 수 있다(§9 "디스크 이전"). 예: 외장 HDD `/mnt/RuthVault2T`

```
/mnt/RuthVault2T/relayfilesDB/
├── storage/   STORAGE_ROOT      사용자 원본 파일 (uid 10001, 0700)
├── logs/      LOG_DIR           앱·워커 파일 로그
├── data/      DATA_DIR          pg/ (PostgreSQL), redis/, backups/ (pg_dump), releases.log
└── docker/    DOCKER_DATA_ROOT  Docker data-root (이미지, 컨테이너, 빌드 캐시, 컨테이너 로그)
```

저장 디스크를 쓰는 방법은 두 가지다. 하나를 고른다.

| 방법 | 언제 | 할 일 |
|---|---|---|
| A. 이미 마운트된 디스크의 한 폴더 (위 예) | 다른 용도로도 쓰는 큰 디스크가 이미 있을 때 | 디스크 암호화·자동 마운트는 직접 설정하고 §2는 건너뛴다. 폴더는 §4가 만든다 |
| B. SSD 하나를 `STORAGE_ROOT` 전용으로 | 빈 SSD를 RelayFiles 파일 전용으로 쓸 때 | §2 `setup-ssd.sh`가 장치를 지우고 LUKS2 + ext4로 만들어 `STORAGE_ROOT`에 마운트한다. `DATA_DIR`·`DOCKER_DATA_ROOT`는 다른 디스크(또는 같은 SSD의 다른 경로가 아닌 별도 디스크)에 둔다 |

방법 A에서 디스크가 부팅 때 자동으로 마운트되는지 먼저 확인한다(`findmnt /mnt/RuthVault2T`, `/etc/fstab`에 `nofail` 포함). 마운트되지 않은 상태로 Docker가 뜨면 빈 마운트 지점에 쓰게 되므로, §4가 Docker를 그 디스크에 묶는다(`RequiresMountsFor`).

`.env`(§3)를 먼저 쓰고 `deploy/scripts/setup-docker.sh`를 한 번 실행한다(§4).

## 2. 외장 SSD (LUKS2 + ext4)

이 절은 SSD 하나를 `STORAGE_ROOT` 전용으로 쓸 때만 해당한다. 스크립트는 장치 전체를 지우고 `STORAGE_ROOT`에 바로 마운트한다. §1처럼 이미 마운트된 저장 디스크(예: `/mnt/RuthVault2T`) 아래 한 폴더에 모두 두는 경우에는 이 스크립트를 실행하지 않는다. 디스크 암호화와 부팅 시 마운트는 직접 설정하고, 폴더는 §4의 `setup-docker.sh`가 만든다.

스크립트는 `.env`의 `STORAGE_ROOT`(절대경로), `STORAGE_UID`/`STORAGE_GID`를 읽는다. §3의 `cp .env.example .env`와 `STORAGE_ROOT` 설정을 먼저 한다(`.env`가 없거나 경로가 상대경로면 멈춘다).

**장치의 모든 데이터가 지워진다.** 먼저 `lsblk`로 장치 이름을 확인한다. 장치 이름(`/dev/sda`, `/dev/sdb`…)은 꽂는 순서에 따라 바뀔 수 있으므로 크기·모델·시리얼로 맞는 장치인지 꼭 확인한다. 시스템 디스크(`/`가 마운트된 장치)를 고르지 않도록 `MOUNTPOINTS` 열도 본다.

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,MOUNTPOINTS
sudo deploy/scripts/setup-ssd.sh /dev/sdX --dry-run   # 실행할 명령만 출력
sudo deploy/scripts/setup-ssd.sh /dev/sdX             # 장치 이름을 다시 입력해야 진행
```

스크립트가 하는 일:

1. 저장소 계정 `relayfiles`(uid/gid `STORAGE_UID`/`STORAGE_GID`)를 만든다. 로그인 셸이 없는 시스템 계정이다.
2. 키 파일 `/etc/relayfiles/ssd.key`(root, `0400`, 4KB 무작위)를 만들고 LUKS2로 암호화한다. 복구용으로 패스프레이즈를 하나 더 등록한다(입력 요청). 키 파일은 부팅 시 자동 해제용, 패스프레이즈는 키 파일을 잃었을 때용이다.
3. ext4(`-m 0`: root 예약 블록 없음. 여유 공간은 앱이 `STORAGE_RESERVE_PERCENT`로 지킨다)로 포맷하고, `/etc/crypttab`과 `/etc/fstab`에 부팅 시 자동 해제·마운트를 등록한다.
4. `.env`의 `STORAGE_ROOT`(예: `/mnt/relayfilesDB`)에 마운트하고 `users/`, `system/`을 `0700`으로 만든다.

`/etc/fstab`에 들어가는 마운트 옵션의 의미:

| 옵션 | 의미 |
|---|---|
| `nofail` | SSD가 없거나 해제에 실패해도 부팅은 계속된다. 이때 서비스는 볼륨 표시 파일이 없으므로 쓰지 않는다 |
| `x-systemd.device-timeout=10s` | 장치를 기다리는 시간. 없으면 부팅이 90초 멈춘다 |
| `noexec,nodev,nosuid` | 업로드된 파일이 실행 파일·장치 파일·setuid로 쓰이지 않게 한다 |
| `noatime` | 읽을 때마다 접근 시각을 쓰지 않는다 (SSD 쓰기 감소) |
| `discard` (crypttab) | TRIM을 SSD까지 전달한다 |

결과 확인:

```bash
lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS /dev/sdX   # sdX → relayfilesDB (crypt) → /mnt/relayfilesDB
sudo cryptsetup status relayfilesDB            # type: LUKS2, cipher: aes-xts-plain64
findmnt /mnt/relayfilesDB                      # OPTIONS에 noexec,nodev,nosuid
sudo ls -la /mnt/relayfilesDB                  # users/ system/ — drwx------ 10001 10001
sudo reboot                                    # 재부팅 후 같은 명령으로 자동 마운트 확인
```

**키 보관.** 키 파일과 패스프레이즈를 둘 다 잃으면 파일을 복구할 수 없다. 서버 밖에 보관한다.

```bash
sudo cp /etc/relayfiles/ssd.key /media/<USB>/relayfiles-ssd.key            # 오프라인 USB 등
sudo cryptsetup luksHeaderBackup /dev/sdX --header-backup-file /media/<USB>/relayfiles-luks-header.img
```

LUKS 헤더가 손상되면 키가 있어도 열 수 없으므로 헤더 백업도 같이 둔다. 헤더 백업은 그 시점의 키로 열리므로 키를 바꾼 뒤에는 다시 만든다.

USB SSD는 절전으로 끊기지 않게 한다.

```bash
echo 'ACTION=="add", SUBSYSTEM=="usb", ATTR{power/control}="on"' | sudo tee /etc/udev/rules.d/50-usb-ssd-power.rules
sudo udevadm control --reload-rules
sudo smartctl -d sat -a /dev/sdX | head -20     # SMART 확인
```

## 3. `.env` 작성

모든 주소·경로·포트·비밀값은 `.env` 하나에 있다. 코드와 compose 파일에는 값이 없다.

```bash
cp .env.example .env
# 비밀값 생성 (출력만 한다). 서버에 Node가 없으면 Docker로 실행한다
docker run --rm -v "$PWD":/w -w /w node:24-trixie-slim node scripts/env-secrets.mjs
chmod 600 .env
nano .env
```

> §4 전이라 Docker가 아직 없으면 `openssl rand -base64 32`(`TOKEN_ENC_KEY`)와 `openssl rand -base64 36`(나머지)으로 만들어도 된다. `TOKEN_ENC_KEY`는 **정확히 32바이트를 base64로** 인코딩한 값이어야 하고, 나머지는 각각 최소 길이(비밀번호 16자, 키 32자)를 넘으면 된다.

출력된 다섯 줄(`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET`)을 `.env`의 같은 키에 붙여 넣는다. 이 값들은 처음 정한 뒤 바꾸지 않는다. 특히 `TOKEN_*`와 `COOKIE_SECRET`을 그냥 바꾸면 모든 계정이 로그인할 수 없게 된다. 바꿀 때는 [runbook.md "비밀값 교체"](runbook.md#비밀값-교체)를 따른다. `.env`는 서버 밖(비밀번호 관리자 등)에도 보관한다.

운영에서 꼭 바꿀 값:

| 키 | 값 |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | 공유 링크 주소, 예: `https://files.example.com` (LAN만 쓰면 `http://192.168.0.100`). `https`면 쿠키에 `Secure`가 붙는다 |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET` | `env:secrets` 출력 |
| `STORAGE_ROOT` | `/mnt/relayfilesDB` (절대경로). 외장 HDD 예: `/mnt/RuthVault2T/relayfilesDB/storage` |
| `DATA_DIR` | PostgreSQL·Redis·백업. 예: `/mnt/RuthVault2T/relayfilesDB/data` |
| `LOG_DIR` | 예: `/mnt/RuthVault2T/relayfilesDB/logs` |
| `DOCKER_DATA_ROOT` | Docker data-root. 예: `/mnt/RuthVault2T/relayfilesDB/docker` |
| `SERVER_NAME` | 도메인 또는 `_` (모든 이름) |
| `NGINX_LISTEN_HOST` | 호스트 Nginx가 앞에 있거나 Tunnel만 쓰면 `127.0.0.1`, 컨테이너 Nginx를 LAN에 바로 열면 `0.0.0.0` |
| `NGINX_LISTEN_PORT` | 컨테이너 Nginx를 여는 포트 (기본 80. 호스트 Nginx가 80을 쓰면 다른 포트) |
| `ADMIN_ALLOWED_CIDRS` | 관리자 페이지를 LAN에서만 열려면 `192.168.0.0/24` (아래 주의 참고) |
| `CLOUDFLARE_TUNNEL_TOKEN` | 터널을 쓸 때만 |
| `DISK_DEVICE` | Server 페이지 Disk health 대상 (예: `/dev/sda`) |
| `TRUSTED_PROXY_IP` | 호스트 Nginx가 앞에 있을 때만 Docker 게이트웨이(기본 `172.28.0.1`, §6) |
| `DOCKER_LOG_MAX_SIZE`, `DOCKER_LOG_MAX_FILE` | 컨테이너 로그 회전 (기본 `10m`, `5`) |

상황에 따라 조정할 값:

| 키 | 기본 | 언제 바꾸나 |
|---|---|---|
| `ANON_TOTAL_QUOTA_GB` | 없음 | 익명 가입을 열어 둘 때. 디스크 크기보다 작게 잡아 낯선 사용자가 디스크를 채우지 못하게 한다 |
| `DEFAULT_QUOTA_GB` / `ACCOUNT_TTL_DAYS` | 5 / 14 | 새 계정의 용량과 자동 삭제일 |
| `UPLOAD_MAX_FILE_SIZE_GB` | 없음 | 파일 하나의 최대 크기 |
| `UPLOAD_CHUNK_SIZE_MB` | 50 | Cloudflare를 쓰면 100 미만으로 둔다 (Nginx `client_max_body_size`는 `NGINX_MAX_BODY_MB`, 기본 100) |
| `NGINX_MAX_BODY_MB`, `NGINX_AUTH_RATE_PER_MIN`, `NGINX_AUTH_BURST`, `NGINX_UPLOAD_RATE_PER_MIN`, `NGINX_UPLOAD_BURST` | 100, 20, 20, 60, 30 | 두 Nginx 템플릿(compose·호스트)의 요청 크기와 주소별 요청 수 제한. 바꾸면 nginx를 다시 만든다(`docker compose up -d nginx`, systemd는 `install.sh`) |
| `APP_MEMORY_MAX`·`APP_CPUS`·`WORKER_MEMORY_MAX`·`WORKER_CPUS` | 2G·3·2G·2 | 서버 사양에 맞춰. 둘의 합이 전체 메모리의 절반 정도면 PostgreSQL이 여유 있다 |
| `VIDEO_TRANSCODE_MAX` | 2 | 동시 영상 변환 수. CPU가 약하면 1, 끄려면 0 |
| `JOBS_TIMEZONE`·`CLEANUP_CRON` | `Asia/Seoul`·`0 4 * * *` | 매일 정리 작업 시각 |
| `TLS_CERT_PATH` | 없음 | 서버에서 직접 TLS를 쓸 때 Status 페이지에 만료일을 보이려면 |

`POSTGRES_HOST`, `REDIS_HOST`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_ACCEL_ENABLED`, `HEALTH_PROBE_URL`은 compose가 컨테이너용 값으로 덮어쓴다. 그대로 둬도 된다. `APP_HOST`도 compose 안에서는 쓰이지 않는다(app 컨테이너는 내부 네트워크에서 `0.0.0.0`으로 열고, 호스트 포트는 공개하지 않는다).

> **`ADMIN_ALLOWED_CIDRS`와 Cloudflare Tunnel.** 관리자 대역은 방문자의 실제 주소로 검사한다. 집 안에서도 `https://files.example.com`(Tunnel)으로 들어가면 Cloudflare를 거쳐 오므로 주소가 **집 공인 IP**가 되어 `192.168.0.0/24`에 들지 않는다. 그래서 관리자 페이지는 LAN 주소(`http://192.168.0.100:<NGINX_LISTEN_PORT>`)로 들어가거나, Tailscale 같은 VPN 대역을 함께 적는다(예: `192.168.0.0/24,100.64.0.0/10`). LAN 주소로 들어가려면 `NGINX_LISTEN_HOST=0.0.0.0`이어야 한다. 비워 두면 어디서나 열리므로 `env:check`가 경고한다.

#### 상황별 예시

```ini
# (1) Cloudflare Tunnel로만 공개, LAN에서는 관리자 페이지만 직접 접속
NODE_ENV=production
PUBLIC_URL=https://files.example.com
SERVER_NAME=_
NGINX_LISTEN_HOST=0.0.0.0        # LAN 접속이 필요 없으면 127.0.0.1 (cloudflared는 내부 네트워크로 nginx에 붙는다)
NGINX_LISTEN_PORT=80
ADMIN_ALLOWED_CIDRS=192.168.0.0/24
CLOUDFLARE_TUNNEL_TOKEN=eyJ...

# (2) 호스트에 이미 Nginx(TLS)가 있고 그 뒤에 둘 때
PUBLIC_URL=https://files.example.com
NGINX_LISTEN_HOST=127.0.0.1
NGINX_LISTEN_PORT=8081
TRUSTED_PROXY_IP=172.28.0.1

# (3) LAN 전용
PUBLIC_URL=http://192.168.0.100
NGINX_LISTEN_HOST=0.0.0.0
NGINX_LISTEN_PORT=80
```

빠진 값은 첫 실행 때 컨테이너가 "어떤 키가 왜 잘못됐는지" 목록을 출력하고 멈춘다. 미리 확인하려면 이미지를 빌드한 뒤(§5) `$C run --rm tools npm run env:check`를 실행한다. `env:check passed`가 나오면 된다.

## 4. 디렉터리

```bash
sudo deploy/scripts/setup-docker.sh --dry-run   # 실행할 명령만 출력
sudo deploy/scripts/setup-docker.sh
```

스크립트가 하는 일(다시 실행해도 안전하다):

1. `/etc/docker/daemon.json`에 `data-root`(`DOCKER_DATA_ROOT`)와 `log-driver: local`을 쓴다(compose 밖에서 띄운 컨테이너용. compose 서비스는 `json-file`로 `DOCKER_LOG_MAX_SIZE` × `DOCKER_LOG_MAX_FILE`만 남긴다). 다른 설정이 이미 있으면 멈추고 직접 넣으라고 안내한다.
2. 경로가 외장 디스크에 있으면 `docker.service`에 `RequiresMountsFor`를 추가한다. 디스크가 마운트된 뒤에만 Docker가 켜지고, 디스크를 내리면 Docker도 멈춘다.
3. `STORAGE_ROOT`(uid `STORAGE_UID`, `0700`), `LOG_DIR`, `DATA_DIR`, `DATA_DIR/pg`, `DATA_DIR/redis`, `DATA_DIR/backups`를 만든다. compose는 이 폴더들을 만들지 않는다(`create_host_path: false`). 디스크가 마운트되지 않았으면 빈 마운트 지점에 쓰지 않고 컨테이너가 시작을 거부한다.
4. Docker가 없으면 설치하고, 실행한 사용자를 `docker` 그룹에 넣는다.
5. Docker가 다른 data-root로 이미 돌고 있었고 새 경로가 비어 있으면, 옛 data-root를 한 번 복사한다(이미지를 다시 받지 않아도 된다). 옛 폴더는 지우지 않는다. 확인 후 안내대로 직접 지운다.

`STORAGE_UID`/`STORAGE_GID`는 호스트 계정과 상관없는 고정 uid다(기본 10001). 컨테이너 안에서만 쓰므로 서버를 옮겨도 파일 소유자를 바꿀 필요가 없다. 호스트에서 `ls -l`로 보면 소유자가 이름 없이 `10001`로 보이는 것이 정상이다(§2 방법 B로 만들었다면 `relayfiles`).

끝나면 **로그아웃했다가 다시 로그인**한다. `docker` 그룹은 새 로그인부터 적용된다. 그 전에 `docker` 명령을 쓰면 `permission denied while trying to connect to the Docker daemon socket`이 난다.

결과 확인:

```bash
docker info --format '{{.DockerRootDir}}'      # DOCKER_DATA_ROOT와 같아야 한다
systemctl cat docker.service | grep RequiresMountsFor
sudo ls -ld "$(grep ^STORAGE_ROOT= .env | cut -d= -f2)"   # drwx------ 10001 10001
docker compose version                         # v2.20 이상
```

## 5. 첫 실행

```bash
C="docker compose --env-file .env -f deploy/docker-compose.yml"   # 저장소 루트에서
[ -f deploy/docker-compose.volumes.yml ] && C="$C -f deploy/docker-compose.volumes.yml"   # SSD를 더 붙였다면(§9)

$C build                                         # app, tools 이미지
$C run --rm tools npm run env:check             # .env 검증 (env:check passed)
$C up -d postgres redis
$C run --rm tools npm run db:deploy             # 마이그레이션 적용
$C run --rm tools npm run volume:init           # SSD에 볼륨 표시 파일을 만들고 DB에 등록
$C up -d app worker nginx
curl -fsS http://127.0.0.1:80/api/health   # NGINX_LISTEN_PORT를 바꿨다면 그 포트. {"success":true,...,"status":"ok"}
$C run --rm tools npm run admin:create          # 첫 관리자. 토큰은 한 번만 출력된다
```

> `$C`는 셸 변수라서 새 터미널을 열면 사라진다. 자주 쓰면 `~/.bashrc`에 `alias rfc='docker compose --env-file ~/RelayFiles/.env -f ~/RelayFiles/deploy/docker-compose.yml'`처럼 등록해 둔다. 이때도 명령은 저장소 루트에서 실행한다.

각 명령이 하는 일과 정상 결과:

| 명령 | 하는 일 | 정상 결과 |
|---|---|---|
| `$C build` | `app`(standalone 서버), `tools`(워커·스크립트) 이미지를 만든다. 첫 빌드는 의존성 설치와 `next build` 때문에 오래 걸린다 | `relayfiles-app:latest`, `relayfiles-tools:latest` (`docker image ls relayfiles-*`) |
| `env:check` | 앱과 같은 규칙으로 `.env`를 검사한다 | `env:check passed`. 문제가 있으면 키별 사유 목록 |
| `up -d postgres redis` | DB·Redis를 띄운다. 처음에는 `DATA_DIR/pg`에 데이터 디렉터리를 초기화한다 | `$C ps`에서 둘 다 `healthy` |
| `db:deploy` | `prisma/migrations/`의 SQL을 순서대로 적용한다 | `All migrations have been successfully applied.` |
| `volume:init` | `STORAGE_ROOT`에 `.relayfiles-volume` 표시 파일을 만들고 `StorageVolume`에 등록한다. 다시 실행해도 같은 볼륨으로 인식한다 | `Volume <uuid> ready at /mnt/relayfilesDB (layout v1).` |
| `up -d app worker nginx` | 서비스 시작. app은 30초마다 헬스체크를 받는다 | `$C ps`에서 app `healthy`, worker·nginx `running` |
| `curl …/api/health` | nginx → app → DB·Redis·볼륨 표시 파일 확인 | `{"success":true,"data":{"status":"ok",…,"components":{"database":"ok","redis":"ok","storage":"ok"}}}` |
| `admin:create` | 만료·용량 제한이 없는 관리자 계정을 만든다 | `name`, `id`, `token` 세 줄. 토큰은 다시 출력되지 않는다 |

`/api/health`의 `status`가 `degraded`면 HTTP 200이어도 무언가 빠진 것이다. `components`에서 `down`인 항목을 본다(`storage: down`이면 볼륨 표시 파일이 없거나 SSD가 마운트되지 않았다. `volume:init`을 실행했는지 확인한다).

브라우저에서 `PUBLIC_URL`을 열고 출력된 토큰으로 로그인한다(사이드바 Add account → Sign in). 로그인하면 바로:

1. 토큰을 비밀번호 관리자에 저장한다. 로그인한 기기의 프로필에서 다시 볼 수 있지만, 모든 기기에서 로그아웃하면 다시 볼 방법이 없다(그때는 `admin:create`로 새 관리자를 만든다).
2. 관리자 → Server 설정에서 가입 모드(Open / Invite only / Closed)를 정한다. 아는 사람끼리만 쓸 거면 Invite only나 Closed로 둔다.
3. 작은 파일 하나를 올리고 내려받아 §8의 "원본 그대로 저장"을 확인한다.

### 부팅 시 자동 시작 (compose를 감싸는 systemd 유닛은 만들지 않는다)

재부팅 뒤 서비스가 다시 뜨는 데 필요한 것은 이미 다 있다.

1. `docker.service`가 부팅 때 켜진다(`systemctl is-enabled docker` → `enabled`, §4가 설정).
2. §4의 `RequiresMountsFor` 때문에 Docker는 저장 디스크가 마운트된 뒤에만 켜진다.
3. Docker는 켜질 때 `restart: unless-stopped`인 컨테이너(이 compose의 모든 서비스)를 직접 다시 시작한다. 사람이 `$C stop`으로 멈춘 컨테이너만 그대로 둔다.
4. 컨테이너가 죽으면 Docker가 다시 띄우고, app은 `HEALTHCHECK`로 상태가 표시된다.

그래서 `docker compose up`을 실행하는 별도 systemd 유닛(예: `relayfiles.service`)은 **필요 없고, 오히려 문제를 만든다.**

| 감싸는 유닛의 형태 | 생기는 문제 |
|---|---|
| `ExecStart=docker compose up`(포그라운드) + `Restart=always` | `release.sh`가 app·worker를 새 태그로 다시 만드는 순간 유닛의 `compose up`이 끝나고, systemd가 다시 실행하면서 `RELEASE_TAG` 없이(= 아직 이전 릴리스인 `latest`) 컨테이너를 되돌릴 수 있다. 릴리스가 성공한 것처럼 보이는데 옛 버전이 도는 상태가 된다 |
| `ExecStop=docker compose down` | `systemctl stop`·`restart`·재부팅 때마다 컨테이너가 지워진다. 점검 모드 없이 사이트가 내려가고, `--env-file`·볼륨 오버레이가 빠져 있으면 다시 올라오지도 않는다 |
| `--env-file .env`나 `-f deploy/docker-compose.volumes.yml` 없이 실행 | `STORAGE_ROOT` 오류로 실패하거나, 추가 SSD가 마운트되지 않은 채 뜬다 |
| `Type=oneshot` + `up -d` | 해는 없지만 Docker가 이미 하는 일을 반복할 뿐이다 |

이미 그런 유닛을 만들었다면 먼저 무엇을 하는지 본다.

```bash
systemctl list-unit-files | grep -i relay       # 이름 확인
systemctl cat <유닛 이름>                        # ExecStart / ExecStop / Restart 확인
systemctl status <유닛 이름>                     # 실제로 무엇이 떠 있는지
```

정리할 때는 `ExecStop`에 `down`이 있으면 `--now` 없이 끈다(바로 멈추면 사이트가 내려간다).

```bash
sudo systemctl disable <유닛 이름>               # 다음 부팅부터 실행하지 않음 (지금 컨테이너는 그대로)
$C ps                                            # 모든 서비스가 Up인지 확인
# 다음 점검 시간에: sudo systemctl stop <유닛 이름> → $C up -d → 컨테이너 확인
#                   → sudo rm /etc/systemd/system/<유닛 이름> && sudo systemctl daemon-reload
```

정리한 뒤 한 번 재부팅해 §8의 "재부팅" 항목을 확인한다. 호스트 Nginx와 cloudflared는 각자 apt 패키지의 systemd 서비스(`nginx`, `cloudflared`)로 돌므로 그대로 둔다.

## 6. 외부 공개

세 가지 중 하나를 고른다. 집 서버는 Cloudflare Tunnel을 권장한다. 공유기 포트를 열지 않고, 집 공인 IP가 드러나지 않으며, TLS 인증서를 Cloudflare가 관리한다.

### Cloudflare Tunnel (권장)

1. Cloudflare Zero Trust → Networks → Tunnels에서 터널을 만들고(커넥터 종류는 Cloudflared) 토큰을 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣는다. 설치 안내 화면의 명령(`cloudflared service install eyJ...`)에서 `eyJ`로 시작하는 부분이 토큰이다. 호스트에 cloudflared를 설치하지는 않는다(컨테이너로 돈다).
2. 터널의 Public hostname: `files.example.com` → Service Type `HTTP`, URL `nginx:8080`. 주소는 compose 네트워크 안의 서비스 이름이라 그대로 적는다.
3. `$C --profile tunnel up -d cloudflared`
4. 확인: `$C logs cloudflared`에 `Registered tunnel connection`이 4개 보이고, Zero Trust 화면의 터널 상태가 HEALTHY, `curl -fsS https://files.example.com/api/health`가 `ok`.

cloudflared는 compose 네트워크에서 고정 주소(`CLOUDFLARED_IP`)를 쓴다. Nginx는 이 주소에서 온 요청의 `CF-Connecting-IP`만 실제 클라이언트 주소로 믿는다. 다른 곳에서 보낸 같은 헤더는 무시한다. cloudflared는 바깥으로 연결만 하므로 공유기에서 열 포트가 없다. 이 방식만 쓰고 LAN 접속이 필요 없으면 `NGINX_LISTEN_HOST=127.0.0.1`로 두어 호스트 포트도 닫는다.

Cloudflare 무료 요금제의 요청 크기 제한은 100MB다. 업로드는 `UPLOAD_CHUNK_SIZE_MB`(기본 50) 단위로 나뉘어 이 제한에 걸리지 않는다. 다운로드 크기에는 이 제한이 없다.

선택: Cloudflare Zero Trust → Access → Applications에서 `files.example.com/admin`(그리고 `/api/admin`) 경로에 Access 정책을 걸면, 관리자 페이지에 들어가기 전에 Cloudflare 로그인(이메일 OTP 등)을 한 번 더 요구할 수 있다. 공유 링크(`/d/…`)와 일반 경로에는 걸지 않는다.

### 호스트 Nginx 뒤

호스트의 Nginx가 TLS를 맡고 `127.0.0.1:NGINX_LISTEN_PORT`로 넘기는 경우(`NGINX_LISTEN_HOST=127.0.0.1`), 컨테이너 Nginx가 보는 상대 주소는 모든 요청에서 Docker 게이트웨이(`DOCKER_SUBNET`의 첫 주소, 기본 `172.28.0.1`)다. 이대로면 모든 방문자가 같은 IP가 되어 로그인 잠금(`LOGIN_MAX_ATTEMPTS`)과 가입 제한(`SIGNUPS_PER_HOUR`)이 전체 사용자에게 한꺼번에 걸린다.

1. 호스트 Nginx의 `location`에 `proxy_set_header X-Real-IP $remote_addr;`를 둔다.
2. `.env`에 `TRUSTED_PROXY_IP=172.28.0.1`을 넣고(`DOCKER_SUBNET`을 바꿨다면 그 게이트웨이) `$C up -d nginx`.

컨테이너 Nginx는 이 주소에서 온 요청의 `X-Real-IP`만 클라이언트 주소로 믿는다. cloudflared의 `CF-Connecting-IP` 처리는 그대로이고, 다른 출처의 `X-Real-IP`는 무시한다. 게이트웨이 주소는 `docker network inspect relayfiles_relay --format '{{(index .IPAM.Config 0).Gateway}}'`로 확인한다.

이 구성에서 요청은 이렇게 흐른다. 호스트 Nginx가 방문자 주소를 확정해 `X-Real-IP`로 넘기는 것이 핵심이다.

```
방문자 ── Cloudflare ── cloudflared(호스트 systemd) ──▶ 호스트 Nginx :80/443 (도메인, TLS)
                                                        │ X-Real-IP = 방문자 주소
                                                        ▼ 127.0.0.1:NGINX_LISTEN_PORT
                                               컨테이너 Nginx :8080 (TRUSTED_PROXY_IP의 X-Real-IP만 믿음)
                                                        ▼
                                                      app, worker, postgres, redis (compose)
```

`.env`:

```ini
NGINX_LISTEN_HOST=127.0.0.1     # 컨테이너 Nginx는 호스트 Nginx만 접속 (LAN·외부에 직접 노출 안 함)
NGINX_LISTEN_PORT=8081          # 호스트 Nginx가 80을 쓰므로 다른 포트
TRUSTED_PROXY_IP=172.28.0.1     # DOCKER_SUBNET 게이트웨이
SERVER_NAME=_                   # 도메인 검사는 호스트 Nginx가 한다
PUBLIC_URL=https://files.example.com
```

호스트 Nginx 사이트 예시(`/etc/nginx/sites-available/relayfiles`, TLS를 직접 하면 certbot이 `listen 443` 줄을 추가한다):

```nginx
# cloudflared가 같은 호스트에서 127.0.0.1로 붙을 때만 그 X-Forwarded-Proto를 믿는다.
map $realip_remote_addr $relayfiles_proto {
    default   $scheme;
    127.0.0.1 $http_x_forwarded_proto;
}

server {
    listen 80;
    server_name files.example.com;
    client_max_body_size 100m;              # tus 조각(UPLOAD_CHUNK_SIZE_MB)보다 크게

    # cloudflared를 호스트에서 돌릴 때: 로컬 cloudflared가 보낸 CF-Connecting-IP만 방문자 주소로 믿는다.
    # 그 밖의 요청은 TCP 상대 주소($remote_addr)가 그대로 방문자 주소다. cloudflared가 없으면 두 줄을 지운다.
    set_real_ip_from 127.0.0.1;
    real_ip_header CF-Connecting-IP;

    location / {
        proxy_pass http://127.0.0.1:8081;   # NGINX_LISTEN_PORT
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;          # 위에서 확정한 방문자 주소 (방문자가 보낸 값은 덮어쓴다)
        proxy_set_header CF-Connecting-IP "";
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $relayfiles_proto;
        proxy_set_header Connection "";
        proxy_request_buffering off;        # 업로드 조각을 디스크에 모으지 않고 바로 넘긴다
        proxy_buffering off;                # 다운로드·스트리밍을 바로 흘린다
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

cloudflared를 호스트에서 돌린다면 터널의 Public hostname Service는 `http://127.0.0.1:80`(호스트 Nginx)이다. `localhost`로 적으면 IPv6 `::1`로 붙을 수 있고, 그러면 `set_real_ip_from 127.0.0.1`에 맞지 않아 모든 방문자가 같은 주소가 된다. 이때 compose의 `cloudflared` 서비스(`--profile tunnel`)는 띄우지 않는다(둘 중 하나만).

확인:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsS -H 'Host: files.example.com' http://127.0.0.1/api/health     # 호스트 Nginx 경유
curl -fsS http://127.0.0.1:8081/api/health                             # 컨테이너 Nginx 직접
ss -tlnp | grep 8081                                                   # 127.0.0.1:8081만 (0.0.0.0이면 NGINX_LISTEN_HOST 확인)
```

그다음 §8의 "클라이언트 주소" 항목(다른 기기에서만 잠기는지)을 꼭 확인한다. 모두가 같이 잠기면 `TRUSTED_PROXY_IP`가 실제 게이트웨이와 다르거나, 호스트 Nginx에 `X-Real-IP` 줄이 없거나, cloudflared가 `::1`로 붙고 있는 것이다.

### LAN만

`NGINX_LISTEN_PORT`로 바로 접속한다. 포트는 공유기에서 외부로 열지 않는다.

### 방화벽 주의 (Docker와 ufw)

Docker가 공개한 포트(`ports:`)는 iptables 규칙을 직접 넣기 때문에 **ufw 규칙보다 먼저 적용된다**. `ufw deny 80`을 해도 `NGINX_LISTEN_HOST=0.0.0.0`이면 열린다. 노출 범위는 ufw가 아니라 `NGINX_LISTEN_HOST`로 정한다.

| 원하는 것 | 설정 |
|---|---|
| 외부(Tunnel)만, LAN에서도 안 열기 | `NGINX_LISTEN_HOST=127.0.0.1` |
| LAN에서도 접속 | `NGINX_LISTEN_HOST=0.0.0.0` + 공유기 포트 포워딩 하지 않기 |
| 특정 LAN 인터페이스만 | `NGINX_LISTEN_HOST=192.168.0.100` (서버의 LAN 주소) |

PostgreSQL·Redis·app은 호스트 포트를 열지 않으므로 바깥에서 닿지 않는다(`ss -tlnp`로 확인). SSH는 ufw로 관리한다(`sudo ufw allow OpenSSH && sudo ufw enable`).

## 7. 업데이트

```bash
cd ~/RelayFiles
git fetch && git log --oneline HEAD..origin/main   # 무엇이 바뀌는지 먼저 본다
git pull
deploy/scripts/release.sh
```

`release.sh`는 순서대로 다음을 한다. 하나라도 실패하면 멈춘다.

1. DB 백업 (`DATA_DIR/backups`, 최근 14개 유지)
2. 이미지 빌드 (태그 = git 커밋)
3. 점검 모드 켜기 (Nginx가 503 점검 페이지를 보여 준다)
4. `prisma migrate deploy`, 데이터 마이그레이션(`data:migrate`), 스토리지 레이아웃(`storage:migrate`)
5. app·worker·nginx 재시작
6. `/api/health`의 `status`가 `ok`가 될 때까지 확인한 뒤(`degraded`는 실패로 본다) 점검 모드를 끄고 `DATA_DIR/releases.log`에 기록. 점검 중에도 Nginx는 `/api/health`만 앱으로 넘긴다
7. 새 이미지에 `latest` 태그도 붙인다. `RELEASE_TAG` 없이 실행하는 `$C run --rm tools …`가 지금 릴리스 이미지를 쓴다.
8. `deploy/scripts/autoclean.sh`로 옛 이미지·빌드 캐시를 정리한다([runbook.md](runbook.md#디스크-정리-autoclean)). 정리가 실패해도 릴리스는 그대로 살아 있다. 건너뛰려면 `AUTOCLEAN=0 deploy/scripts/release.sh`.

방문자가 점검 페이지를 보는 시간은 3–6단계뿐이다. 빌드(2단계) 동안에는 이전 버전이 그대로 응답한다.

환경 변수로 동작을 바꿀 수 있다.

| 변수 | 기본 | 의미 |
|---|---|---|
| `RELEASE_TAG` | 현재 커밋 짧은 해시 | 이미지 태그 |
| `HEALTH_TRIES` | 30 | 헬스 체크 시도 횟수 (2초 간격, 기본 최대 1분) |
| `AUTOCLEAN` | 1 | 0이면 옛 이미지 정리를 건너뛴다 |
| `BACKUP_KEEP` | 14 | 남길 DB 백업 수 |
| `IMAGE_KEEP` | 3 | autoclean이 남길 릴리스 이미지 수 (롤백 가능 범위) |

### 단계별로 실패했을 때

| 실패한 단계 | 상태 | 할 일 |
|---|---|---|
| 1 백업 | 아무것도 바뀌지 않았다 | `DATA_DIR/backups` 권한·디스크 여유를 확인하고 다시 실행 |
| 2 빌드 | 이전 컨테이너가 그대로 돈다 | 빌드 로그를 확인한다. 디스크 부족이면 `deploy/scripts/autoclean.sh` |
| 4 마이그레이션 | 스크립트가 끝나면서 점검 모드가 풀리고 **이전 앱이 그대로 돈다**. 스키마는 실패한 마이그레이션 직전까지 적용됐을 수 있다 | `$C run --rm tools npx prisma migrate status`로 상태를 본다. 원인을 고친 뒤 다시 `release.sh`. 실패로 표시된 마이그레이션은 `npx prisma migrate resolve --rolled-back <이름>`으로 정리한 뒤 다시 적용한다. 데이터·스토리지 마이그레이션은 저장된 커서·저널에서 이어서 실행된다 |
| 6 헬스 체크 | 새 컨테이너가 떠 있지만 응답이 없거나 `degraded`다. 스크립트가 끝나면서 점검 모드는 풀린다 | `$C logs --tail 200 app worker`로 원인을 보고, 급하면 아래 롤백 |

### 롤백

절차와 DB 스키마 규칙은 [runbook.md "롤백"](runbook.md#롤백)에 있다(이전 이미지 태그로 `app`·`worker`를 다시 띄운다).

### 특정 릴리스에서 한 번만 할 일

뷰어 미리보기가 들어간 릴리스로 처음 올릴 때는 한 번 `$C --profile tools run --rm tools npm run media:backfill -- --previews`를 실행한다(그전에 올린 사진의 미리보기 생성). SSD를 더 붙였다면 `deploy/nginx/volumes/*.conf`에 남아 있는 `add_header Cache-Control …` 줄을 지우고 `$C restart nginx`(재생 캐시가 동작하도록, `deploy/nginx/volumes/README.md`).

### 외부 이미지 업데이트

`postgres:16`, `redis:7`처럼 메이저 버전만 고정한 이미지는 `release.sh`가 다시 받지 않는다. 보안 패치를 받으려면 가끔 실행한다.

```bash
$C pull postgres redis nginx cloudflared
$C up -d postgres redis nginx
$C --profile tunnel up -d cloudflared     # 터널을 쓰면
```

PostgreSQL 메이저 버전(16 → 17)은 데이터 디렉터리를 그대로 열 수 없다. 덤프 → 새 버전에 복원 순서로 따로 진행한다.

## 8. 확인 목록 (실서버)

| 항목 | 확인 방법 |
|---|---|
| 원본 그대로 저장 | 업로드 후 `sudo sha256sum /mnt/relayfilesDB/users/<accountId>/<경로>`와 다운로드한 파일의 해시가 같다 |
| 권한 | `sudo ls -l`로 파일 `-rw-------`, 폴더 `drwx------`, 소유자 `relayfiles` |
| 다른 계정 차단 | 다른 브라우저(다른 계정)에서 남의 파일 URL을 열면 404 |
| X-Accel | 다운로드·스트리밍 응답이 Nginx에서 나가고(`$C logs nginx`), 영상 탐색(Range)이 된다 |
| 대용량 재개 | 2GB 이상 업로드 중 네트워크를 끊었다가 다시 연결하면 이어서 올라간다 |
| SSD 분리 | SSD를 빼면 Status 페이지 Storage가 실패로 바뀌고 업로드·다운로드가 503. 다시 꽂고 `sudo cryptsetup open --key-file /etc/relayfiles/ssd.key /dev/sdX relayfilesDB`, `sudo mount /mnt/relayfilesDB`, `$C restart app worker nginx` 후 복구([runbook.md](runbook.md#ssd가-빠졌을-때)) |
| 이름 변경·이동 | 앱에서 바꾼 폴더 구조가 SSD의 디렉터리에 그대로 반영된다 |
| 공유 링크 | 비밀번호, 다운로드 한도, 첫 다운로드 후 삭제, Stream only가 동작한다 |
| 정리 작업 | Accounts → Run cleanup now, Server 페이지 Cleanup job의 마지막 실행 시각 |
| 지표 | Server 페이지 값과 `htop`, `df -h`가 비슷하다 (컨테이너 안에서 재므로 아래 참고) |
| 앱 중단 | `$C stop app` → Nginx의 "Server unreachable" 페이지 → `$C start app`으로 복구 |
| 점검 모드 | `touch deploy/maintenance/on` → `/api/health`를 뺀 모든 요청이 503 "Under maintenance" → `rm`으로 해제 |
| 클라이언트 주소 | 다른 기기에서 틀린 토큰으로 5번 로그인하면 그 기기만 잠기고, 이 기기는 로그인된다 (모두가 같이 잠기면 §6 "호스트 Nginx 뒤" 설정 확인) |
| 관리자 대역 | `ADMIN_ALLOWED_CIDRS` 밖(휴대폰 LTE 등)에서 `/admin`이 403 |
| 노출 포트 | `ss -tlnp`에 `NGINX_LISTEN_HOST:NGINX_LISTEN_PORT`(과 SSH)만 열려 있다 |
| 좀비 프로세스 | `docker top relayfiles-app-1 \| head -3`의 첫 프로세스가 `/usr/bin/tini`, `ps -eo stat \| grep -c '^Z'`가 0 |
| 재부팅 | `sudo reboot` 뒤 디스크 마운트 → Docker → 모든 서비스가 사람 손 없이 다시 올라온다(`restart: unless-stopped`) |
| 백업 | 다음 날 `DATA_DIR/backups`에 새 덤프가 있다(§10) |
| 모바일 | iOS Safari, Android Chrome에서 업로드·미리보기·공유 페이지 |

## 9. 참고

- **Server 페이지 지표**: app이 컨테이너 안에서 잰다. CPU 사용률과 메모리는 컨테이너도 호스트의 `/proc` 값을 보므로 호스트와 거의 같다. 네트워크는 컨테이너 인터페이스 기준이라 RelayFiles 트래픽만 잡힌다(대역폭 그래프의 목적에 맞다). 대역폭과 디스크 read/write 그래프는 worker가 `METRICS_SAMPLE_INTERVAL_SEC`마다 기록한 최근 48시간을 시간당 막대로 보여준다. 디스크 값은 `/proc/diskstats`(네임스페이스가 없어 컨테이너에서도 호스트 값)에서 `/sys/block/<이름>/device`가 있는 물리 디스크만 잡으므로 다른 프로그램의 I/O도 포함된다.
- **Disk health**: `smartctl`은 장치 접근과 root 권한이 필요해서 컨테이너에서는 기본으로 "Unavailable"이 표시된다. SMART 상태는 호스트에서 `sudo smartctl -d sat -H /dev/sdX`로 확인한다. 앱에 보여야 한다면 app 서비스에 `devices`, `cap_add: [SYS_RAWIO]`, root 실행이 필요하므로 권장하지 않는다.
- **두 번째 SSD**: `volume:init -- <경로>`가 Nginx location(`deploy/nginx/volumes/`)을 만들고, 마운트는 `deploy/docker-compose.volumes.yml` 오버레이로 추가한다. 절차와 계정 이동은 [runbook.md](runbook.md#볼륨-추가교체).
- **디스크 이전**: §1의 폴더 하나가 서비스 전체다. 새 서버에서 디스크를 옛 서버와 같은 경로(예: `/mnt/RuthVault2T`)에 마운트하고, 저장소와 `.env`를 옮긴 뒤 `sudo deploy/scripts/setup-docker.sh` → `deploy/scripts/release.sh`를 실행한다. DB에는 볼륨의 절대경로(`StorageVolume.mountPath`)가 저장되므로 경로가 바뀌면 안 된다. 옮기기 전에 `deploy/scripts/backup.sh`로 덤프를 남기고 `$C stop`으로 멈춘다. PostgreSQL 데이터 폴더는 같은 메이저 버전(16)과 같은 CPU 아키텍처에서만 그대로 열린다. 아키텍처가 다르면(예: Raspberry Pi arm64 → x86_64) `DATA_DIR/pg`를 비우고 `pg_restore`로 덤프를 복원한다([runbook.md](runbook.md)).
- **TLS 인증서 만료일**: Cloudflare를 쓰면 앞단 인증서는 Cloudflare가 관리한다. 서버에서 직접 TLS를 쓰는 경우에만 `TLS_CERT_PATH`를 지정한다.
- **배포 후 파일 위치 요약**

  | 무엇 | 어디 |
  |---|---|
  | 코드, `.env`, 점검 플래그 | `~/RelayFiles` (`deploy/maintenance/on`) |
  | 사용자 파일, 썸네일·미리보기, 업로드 임시 조각, 휴지통 | `STORAGE_ROOT` (`users/`, `system/`) |
  | PostgreSQL, Redis, DB 백업, 릴리스 기록 | `DATA_DIR` (`pg/`, `redis/`, `backups/`, `releases.log`) |
  | 앱·워커 로그 | `LOG_DIR` (프로세스마다 `app-`·`worker-`·`tools-` + `error.log`·`combined.log`, 20MB × 5개 순환) |
  | nginx 접근 로그, 컨테이너 표준 출력 | `$C logs <서비스>` (Docker data-root 안) |
  | Docker 이미지·빌드 캐시 | `DOCKER_DATA_ROOT` |
  | SSD 키 | `/etc/relayfiles/ssd.key` (서버 밖에도 보관) |

## 10. 백업 자동화

`release.sh`는 릴리스 때만 DB를 백업한다. 매일 백업은 cron으로 따로 건다. 무엇을 어떻게 백업하는지는 [runbook.md "백업"](runbook.md#백업)을 본다.

```bash
crontab -e      # docker 그룹에 속한 배포 사용자로
```

```cron
# 매일 03:15 DB 덤프 (DATA_DIR/backups, 최근 BACKUP_KEEP=14개)
15 3 * * * cd /home/<사용자>/RelayFiles && deploy/scripts/backup.sh >> /home/<사용자>/relayfiles-backup.log 2>&1
# 매일 03:45 사용자 파일을 다른 디스크로 (DB 덤프 직후라 시점이 맞는다)
45 3 * * * sudo rsync -aHAX --delete <STORAGE_ROOT>/ /mnt/<백업 디스크>/relayfilesDB/ >> /home/<사용자>/relayfiles-rsync.log 2>&1
# 매주 일요일 05:15 백업 검증: 최신 덤프를 임시 컨테이너에 복원해 운영과 비교 + fsck 보고 (runbook.md "백업 검증")
15 5 * * 0 cd /home/<사용자>/RelayFiles && deploy/scripts/verify-backup.sh >> /home/<사용자>/relayfiles-verify.log 2>&1
```

- cron에는 `PATH`가 짧으므로 `docker`를 못 찾으면 crontab 맨 위에 `PATH=/usr/local/bin:/usr/bin:/bin`을 넣는다.
- `rsync`를 cron에서 `sudo`로 쓰려면 그 명령만 비밀번호 없이 허용한다(`sudo visudo -f /etc/sudoers.d/relayfiles-backup`에 `<사용자> ALL=(root) NOPASSWD: /usr/bin/rsync`). 아니면 root의 crontab(`sudo crontab -e`)에 넣는다.
- 백업 디스크가 같은 서버에 붙어 있으면 서버 고장·도난에는 소용이 없다. `DATA_DIR/backups`의 덤프와 `.env`, SSD 키는 주기적으로 서버 밖(다른 기기, 클라우드의 암호화된 저장소)에도 둔다.
- **복원 연습**을 한 번 해 둔다. 덤프가 있어도 복원해 본 적이 없으면 백업이 아니다([runbook.md "DB 복구"](runbook.md#db-복구)).

## 11. 문제 해결

먼저 볼 것: `$C ps`(상태), `$C logs --tail 100 app worker nginx`(로그), `curl -fsS http://127.0.0.1:${NGINX_LISTEN_PORT:-80}/api/health`(구성 요소별 상태), 에러 화면의 요청 ID로 `LOG_DIR/app-combined.log` 검색.

| 증상 | 원인 | 해결 |
|---|---|---|
| `required variable STORAGE_ROOT is missing a value` | 저장소 루트가 아닌 곳에서 실행했거나 `--env-file .env`를 빠뜨렸다 | 저장소 루트에서 `$C ...`로 실행 |
| `invalid mount config … bind source path does not exist` | `STORAGE_ROOT`·`LOG_DIR`·`DATA_DIR/pg` 등이 없다. 디스크가 마운트되지 않았거나 §4를 건너뛰었다 | `findmnt <경로>`로 마운트 확인 → `sudo deploy/scripts/setup-docker.sh` |
| `permission denied … docker.sock` | `docker` 그룹이 아직 적용되지 않았다 | 로그아웃 후 다시 로그인 (`id`에 `docker`가 보여야 한다) |
| 컨테이너가 시작 직후 멈추고 로그에 키 목록 | `.env` 값이 잘못됐다 | 로그의 키를 고치고 `$C run --rm tools npm run env:check` |
| `/api/health`가 `storage: down` | 볼륨 표시 파일이 없다(SSD 미마운트, `volume:init` 안 함) | 마운트 확인 → `$C run --rm tools npm run volume:init` → `$C restart app worker` |
| `/api/health`가 `database: down` (503) | PostgreSQL이 멈췄거나 비밀번호가 다르다 | `$C logs postgres`. 처음 만든 뒤 `POSTGRES_PASSWORD`를 바꿨다면 [runbook.md "DB 비밀번호"](runbook.md#db-비밀번호-postgres_password) |
| 브라우저에 "Server unreachable" (502) | app이 멈췄거나 재시작 중이다 | `$C ps app`, `$C logs --tail 200 app` |
| 업로드가 시작되자마자 413 | 앞단 프록시의 요청 크기 제한 | 호스트 Nginx `client_max_body_size 100m`, `UPLOAD_CHUNK_SIZE_MB` < 100 |
| 업로드·다운로드가 503 "Storage offline" | SSD가 빠졌다 | [runbook.md "SSD가 빠졌을 때"](runbook.md#ssd가-빠졌을-때) |
| 모든 사용자가 동시에 로그인 잠금(429) | 앞단 프록시 주소가 모두의 주소로 보인다 | §6 "호스트 Nginx 뒤"의 `X-Real-IP`·`TRUSTED_PROXY_IP` |
| `/admin`이 집에서도 403 | Tunnel 주소로 들어와 공인 IP로 보인다 | §3 `ADMIN_ALLOWED_CIDRS` 주의: LAN 주소나 VPN으로 접속 |
| 로그인 후 바로 로그아웃됨 (http) | `PUBLIC_URL`이 `https`인데 http로 접속해 `Secure` 쿠키가 저장되지 않았다 | `PUBLIC_URL`과 실제로 여는 주소의 scheme을 맞춘다 |
| 썸네일이 안 생긴다 | worker가 멈췄거나 Redis 장애 | `$C ps worker`, `$C logs worker` → `$C run --rm tools npm run media:backfill` |
| 디스크가 가득 참 | 옛 이미지·빌드 캐시 | `deploy/scripts/autoclean.sh --dry-run` → `autoclean.sh`, `docker system df` |
| 빌드 중 `Killed` / exit 137 | 메모리 부족 | 다른 서비스를 잠시 멈추고 빌드하거나 스왑을 늘린다 |
| 회사망 등에서 빌드가 TLS 오류 | TLS 검사 프록시 | `docker build --secret id=extra_ca,src=/path/ca.crt …` (`Dockerfile` 주석) |
| cloudflared가 연결되지 않음 | 토큰 오류, 아웃바운드 7844 포트 차단 | `$C logs cloudflared`, 토큰을 다시 복사 |

## 12. 배포 후 보안 점검

| 항목 | 기준 |
|---|---|
| `.env` | `chmod 600`, 저장소에 커밋되지 않음(`git status`에 안 보임), 서버 밖에 사본 |
| 비밀값 | `env:secrets`로 만든 무작위 값 (예시값·짧은 값 아님) |
| 관리자 | `ADMIN_ALLOWED_CIDRS` 설정, 관리자 토큰은 비밀번호 관리자에, 쓰지 않는 관리자 계정은 삭제 |
| 가입 | 공개 서버면 Invite only/Closed, 열어 둔다면 `ANON_TOTAL_QUOTA_GB` 설정 |
| 노출 | `ss -tlnp`에 nginx 포트와 SSH만. 공유기 포트 포워딩 없음(Tunnel 사용 시) |
| SSH | 공개키 인증만(`PasswordAuthentication no`), root 로그인 금지, fail2ban |
| 디스크 | SSD LUKS2 확인(`cryptsetup status`), 키 파일·헤더 백업이 서버 밖에 있음 |
| 업데이트 | Dependabot PR을 정기적으로 머지하고 `release.sh`, 외부 이미지 `pull`(§7), `sudo apt upgrade` (unattended-upgrades 권장) |
| 백업 | §10 cron 동작, 복원 연습 1회 |
| 로그 | Nginx 에러 로그에는 클라이언트 주소가 남으므로 공유하지 않는다 |
