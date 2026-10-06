@AGENTS.md

# RelayFiles — 프로젝트 규칙

셀프호스팅 파일 공유·스트리밍 서비스. 디자인 시안을 Next.js로 구현하고 Ubuntu 서버(N95)에서 실제로 운영한다.

- 구현 계획(단일 기준): [`docs/plan.md`](docs/plan.md)
- 디자인 시안 원본: [`docs/design/Relay_App.dc.html`](docs/design/Relay_App.dc.html)
- 아키텍처와 레이어 규칙: [`docs/architecture.md`](docs/architecture.md)

## 스택 (버전은 `package.json`이 기준)

| 영역 | 사용 |
|---|---|
| 런타임 | Node.js 24 LTS (`.nvmrc`) |
| 프레임워크 | Next.js 16.3 App Router, React 19.3, `output: "standalone"`, `typedRoutes` |
| 스타일 | Tailwind CSS 4.3 (CSS-first `@theme`), 디자인 토큰은 CSS 변수 |
| 언어 | TypeScript 6.0 strict (`typescript-eslint`가 TS 7을 지원할 때까지 `~6.0.3` 고정) |
| 검증 | zod 4 (env, API 계약) |
| 데이터 | PostgreSQL 16 + Prisma 7, Redis 7 + BullMQ (M2부터) |
| 파일 | 외장 SSD `/mnt/relayfilesDB`, 사용자별 루트 폴더에 원본 저장 (M2부터) |
| 테스트 | Vitest 5 (단위), Playwright 1.63 (E2E, 360/768/1280 뷰포트) |
| 린트 | ESLint 9 flat config + `eslint-plugin-boundaries` (레이어 규칙) |

## Next.js 16 주의사항

- `middleware.ts`는 **`proxy.ts`로 이름이 바뀌었다**. 새 코드는 `src/proxy.ts`를 쓴다.
- `forbidden()` / `unauthorized()`는 `experimental.authInterrupts`가 필요하다.
- 라우트 타입(`PageProps`, `LayoutProps`)은 `next typegen`이 생성한다(`npm run typecheck`가 실행함).
- 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 확인한다.

## 명령어

```bash
npm run dev          # 개발 서버
npm run build        # next build + standalone 번들 준비
npm run start        # node .next/standalone/server.js
npm run typecheck    # next typegen && tsc --noEmit
npm run lint         # eslint (경고 0개 허용)
npm run test         # 단위 테스트 (외부 서비스 없음)
npm run test:integration  # PostgreSQL·Redis가 필요한 통합 테스트 (.env 사용)
npm run db:migrate   # prisma migrate dev (개발: 스키마 변경 → 마이그레이션 생성)
npm run db:deploy    # prisma migrate deploy (운영)
npm run volume:init  # STORAGE_ROOT 볼륨 초기화·등록 (재실행 안전)
npm run admin:create # 관리자 계정 생성, 토큰을 한 번만 출력
npm run test:e2e     # playwright (PLAYWRIGHT_CHROMIUM_PATH로 브라우저 지정 가능)
npm run check:emoji  # 이모지 사용 검사
npm run check        # typecheck · lint · emoji · test · build 전체
npm run worker       # 백그라운드 워커(썸네일, 공개 링크용 메타데이터 제거본). ffmpeg 필요
npm run media:backfill  # 썸네일 없는 이미지·영상을 다시 큐에 넣기
```

결과물을 전달하기 전에 `npm run check`를 통과시킨다. DB나 스토리지를 건드리면 `npm run test:integration`도 통과시킨다.

개발용 PostgreSQL·Redis: `docker compose --env-file .env -f deploy/docker-compose.dev.yml up -d` (값은 `.env`에서 읽음). Prisma 클라이언트는 `src/server/db/generated/`에 생성되며 커밋하지 않는다(`postinstall`이 생성).

## 구조 규칙

