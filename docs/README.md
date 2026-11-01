# 문서

| 문서 | 내용 |
|---|---|
| [architecture.md](architecture.md) | 레이어 규칙, 요청 흐름, 워커, 미리보기·캐시, 교체 가능한 인터페이스, 데이터 저장소, 스토리지, 환경 변수, 버전 관리 규칙 |
| [design/spec.md](design/spec.md) | 토큰·프리미티브 수치 스펙 (디자인 기준) |
| [api.md](api.md) | 응답 형식, 에러 코드, 엔드포인트 |
| [security.md](security.md) | 보안 모델 (스토리지, 로그, 인증) |
| [deploy-ubuntu.md](deploy-ubuntu.md) | Ubuntu 서버·외장 SSD·Docker Compose 배포. 배포 방식 비교, 요청 흐름, 단계별 확인, 백업 자동화, 문제 해결, 배포 후 보안 점검 |
| [deploy-systemd.md](deploy-systemd.md) | Docker 없이 systemd 서비스 + 호스트 Nginx 배포. 계정 구분, 디렉터리 구조, 단계별 확인, 실패 시 복구, 문제 해결 |
| [deploy-k3s.md](deploy-k3s.md) | Raspberry Pi k3s 클러스터 배포. GHCR 멀티 아키텍처 이미지, 템플릿 렌더링, 데이터·마이그레이션 Job, 롤아웃·롤백 |
| [runbook.md](runbook.md) | 운영 절차 (백업, 복구, 롤백, 점검, SSD, 마이그레이션, 볼륨 추가·교체, 서버 이전, 비밀값 교체) |
| [upgrade/folder-tools-transfers.md](upgrade/folder-tools-transfers.md) | 업데이트 가이드: 순번 정리·중복 찾기·파일별 전송 진행률 릴리스를 운영 서버에 올리는 순서, 자동 처리 내용, 확인, 실패·롤백 |
