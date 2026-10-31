# k3s 배포 (Raspberry Pi 클러스터)

Docker Compose([deploy-ubuntu.md](deploy-ubuntu.md))·systemd([deploy-systemd.md](deploy-systemd.md))와 같은 앱을 k3s 클러스터에서 돌린다. 이미지는 GitHub Actions가 빌드해 GHCR에 올린 멀티 아키텍처 이미지(amd64 + arm64)를 쓰므로 Pi에서 빌드하지 않는다.

## 1. 구성

| 리소스 | 내용 |
|---|---|
| 이미지 | `.github/workflows/images.yml`이 `main` 푸시와 `v*` 태그마다 `ghcr.io/<owner>/relayfiles-app`, `-tools`를 올린다. 태그: `sha-<커밋 12자>`(모든 푸시), `main`, 버전 태그면 `vX.Y.Z`와 `latest`. PostgreSQL·Redis·Nginx는 `docker-compose.yml`에 고정된 이미지(digest 포함)를 그대로 쓴다 |
| 템플릿 | `deploy/k3s/data.yaml.template`(PostgreSQL·Redis), `migrate-job.yaml.template`(마이그레이션 Job), `relayfiles.yaml.template`(app·worker·Nginx). `.env` 값으로 `scripts/render-template.mjs`가 렌더링한다 |
| 배치 | 모든 Pod가 `relayfiles/storage=true` 라벨이 붙은 노드 하나(SSD가 연결된 노드)에서 돈다. 파일·DB·Redis 데이터는 그 노드의 호스트 경로(`STORAGE_ROOT`, `DATA_DIR/pg`, `DATA_DIR/redis`, `LOG_DIR`)이고, Compose와 같은 디렉터리라 같은 디스크를 그대로 옮겨 쓸 수 있다 |
| 설정 | `.env` 전체가 Secret `relayfiles-env`가 된다. Nginx 템플릿·에러 페이지·추가 볼륨 설정은 ConfigMap이다. 오프사이트 백업 키(`RESTIC_*`, `OFFSITE_*`)는 컨테이너에서 비운다 |
| 노출 | Service `relayfiles-nginx`(LoadBalancer, k3s ServiceLB, `externalTrafficPolicy: Local`로 방문자 주소 유지)가 노드의 `NGINX_LISTEN_PORT`에서 받는다. 앱은 Compose처럼 Nginx를 거쳐서만 열린다. `SERVER_NAME`에 없는 호스트 이름은 Nginx가 끊는다(444, `_`면 모든 이름) |
| 네트워크 정책 | NetworkPolicy `relayfiles-app`: 앱 Pod는 Nginx Pod와 워커(Status 페이지 프로브)에서 오는 `APP_PORT` 연결만 받는다. 다른 Pod가 앱에 직접 `X-Real-IP`·`CF-Connecting-IP`를 꾸며 보내 관리자 대역(`ADMIN_ALLOWED_CIDRS`)과 로그인·잠금 해제 제한을 피하지 못하게 한다. k3s에 내장된 정책 컨트롤러(kube-router)가 적용하므로 k3s 서버를 `--disable-network-policy`로 띄웠다면 적용되지 않는다. 클러스터 안의 Prometheus는 `relayfiles-nginx`로 `/metrics`를 긁는다 |
| 프로브 | 앱: `startupProbe`(최대 2분)·`livenessProbe`는 `HEAD /api/health`(이미지의 `healthcheck.mjs`, DB·Redis를 보지 않으므로 DB 장애로 앱이 재시작되지 않는다), `readinessProbe`는 `GET /api/health`(DB가 내려가면 503이라 트래픽을 받지 않는다). Nginx: TCP `readinessProbe`(HTTP 프로브는 Pod 주소를 Host로 보내 444가 된다) |
| 종료 | 앱·Nginx는 `preStop`에서 `K3S_PRESTOP_SEC`(기본 5초) 기다려 Service 엔드포인트에서 먼저 빠진 뒤 SIGTERM을 받는다. 앱은 진행 중인 요청을 `APP_STOP_GRACE_SEC`(30초) 동안 마무리한다(`terminationGracePeriodSeconds` = 둘의 합). 워커는 `WORKER_STOP_GRACE_SEC`(90초) |
| 복제본 | 앱은 `K3S_APP_REPLICAS`(기본 1, 최대 4)개. 업로드 잠금과 변환 슬롯이 Redis로 공유되므로 2개 이상도 된다. 워커는 1개(매일 정리와 표본 수집을 예약한다) |

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
- 저장소 노드 하나에 묶인다(호스트 경로). 그 노드가 내려가면 서비스도 내려간다. 다른 노드는 다른 서비스(대시보드, 봇)에 쓴다.
- `volume:init`으로 추가 SSD를 붙이면 `deploy/nginx/volumes/<id>.conf`가 생긴다. 다시 `deploy.sh`를 실행해야 ConfigMap과 Nginx에 반영되고, 새 마운트 경로를 app·worker·Nginx에 붙이는 패치는 직접 넣어야 한다.