- `src/app` 라우팅 전용 · `src/features/<기능>` 기능 단위 UI/훅/클라이언트 API · `src/shared` 공용 UI·유틸 · `src/domain` 순수 규칙 · `src/contracts` zod 계약 · `src/config` 설정·정책 상수 · `src/server` 서버 전용(DB, Redis, 스토리지).
- 레이어 의존 방향은 `eslint-plugin-boundaries`가 강제한다. 허용 표는 `eslint.config.mjs`와 `docs/architecture.md`를 본다.
- `src/domain`은 React, Next, Prisma, Node API에 의존하지 않는 순수 함수만 둔다. 모든 함수에 `*.test.ts`를 둔다.
- `src/server/**` 파일은 `import "server-only"`로 시작한다.
- 매직 넘버는 금지한다. 정책 값은 `src/config/policy.ts`, 배포별 값은 env(`src/config/env.ts`에서만 읽음)에 둔다.
- 파일 하나에 책임 하나. 컴포넌트는 200줄 이하를 목표로 한다.
- 이름: 컴포넌트 `PascalCase.tsx`, 훅 `useX.ts`, 서비스 `x.service.ts`, 리포지토리 `x.repo.ts`, 스키마 `x.schema.ts`, 테스트 `*.test.ts`.

## 디자인 구현 규칙

- 시안의 px, 색, 반경, 그림자, 문구(영문 원문)를 그대로 옮긴다. 반올림 금지.
- 테마 의존 색은 CSS 변수 토큰, 시안의 하드코딩 색은 이름 붙인 고정 팔레트를 쓴다.
- hover는 시안에 지정된 곳에만 단다. 키보드 포커스(`focus-visible`)에만 포커스 링을 추가한다.
- **아이콘은 `@phosphor-icons/react` SVG만 쓴다. 이모지 금지**(`npm run check:emoji`가 검사).
- 폰트: Figtree(라틴) + Pretendard(한글) + JetBrains Mono(고정폭), 모두 셀프호스팅.
- 반응형 경계: mobile `<720px`, tablet `720–1023px`, desktop `≥1024px`. 최소 폭 320px에서 가로 스크롤이 없어야 한다.
- 데모 데이터, 데모 미디어, 가짜 지표를 넣지 않는다. 모든 화면은 실제 데이터를 쓴다.

## 환경 변수

- 커밋되는 env 파일은 `.env.example` 하나다. 사용자가 복사해서 `.env`를 직접 만든다(`npm run env:secrets`로 비밀값 생성, `npm run env:check`로 검증).
- 포트, 호스트, 경로, 도메인, 비밀값을 코드·compose·nginx 설정에 하드코딩하지 않는다.
- 앱은 `src/config/env.ts`의 그룹별 getter(`getAppEnv()`, `getEnv("database")` 등)로만 읽는다. 그룹은 처음 쓰일 때 검증된다.
- 새 설정은 `env.ts` 스키마와 `.env.example`을 같은 PR에서 함께 바꾼다(`env.test.ts`가 두 목록이 같은지 검사).

## API · 보안

- 응답 형식: `{ success: true, data }` / `{ success: false, error, code }`. 스택 트레이스, 쿼리, 내부 경로를 노출하지 않는다.
- 모든 route handler는 `apiHandler()`(try-catch, 로깅, 에러 마스킹, request id)를 거친다.
- 파일 경로는 클라이언트에서 받지 않는다(nodeId → 서버가 계산). 해석한 경로가 사용자 루트 하위인지 항상 검사한다.
- 다른 계정의 리소스는 404로 응답한다.
- 원본 파일은 수정하지 않는다. SSD는 LUKS2로 전체 암호화하고, 앱에서 파일 단위 암호화는 하지 않는다.
- 로그에 토큰, 비밀번호, 실제 IP를 남기지 않는다.

## DB · 마이그레이션

- 스키마부터 바꾼다: `npx prisma migrate dev --name <설명>` → 마이그레이션 파일 커밋 → 구현. 운영 배포는 `npx prisma migrate deploy`. `db push` 금지.
- 파괴적 변경은 expand → migrate → contract로 여러 릴리스에 나눈다.
- 공유 링크(`linkId`)와 계정 토큰은 어떤 마이그레이션에서도 바뀌면 안 된다.

## Git

- Conventional Commits: `feat(scope): subject`, 소문자, 명령형, 마침표 없음.
- PR 본문: `## Changes` / `## How to Test` / `## Related Issues`.
- npm만 쓰고 `package-lock.json`을 커밋한다.
