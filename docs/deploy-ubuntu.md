# Ubuntu 서버 배포

RelayFiles를 Ubuntu 서버(현재 N95, `192.168.0.100`)에 Docker Compose로 올리는 절차다. 설계 근거는 [plan.md](plan.md) §13.4–13.8, §14. 운영 중 작업(백업, 복구, 롤백, 점검 모드)은 [runbook.md](runbook.md)를 본다.

## 0. 구성

```
인터넷 ── Cloudflare Tunnel(cloudflared) ─┐
LAN ─────────────── :NGINX_LISTEN_PORT ───┤
                                          ▼
                                       nginx ── X-Accel ──▶ /mnt/relayfilesDB (외장 SSD, LUKS2, 읽기 전용 마운트)
                                          │
                                          ▼
                     app (Next.js) ── worker (썸네일, 정리, 지표, 헬스 프로브)
                          │                │
                          ▼                ▼
                   postgres (DATA_DIR/pg)   redis (DATA_DIR/redis)
```

| 서비스 | 이미지 | 외부 공개 | 데이터 |
|---|---|---|---|
| nginx | `nginxinc/nginx-unprivileged` | `NGINX_LISTEN_PORT` 하나만 | 없음 (설정은 `deploy/nginx/templates`) |
| app | `Dockerfile` `app` 타깃 | 없음 | SSD (`STORAGE_ROOT`), 로그 (`LOG_DIR`) |
| worker | `Dockerfile` `tools` 타깃 | 없음 | SSD, 로그 |
| postgres / redis | `postgres:16`, `redis:7` | 없음 | `DATA_DIR` (내장 디스크) |
| tools | `tools` 타깃 (`--profile tools`) | 없음 | 마이그레이션, `volume:init`, `admin:create` 같은 일회성 명령 |
| cloudflared | `cloudflare/cloudflared` (`--profile tunnel`) | 없음 (아웃바운드만) | 없음 |

app·worker·nginx는 모두 저장소 계정(`STORAGE_UID`, 기본 10001)으로 실행한다. SSD의 파일은 이 계정만 읽을 수 있다(디렉터리 `0700`, 파일 `0600`).

## 1. 서버 준비

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git cryptsetup smartmontools curl
sudo usermod -aG docker "$USER"   # 다시 로그인
git clone https://github.com/Ruthgyeul/RelayFiles.git ~/RelayFiles
cd ~/RelayFiles
```

> Docker 공식 저장소의 `docker-ce`와 `docker-compose-plugin`을 써도 된다. `docker compose version`이 2.20 이상이면 된다.

## 2. 외장 SSD (LUKS2 + ext4)

**장치의 모든 데이터가 지워진다.** 먼저 `lsblk`로 장치 이름을 확인한다.

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL
sudo deploy/scripts/setup-ssd.sh /dev/sdX --dry-run   # 실행할 명령만 출력
sudo deploy/scripts/setup-ssd.sh /dev/sdX             # 장치 이름을 다시 입력해야 진행
```

스크립트가 하는 일:

1. 저장소 계정 `relayfiles`(uid/gid `STORAGE_UID`/`STORAGE_GID`)를 만든다.
2. 키 파일 `/etc/relayfiles/ssd.key`(root, `0400`)를 만들고 LUKS2로 암호화한다. 복구용으로 패스프레이즈를 하나 더 등록한다(입력 요청).
3. ext4(`-m 0`)로 포맷하고, `/etc/crypttab`과 `/etc/fstab`에 부팅 시 자동 해제·마운트를 등록한다. `nofail`이 있어서 SSD가 없어도 부팅은 된다.
4. `STORAGE_ROOT`(기본 `/mnt/relayfilesDB`)에 마운트하고 `users/`, `system/`을 `0700`으로 만든다.

키 파일과 패스프레이즈는 서버 밖에도 보관한다. 둘 다 잃으면 파일을 복구할 수 없다.

USB SSD는 절전으로 끊기지 않게 한다.

