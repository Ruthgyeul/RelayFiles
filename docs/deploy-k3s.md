# k3s 배포 (Raspberry Pi 클러스터)

Docker Compose([deploy-ubuntu.md](deploy-ubuntu.md))·systemd([deploy-systemd.md](deploy-systemd.md))와 같은 앱을 k3s 클러스터에서 돌린다. 이미지는 GitHub Actions가 빌드해 GHCR에 올린 멀티 아키텍처 이미지(amd64 + arm64)를 쓰므로 Pi에서 빌드하지 않는다.

## 1. 구성

| 리소스 | 내용 |
|---|---|
| 이미지 | `.github/workflows/images.yml`이 `main` 푸시와 `v*` 태그마다 `ghcr.io/<owner>/relayfiles-app`, `-tools`를 올린다. 태그: `sha-<커밋 12자>`(모든 푸시), `main`, 버전 태그면 `vX.Y.Z`와 `latest`. PostgreSQL·Redis·Nginx는 `docker-compose.yml`에 고정된 이미지(digest 포함)를 그대로 쓴다 |
| 템플릿 | `deploy/k3s/data.yaml.template`(PostgreSQL·Redis), `migrate-job.yaml.template`(마이그레이션 Job), `relayfiles.yaml.template`(app·worker·Nginx), `media.yaml.template`(미디어 워커, 켰을 때만). `.env` 값으로 `scripts/render-template.mjs`가 렌더링한다 |
| 배치 | 모든 Pod가 `relayfiles/storage=true` 라벨이 붙은 노드 하나(SSD가 연결된 노드)에서 돈다. 예외는 미디어 워커(`K3S_MEDIA_REPLICAS` ≥ 1, [§6](#6-미디어-워커-분리-pi-노드))로, `relayfiles/media=true` 노드에서 SSD를 NFS로 붙여 돈다. 파일·DB·Redis 데이터는 그 노드의 호스트 경로(`STORAGE_ROOT`, `DATA_DIR/pg`, `DATA_DIR/redis`, `LOG_DIR`)이고, Compose와 같은 디렉터리라 같은 디스크를 그대로 옮겨 쓸 수 있다 |
| 설정 | `.env`가 Secret `relayfiles-env`가 되는데, 호스트 스크립트만 쓰는 키(오프사이트 백업 `RESTIC_*`·`OFFSITE_*`, `CLOUDFLARE_TUNNEL_TOKEN`)는 빼고 만든다(`scripts/lib/host-only-env.mjs`와 같은 목록). k3s는 Secret을 기본으로 암호화하지 않고 저장하므로 클러스터에 들어가지 않는 편이 안전하다. Nginx 템플릿·에러 페이지·추가 볼륨 설정은 ConfigMap이다 |
| 노출 | Service `relayfiles-nginx`(LoadBalancer, k3s ServiceLB, `externalTrafficPolicy: Local`로 방문자 주소 유지)가 노드의 `NGINX_LISTEN_PORT`에서 받는다. 앱은 Compose처럼 Nginx를 거쳐서만 열린다. `SERVER_NAME`에 없는 호스트 이름은 Nginx가 끊는다(444, `_`면 모든 이름) |
| 네트워크 정책 | NetworkPolicy `relayfiles-data`: PostgreSQL·Redis는 app·worker·미디어 워커(`relayfiles-media`)·마이그레이션 Job(`relayfiles-migrate`) Pod의 연결만 받는다(클러스터의 다른 워크로드가 비밀번호 하나만 남은 DB에 닿지 못한다). 모든 Pod는 `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`(쿠버네티스 API를 쓰지 않는다)이고 PostgreSQL·Redis 컨테이너는 `drop: [ALL]`에 시작할 때 필요한 권한만 더한다. NetworkPolicy `relayfiles-app`: 앱 Pod는 Nginx Pod와 워커(Status 페이지 프로브)에서 오는 `APP_PORT` 연결만 받는다. 다른 Pod가 앱에 직접 `X-Real-IP`·`CF-Connecting-IP`를 꾸며 보내 관리자 대역(`ADMIN_ALLOWED_CIDRS`)과 로그인·잠금 해제 제한을 피하지 못하게 한다. k3s에 내장된 정책 컨트롤러(kube-router)가 적용하므로 k3s 서버를 `--disable-network-policy`로 띄웠다면 적용되지 않는다. 클러스터 안의 Prometheus는 `relayfiles-nginx`로 `/metrics`를 긁는다 |
| 프로브 | 앱: `startupProbe`(최대 2분)·`livenessProbe`는 `HEAD /api/health`(이미지의 `healthcheck.mjs`, DB·Redis를 보지 않으므로 DB 장애로 앱이 재시작되지 않는다), `readinessProbe`는 `GET /api/health`(DB가 내려가면 503이라 트래픽을 받지 않는다). Nginx: TCP `readinessProbe`(HTTP 프로브는 Pod 주소를 Host로 보내 444가 된다) |
| 종료 | 앱·Nginx는 `preStop`에서 `K3S_PRESTOP_SEC`(기본 5초) 기다려 Service 엔드포인트에서 먼저 빠진 뒤 SIGTERM을 받는다. 앱은 진행 중인 요청을 `APP_STOP_GRACE_SEC`(30초) 동안 마무리한다(`terminationGracePeriodSeconds` = 둘의 합). 워커는 `WORKER_STOP_GRACE_SEC`(90초) |
| 복제본 | 앱은 `K3S_APP_REPLICAS`(기본 1, 최대 4)개. 업로드 잠금과 변환 슬롯이 Redis로 공유되므로 2개 이상도 된다. 저장소 노드의 워커는 1개(매일 정리와 표본 수집을 예약한다). 썸네일·변환은 미디어 워커 `K3S_MEDIA_REPLICAS`개(기본 0, 최대 8)로 다른 노드에 나눌 수 있다 |

## 2. 준비

1. k3s 설치(마스터는 Pi 5 8GB). SSD는 [deploy-ubuntu.md §1](deploy-ubuntu.md)처럼 `setup-ssd.sh`로 마운트하고 볼륨을 초기화해 둔다(`STORAGE_ROOT`는 절대경로).
2. SSD가 붙은 노드에 라벨을 단다. 정확히 한 노드여야 한다.

   ```bash
   kubectl label node <노드 이름> relayfiles/storage=true
   ```

3. 그 노드에 데이터 디렉터리를 만든다(Compose에서 옮겨 왔다면 이미 있다).

   ```bash
   sudo install -d -m 0700 /srv/relayfiles/pg /srv/relayfiles/redis /srv/relayfiles/backups
   sudo install -d -o 10001 -g 10001 -m 0750 /var/log/relayfiles
   ```

4. `.env`(Compose와 같은 형식)에 k3s 값을 넣는다.

   ```dotenv
   K3S_IMAGE_REPO=ghcr.io/<owner>/relayfiles   # -app, -tools는 스크립트가 붙인다
   K3S_NAMESPACE=relayfiles
   K3S_APP_REPLICAS=1
   ```

5. 패키지가 비공개면 k3s가 GHCR에서 받을 수 있게 각 노드의 `/etc/rancher/k3s/registries.yaml`에 읽기 전용 토큰(`read:packages`)을 넣고 k3s를 재시작한다. 공개 패키지면 필요 없다.

   ```yaml
   configs:
     ghcr.io:
       auth: { username: <GitHub 사용자>, password: <read:packages 토큰> }
   ```

6. `deploy/scripts/k3s/deploy.sh`를 실행할 곳(마스터 노드 등)에 저장소를 받고 `npm ci`, `kubectl`이 클러스터에 붙게 한다(k3s 서버에서는 `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml`).

## 3. 배포·업데이트

```bash
git pull
deploy/scripts/k3s/deploy.sh            # 지금 체크아웃한 커밋의 sha-<12자> 이미지
deploy/scripts/k3s/deploy.sh v1.4.0     # 버전 태그
```

`deploy.sh`는 태그를 먼저 digest로 바꿔(`image@sha256:…`, `docker buildx`·`crane`·`skopeo` 중 설치된 것) 클러스터가 확인한 그 이미지만 돌게 한다(태그는 옮겨질 수 있다). GitHub CLI(`gh`, 로그인 필요)가 있으면 그 digest의 서명된 build provenance(`images.yml`)를 `gh attestation verify`로 확인하고, 맞지 않으면 배포하지 않는다. 도구가 없으면 경고하고 태그로 배포한다.

순서: 네임스페이스 → Secret(`.env`)·ConfigMap → PostgreSQL·Redis(준비될 때까지 대기) → 새 tools 이미지로 마이그레이션 Job(`db:deploy` → `data:migrate` → `storage:migrate`, 실패하면 앱은 그대로 두고 로그를 보여 준 뒤 멈춘다) → app·worker·Nginx 롤링(각각 `K3S_ROLLOUT_TIMEOUT`, 기본 `10m`) → `/api/health`가 `"status":"ok"`인지 확인(2초 간격 `HEALTH_TRIES`=30번).

- **자동 롤백**: 롤아웃이 시간 안에 끝나지 않거나 헬스 체크가 `ok`가 아니면, 이번 실행에서 새 리비전이 된 Deployment만 `kubectl rollout undo --to-revision=<이전>`으로 되돌리고 실패로 끝난다. Secret·ConfigMap은 이번 값 그대로이고, DB 스키마도 마이그레이션된 그대로다(expand라 이전 버전이 동작한다). 원인은 `kubectl -n relayfiles describe pod -l app.kubernetes.io/name=relayfiles-app`(프로브 실패), `kubectl -n relayfiles logs deployment/relayfiles-app`로 본다.

- 이미지가 아직 없으면(Actions 빌드 중) Pod가 `ImagePullBackOff`로 기다린다. Actions의 **Images** 실행이 끝난 뒤 다시 실행한다.
- 마이그레이션 동안 이전 버전이 계속 서비스한다. 스키마 변경은 expand → migrate → contract로 나눠 넣으므로(CLAUDE.md) 이전 버전이 새 스키마에서도 동작한다.
- 롤백(손으로): 이전 태그로 같은 명령을 실행한다. 파괴적 변경(contract)이 들어간 릴리스는 그 직전 DB 백업으로 되돌린다([runbook.md "DB 복구"](runbook.md#db-복구)).
- 점검 모드: 저장소 노드에서 `sudo touch /srv/relayfiles/maintenance/on`(지우면 해제). Nginx가 정적 503 페이지를 보여 준다.

## 4. 운영

| 작업 | 명령 |
|---|---|
| 상태 | `kubectl -n relayfiles get pods -o wide` |
| 로그 | `kubectl -n relayfiles logs deployment/relayfiles-app -f`, 파일은 저장소 노드의 `LOG_DIR` |
| 일회성 명령 | `kubectl -n relayfiles exec deployment/relayfiles-worker -- npm run <스크립트> [-- 인자]` (예: `admin:create`, `storage:fsck`, `volume:list`) |
| `.env`를 바꾼 뒤 | `deploy/scripts/k3s/deploy.sh <지금 태그>`(Secret을 갱신하고 같은 이미지로 다시 적용) 후 `kubectl -n relayfiles rollout restart deployment/relayfiles-app deployment/relayfiles-worker` |

DB 백업(저장소 노드의 cron, Compose의 `backup.sh`와 같은 위치·형식):

```cron
15 3 * * * kubectl -n relayfiles exec statefulset/relayfiles-postgres -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /srv/relayfiles/backups/relayfiles-$(date -u +\%Y\%m\%d-\%H\%M\%S).dump && find /srv/relayfiles/backups -name 'relayfiles-*.dump' -mtime +14 -delete
```

오프사이트 백업(`deploy/scripts/offsite-backup.sh`)은 호스트에서 덤프와 `STORAGE_ROOT`를 읽으므로 저장소 노드에서 그대로 쓴다([runbook.md "오프사이트 백업"](runbook.md#오프사이트-백업)).

## 5. 제한

- Cloudflare Tunnel은 이 매니페스트에 없다. 쓴다면 cloudflared를 `relayfiles-nginx` 서비스로 보내되, Nginx는 cloudflared를 신뢰하는 피어로 알지 못하므로(`CLOUDFLARED_IP`가 비어 있는 것과 같다) 방문자 주소가 cloudflared의 주소로 기록된다. 주소별 제한이 필요하면 Compose 배포를 쓴다.
- 바이러스 검사(ClamAV)는 매니페스트에 없다. 공식 이미지가 x86-64 전용이라 Pi(arm64)에서는 돌지 않기 때문이다. 쓰려면 저장소 노드의 호스트에 `clamav-daemon`을 설치하고(runbook "업로드 링크 바이러스 검사"), `CLAMAV_HOST`를 그 노드 주소로 둔다.
- 저장소 노드 하나에 묶인다(호스트 경로). 그 노드가 내려가면 서비스도 내려간다. 다른 노드는 미디어 워커([§6](#6-미디어-워커-분리-pi-노드))나 다른 서비스(대시보드, 봇)에 쓴다.
- `volume:init`으로 추가 SSD를 붙이면 `deploy/nginx/volumes/<id>.conf`가 생긴다. 다시 `deploy.sh`를 실행해야 ConfigMap과 Nginx에 반영되고, 새 마운트 경로를 app·worker·Nginx에 붙이는 패치는 직접 넣어야 한다.

## 6. 미디어 워커 분리 (Pi 노드)

썸네일, 뷰어 미리보기, 공유 링크용 메타데이터 제거본, 저장 변환본, 업로드 링크 바이러스 검사(`media` 큐)는 CPU를 많이 쓴다. 이 작업을 Pi 노드에서 돌려 저장소 노드(N95)의 CPU를 앱과 PostgreSQL에 남길 수 있다. 기본은 꺼져 있다(`K3S_MEDIA_REPLICAS=0`). 켜지 않으면 지금까지와 똑같다.

### 구조

| 역할(`WORKER_ROLES`) | 어디서 | 이유 |
|---|---|---|
| `media` | 미디어 워커 Pod(`relayfiles-media`, Pi) + 저장소 노드 워커(`K3S_STORAGE_NODE_MEDIA=true`일 때) | 같은 Redis 큐를 여러 프로세스가 나눠 가진다. 변환 슬롯(`VIDEO_TRANSCODE_MAX`)도 Redis로 공유한다 |
| `maintenance` | 저장소 노드 워커만 | 대역폭·디스크 표본이 그 노드의 `/proc`을 읽는다. 매일 정리 스케줄도 한 곳에서만 돌아야 한다 |
| `notify` | 저장소 노드 워커만 | 알림 순서와 반복 제한을 한 곳에서 지킨다 |

- 미디어 워커는 저장소 노드가 NFS로 내보낸 `STORAGE_ROOT`를 **같은 경로**에 마운트한다. DB의 볼륨 경로가 그대로 맞고, 쓰기는 저장소 노드와 같이 볼륨 안 `system/tmp`에 쓴 뒤 rename으로 옮긴다(같은 파일 시스템).
- NFS 마운트는 kubelet이 클라이언트 기본값(hard, 양쪽이 지원하는 가장 높은 버전)으로 한다. 저장소 노드가 내려가 있는 동안 파일 접근은 실패하지 않고 기다리며, 돌아오면 작업이 이어진다.
- 로그는 파일로 남기지 않고 stdout으로만 나온다(`kubectl -n relayfiles logs deployment/relayfiles-media`).
- 원본은 읽기만 한다. 쓰는 곳은 `system/` 아래(썸네일·제거본·미리보기·변환본)와 업로드 링크 검사 결과(감염이면 휴지통으로 옮기기)뿐이다.

### 준비

1. **저장소 노드(N95)에 NFS 서버**를 설치하고 `STORAGE_ROOT`를 미디어 노드에만 내보낸다.

   ```bash
   sudo apt install -y nfs-kernel-server
   ```

   `/etc/exports`(예: `STORAGE_ROOT=/mnt/relayfilesDB/data`, Pi 3대):

   ```
   /mnt/relayfilesDB/data 192.168.0.200(rw,sync,no_subtree_check,root_squash,mp=/mnt/relayfilesDB) 192.168.0.201(rw,sync,no_subtree_check,root_squash,mp=/mnt/relayfilesDB) 192.168.0.202(rw,sync,no_subtree_check,root_squash,mp=/mnt/relayfilesDB)
   ```

   - 대역(`192.168.0.0/24`)이 아니라 **노드 주소 하나씩** 적는다. NFS(`sec=sys`)는 클라이언트가 말하는 uid를 믿으므로, 목록에 있는 주소만 파일에 닿을 수 있다.
   - `mp=<SSD 마운트 지점>`: SSD가 마운트되어 있을 때만 내보낸다. 빠져 있으면 빈 마운트 지점을 내보내지 않으므로 미디어 워커가 엉뚱한 디렉터리에 쓰지 않는다(볼륨 표시 파일 검사와 이중으로 막는다).
   - `root_squash`: Pod는 uid `STORAGE_UID`(10001)로 돌고 root가 필요 없다.

   ```bash
   sudo exportfs -ra
   sudo exportfs -v      # 내보낸 경로와 옵션 확인
   ```

   방화벽(ufw)을 쓰면 NFSv4(2049/tcp)를 미디어 노드에서만 연다.

   ```bash
   sudo ufw allow from 192.168.0.200 to any port 2049 proto tcp
   ```

2. **미디어 노드(Pi)에 NFS 클라이언트**를 설치한다. kubelet이 호스트의 `mount.nfs`로 마운트한다.

   ```bash
   sudo apt install -y nfs-common
   ```

   손으로 한 번 확인한다(uid 10001로 쓸 수 있는지는 Pod가 확인한다).

   ```bash
   sudo mount -t nfs 192.168.0.100:/mnt/relayfilesDB/data /mnt && ls /mnt && sudo umount /mnt
   ```

3. **라벨**: 미디어 워커를 돌릴 노드에 붙인다. 저장소 노드에는 붙이지 않는다(자기 SSD를 NFS로 다시 읽을 이유가 없다).

   ```bash
   kubectl label node <Pi 노드 이름> relayfiles/media=true
   ```

4. **`.env`**:

   ```dotenv
   K3S_MEDIA_REPLICAS=3                 # 보통 라벨 붙인 노드 수 (노드마다 하나씩 퍼진다)
   K3S_MEDIA_NFS_SERVER=192.168.0.100   # 저장소 노드의 LAN 주소
   K3S_MEDIA_NFS_PATH=                  # 비우면 STORAGE_ROOT (exports에 적은 경로와 같아야 한다)
   K3S_MEDIA_CONCURRENCY=1              # Pod 하나가 동시에 처리하는 작업 수
   K3S_MEDIA_MEMORY_MAX=1G
   K3S_MEDIA_CPUS=2
   K3S_STORAGE_NODE_MEDIA=true          # false: 저장소 노드는 미디어 작업을 하지 않는다
   ```

   - 처음에는 `K3S_STORAGE_NODE_MEDIA=true`로 두고(N95와 Pi가 함께 처리) 미디어 워커 로그가 깨끗한지 본 뒤 `false`로 바꾸는 것을 권한다.
   - Pi 4GB 노드는 `K3S_MEDIA_MEMORY_MAX=1G`를 넘기지 않는다. 큰 사진(sharp)과 영상 변환이 한 Pod에서 동시에 돌지 않게 `K3S_MEDIA_CONCURRENCY=1`이 기본이다.

5. 배포:

   ```bash
   deploy/scripts/k3s/deploy.sh
   ```

   `deploy.sh`가 확인하는 것: `K3S_MEDIA_NFS_SERVER`가 있는지, `relayfiles/media=true` 노드가 하나 이상인지, `K3S_STORAGE_NODE_MEDIA=false`인데 미디어 워커가 0개는 아닌지. 미디어 워커 롤아웃이 `K3S_ROLLOUT_TIMEOUT` 안에 끝나지 않으면(대부분 NFS 마운트 실패로 `ContainerCreating`에 멈춤) 이번 실행에서 바뀐 Deployment를 되돌린다. 저장소 노드 워커도 이전 역할(미디어 포함)로 돌아가므로 썸네일이 멈추지 않는다. 처음 켠 실행이었다면 되돌릴 리비전이 없어 `relayfiles-media`는 멈춘 채 남는다. 원인을 고친 뒤 다시 실행하거나 `K3S_MEDIA_REPLICAS=0`으로 지운다.

### 확인

```bash
kubectl -n relayfiles get pods -l app.kubernetes.io/name=relayfiles-media -o wide   # Pi 노드에 퍼졌는지
kubectl -n relayfiles logs deployment/relayfiles-media | grep '"worker started"'      # "roles":["media"]
kubectl -n relayfiles logs deployment/relayfiles-worker | grep '"worker started"'     # maintenance, notify (+ media)
```

사진 하나를 올려 썸네일이 생기는지 보고, `kubectl -n relayfiles describe pod -l app.kubernetes.io/name=relayfiles-media`에 `MountVolume.SetUp failed`가 없는지 본다.

### 끄기

`K3S_MEDIA_REPLICAS=0`(그리고 `K3S_STORAGE_NODE_MEDIA=true`)로 바꾸고 `deploy.sh`를 실행한다. 미디어 워커 Deployment를 지우고 저장소 노드 워커가 미디어 작업을 다시 맡는다. 큐에 남은 작업은 그대로 이어서 처리된다.

### 제한

- **추가 볼륨**: `volume:init`으로 붙인 두 번째 SSD는 미디어 워커에 마운트되지 않는다. 그 볼륨의 파일 작업은 볼륨 표시 파일이 없어 실패하고 다시 시도된다(`MEDIA.jobAttempts`). 추가 볼륨이 있으면 `K3S_STORAGE_NODE_MEDIA=true`로 두어 저장소 노드 워커도 처리하게 하거나, 그 경로도 NFS로 내보내고 `media.yaml.template`에 마운트를 더한다.
- **바이러스 검사**: `scan` 작업도 미디어 워커가 가져간다. `CLAMAV_HOST`가 미디어 노드에서 닿는 주소여야 한다(clamd가 `127.0.0.1`에서만 듣고 있으면 Pi에서의 검사는 실패하고, 마지막 시도 뒤 `FAILED`가 된다). clamd를 저장소 노드 LAN 주소에서 듣게 하고 3310/tcp를 미디어 노드에만 연다.
- **속도**: Pi의 ffmpeg는 소프트웨어 디코딩이라 영상 변환이 N95보다 느리다. 저장 변환은 `TRANSCODE.storeTimeoutSec`(6시간) 안에 끝나야 하므로 4K 원본이 많으면 `K3S_STORAGE_NODE_MEDIA=true`를 유지한다.
- **전송 구간 암호화 없음**: NFS 트래픽(사진·영상 원본 읽기)은 LAN에서 평문이다. SSD의 LUKS2 암호화는 디스크를 보호할 뿐이다. 신뢰하지 않는 기기가 같은 LAN에 있으면 이 기능을 쓰지 않거나 NFS를 WireGuard/Tailscale 위로 보낸다([security.md "미디어 워커 (NFS)"](security.md#미디어-워커-nfs)).
- 저장소 노드가 내려가면 미디어 워커의 파일 접근이 hard 마운트로 멈춰 기다린다. 그동안 Pod를 지우면 `Terminating`에 오래 머물 수 있다(노드가 돌아오면 끝난다).

## WebDAV

k3s 템플릿에는 아직 WebDAV 배포가 없다. Nginx는 `/dav/`를 `relayfiles-dav` 서비스로 넘기도록 렌더링되지만 그 이름이 없으므로 502를 준다. 필요하면 Docker Compose나 systemd 배포에서 쓴다.
