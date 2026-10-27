# 문서

| 문서 | 내용 |
|---|---|
| [plan.md](plan.md) | 설계 결정 (화면 구성, 에러 화면, 백엔드, 스토리지, 마이그레이션 전략, 환경 변수 원칙). 코드 주석의 `§` 번호가 이 문서를 가리킨다 |
| [architecture.md](architecture.md) | 레이어 규칙, 요청 흐름, 교체 가능한 인터페이스, 워커, 미리보기·캐시 |
| [design/spec.md](design/spec.md) | 토큰·프리미티브 수치 스펙 (디자인 기준) |
| [api.md](api.md) | 응답 형식, 에러 코드, 엔드포인트 |
| [security.md](security.md) | 보안 모델 (스토리지, 로그, 인증) |
| [deploy-ubuntu.md](deploy-ubuntu.md) | Ubuntu 서버·외장 SSD·Docker Compose 배포. 배포 방식 비교, 요청 흐름, 단계별 확인, 백업 자동화, 문제 해결, 배포 후 보안 점검 |
| [deploy-systemd.md](deploy-systemd.md) | Docker 없이 systemd 서비스 + 호스트 Nginx 배포. 계정 구분, 디렉터리 구조, 단계별 확인, 실패 시 복구, 문제 해결 |
| [runbook.md](runbook.md) | 운영 절차 (백업, 복구, 롤백, 점검, SSD, 마이그레이션, 볼륨 추가·교체, 서버 이전, 비밀값 교체, 리허설 기록) |