```bash
echo 'ACTION=="add", SUBSYSTEM=="usb", ATTR{power/control}="on"' | sudo tee /etc/udev/rules.d/50-usb-ssd-power.rules
sudo smartctl -d sat -a /dev/sdX | head -20     # SMART 확인
```

## 3. `.env` 작성

```bash
cp .env.example .env
# 비밀값 생성 (출력만 한다). 서버에 Node가 없으면 Docker로 실행한다
docker run --rm -v "$PWD":/w -w /w node:24-bookworm-slim node scripts/env-secrets.mjs
chmod 600 .env
```

운영에서 꼭 바꿀 값:

| 키 | 값 |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | 공유 링크 주소, 예: `https://files.example.com` (LAN만 쓰면 `http://192.168.0.100`) |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, `COOKIE_SECRET` | `env:secrets` 출력 |
| `STORAGE_ROOT` | `/mnt/relayfilesDB` (절대경로) |
| `DATA_DIR` | `/srv/relayfiles` (PostgreSQL·Redis·백업, 내장 디스크) |
| `LOG_DIR` | `/var/log/relayfiles` |
| `SERVER_NAME` | 도메인 또는 `_` (모든 이름) |
| `NGINX_LISTEN_PORT` | LAN에 여는 포트 (기본 80) |
| `ADMIN_ALLOWED_CIDRS` | 관리자 페이지를 LAN에서만 열려면 `192.168.0.0/24` |
| `CLOUDFLARE_TUNNEL_TOKEN` | 터널을 쓸 때만 |
| `DISK_DEVICE` | Server 페이지 Disk health 대상 (예: `/dev/sda`) |

`POSTGRES_HOST`, `REDIS_HOST`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_ACCEL_ENABLED`, `HEALTH_PROBE_URL`은 compose가 컨테이너용 값으로 덮어쓴다. 그대로 둬도 된다.

빠진 값은 첫 실행 때 컨테이너가 "어떤 키가 왜 잘못됐는지" 목록을 출력하고 멈춘다. 미리 확인하려면 이미지를 빌드한 뒤 `docker compose ... run --rm tools npm run env:check`를 실행한다.

## 4. 디렉터리

```bash
sudo install -d -o 10001 -g 10001 -m 0750 /var/log/relayfiles
sudo install -d -m 0700 /srv/relayfiles
```

uid가 10001이 아니면 `.env`의 `STORAGE_UID`/`STORAGE_GID`와 같게 맞춘다.

## 5. 첫 실행

```bash
C="docker compose --env-file .env -f deploy/docker-compose.yml"

$C build                                         # app, tools 이미지
$C up -d postgres redis
$C run --rm tools npm run db:deploy             # 마이그레이션 적용
$C run --rm tools npm run volume:init           # SSD에 볼륨 표시 파일을 만들고 DB에 등록
$C up -d app worker nginx
curl -fsS http://127.0.0.1:${NGINX_LISTEN_PORT:-80}/api/health   # {"success":true,...,"status":"ok"}
$C run --rm tools npm run admin:create          # 첫 관리자. 토큰은 한 번만 출력된다
```

브라우저에서 `PUBLIC_URL`을 열고 출력된 토큰으로 로그인한다(사이드바 Add account → Sign in).

## 6. 외부 공개

### Cloudflare Tunnel (권장)

1. Cloudflare Zero Trust → Networks → Tunnels에서 터널을 만들고 토큰을 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣는다.
2. Public hostname: `files.example.com` → Service `http://nginx:8080`.
3. `$C --profile tunnel up -d cloudflared`

cloudflared는 compose 네트워크에서 고정 주소(`CLOUDFLARED_IP`)를 쓴다. Nginx는 이 주소에서 온 요청의 `CF-Connecting-IP`만 실제 클라이언트 주소로 믿는다. 다른 곳에서 보낸 같은 헤더는 무시한다.

Cloudflare 무료 요금제의 요청 크기 제한은 100MB다. 업로드는 `UPLOAD_CHUNK_SIZE_MB`(기본 50) 단위로 나뉘어 이 제한에 걸리지 않는다.

### LAN만

`NGINX_LISTEN_PORT`로 바로 접속한다. 포트는 공유기에서 외부로 열지 않는다.

## 7. 업데이트

```bash
git pull
deploy/scripts/release.sh
```

`release.sh`는 순서대로 다음을 한다. 하나라도 실패하면 멈춘다.

1. DB 백업 (`DATA_DIR/backups`, 최근 14개 유지)
2. 이미지 빌드 (태그 = git 커밋)
3. 점검 모드 켜기 (Nginx가 503 점검 페이지를 보여 준다)
4. `prisma migrate deploy`, 데이터 마이그레이션(`data:migrate`), 스토리지 레이아웃(`storage:migrate`)
5. app·worker·nginx 재시작, 점검 모드 끄기
6. `/api/health` 확인, `DATA_DIR/releases.log`에 기록

실패하면 [runbook.md](runbook.md#롤백)의 롤백 절차를 따른다.

## 8. 확인 목록 (실서버)

| 항목 | 확인 방법 |
|---|---|
| 원본 그대로 저장 | 업로드 후 `sudo sha256sum /mnt/relayfilesDB/users/<accountId>/<경로>`와 다운로드한 파일의 해시가 같다 |
| 권한 | `sudo ls -l`로 파일 `-rw-------`, 폴더 `drwx------`, 소유자 `relayfiles` |
| 다른 계정 차단 | 다른 브라우저(다른 계정)에서 남의 파일 URL을 열면 404 |
| X-Accel | 다운로드·스트리밍 응답이 Nginx에서 나가고(`docker compose logs nginx`), 영상 탐색(Range)이 된다 |
| 대용량 재개 | 2GB 이상 업로드 중 네트워크를 끊었다가 다시 연결하면 이어서 올라간다 |
| SSD 분리 | SSD를 빼면 Status 페이지 Storage가 실패로 바뀌고 업로드·다운로드가 503. 다시 꽂고 `sudo mount /mnt/relayfilesDB` 후 복구 |
| 이름 변경·이동 | 앱에서 바꾼 폴더 구조가 SSD의 디렉터리에 그대로 반영된다 |
| 공유 링크 | 비밀번호, 다운로드 한도, 첫 다운로드 후 삭제, Stream only가 동작한다 |
| 정리 작업 | Accounts → Run cleanup now, Server 페이지 Cleanup job의 마지막 실행 시각 |
| 지표 | Server 페이지 값과 `htop`, `df -h`가 비슷하다 (컨테이너 안에서 재므로 아래 참고) |
| 앱 중단 | `docker compose stop app` → Nginx의 "Server unreachable" 페이지 → `start app`으로 복구 |
| 모바일 | iOS Safari, Android Chrome에서 업로드·미리보기·공유 페이지 |

## 9. 참고

- **Server 페이지 지표**: app이 컨테이너 안에서 잰다. CPU 사용률과 메모리는 컨테이너도 호스트의 `/proc` 값을 보므로 호스트와 거의 같다. 네트워크는 컨테이너 인터페이스 기준이라 RelayFiles 트래픽만 잡힌다(대역폭 그래프의 목적에 맞다).
- **Disk health**: `smartctl`은 장치 접근과 root 권한이 필요해서 컨테이너에서는 기본으로 "Unavailable"이 표시된다. SMART 상태는 호스트에서 `sudo smartctl -d sat -H /dev/sdX`로 확인한다. 앱에 보여야 한다면 app 서비스에 `devices`, `cap_add: [SYS_RAWIO]`, root 실행이 필요하므로 권장하지 않는다.
- **두 번째 SSD**: `volume:init -- <경로>`가 Nginx location(`deploy/nginx/volumes/`)을 만들고, 마운트는 `deploy/docker-compose.volumes.yml` 오버레이로 추가한다. 절차와 계정 이동은 [runbook.md](runbook.md#볼륨-추가교체).
- **TLS 인증서 만료일**: Cloudflare를 쓰면 앞단 인증서는 Cloudflare가 관리한다. 서버에서 직접 TLS를 쓰는 경우에만 `TLS_CERT_PATH`를 지정한다.
