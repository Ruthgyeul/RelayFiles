# RelayFiles — 디자인 시안 구현 계획서

> 기준 시안: `Relay_App.dc.html` (1,952줄 = 마크업 1–996 + 동작 로직 997–1950)
> 대상 레포: `Ruthgyeul/RelayFiles` (현재 `README.md`, `.gitignore`만 있음) · 작업 브랜치 `claude/eager-bell-lrz3vc`
> v2 반영 사항: 폰트 재선정 · 이모티콘 금지(SVG 아이콘만) · 데모 데이터 미포함(실서버 동작) · 구조/지속성/확장성 강화 · 반응형 명세 · 에러/경고 페이지 추가
> v3 반영 사항: PostgreSQL + Redis(캐시 포함) 역할 분담, 외장 SSD `/mnt/relayfilesDB`에 사용자별 루트 폴더로 원본 저장, 보안 대책, 다중 볼륨 확장 구조(§13.4–13.7, §14)
> v4 반영 사항: 마이그레이션 전략(DB 스키마, 스토리지 레이아웃, 계정·볼륨 이동, 서버 이전, 백엔드 전환, 키 교체, 캐시·클라이언트 데이터 버전) — §13.8
> M0 반영 사항: 실제 설치 검증 결과로 버전 확정(TypeScript 6.0.3, ESLint 9.39), Next 16 규약 반영(`middleware.ts` → `proxy.ts`, `forbidden`/`unauthorized`는 `experimental.authInterrupts`), standalone 실행 방식

---

## 0. Context

- **배경**: RelayFiles는 아직 코드가 없다. 디자인 툴에서 만든 단일 HTML 프로토타입에 화면, 상호작용, 문구, 정책(14일 자동 삭제, 토큰 계정, 공유 링크, 다운로드 혼잡 제어 등)이 모두 들어 있다. 이것을 **Next.js 16.3 + React 19.3 + Tailwind CSS 4.3**으로 구현하고, 실제 Ubuntu 서버에서 동작하는 제품으로 만든다.
- **시안의 정체**: `<x-dc>` 템플릿(`{{ }}`, `<sc-if>`, `<sc-for>`, `style-hover`)과 `class Component extends DCLogic`. 데이터, 서버 지표, 업로드 진행률은 모두 클라이언트 목업과 시뮬레이션이다.
- **목표**:
  1. 레이아웃, 색, 간격, 반경, 그림자, 문구(영문 원문), 상호작용 규칙은 시안과 동일하게 맞춘다.
  2. 시안의 목업과 시뮬레이션은 **전부 실제 데이터와 실제 서버 기능**으로 대체한다. 데모 시드, 데모 미디어, 가짜 지표는 넣지 않는다.
  3. 시안에 없는 화면(에러, 경고 페이지)은 시안의 디자인 언어로 새로 만든다.
- **시안과 의도적으로 다른 점** (전부 사용자 요청): 폰트 구성(§3.1), 아이콘 렌더링 방식(SVG 컴포넌트, §3.2), 데모 데이터 제거(§3.3), 에러·경고 페이지 추가(§9).
- **확정된 결정 (사용자 승인)**:
  1. **암호화 — 파일 단위가 아니라 SSD 전체를 암호화한다.** 외장 SSD `/mnt/relayfilesDB`는 LUKS2(dm-crypt, AES-XTS) 전체 디스크 암호화로 보호한다. 앱은 파일을 따로 암호화하지 않으므로 디스크 위 파일은 **업로드한 원본과 바이트 단위로 같다**. 이 덕분에 Nginx가 원본 파일을 직접 보낼 수 있다(X-Accel, Range, sendfile). SSD를 분실하거나 도난당해도 키 없이는 읽을 수 없다(§13.5).
  2. **이미지 메타데이터 — 원본은 절대 수정하지 않는다.** 저장된 원본은 그대로 두고, **공개 공유 링크로 나가는 이미지만** 위치(GPS)와 카메라 정보(EXIF)를 지운 사본(`system/derived/`)을 만들어 보낸다. 소유자가 직접 받는 다운로드는 항상 원본이다. 계정 설정 "Strip metadata on public links"(기본 ON)로 끌 수 있다(§13.5, §8.4).

---

## 1. 시안 분석 요약

### 1.1 페이지

| 라우트 | 헤더 타이틀 | 내비 라벨 / 아이콘 | 노출 |
|---|---|---|---|
| `/` | Home | Home / House | 모두 |
| `/files/[[...folderId]]` | 현재 폴더명 | File Manager / FolderSimple (+24h 내 만료 배지) | 모두 |
| `/admin/accounts` | Accounts | Accounts / UsersThree | admin |
| `/admin/server` | Server | Server / Cpu | admin |
| `/status` | Status | Status / Pulse | 모두(공개) |
| `/settings` | My Profile | Settings / GearSix | 로그인 |
| `/d/[linkId]` | — | — | 공개 공유 페이지 |

### 1.2 오버레이 카탈로그 (z-index는 시안 값 유지)

| z (backdrop/panel) | 오버레이 | 폭 |
|---|---|---|
| 10 | 상단 헤더(sticky) | — |
| 15 | 메뉴 바깥 클릭 캐처 | — |
| 16 | 사이드바(sticky, lg 이상) | 240 / 접힘 68 |
| 20 | 팝오버 메뉴(행, 헤더, 정렬, 계정) | min 200 / 계정 170 |
| 30 / 31 | 모바일 드로어 | 260 |
| 40 | 전송 패널 / "Transfers · N" 알약 | min(400, 100vw−32) |
| 44 | "Moving N items" 드래그 알약 | — |
| 45 | 공유 페이지 소유자 미리보기 | 풀스크린 |
| 50 / 51 | 공유 설정, 로그인, 계정 관리 | 480 / 420 / 480 |
| 55 / 56 | 새 토큰 저장(바깥 클릭으로 안 닫힘) | 460 |
| 57 / 58 | 링크 활동, 중복 업로드, 삭제 확인 | 520 / 440 / 400 |
| 60 / 61 | 미디어 뷰어(sm 이상 모달 880, 미만 풀스크린) | — |
| 62 / 63 | 장애 등록, 속성, 태그, 이름 변경, 이동·복사, 새 폴더, 확인 대화상자 | 480 / 460 / 440 / 420 / 440 / 420 / 400 |
| 64 / 65 | 키보드 단축키 | 560 |
| 66 / 67 | 전역 검색(⌘K) | 620, top max(12px,10vh) |
| 70 | 알림 토스트(가운데 상단, 1800ms) | — |
| 72 | 계정 전환 토스트(우상단, 3200ms) | 340 |

### 1.3 반응형 경계 (시안 기준값)

- **mobile** `<720px`: 버튼 라벨 숨김, 탭 영역 40px, 메뉴 항목 44px, 리스트 썸네일 숨김, 뷰어 풀스크린, 경로 표시줄 최대 3단계
- **tablet** `720–1023px`: 라벨 표시, 탭 30px, 메뉴 36px, 경로 6단계, 사이드바 대신 드로어
- **desktop** `≥1024px`: 고정 사이드바(접기 240↔68, `transition: width .18s ease`)

---

## 2. 기술 스택 & 버전 (2026-10-05 npm 확인)

| 영역 | 패키지 | 버전 | 비고 |
|---|---|---|---|
| 런타임 | Node.js | 24 LTS | `.nvmrc`, Docker `node:24-bookworm-slim` |
| 프레임워크 | `next` | **16.3.8** | App Router, Turbopack, `output: 'standalone'`, `typedRoutes` |
| UI | `react`, `react-dom` | **19.3.0** | |
| 스타일 | `tailwindcss`, `@tailwindcss/postcss` | **4.3.3** | CSS-first `@theme` |
| 언어 | `typescript` | **6.0.3** (`~6.0.3` 고정) | M0 검증: Next 16.3은 TS 7을 지원하지만 `typescript-eslint` 8.71이 TS 7을 지원하지 않는다(peer `<6.1`). 지원되면 TS 7로 올린다 |
| 아이콘 | `@phosphor-icons/react` | **2.1.10** | SVG 컴포넌트, `/ssr` 엔트리, 트리셰이킹. 이모지 금지 |
| 폰트 | `next/font/google`(Figtree, JetBrains Mono), `pretendard` npm(로컬) | — | §3.1 |
| 클라이언트 상태 | `zustand` | 5.0.15 | UI 상태만 담당 |
| 서버 상태 | `@tanstack/react-query` | 최신 5.x | 캐시, 무효화, 낙관적 업데이트 |
| 검증 | `zod` | 4.6.5 | env, API 입력/출력 스키마 공유 |
| ORM | `prisma`, `@prisma/client` | **7.10.0** | `latest` 태그가 8.0 RC라서 stable로 고정 |
| 큐/캐시 | `bullmq` 6.3.11, `ioredis` 6.0.0 | | |
| 업로드 | `@tus/server` 2.4.5, `@tus/file-store` 2.1.1, `tus-js-client` 4.3.1 | | 재개 가능 청크 업로드 |
| zip | `archiver` 8.0.0 | | 스트리밍 zip |
| 서버 지표 | `systeminformation` 5.33.15 | | |
| 비밀번호 해시 | `@node-rs/argon2` | 최신 | 공유 링크 비밀번호(ARM64 prebuilt 있음) |
| 로깅 | `winston` 3.19.0 | | |
| 테스트 | `vitest` 5.0.3, `@playwright/test` 1.63.0, `@testcontainers/postgresql`(선택) | | |
| 린트 | `eslint` **9.39.x**, `eslint-config-next` 16.3.8, `eslint-plugin-boundaries` 7.x, `eslint-import-resolver-typescript` 4.x | | M0 검증: `eslint-config-next`에 포함된 react/import/jsx-a11y 플러그인이 ESLint 10을 지원하지 않아 9로 고정. 레이어 의존 규칙 강제 |

npm으로 고정하고 `package-lock.json`을 커밋한다. native 모듈은 ARM64 호환을 확인한다(Pi 배포 가능성 대비).

---

## 3. 디자인 구현 원칙

### 3.1 폰트 — 시안 톤에 맞춘 구성

| 용도 | 폰트 | 이유 |
|---|---|---|
| 본문/UI(라틴) | **Figtree** (`next/font/google`, variable, 400–800) | 시안의 크기, 행간, 굵기 체계가 Figtree 기준이라 레이아웃이 그대로 맞는다. 둥근 지오메트릭 산세리프가 다크 UI와 잘 어울린다. 400–800 전 범위를 불러와 시안이 의도한 800 배지를 실제 800으로 렌더링한다 |
| 한글 폴백 | **Pretendard Variable** (npm `pretendard`, `next/font/local`, dynamic subset) | 파일명, 폴더명, 노트에 한글이 들어가는데 Figtree에는 한글이 없다. Pretendard는 x-height와 굵기 대비가 Figtree와 잘 맞는다 |
| 고정폭(토큰, ID, URL, 경로, 단축키, 초대코드) | **JetBrains Mono** (`next/font/google`, 400/600) | 시안의 `ui-monospace`는 OS마다 다르게 보인다. 토큰 판독성(0/O, l/1 구분)이 중요하다 |

- CSS 변수: `--font-sans: var(--font-figtree), var(--font-pretendard), system-ui, sans-serif`, `--font-mono: var(--font-jetbrains), ui-monospace, monospace`.
- 모든 폰트는 빌드 시 셀프호스팅된다. 런타임 외부 CDN 요청이 없다.

### 3.2 아이콘 — SVG 컴포넌트만, 이모지 금지

- `@phosphor-icons/react`의 SVG 컴포넌트를 쓴다. 시안의 `ph`/`ph-bold`/`ph-fill`은 `weight="regular" | "bold" | "fill"`로 매핑한다.
- 시안처럼 데이터에서 아이콘을 고르는 곳(파일 종류, 메뉴, 태그, 상태)은 **아이콘 레지스트리**(`src/shared/ui/icon/registry.ts`: `IconName → Component` 맵)와 `<Icon name="folder-simple" weight="fill" size={20} />` 래퍼로 처리한다. 타입은 `IconName` 유니온이라 오타는 컴파일 에러가 된다.
- 래퍼는 `width/height=size`, `flex:none`, `aria-hidden`(장식용)으로 렌더링한다. 의미가 있는 아이콘 전용 버튼에는 `aria-label`을 단다.
- 시안의 텍스트 기호 중 `·` `…` `→` `←` `↑` `↓` `⌘` `∞` `•`는 타이포그래피 문자라서 유지한다. 그림 이모지는 UI와 코드 어디에도 쓰지 않는다(ESLint 정규식 규칙 + CI grep 검사).

### 3.3 데모 데이터 미포함

- 시안의 `seed()`(Videos/Photos/Music 데모 트리), MDN·picsum·soundhelix 미디어, 데모 계정 6개(`directory`), 하드코딩된 데모 incident 2건, 시뮬레이션 지표(`srvT` 랜덤워크, 가짜 traffic 막대, 시드 기반 48h/60일 차트), "PROTOTYPE ONLY" admin 자동 로그인은 **이식하지 않는다**.
- 빈 상태는 시안의 empty 디자인을 그대로 쓰고, 이력 데이터가 아직 없는 차트에는 "No data yet" 상태를 추가한다(§8.6, §8.7).
- 테스트용 데이터는 테스트 코드 안에서 API로 생성하고 테스트가 끝나면 지운다. 저장소와 배포물에는 포함하지 않는다.
- 첫 관리자는 서버에서 `npm run admin:create`로 만들고 토큰을 터미널에 한 번 출력한다.

### 3.4 시각 동일성 규칙

1. px 값은 그대로 옮긴다. spacing 배수(예: 18px = `p-4.5`)면 유틸리티, 아니면 `h-[38px]` 임의값. 반올림 금지.
2. 테마 의존 색은 CSS 변수 토큰, 시안 하드코딩 색은 고정 팔레트(`src/shared/styles/palette.ts` + `@theme` 상수)로 이름을 붙여 쓴다.
3. hover는 시안에 `style-hover`가 있는 곳에만 단다.
4. 키보드 포커스에만 `focus-visible: outline 2px var(--accentHi)`를 추가한다(접근성).
5. `<img>`/`<video>`는 원시 요소를 쓴다. 사용자 업로드 미디어는 인증 쿠키가 필요한 스트림 URL이라 `next/image` 최적화 대상이 아니다.
6. 시안의 `window.prompt`/`window.confirm`(새 폴더, 새 링크, 토큰 재발급, 계정 삭제, 기기 로그아웃, 장애 삭제)은 **시안 모달 디자인과 같은 `PromptDialog`/`ConfirmDialog`로 대체**한다. 네이티브 다이얼로그는 테마가 깨지고 모바일 UX가 나쁘다.

### 3.5 고정 팔레트 (테마 무관, 시안 하드코딩 값)

- 성공: `#3fd49a #4fe0a6 #123c33 #10302a #2f6b55 #2fbf86`
- 경고: `#f5c04a #f5b400 #f5a142 #33290f #6b5518 #3a2e12 #3a2a1c #f5d58a`, 미리보기 바 `#2a2410 #4a3d14 #3a3214 #5a4b1a`
- 위험: `#ff8a94 #ff6b7d #e5484d #3a1d24 #6b2d39 #33171d #ffc9cf`
- 정보: `#7cc8f5 #14324a #245a7d #3fc1d5 #163a44`, 메모리 `#2c2350`
- 종류: folder `#f5b400`, video `#f2667a`, audio `#b18cff`, image `#3fc1a5`, other `var(--t4)`
- 기타: nav hover `#222b45`, 점선 `#3a4666`, 활성 점 `#3a8bff`, 확인 비활성 `#2a3350`, 그리드 체크박스 `rgba(20,27,46,.72)`, 뷰어 `#1d2233`/`#1a1f2e`, backdrop `rgba(6,10,20,.55|.6|.7)`, 뷰어 backdrop `rgba(8,12,24,.72)+blur(2px)`, 만료 배지 `#f5a142/#1a1206`

---

## 4. 아키텍처 & 프로젝트 구조

### 4.1 설계 원칙

- **기능 단위 모듈(feature-sliced)**: 화면이 아니라 도메인(파일, 공유, 계정, 관리자, 상태 등) 기준으로 묶는다. 기능을 추가하면 `features/<name>/` 하나만 늘어난다.
- **단방향 레이어**: `app`(라우팅) → `features`(UI·훅·클라이언트 API) → `shared`(공용 UI·유틸) / 서버 측은 `app/api`(얇은 핸들러) → `server/services`(업무 규칙) → `server/repositories`(Prisma) → DB. 역방향 import는 `eslint-plugin-boundaries`로 금지한다.
- **도메인 규칙은 순수 함수**: `src/domain/`은 React, Next, Prisma에 의존하지 않는다. 클라이언트와 서버가 같은 규칙(이름 검증, 가시성 상속, 혼잡도, 만료 계산)을 공유하므로 규칙이 한곳에만 있다.
- **계약 우선**: API 요청/응답 zod 스키마를 `src/contracts/`에 두고 클라이언트와 서버가 함께 import한다. 타입이 어긋나면 컴파일 에러가 난다.
- **인터페이스로 교체 가능하게**: `StorageDriver`(로컬 디스크 → 추후 S3/MinIO), `MetricsSource`, `GeoLookup`, `Clock`(테스트용 시간 주입).
- **서버 전용 보호**: `src/server/**`는 `import 'server-only'`로 클라이언트 번들 유입을 막는다.
- **설정 단일화**: 매직 넘버(14일, 10분 창, 5/10회 임계값, 잠금 시간, 청크 크기, 폴링 주기)는 `src/config/policy.ts` 한곳에 이름을 붙여 둔다. 배포마다 바뀌는 값은 env로 뺀다.

### 4.2 디렉터리

```
RelayFiles/
├─ CLAUDE.md                         # 프로젝트 규칙 (M0에서 가장 먼저 작성)
├─ docs/
│  ├─ design/Relay_App.dc.html       # 시안 원본
│  ├─ design/spec.md                 # 화면별 수치 스펙(§8 확장)
│  ├─ architecture.md · api.md · deploy-ubuntu.md · security.md · runbook.md
├─ src/
│  ├─ app/                           # 라우팅 전용 (로직 없음, feature 컴포넌트 조립)
│  │  ├─ layout.tsx                  # html[data-theme], 폰트, Providers
│  │  ├─ (app)/layout.tsx            # AppShell
│  │  ├─ (app)/page.tsx · files/[[...folderId]]/page.tsx · settings/page.tsx
│  │  ├─ (app)/admin/layout.tsx      # admin 가드 → forbidden()
│  │  ├─ (app)/admin/accounts/page.tsx · admin/server/page.tsx
│  │  ├─ (app)/status/page.tsx · (app)/loading.tsx
│  │  ├─ d/[linkId]/page.tsx         # 공개 공유 페이지
│  │  ├─ not-found.tsx · forbidden.tsx · unauthorized.tsx · error.tsx · global-error.tsx
│  │  ├─ error/[code]/page.tsx       # 400/410/413/429/503 등 명시적 에러 화면
│  │  └─ api/**/route.ts             # 얇은 핸들러: 인증 → zod 파싱 → service 호출 → 응답
│  ├─ features/
│  │  ├─ shell/       (Sidebar, Drawer, AppHeader, AppFooter, BannerStack, toasts)
│  │  ├─ files/       (components/, hooks/, api.ts, store.ts, menu.ts)
│  │  ├─ upload/      (tus 클라이언트, 중복 처리, 드롭 재귀 파서)
│  │  ├─ transfers/   (패널, 진행 상태 store)
│  │  ├─ viewer/      (MediaViewer, InlineVideo, resume)
│  │  ├─ share/       (SharePage, 상태 카드들, 설정 대화상자)
│  │  ├─ tags/ · search/ · activity/
│  │  ├─ account/     (로그인, 새 토큰, 프로필, 기기, 다중 계정 전환)
│  │  ├─ admin/       (accounts, manage, invites, announcement)
│  │  ├─ server-monitor/ · status/ · incidents/
│  │  ├─ errors/      (ErrorScreen, WarningScreen, 코드별 프리셋)
│  │  └─ shortcuts/
│  ├─ shared/
│  │  ├─ ui/          (Button, IconButton, Card, ListCard, OptionChip, OptionCard, CheckRow,
│  │  │                Pill, Tag, Banner, Menu, Modal, ConfirmDialog, PromptDialog, TextInput,
│  │  │                TextArea, Avatar, Skeleton, StatTile, Meter, BarChart, Kbd, Logo, icon/)
│  │  ├─ hooks/       (useViewport, useMenuPlacement, useHotkeys, useInterval, useClipboard)
│  │  ├─ lib/         (cn, http client(fetchJson + 에러 매핑), date/size 포맷 래퍼)
│  │  └─ styles/      (globals.css, themes.css, palette.ts)
│  ├─ domain/         # 순수 규칙 (+ *.test.ts) — §10
│  ├─ contracts/      # zod 스키마 (API DTO, 에러 코드)
│  ├─ config/         # policy.ts, env.ts(zod), theme.ts
│  └─ server/
│     ├─ db.ts · redis.ts · logger.ts · queue.ts
│     ├─ auth/ (session, token, guards, rate-limit)
│     ├─ services/ (accounts, nodes, uploads, downloads, share, admin, metrics, health, incidents)
│     ├─ repositories/ (Prisma 접근만)
│     ├─ storage/ (StorageDriver 인터페이스, LocalVolumeDriver, volume-registry, safe-path,
│     │            storage-transaction, volume-watch) — §13.5
│     ├─ cache/ (cached() 헬퍼, 키 규칙, 무효화)
│     └─ http/ (apiHandler 래퍼, ApiError, 응답 헬퍼)
├─ worker/            # BullMQ 워커 진입점 + jobs/
├─ scripts/           # admin-create.ts, rotate-keys.ts, volume-*.ts
│  └─ migrations/      # data/<ts>-<name>.ts (DB 데이터 백필), storage/<n>-<name>.ts (디스크 레이아웃) — §13.8
├─ prisma/ schema.prisma · migrations/
├─ e2e/               # Playwright
├─ deploy/            # docker-compose.yml, Dockerfile, nginx/, systemd/, error-pages/
└─ .env.example
```

### 4.3 코드 규칙 (CLAUDE.md에 명시)

- 파일당 한 가지 책임. 컴포넌트는 200줄 이하를 목표로 하고, 넘으면 하위 컴포넌트로 나눈다.
- 이름: 컴포넌트 `PascalCase.tsx`, 훅 `useX.ts`, 서비스 `x.service.ts`, 리포지토리 `x.repo.ts`, 스키마 `x.schema.ts`.
- `any` 금지, `noUncheckedIndexedAccess` 등 strict 옵션 사용, 프로덕션에서 `console.log` 금지.
- API 응답은 `{ success: true, data } | { success: false, error, code }`(code는 클라이언트 에러 화면 매핑용 enum).
- 모든 route handler는 `apiHandler()` 래퍼를 거친다(try-catch, 로깅, 에러 마스킹, request id).

---

## 5. 디자인 토큰 (`src/shared/styles/globals.css`)

```css
@import "tailwindcss";
@import "./themes.css";          /* 시안 11행의 10개 테마 블록을 그대로 옮김 */

@theme {
  --breakpoint-sm: 45rem;   /* 720px  mobile/tablet 경계 */
  --breakpoint-lg: 64rem;   /* 1024px tablet/desktop 경계 */
  --font-sans: var(--font-figtree), var(--font-pretendard), system-ui, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, monospace;
  --color-bg: var(--bg); --color-header: var(--header); --color-sunk: var(--sunk);
  --color-card: var(--card); --color-elev: var(--elev); --color-btn: var(--btn);
  --color-btn-h: var(--btnH); --color-line: var(--line); --color-card-line: var(--cardLine);
  --color-ctrl: var(--ctrl); /* t1..t5, accent 계열 7종, on-accent 동일하게 매핑 */
  --animate-skel: skel 1.4s ease-in-out infinite;
  @keyframes skel { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
}
body { margin:0; background:var(--bg); color:var(--t1); font-family:var(--font-sans); }
a { color:var(--accentIcon) } a:hover { color:var(--accentText) }
```

- 테마 10종: blue(`:root`), lime, coral, amber, teal, mono, plum, crimson, forest, sky. 기본은 시안 default **Slate Sky(`sky`)**. 서버 설정(`ServerConfig.theme`, admin이 Server 페이지에서 변경) 또는 env `DEFAULT_THEME`을 SSR로 `<html data-theme>`에 반영하므로 깜빡임이 없다.
- sky 값: bg `#0f1419`, header `#12181e`, sunk `#141b21`, card `#182028`, elev `#1e2730`, btn `#232d37`, btnH `#2b3641`, line `#212a33`, cardLine `#27313b`, ctrl `#36424e`, t1 `#eef3f7`, t2 `#cdd8e1`, t3 `#a4b2bf`, t4 `#8695a2`, t5 `#677683`, accent `#38bdf8`, accentHi `#5ccbfa`, accentIcon `#4cc4f9`, accentText `#bae6fd`, accentSoft `#0f3347`, accentSoftLine `#1f5d80`, onAccent `#06141c`
- 안전 영역: `padding-bottom: env(safe-area-inset-bottom)`(전송 패널, 뷰어, 드로어), `viewport-fit=cover`. 풀스크린 요소는 `100dvh`를 쓴다(모바일 주소창 대응).

---

## 6. 공용 UI 프리미티브 (`src/shared/ui/`)

| 컴포넌트 | 스펙 (시안 값) |
|---|---|
| `Button` primary | bg accent, 1px accent, onAccent, 700, radius 10, `hoverable` 시 accentHi |
| `Button` secondary | bg btn, 1px ctrl, t1, 700, radius 10, `hoverable` 시 btnH |
| `Button` danger-outline / danger-solid | transparent, 1px `#6b2d39`, `#ff8a94` / bg `#e5484d`, white |
| `Button` size | h 28·30·32·34·36·38·40·44 × px 10·12·14·16 × 12·13·14·15px. `labelHiddenOnMobile` prop(라벨 sm 미만 숨김, 아이콘만) |
| `IconButton` | transparent, t3, radius 8, 28–44, hover btn/btnH, **필수 `aria-label`** |
| `Card` / `ListCard` | card bg, 1px cardLine, radius 16 / bg cardLine + gap 1px 구분선 |
| `OptionChip` / `OptionCard` | on: accentSoft·accentHi·accentText / off: btn·ctrl·t2. h34 px14 / p12 radius 12 |
| `CheckRow` | Square ↔ CheckSquare(fill) 22px accentHi + 14px 600 라벨, `role="checkbox" aria-checked` |
| `Pill` / `Tag` | 2px 7px r999 10px 800 ls .04em / 3px 8px r6 btn·ctrl 11px 600 t2 |
| `Banner` | p `14px 10px 14px 16px`, r14, 아이콘 20–22, 닫기 30–32 |
| `Menu` | fixed, min-w 200, elev, 1px ctrl, r12, p6, shadow `0 12px 30px rgba(0,0,0,.4)`, 항목 h 36/44, 14px 600, r8, hover btnH, 구분선 `margin:4px 6px`. **mobile에서는 하단 시트**로 표시(§7) |
| `Modal` | backdrop + 패널(card, 1px ctrl, r16, shadow `0 24px 60px rgba(0,0,0,.5)`, `min(Npx, calc(100vw - 24px))`, max-h `calc(100dvh - 24px)`), Header(p `16px 20px`), Footer(p `14px 20px`, 오른쪽 정렬 gap 8). focus trap, Esc, 이전 포커스 복원, `role="dialog" aria-modal` |
| `ConfirmDialog` / `PromptDialog` | 시안 삭제 확인 모달(w400) 스타일. 네이티브 confirm/prompt 대체 |
| `TextInput` / `TextArea` | h40/44, px 12–14, r10, 1px ctrl, bg bg/sunk, 15/14px, outline none, focus-visible 링 |
| `Avatar` | identicon(§10 `avatarOf`) `image-rendering:pixelated`, 활성 점 12px `#3a8bff` |
| `Skeleton` · `StatTile` · `Meter` · `BarChart` · `Kbd` · `Logo` | 시안 값 그대로(막대 r `2px 2px 0 0`, transition .4s/.6s, Kbd 하단 2px 테두리) |
| `EmptyState` / `NoData` | 시안 empty(56 아이콘 박스) / 차트용 "No data yet" (t4, 막대 영역 높이 유지) |

데이터로 계산되는 색은 `style={{ '--c': value }}` + `bg-(--c)`로 넘긴다. 클래스 문자열을 조합하지 않는다.

---

## 7. 반응형 명세 (전 화면 공통 규칙)

| 요소 | mobile <720 | tablet 720–1023 | desktop ≥1024 |
|---|---|---|---|
| 내비게이션 | 햄버거 → 드로어(260, 계정·내비·스토리지) | 동일 | 고정 사이드바 240, 햄버거=접기(68, 아이콘만, title 툴팁) |
| 헤더 | h60, 타이틀 말줄임, 전역 검색은 아이콘 버튼만 | 검색 버튼 + "Search files…" + ⌘K | 동일 |
| 본문 폭 | 100% − 좌우 16px | max 880 가운데 | max 880 가운데 |
| 툴바 버튼 | 아이콘만, h32 | 아이콘 + 라벨 | 동일 |
| 행 버튼 | 탭 영역 40px, 라벨 숨김 | 30px + 라벨 | 동일 |
| 리스트 썸네일 | 숨김 | 표시(`pl-[92px]`, max 288) | 동일 |
| 그리드 | `minmax(min(160px,100%),1fr)` → 2열 | 3–4열 | 4–5열 |
| 팝오버 메뉴 | **하단 시트**(풀 폭, 항목 44px, safe-area) | 앵커 팝오버(`menuPlace`) | 동일 |
| 모달 | `calc(100vw - 24px)`, 내부 스크롤 | 지정 폭 | 동일 |
| 미디어 뷰어 | 풀스크린(`100dvh`), 버튼 44, 하단 위치 표시 | 모달 880 | 동일 |
| 경로 표시줄 | 최대 3단계 접기 | 6단계 | 6단계 |
| 전송 패널 | 하단 고정 폭 `100vw-32`, max-h 60dvh | 400 | 400 |
| 통계/카드 그리드 | 1열(`auto-fit minmax`가 자연 축소) | 2열 | 3–4열 |
| Admin 계정 행 | 정보 4칸이 2×2로 줄바꿈, 버튼 하단 | 1행 | 1행 |
| 드래그 이동 | 터치에서는 HTML5 DnD가 동작하지 않으므로 "Move to…" 메뉴/대화상자로 대체(시안에 존재) | 마우스 DnD | 마우스 DnD |
| 최소 지원 폭 | 320px(가로 스크롤 없음) | — | — |

- 구현 방식: 순수 시각 차이는 Tailwind `sm:`/`lg:` 클래스(SSR 안전)로 처리한다. 로직 분기(뷰어 모드, 썸네일 마운트, 메뉴 시트/팝오버, 경로 단계 수)만 `useViewport()`(useSyncExternalStore + matchMedia)로 처리한다. 첫 렌더는 CSS로 맞추고 로직 분기는 마운트 후 결정하므로 하이드레이션 불일치가 없다.
- `pointer: coarse`에서는 hover 전용 효과를 끄고, 썸네일 재생 버튼을 항상 표시한다.

---

## 8. 화면별 구현 스펙

### 8.1 AppShell
- 숨김 file input 2개(일반 `multiple`, 폴더 `webkitdirectory`). 업로드 대상(home 또는 폴더id)은 upload store가 관리한다.
- **사이드바/드로어**: 로고 바 h60 · 계정 목록(활성 accentSoft/accentSoftLine, 아바타 38, 이름 14px 700, 역할 12px t4 `Admin · never expires`/`Never expires`/`Deletes Oct 19`, 메뉴 Profile/Copy token/Sign out) · "Add account"(1px dashed `#3a4666`) · 내비(h44 r10 15px 600, 활성 accentSoft/accentText, hover `#222b45`, File Manager 배지 `#f5a142`) · 하단 Storage(12px, 미터 h4, ≥90% `#ff6b7d`, ≥70% `#f5a142`).
- **헤더**: sticky h60, 햄버거 40, 타이틀 20px 700, 전역 검색 버튼(files 페이지).
- **배너 스택 순서**: 자동 계정 → 공지(files) → 24h 내 만료(files/home, 최대 3행, "+7 days" `#f5b400`) → 용량 경고(80%/95%) → **오프라인 경고**(신규, §9.3) → 본문.
- **푸터**: 로고, "Private file sharing & streaming", 실제 상태 점과 제목(`/api/health` 결과), Shortcuts, `v{package.json version} · © {연도}`.
- **로딩**: `loading.tsx`가 시안 부팅 스켈레톤(헤더 카드, 툴바, 6행)을 그대로 보여 준다. 시안의 900ms 고정 지연은 쓰지 않는다.
- 계정 메뉴의 바깥 클릭 닫힘 누락 버그(시안)는 수정한다.

### 8.2 Home (`/`)
- 히어로(로고 64, "RelayFiles" 34px, 설명 원문), 업로드 카드(드롭존 h280, 2px dashed `#3a4666`/드래그 시 accentHi, Select files / Select folder), 마지막 업로드 카드("{name} is ready", URL, Copy, Open folder).
- 규칙: 업로드마다 루트에 새 폴더를 만든다(단일 최상위 폴더 이름 / 단일 파일이면 확장자를 뺀 이름 / `Upload Oct 5, 3:12 PM`, 중복이면 `uniqName`). 폴더 생성은 서버 `prepareUpload`가 원자적으로 한다.
- 모바일: 드롭존 높이를 220px로 줄이고 "Drag & drop" 문구를 "Tap to choose files or folders"로 바꾼다(터치 환경에서는 드래그 문구가 맞지 않음. **추가 문구**이며 tablet 이상은 원문 유지).

### 8.3 File Manager (`/files/[[...folderId]]`)
- **경로 표시줄**: MAX(3/6)를 넘으면 `[root, …, 마지막 MAX−2개]`로 접는다. 드래그 드롭으로 이동, 경로 복사(mono 12px).
- **폴더 헤더 카드**: Up(드롭으로 상위 이동), 아이콘 박스 48, 이름 20px, 날짜·개수, 가시성 태그(`Public`/`Public · inherited`/`Private`/`Private · inherited`/`root folder`), [Share page][Share][더보기 → `nodeMenu`], 노트.
- **툴바**: 전체 선택 | 선택 시 Download / Zip / Tags / Copy / Move / Delete, 미선택 시 Upload / Upload folder / New folder | 보기 전환 · 검색 · 정렬(7종, "SORT BY") · 새로고침(쿼리 무효화 후 "Up to date").
- **필터 칩**(All, Folders, Videos, Audio, Images, Other + 개수), **폴더 내 검색**(`/`), **태그 모드**(`#a #b` → 계정 전체 AND 검색, 서버 GIN 인덱스).
- **리스트 행 / 그리드 카드**: 시안 스펙 그대로(체크박스, 종류 아이콘과 폴더 개수 배지, 이름, 잠금 아이콘, 혼잡 배지, 메타 + 다운로드 수 + 이어보기, 태그, 버튼, 썸네일, 인라인 재생, 이어보기 바 4px, 드롭 대상 표시).
- **썸네일**: 원본을 내려받지 않도록 서버가 만든 썸네일을 쓴다. 이미지는 리사이즈 webp, 영상은 ffmpeg로 1초 지점 프레임(`/api/files/:id/thumb`, 워커가 생성). 생성 전에는 종류 아이콘을 보여 준다.
- **메뉴** `nodeMenu`: 4그룹(열기/다운로드 · 공유/태그/링크/활동/설정/다운로드 일시정지(admin) · 이름 변경/복사/이동/삭제 · 속성). 위치는 `menuPlace`(아래, 위, 끼워 넣기)이고 스크롤하면 닫힌다. mobile에서는 하단 시트.
- **DnD**: 선택 전체를 이동한다. "Moving N items" 알약, 하위로 이동 금지, 이름 충돌은 서버가 `uniqName`으로 처리하고 응답에 바뀐 이름 수를 담는다. OS 파일 드롭은 재귀 탐색 후 업로드한다.
- **업로드**: 이름 검증 → `prepare`(중복 목록, 용량) → 중복 모달(Replace/Keep both/Skip) → tus 업로드 → 완료 후 쿼리 무효화. 실패 응답 413/507은 토스트와 용량 배너로 연결한다.
- **빈 상태**: 문구 5종 원문 그대로.

### 8.4 My Profile / Settings (`/settings`)
- 프로필 카드, 보존 정책 안내(3종 원문), Storage / **Traffic(실측: 계정 다운로드 바이트 30일, `TrafficDaily`)** / Content(실제 파일·폴더 수), Access & recovery(토큰 마스킹 `앞4+•×28+뒤4`, 보기, 복사, 재발급 → ConfirmDialog → 새 토큰 모달), Signed-in devices(실제 세션, UA 파싱, 위치는 Cloudflare `CF-IPCountry`/`CF-IPCity` 헤더가 있으면 사용, 없으면 국가만, IP 마스킹 `a.b.•••.•••`), Preferences(Purge now → 실제 만료 항목 정리 API, **Strip metadata on public links** 토글(신규, CheckRow 스타일, 기본 ON)), Delete account.

### 8.5 Admin · Accounts (`/admin/accounts`)
- 통계 4장, 정책 안내 + Run cleanup now(정리 job을 즉시 실행), 필터 알약 + 검색, 계정 행(배지 ADMIN/ACTIVE/EXPIRING/PENDING DELETE, YOU, this device, 정보 4칸, Manage, 삭제), Manage 모달(Role, Deletion date 7종, Storage limit 6종 + Custom, Restart 14 days, 미리보기, 마지막 admin 보호). 서버 페이지네이션 50개 단위(무한 스크롤).

### 8.6 Admin · Server (`/admin/server`)
- 공지 편집(레벨 info/warn/maint, Publish/Take down). 지표 카드 4장(Disk/CPU/Memory/Network out)은 **systeminformation 실측**이다. "of 2 TB", "8 cores", "16 GB", "1 Gbps link" 같은 값도 실제 하드웨어에서 읽는다.
- 대역폭 60분 막대(워커가 1분마다 샘플링해 Redis 링 버퍼에 저장, SSE 1.5초 갱신). 데이터가 60개 미만이면 빈 막대를 `var(--btn)`으로 채운다.
- 실시간 타일(ACTIVE STREAMS = 열린 Range 스트림 수, TRANSFERS = 진행 중 tus 업로드, ACCOUNTS, UPTIME = `os.uptime`).
- Services 4행: Web server(자체 HTTPS probe), Media streaming(Range probe), Cleanup job(BullMQ 마지막 실행 결과), Disk health(SMART 상태와 온도. 권한이 없으면 "Unavailable").
- New accounts(Open/Invite only/Closed) + 초대코드. **테마 선택**(10종, 신규 항목. OptionChip 스타일).

### 8.7 Status (`/status`, 공개)
- 상태 카드(operational/degraded/down), Your connection(2.5초 `HEAD /api/health`, 최근 40개로 latency/avg/jitter/loss 계산, 등급 임계값 원문).
- Latency 48h: 서버 health probe의 시간별 집계(`HealthHourly`)에 마지막 막대는 클라이언트 실측. 데이터가 없는 시간은 NoData 막대로 그린다.
- Services 6종 × 60일: `HealthDaily` 집계(ok/warn/down/nodata 4색. nodata는 `var(--btn)`, 툴팁 "No data"), 가동률은 실제 계산.
- Server 정보(위치는 env, p50/p95는 probe 실측, TLS 만료일은 인증서 파일을 읽어 표시, 90일 가동률). Incidents(admin CRUD, 데모 incident 없음, 빈 상태 "No incidents reported.").

### 8.8 공유 페이지 (`/d/[linkId]` + 소유자 미리보기)
- 하나의 `SharePage` 컴포넌트를 두 곳에서 쓴다. 소유자 미리보기는 노란 바 "Visitor preview · {url}" + Back to app + Make public이 붙고, 공개 라우트에는 없다.
- 상태: Download limit reached / This link has expired / This link is private / Password protected(Unlock) / 열림(경로, 헤더 카드, 노트, 항목 행 View/Play/Download, 혼잡 배지, "Shared privately with RelayFiles").
- 서버가 상태를 판정한다(만료, 한도, 비공개, 비밀번호, burn, Stream only, 혼잡도). 이벤트(open/play/view/download)를 로그로 남긴다. 존재하지 않는 linkId는 §9의 링크 전용 404 화면으로 보낸다.

### 8.9 대화상자 (`features/*/components/*Dialog.tsx`)
ShareSettings, SignIn(잠금 카운트다운), NewToken(체크해야 Continue 활성), ManageAccount, LinkActivity, DuplicateUpload, ConfirmDelete, Incident, Shortcuts, GlobalSearch(최근 파일 8 / 결과 30, ↑↓ Enter), Properties, Tags(칩 입력, 제안, 다중 선택), Rename(확장자 앞까지 선택, 서버 중복이면 "Suggested:"), MoveCopy(폴더 트리, 들여쓰기 `12+d×18`), MediaViewer, TransfersPanel, NewFolder(PromptDialog), Confirm(공용). 스펙과 문구는 시안 원문 그대로 따른다.

---

## 9. 에러 · 경고 페이지 (신규)

### 9.1 공용 디자인: `ErrorScreen`
시안 공유 페이지의 상태 카드 언어를 확장한다.
- 레이아웃: 헤더(h60, 로고 + RelayFiles) → 가운데 카드(`min(440px,100%)`, card, 1px cardLine, r16, p `28px 24px`, 가운데 정렬, gap 12) → 하단 푸터(상태 점 + "v0.x").
- 카드 구성: 아이콘 박스 56(r14) → 상태 코드 배지(mono 600 12px, Pill) → 제목 19px 700 → 설명 14px lh1.5 t3 `text-pretty` → 버튼 행(primary + secondary, h40) → 보조 정보(요청 ID `X-Request-Id`, mono 12px t5, 복사 버튼).
- 색 규칙(CLAUDE.md 규칙과 일치): **4xx는 위험 계열**(`#3a1d24` 박스, `#ff6b7d` 아이콘, 배지 `#ff8a94`), **5xx와 점검은 경고 계열**(`#3a2e12`, `#f5b400`), **안내성 상태**(오프라인, 세션 만료)는 accent 계열(accentSoft, accentIcon).
- 반응형: mobile에서는 카드 좌우 16px 여백, 버튼은 세로로 쌓아 풀 폭.

### 9.2 코드별 화면

| 코드 | Next 연결 지점 | 아이콘 | 제목 / 설명(영문, 시안 톤) | 액션 |
|---|---|---|---|---|
| 400 | `/error/400`(잘못된 쿼리, 손상된 공유 링크 형식) | WarningOctagon | Bad request / The link or request is malformed. | Go home |
| 401 | `unauthorized.tsx`(`experimental.authInterrupts`) | Key | Sign in required / This page needs an account token. | Sign in(로그인 모달), Go home |
| 403 | `forbidden.tsx`(admin 페이지, 다른 계정 리소스) | ShieldWarning | Access denied / Your account can't open this page. | Go home, Switch account |
| 404 | `not-found.tsx` | FileX | Page not found / This page doesn't exist or was moved. | Go home, Open File Manager |
| 404(공유) | `d/[linkId]/not-found.tsx` | LinkBreak | Link not found / This link doesn't exist or was replaced with a new one. | — (방문자용, 앱 내비 없음) |
| 410 | `/error/410`(삭제된 계정 토큰, 만료 계정) | HourglassSimpleLow | Account deleted / This account reached its deletion date and its files were removed. | Create new account |
| 413 | 업로드 응답 → 토스트 + 배너(페이지 아님) | — | File too large | — |
| 429 | `/error/429`(로그인 잠금, API 레이트 리밋) | Timer | Too many requests / Try again in {mm:ss}. 카운트다운 | Retry(카운트다운이 끝나면 활성) |
| 500 | `error.tsx`(세그먼트), `global-error.tsx`(루트, 자체 html/body와 인라인 토큰) | Bug | Something went wrong / An unexpected error occurred. It has been logged. | Try again(`reset()`), Go home |
| 502/504 | **Nginx 정적 페이지**(`deploy/error-pages/`, 앱 다운 시) | 인라인 SVG | Server unreachable / The app server is not responding. | Retry, Status |
| 503 | `/error/503` + Nginx 점검 페이지(`maintenance.flag` 파일이 있으면 Nginx가 반환) | Wrench | Under maintenance / {공지 maint 메시지 또는 기본 문구} | Status |
| 503(스토리지) | `/error/storage-offline`(볼륨 OFFLINE, §13.5) | HardDrives | Storage offline / Files are temporarily unavailable. Browsing still works; uploads and downloads resume when storage is back. | Status, Retry |
| 507 | 업로드 응답 → 토스트 + 용량 배너 | — | Not enough space on the server | — |

- Nginx 정적 페이지는 Next 빌드 산출물에 의존하지 않도록 순수 HTML + 인라인 CSS(같은 토큰 값, 폰트 폴백 system-ui) + 인라인 SVG 아이콘으로 만든다. `scripts/build-error-pages.ts`가 `ErrorScreen`을 정적 HTML로 렌더링해 생성하므로 디자인이 한곳에서 관리된다.
- `proxy.ts`(Next 16에서 `middleware.ts`가 이름 변경됨)와 `apiHandler`는 에러 코드 enum(`contracts/errors.ts`)을 쓴다. 클라이언트 `fetchJson`은 401/403/410/429를 해당 화면이나 모달로 매핑한다.

### 9.3 경고 화면·배너 (페이지 전체를 막지 않는 상태)

| 상황 | 표시 | 디자인 |
|---|---|---|
| 오프라인 | 상단 배너 "You're offline · transfers paused and will resume automatically" | Banner(accent 계열, WifiSlash) |
| 세션 만료/폐기(다른 기기에서 토큰 재발급) | 모달 "Signed out on this device" + Sign in | 시안 SignIn 모달 재사용 |
| 계정 삭제 임박(≤3일) | 배너 "This account and its files are deleted in 2d 4h" | 경고 계열 |
| 저장 공간 80/95% | 시안 용량 배너 | 원문 |
| 서버 점검 공지 | 시안 Announcement(maint) | 원문 |
| 가입 닫힘 | 시안 SignIn 모달 Closed 안내 | 원문 |
| 지원하지 않는 브라우저(폴더 업로드 미지원 등) | 해당 버튼 비활성 + 툴팁 | — |
| JS 비활성 | `<noscript>` 카드 | ErrorScreen 정적 버전 |

---

## 10. 도메인 규칙 (`src/domain/`, 각 파일에 `*.test.ts`)

| 파일 | 함수 | 비고 |
|---|---|---|
| `format.ts` | `fmtSize`(1000진법), `fmtDate`(en-US), `fmtLeft`, `fmtT`, `fmtAgo` | 시간대는 브라우저 기준이라 클라이언트 렌더링 |
| `avatar.ts` | `avatarOf(seed)` FNV-1a + xorshift identicon | 결정적 |
| `names.ts` | `nameError`, `nameTaken`, `uniqName` | 서버와 클라이언트가 공유 |
| `tags.ts` | `parseTags`, `hasAllTags`, `normalizeTag`(24자, 공백→`-`) | |
| `tree.ts` | `sortNodes`(7종), `effectiveVisibility`, `isInside`, `collapseCrumbs` | |
| `policy.ts` | `deletionDate`, `quotaLevel`, `busyLevel`(10분, 5/10회), `limitHit`, `settingTags`, `expiringSoon` | 임계값은 `config/policy.ts` |
| `menu.ts` | `menuPlace(rect, count, viewport)`, `buildNodeMenu(node, ctx)` | DOM 분리 |
| `status.ts` | `rateLatency`, `jitter`, `lossRate`, `overallLevel` | |
| `ids.ts` | id/name/token/linkId/invite 생성 규칙(문자 집합) | 서버에서 `crypto` 사용 |

---

## 11. 상태 관리 & 데이터 흐름

- **서버 상태**: TanStack Query. 키는 `['folder', id]`, `['me']`, `['admin','accounts',filter]` 형태다. 변경은 mutation 후 관련 키를 무효화하고, 이름 변경, 이동, 태그, 선택 삭제에는 낙관적 업데이트를 적용한다.
- **UI 상태**: zustand slice 단위로 나눈다(`ui`(메뉴, 모달, 토스트), `files`(cwd 외 보기 상태: 선택, 정렬, 필터, 보기 모드, DnD), `transfers`, `session`(서명된 계정 목록, 활성 계정)). 보기 설정(정렬, 보기 모드, 사이드바 접힘)은 localStorage에 저장한다.
- **현재 폴더**는 URL(`/files/<id>`)이 원천이다. 뒤로가기, 공유, 새로고침에 안전하다.
- **실시간성**: 만료 남은 시간은 30초 틱으로 다시 렌더링한다. 만료 삭제는 서버 워커가 하고, 클라이언트는 focus/interval 시 무효화한다. Server 페이지는 SSE를 쓴다.
- **이어보기**: localStorage `relay.resume`(시안 규칙: 3초 이후 저장, 끝 5초 이내면 삭제, 800ms 디바운스, "Resumed from").
- **전송**: tus 진행 이벤트로 시안 상태 모델(`active|paused|complete`, `auto`)과 문구를 갱신한다. `offline`이면 자동 일시정지, `online`이면 자동 재개, 수동 일시정지/재개를 지원한다. 다운로드는 브라우저 다운로드로 처리하고 패널에는 시작 기록만 남긴다(fetch 스트림 진행률은 선택 구현).

---

## 12. 단축키
⌘/Ctrl+K 전역 검색 · Esc 닫기 · `?` 단축키 모달 · 뷰어(Space/K, ←/→ 5초, J/L 10초, ↑/↓ 볼륨, M, F, N/P) · File Manager(`/`, U, G, Ctrl+A, Del, Backspace). 입력 중에는 무시한다. 규칙과 우선순위는 시안 `onKey`와 같다.

---

## 13. 백엔드

### 13.1 Prisma 스키마 (스키마 먼저 → `migrate dev --name init`)
- `Account { id(12), name @unique, tokenLookup @unique(HMAC-SHA256), tokenEnc Bytes(AES-256-GCM), volumeId, color, isAdmin, neverExpire, expiresAt?, quotaBytes BigInt?, stripMetadataOnShare Bool @default(true), createdAt, lastLoginAt }`. 계정을 만들 때 `/mnt/relayfilesDB/users/<id>/`를 함께 생성하고, 실패하면 DB 생성도 롤백한다
- `Session { id, accountId, os, browser, country?, city?, ipMasked, createdAt, lastSeenAt, revokedAt? }`
- `StorageVolume { id, driver(local|s3), mountPath, status(ACTIVE|READONLY|DRAINING|OFFLINE), layoutVersion, reservePct, createdAt }`, `Account.volumeId`, `Account.migrating Bool` → §13.5, §13.8
- `DataMigration { id, name, startedAt, finishedAt?, cursor? }` — 데이터 마이그레이션 진행 기록(§13.8)
- `Node { id, accountId, parentId?, type, name, kind?, mime?, size BigInt, sha256?, hasThumb Bool, hasDerived Bool, missing Bool, linkId @unique, visibility, expiryLabel, expAt?, burn, downloadLimit?, passwordHash?, access, note, dlPaused, downloads, tags String[], createdAt }`, `@@unique([parentId,name])`, `@@index([accountId,parentId])`, GIN(tags), trigram(name)
- `LinkEvent { id, nodeId, kind, fileName, device, ipMasked, country, at }`(노드당 200개 유지), `TrafficDaily { accountId, day, bytes }`
- `Invite`, `ServerConfig { signupMode, theme }`, `Announcement`, `Incident`, `HealthSample`(분) → `HealthHourly`/`HealthDaily`(집계)
- `PlaybackPosition`은 서버에 두지 않는다(localStorage 유지).

### 13.2 인증·세션 (다중 계정)
- 첫 방문 시 signup이 open이면 익명 계정을 자동 생성하고 배너를 띄운다. invite/closed면 로그인 모달을 띄운다.
- 토큰 로그인: Redis 실패 카운터(IP 기준). 시안 문구대로 5회마다 30s → 120s → 600s 잠금(`config/policy.ts`, 변경 가능). 잠금 상태는 429 화면/모달 카운트다운으로 보여 준다.
- 쿠키 `rf_s`(httpOnly, Secure, SameSite=Lax, 서명)에 기기의 세션 id 목록과 활성 계정을 담는다. 세션 폐기는 Redis nonce로 즉시 반영한다.
- `src/proxy.ts`(Next 16 규약, 구 `middleware.ts`): 인증이 필요한 경로는 401, admin 경로는 403, 공개 경로는 `/d/*`, `/status`, `/api/share/*`, `/api/health`, `/error/*`.

### 13.3 API (`{ success, data | error, code }`, zod 계약)
- me: `GET /api/me`, `GET|POST /api/me/token`, `DELETE /api/me`, `GET|DELETE /api/me/sessions[/:id]`, `GET /api/me/traffic`
- nodes: `GET /api/nodes/:id`, `POST /api/nodes`, `PATCH /api/nodes/:id`, `POST /api/nodes/{delete,move,copy}`, `POST /api/nodes/:id/link`, `GET /api/nodes/:id/activity`, `GET /api/nodes/expiring`, `GET /api/search`, `POST /api/nodes/purge-expired`
- uploads: `POST /api/uploads/prepare` → tus `/api/uploads/tus/*`(청크 50MB, Cloudflare 100MB 제한 아래) → 완료 훅(노드 생성, `media.process` job)
- files: `GET /api/files/:id/{stream,download,thumb}`(Range 206), `POST /api/zip`
- share: `GET /api/share/:linkId`, `POST /api/share/:linkId/unlock`, 공유 stream/download/zip
- admin: accounts(목록, PATCH, DELETE), cleanup, invites, signup, theme, announcement, `GET /api/admin/server/stream`(SSE)
- status: `HEAD|GET /api/health`, `GET /api/status`, incidents CRUD(admin)

### 13.4 데이터 저장소 역할 분담

| 저장소 | 위치 | 담는 것 |
|---|---|---|
| **PostgreSQL 16** | 서버 내장 디스크(`/srv/relayfiles/pg`). 외장 SSD가 분리돼도 메타데이터는 남는다 | 계정, 세션, 노드 인덱스(트리, 설정, 태그, 링크), 이벤트 로그, 집계, 설정 |
| **Redis 7** | 내장 디스크(AOF everysec) | 세션 nonce, 로그인 실패/잠금 카운터(TTL), 레이트 리밋, 다운로드 혼잡도 ZSET, **캐시**(폴더 크기·개수 집계, 경로 해석 결과, admin 통계, 서버 지표 링 버퍼), BullMQ 큐 |
| **외장 SSD** `/mnt/relayfilesDB` | USB/NVMe 외장 SSD(ext4) | **사용자 원본 파일**(사용자별 루트 폴더) + 시스템 작업 공간(업로드 임시, 썸네일, 휴지통) |

- 캐시 원칙: Redis는 언제 비워져도 되는 파생 데이터만 둔다(원천은 PostgreSQL과 디스크). 키는 `rf:{도메인}:{id}`이고 TTL과 이벤트 기반 무효화(노드 변경 시 조상 폴더의 크기 캐시 삭제)를 함께 쓴다. 캐시 접근은 `server/cache/`의 `cached(key, ttl, loader)` 헬퍼로 통일한다.

### 13.5 파일 스토리지 — `/mnt/relayfilesDB` (사용자별 루트 폴더, 원본 저장)

**디렉터리 레이아웃**

```
/mnt/relayfilesDB/                     # 외장 SSD 마운트 지점 (STORAGE_ROOT)
├─ .relayfiles-volume                  # 볼륨 식별 파일 {volumeId, createdAt} — 마운트 확인용
├─ users/                              # 0700, 앱 전용 시스템 계정 소유
│  ├─ <accountId>/                     # = 해당 사용자의 root 폴더 (앱의 "root")
│  │  ├─ Videos/                       # 사용자가 만든 폴더 이름 그대로
│  │  │  └─ flower.mp4                 # 업로드한 원본 바이트 그대로 (재인코딩, 변형 없음)
│  │  └─ Upload Oct 5, 3:12 PM/…
│  └─ <accountId>/…
└─ system/                             # 사용자 영역과 완전히 분리 (사용자 이름과 충돌 불가)
   ├─ tmp/uploads/                     # tus 업로드 조각 (같은 파일시스템 → 완료 시 원자적 rename)
   ├─ thumbs/<accountId>/<nodeId>.webp # 썸네일 (파생물, 언제든 재생성 가능)
   ├─ derived/<accountId>/<nodeId>     # (옵션) 공개 공유용 메타데이터 제거본
   └─ trash/<timestamp>-<accountId>/   # 삭제 대기 (계정 삭제, Replace 업로드의 기존 파일)
```

- **사용자 1명 = 디렉터리 1개 = 앱의 root 폴더**. 앱의 폴더 트리가 디스크 디렉터리 트리와 1:1로 대응한다. 파일은 업로드한 **원본 그대로** 저장되며, 다운로드하면 바이트 단위로 같은 파일을 받는다.
- 디렉터리 이름은 계정 이름(`anon-xxxx`)이 아니라 **불변 accountId**를 쓴다. 이름이 바뀌어도 경로가 유지된다.
- **PostgreSQL은 인덱스, 디스크는 원천**: `Node`에 이름과 부모 관계가 있으므로, 물리 경로는 `volume.root + /users/ + accountId + 조상 이름들`로 계산한다(Redis 캐시). 이름 변경과 이동은 `fs.rename` 한 번이다(같은 파일시스템이라 원자적이고, 폴더면 하위 전체가 따라온다).
- **DB와 디스크 일관성**: 모든 파일 조작은 `StorageTransaction`으로 감싼다. ① DB 트랜잭션에서 상태 변경을 준비하고 ② 파일시스템 작업을 하고 ③ 커밋한다. ② 실패 시 DB를 롤백하고, ③ 실패 시 보상 작업(되돌리는 rename)을 한다. 그래도 남는 불일치는 `storage.reconcile` 작업이 찾는다(§13.7).

**보안**

| 위협 | 대책 |
|---|---|
| 경로 조작(`../`, 절대경로, NUL) | 이름은 `nameError`로 검증한다(`/`, NUL, `.`, `..`, 앞뒤 공백, 255바이트 거부. ext4 파일명 한도와 일치). 물리 경로는 항상 `path.resolve` 후 **사용자 루트 하위인지 검사**(`resolved.startsWith(userRoot + path.sep)`)하고, 경로 문자열을 클라이언트에서 받지 않는다(항상 nodeId → 서버가 경로 계산) |
| 심볼릭 링크·하드링크 악용 | 앱은 심볼릭 링크를 만들지 않는다. 열 때 `O_NOFOLLOW`, 순회 시 `lstat`으로 링크를 발견하면 거부한다. 업로드는 일반 파일로만 생성한다 |
| 다른 사용자 파일 접근 | 모든 파일 API는 `node.accountId === session.accountId`(또는 공유 링크 권한)를 서비스 레이어에서 검사한 뒤에만 경로를 계산한다. 타 계정 리소스는 404로 응답한다(존재 여부 노출 방지) |
| 서버 내 다른 프로세스·사용자 | 전용 시스템 계정 `relayfiles`(uid 고정, 예: 10001)가 소유한다. 디렉터리 `0700`, 파일 `0600`, `umask 077` |
| 업로드 파일 실행 | 마운트 옵션 `nodev,nosuid,noexec,noatime`. 다운로드 응답은 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`. 인라인 미리보기는 이미지·영상·음악 MIME 허용 목록만 쓰고, HTML/SVG는 항상 다운로드로 처리한다(XSS 방지) |
| SSD 분실·도난 | **LUKS2 전체 디스크 암호화**(dm-crypt, AES-XTS) — 확정(§0). 파일 단위 앱 암호화는 하지 않는다. 디스크 위 파일은 원본 형태를 유지하면서 장치 단위로 보호된다. 키파일은 서버 내장 디스크 `/etc/relayfiles/ssd.key`(0400, root)에 두고 `crypttab`으로 부팅 시 자동 해제한다 |
| 경로 길이 | 전체 경로 4096바이트, 폴더 깊이 32단계 제한(`config/policy.ts`) |
| 용량 고갈 | 계정 쿼터와 별도로 **볼륨 여유 공간 5% 예약**. 그보다 부족하면 업로드를 거부(507)하고 경고 페이지를 띄운다 |
| 무결성 | 업로드 완료 시 SHA-256을 계산해 `Node.sha256`에 저장한다. 다운로드 ETag와 재조정 작업의 손상 탐지에 쓴다 |

- **메타데이터 처리**: 원본을 보존해야 하므로 원본 파일은 수정하지 않는다. 공개 공유 링크로 이미지가 나갈 때만 EXIF/GPS를 지운 사본(`system/derived/`)을 만들어 보낸다(계정 설정 "Strip metadata on public links", 기본 ON). 소유자 다운로드는 항상 원본이다.
- **다운로드 성능**: 앱 레벨 암호화가 없으므로 Node가 인증·권한·혼잡도를 판정한 뒤 **Nginx `X-Accel-Redirect`**로 넘긴다. Nginx가 Range, sendfile, 대역폭 제한(`X-Accel-Limit-Rate`로 Busy 단계 스로틀)을 처리하므로 Node 프로세스가 대용량 전송을 맡지 않는다. Nginx의 `internal` location이 `/mnt/relayfilesDB/users/`를 alias로 가리킨다. 경로는 percent-encoding해서 한글·공백 파일명을 처리한다.
- **zip**: 디스크에서 바로 읽어 `archiver` 스트림으로 보낸다(store 모드: 이미 압축된 미디어는 재압축하지 않음).
- **복사**: `fs.copyFile(src, dst, COPYFILE_FICLONE)`(reflink를 지원하는 파일시스템이면 즉시, 아니면 일반 복사). 큰 폴더 복사는 BullMQ 작업으로 돌리고 전송 패널에 진행률을 보여 준다.

**확장성**

- `StorageDriver` 인터페이스: `resolve`, `createReadStream`, `writeFromTemp`, `rename`, `copy`, `remove`, `stat`, `statfs`, `ensureUserRoot`, `moveToTrash`. 구현체는 `LocalVolumeDriver`이고, 추후 `S3Driver`(MinIO, R2)를 같은 인터페이스로 추가한다. 서비스 레이어는 구현체를 모른다.
- **다중 볼륨**: `StorageVolume { id, mountPath, status(ACTIVE|READONLY|DRAINING|OFFLINE), reservePct, createdAt }` 테이블을 두고 `Account.volumeId`로 배정한다. 새 계정은 여유 공간이 가장 큰 ACTIVE 볼륨에 배정된다. 두 번째 SSD는 `/mnt/relayfilesDB2`에 마운트하고 `npm run volume:add`로 등록하면 즉시 쓸 수 있다. 계정 이전은 `volume:migrate <accountId> <volumeId>`(rsync → 검증 → 전환 → 정리)로 한다.
- DB에는 **볼륨 기준 상대 경로 정보만** 저장한다(절대경로 없음). 마운트 지점이 바뀌어도 `StorageVolume.mountPath` 한 줄만 고치면 된다.
- 업그레이드 계획(MS-01 DB 서버, 10GbE)으로 옮길 때도 PostgreSQL은 `DATABASE_URL`, 파일은 볼륨 재등록 또는 S3 드라이버로 옮기면 되고 애플리케이션 코드는 바뀌지 않는다.

**마운트 상태 감시**

- 앱과 워커는 시작할 때, 그리고 30초마다 `.relayfiles-volume`의 volumeId를 확인한다. 이 파일이 없으면(SSD 분리, 마운트 실패) 볼륨을 `OFFLINE`으로 바꾸고 업로드와 다운로드를 503으로 막는다. 이때 경고 페이지 **"Storage offline"**(§9.2)과 Status 페이지 Storage 구성요소 DOWN을 표시한다. 빈 마운트 지점(내장 디스크)에 잘못 쓰는 사고를 막는 것이 목적이다.
- Server 페이지 Disk 카드는 볼륨별 용량(`statfs`)을 보여 준다. Disk health는 외장 SSD의 SMART 정보(`smartctl -d sat` 경유, 권한이 없으면 Unavailable)다.

### 13.6 기타 보안
- 혼잡도: Redis ZSET `rf:dl:{nodeId}`(10분 창). Busy면 `X-Accel-Limit-Rate`로 속도 제한, Server busy면 429 + `Retry-After`.
- 보안 헤더(CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), 업로드 MIME은 확장자와 매직 바이트(`file-type`)로 판정, 공유 비밀번호는 argon2, 계정 토큰은 HMAC lookup + AES-256-GCM 암호화 보관(`TOKEN_ENC_KEY`), IP는 마스킹해서 저장, 로그에 토큰과 IP를 남기지 않는다.

### 13.7 워커 (`worker/`, BullMQ, 앱과 별도 프로세스)
`cleanup`(매일 04:00: 만료 계정 → 사용자 루트를 `system/trash`로 rename 후 DB 삭제, 만료 노드, burn) · `trash.purge`(trash 항목 24시간 후 실제 삭제) · `tmp.purge`(6시간 넘은 미완료 tus 조각) · `expiry-sweep`(1분) · `media.process`(SHA-256, 썸네일, 공유용 메타데이터 제거본) · `storage.reconcile`(매일: DB에만 있는 노드는 missing으로 표시, 디스크에만 있는 파일은 리포트, 관리자가 옵션으로 import 가능) · `volume.watch`(30초) · `metrics.sample`(1분) · `health.probe`(1분 → 시간·일 집계) · `traffic.rollup`(10분).

### 13.8 마이그레이션 전략

서비스를 운영하면서 바뀌는 모든 것(DB 스키마, 디스크 레이아웃, 저장 위치, 서버, 키, 캐시 형식, 클라이언트 저장 데이터)을 **버전 관리하고, 다시 실행해도 안전(idempotent)하며, 중단 후 이어서 할 수 있게** 만든다. 공통 원칙은 세 가지다. ① 공유 링크(`linkId`)와 계정 토큰은 어떤 마이그레이션에서도 바뀌지 않는다. ② 실행 전에 백업하고, 실행 후에 검증한다. ③ 모든 작업은 `docs/runbook.md`에 절차와 롤백 방법을 남긴다.

**① DB 스키마 (Prisma)**
- 개발: `npx prisma migrate dev --name <설명>` → `prisma/migrations/`를 커밋한다. 운영: 배포 스크립트에서 `npx prisma migrate deploy`만 실행한다. `db push`는 쓰지 않는다(CLAUDE.md 규칙).
- **Expand → Migrate → Contract** 3단계로 무중단 변경을 한다. 예를 들어 컬럼 이름을 바꿀 때: 새 컬럼 추가(expand, 구버전 코드와 호환) → 앱이 양쪽에 쓰고 백필 작업 실행 → 다음 릴리스에서 옛 컬럼 삭제(contract). 한 릴리스 안에 파괴적 변경을 넣지 않는다.
- **데이터 마이그레이션**(백필, 값 변환)은 SQL 마이그레이션과 분리해 `scripts/migrations/data/<timestamp>-<name>.ts`에 두고, `DataMigration { id, name, startedAt, finishedAt, cursor }` 테이블로 진행 상황을 기록한다. 대량 데이터는 배치(1,000행) + 커서로 처리해서 중단해도 이어서 실행할 수 있다.
- 배포 순서(`deploy/scripts/release.sh`): `pg_dump` 스냅샷 → `migrate deploy` → 데이터 마이그레이션 → 앱/워커 롤링 재시작 → 헬스체크. 실패하면 이전 이미지 태그와 스냅샷으로 되돌린다.
- CI 검사: `prisma migrate diff --from-migrations --to-schema-datamodel`로 커밋되지 않은 스키마 변경을 막는다. 마이그레이션 SQL에 `DROP COLUMN`/`DROP TABLE`이 있으면 PR 라벨 `breaking-migration`을 요구하는 검사를 둔다.
- 메이저 업그레이드(Prisma 8 stable, PostgreSQL 16 → 17)는 CLAUDE.md 정책대로 별도 브랜치에서 진행한다. PostgreSQL 메이저는 `pg_upgrade --link` 또는 dump/restore로 한다.

**② 파일 스토리지 레이아웃**
- `.relayfiles-volume`에 `layoutVersion`을 기록한다(최초 1). 디렉터리 구조를 바꿔야 할 때(예: `system/` 하위 재배치, 사용자 폴더를 `users/<앞2자리>/<accountId>`로 샤딩)는 `scripts/migrations/storage/<n>-<name>.ts`를 작성한다.
- 실행기 `npm run storage:migrate`: 볼륨을 `READONLY`로 전환(업로드와 변경 차단, 다운로드는 유지) → 저널 파일(`system/migration.journal`)에 단계별 기록 → rename 위주로 수행(같은 파일시스템이라 빠르고 원자적) → 검증(노드 수, 파일 수, 샘플 SHA-256) → `layoutVersion` 갱신 → `ACTIVE` 복귀. 중간에 멈춰도 저널을 보고 이어서 하거나 되돌린다.
- 앱은 시작할 때 볼륨의 `layoutVersion`이 코드가 기대하는 값과 다르면 해당 볼륨을 OFFLINE으로 두고 "마이그레이션 필요" 로그와 Server 페이지 경고를 띄운다(잘못된 구조에 쓰는 사고 방지).

**③ 계정·볼륨 간 이동 (SSD 증설, 교체)**
- `npm run volume:migrate -- --account <id> --to <volumeId>` 또는 `--volume <from> --to <to>`(볼륨 전체 비우기):
  1. 대상 계정을 `migrating` 상태로 표시한다. 업로드, 이름 변경, 이동은 잠시 막고(UI는 경고 배너 "Your files are being moved to new storage", 읽기와 다운로드는 유지) 진행한다.
  2. `rsync -aHAX --checksum`으로 1차 복사 → 변경분 2차 복사 → 파일 수와 SHA-256(`Node.sha256`) 전수 대조.
  3. 트랜잭션으로 `Account.volumeId`를 전환하고 경로 캐시를 무효화한 뒤 잠금을 해제한다.
  4. 원본 볼륨의 사본은 `system/trash`로 옮기고 24시간 뒤 삭제한다(그동안 롤백 가능).
- 볼륨 상태 `DRAINING`: 새 계정 배정에서 빠지고, 워커가 계정을 하나씩 다른 볼륨으로 옮긴다(SSD 교체 절차).

**④ 서버 이전 (현재 N95 → 업그레이드 계획의 MS-A2 앱 + MS-01 DB)**
- 앱이 서버 위치에 의존하지 않도록 모든 주소와 경로는 env로 둔다(`DATABASE_URL`, `REDIS_URL`, `STORAGE_ROOT`, `PUBLIC_URL`, 허용 IP 대역). VLAN과 IP가 바뀌어도 코드는 바뀌지 않는다.
- 절차(`docs/runbook.md#server-migration`):
  1. 새 서버에 compose 배포(빈 상태) → `maintenance.flag`로 기존 서버를 점검 모드로 전환(503 점검 페이지).
  2. PostgreSQL: `pg_dump -Fc` → `pg_restore`(짧은 중단). 무중단이 필요하면 logical replication(publication/subscription)으로 동기화한 뒤 전환한다.
  3. Redis: 영구 데이터가 아니므로 옮기지 않는다(세션 nonce만 재발급된다. 사용자는 쿠키로 다시 인증됨). BullMQ 반복 작업은 워커가 시작할 때 다시 등록한다.
  4. 파일: 외장 SSD를 물리적으로 옮겨 같은 경로(`/mnt/relayfilesDB`)에 마운트한다. `.relayfiles-volume`의 volumeId로 같은 볼륨인지 확인하므로 재등록 없이 인식된다. 네트워크로 복사할 때는 ③과 같은 rsync와 검증 절차를 쓴다.
  5. DNS와 Cloudflare Tunnel 대상을 바꾸고 헬스체크한 뒤 점검 모드를 해제한다. 기존 서버는 1주일 동안 읽기 전용으로 남겨 둔다(롤백용).

**⑤ 스토리지 백엔드 전환 (로컬 → S3/MinIO, 선택)**
- 볼륨에 `driver`(local|s3) 필드를 두고, ③과 같은 계정 단위 이동 작업으로 옮긴다(복사 → 해시 검증 → 전환). 로컬과 S3 볼륨을 함께 운영할 수 있다.

**⑥ 키·비밀값 교체**
- `TOKEN_ENC_KEY`, `TOKEN_HMAC_KEY`, 쿠키 서명 키는 **키 ID 방식**(`KEYS_JSON={"k2":"…","k1":"…"}`, 현재 키 `ACTIVE_KEY_ID`)으로 둔다. 암호문 앞에 키 ID를 붙여 저장하므로 새 키를 추가해도 기존 데이터를 읽을 수 있다. `scripts/rotate-keys.ts`가 배치로 재암호화하고, 끝나면 옛 키를 제거한다. 토큰 값 자체는 바뀌지 않는다.

**⑦ 캐시·계약·클라이언트 데이터 버전**
- Redis 키에 버전 접두사(`rf:v1:`)를 붙인다. 캐시 형식이 바뀌면 버전을 올려 옛 키를 자연 만료시킨다(별도 삭제 작업 불필요).
- API 계약(`src/contracts/`)은 하위 호환으로만 변경한다(필드 추가 OK, 삭제/의미 변경은 새 필드로). 배포 중에 구버전 클라이언트가 남아 있어도 동작해야 한다.
- 클라이언트 localStorage(`relay.resume`, 보기 설정)는 `{ v: 1, data }` 형태로 저장하고, 로드할 때 버전별 변환 함수(`migrateLocal(v)`)를 거친다. 알 수 없는 형식이면 버린다.
- 공유 링크 URL 형식(`/d/<linkId>`)은 고정한다. 경로 구조가 바뀌어도 옛 URL은 `proxy.ts`에서 301로 연결한다.

---

## 14. Ubuntu 서버 배포·테스트 (현재 하드웨어: N95 `192.168.0.100`, Ubuntu)

- **외장 SSD 준비**(`docs/deploy-ubuntu.md`, `deploy/scripts/setup-ssd.sh`):
  1. `lsblk`/`blkid`로 장치 확인 → (필수) `cryptsetup luksFormat --type luks2` → 키파일 `/etc/relayfiles/ssd.key`(0400) 등록 → `/etc/crypttab`
  2. `mkfs.ext4 -L relayfilesDB -m 0` → `/etc/fstab`에 **UUID로** 등록: `/mnt/relayfilesDB ext4 defaults,noatime,nodev,nosuid,noexec,nofail,x-systemd.device-timeout=10s 0 2`
  3. `useradd --system --uid 10001 relayfiles` → `install -d -o relayfiles -m 0700 /mnt/relayfilesDB/{users,system}` → `npm run volume:init`(`.relayfiles-volume` 생성, DB에 볼륨 등록)
  4. USB SSD 절전 해제(`hdparm`/udev rule로 autosuspend off), SMART 확인(`smartctl -d sat -a`)
- `deploy/docker-compose.yml`: `app`(Next standalone, `user: 10001`), `worker`, `postgres:16`, `redis:7`. PostgreSQL과 Redis 데이터는 내장 디스크 `/srv/relayfiles/{pg,redis}`, 파일은 `/mnt/relayfilesDB`를 **같은 경로로 bind mount**(`/mnt/relayfilesDB:/mnt/relayfilesDB:rw`, `bind.propagation: rslave`. SSD를 다시 마운트해도 컨테이너에 반영됨). DB와 Redis 포트는 외부에 공개하지 않는다(내부 네트워크만). 헬스체크와 `restart: unless-stopped`.
- `deploy/nginx/relayfiles.conf`: 리버스 프록시, `client_max_body_size 60m`, tus 경로 `proxy_request_buffering off`, `X-Accel-Redirect` 대상 `location /_protected/ { internal; alias /mnt/relayfilesDB/users/; sendfile on; }`, `error_page 502 503 504`를 정적 에러 페이지로, 점검 플래그 파일 분기. Nginx 워커가 파일을 읽어야 하므로 `www-data`를 `relayfiles` 그룹에 넣고 해당 경로만 `0750`으로 둔다(또는 Nginx를 같은 uid로 실행). 둘 중 하나를 문서에 명시한다.
- 백업: `pg_dump` 매일(내장 디스크 + 외부 사본), 파일은 `rsync -aHAX`로 2차 디스크 또는 NAS(선택). 복구 절차는 `docs/runbook.md`.
- 외부 노출은 Cloudflare Tunnel, 내부 테스트는 LAN.
- `docs/deploy-ubuntu.md`: 패키지(ffmpeg, docker, nginx, smartmontools), `.env.production` 작성, `prisma migrate deploy`, `npm run admin:create`, 백업(`pg_dump` + 데이터 디렉터리 rsync), 로그 위치 `/var/log/relayfiles/`.
- **실서버 검증 시나리오**: 업로드 후 `/mnt/relayfilesDB/users/<id>/…`에 원본이 같은 이름으로 생기는지, `sha256sum` 원본과 다운로드 결과가 같은지, 권한(0700/0600)과 다른 계정 접근 차단, SSD를 분리했을 때 Storage offline 표시와 재연결 후 복구, 이름 변경·이동 후 디스크 트리가 따라오는지, 대용량 업로드(2GB+) 중 네트워크 끊김 후 재개, 영상 Range 탐색, 휴대폰(iOS Safari, Android Chrome)과 데스크톱 반응형 확인, 공유 링크 비밀번호·한도·burn, 만료 job 실행, 서버 지표값을 `htop`/`df`와 대조, 앱을 내렸을 때 Nginx 502 페이지 표시.

---

## 15. 단계별 실행 순서 (기능 단위 수직 슬라이스)

> 각 단계 끝에 `npm run typecheck · lint · test · build`를 통과시키고 커밋한다(Conventional Commits). 브랜치는 `claude/eager-bell-lrz3vc`, PR base는 `main`.

| # | 범위 | 완료 기준 |
|---|---|---|
| M0 | 스캐폴딩(create-next-app 16.3, TS strict, Tailwind 4.3, ESLint flat + boundaries, Vitest, Playwright), `CLAUDE.md`, `docs/`, 시안을 `docs/design/`에, `.env.example`, `config/env.ts` | 빈 앱 빌드 |
| M1 | 디자인 시스템: 토큰, 테마 10종, 폰트 3종, 아이콘 레지스트리, §6 프리미티브, `/dev/ui` 카탈로그(dev 전용) | 카탈로그 스크린샷 |
| M2 | 인프라: docker-compose(dev), Prisma 스키마 + 마이그레이션, Redis + 캐시 헬퍼, logger, `apiHandler`, 에러 코드 계약, **스토리지 계층**(StorageDriver, LocalVolumeDriver, safe-path, StorageTransaction, 볼륨 등록·감시. 개발 환경에서는 `STORAGE_ROOT=./.data/relayfilesDB`), **에러 페이지 전부(§9)** | `/error/*`, 404, 403 렌더링. 경로 탈출 테스트 통과 |
| M3 | 인증: 익명 계정, 토큰 로그인과 잠금, 다중 계정 쿠키, `proxy.ts`, admin:create, 로그인/새 토큰 모달 | e2e 로그인 |
| M4 | AppShell(사이드바, 드로어, 헤더, 푸터, 배너, 토스트, 로딩) + 반응형 3단계 | 375/768/1280 확인 |
| M5 | File Manager 조회: 폴더, 경로, 헤더, 툴바, 필터, 검색, 태그 모드, 리스트/그리드, 빈 상태, 메뉴(팝오버/시트) | |
| M6 | 파일 조작: 새 폴더, 이름 변경, 이동/복사(DnD 포함), 삭제, 태그, 속성, 공유 설정, 링크 재발급, 활동 로그 | |
| M7 | 업로드: prepare, 중복 처리, tus, 전송 패널, 오프라인 자동정지, Home 업로드 | 2GB 재개 테스트 |
| M8 | 다운로드·스트리밍: Range(Nginx X-Accel), zip, 미디어 뷰어, 인라인 재생, 이어보기, 썸네일, 메타데이터 제거 워커 | |
| M9 | 공유 페이지(`/d/[linkId]` + 미리보기), 비밀번호, 한도, burn, Stream only, 혼잡도 | |
| M10 | 프로필/설정(토큰, 기기, 트래픽, 계정 삭제), 만료 배너, 용량 경고 | |
| M11 | Admin Accounts + Manage, 정리 job, 초대, signup 모드 | |
| M12 | Server 모니터(실측 SSE), 공지, 테마 선택 | |
| M13 | Status(health probe 집계, 클라이언트 핑), Incidents | |
| M14 | 단축키, 전역 검색, 접근성 점검, 성능(가상 스크롤: 항목 500개 이상) | |
| M15 | 배포: Dockerfile, compose(prod), Nginx와 정적 에러 페이지, Cloudflare Tunnel, `docs/deploy-ubuntu.md`, 릴리스 스크립트(백업 → `migrate deploy` → 데이터 마이그레이션 → 재시작 → 헬스체크), N95 실서버 검증(§14) | 실서버 체크리스트 통과 |
| M16 | 마이그레이션 도구(§13.8): `storage:migrate` 실행기와 저널, `volume:migrate`, 키 회전, 서버 이전 runbook, CI 마이그레이션 검사. 리허설: 두 번째 볼륨(테스트 SSD 또는 디렉터리)으로 계정 이동, 덤프/복원 리허설 | 리허설 기록을 `docs/runbook.md`에 남김 |

---

## 16. 검증 계획

1. **매 단계**: `npm run typecheck`, `lint`, `test`, `build`. CI(GitHub Actions)에서 Postgres/Redis 서비스 컨테이너와 함께 실행한다.
2. **단위 테스트(Vitest)**: `src/domain/*` 전 함수. 시안 원본 함수를 픽스처로 복사해 같은 입력에 같은 출력을 내는지 확인한다(fmtSize 경계, uniqName, nameError 255B, menuPlace 3분기, busyLevel, effectiveVisibility, sortNodes 7종, collapseCrumbs). 서비스 레이어는 테스트 DB로 검증한다.
3. **API 통합 테스트**: 인증, 권한(타 계정 리소스는 404), 업로드 재개, Range 206, 공유 상태 판정, 잠금 TTL, 정리 job.
4. **마이그레이션 테스트**: 빈 DB에 `migrate deploy` 전체 적용과 직전 릴리스 스냅샷에서 업그레이드 둘 다 CI에서 검증, 데이터 마이그레이션 중단 후 재실행(idempotent), 스토리지 레이아웃 마이그레이션 중단 → 저널로 재개·롤백, `volume:migrate` 후 SHA-256 전수 일치와 공유 링크 유지, 키 회전 후 기존 토큰 로그인, localStorage 구버전 데이터 변환.
5. **스토리지 테스트**(임시 디렉터리를 볼륨으로 사용): 경로 탈출(`..`, 절대경로, NUL, 심볼릭 링크를 심어 둔 경우) 전부 거부, 원본 SHA-256 보존, rename/move 시 디스크 트리 동기화, StorageTransaction 실패 주입 시 DB 롤백과 보상, 볼륨 식별 파일이 없으면 OFFLINE, 여유 공간 예약에 걸리면 507, reconcile 리포트.
6. **E2E(Playwright, Chromium `/opt/pw-browsers`)**: 업로드 → 중복 → Keep both, DnD 이동, 메뉴 위치(하단 행 위쪽으로 열림), 모바일 하단 시트, 단축키, 계정 전환 토스트, 공유 4개 상태, 잠금 카운트다운, `setOffline`으로 자동정지/재개, 에러 페이지 7종.
7. **반응형 회귀**: 모든 페이지·오버레이를 360×800 / 768×1024 / 1280×800에서 스크린샷 비교(`toHaveScreenshot`). 가로 스크롤이 없는지(`scrollWidth ≤ clientWidth`) 단언한다.
8. **시안 대조**: 핵심 요소의 `getComputedStyle`(높이, 패딩, 반경, 색, 굵기)을 `docs/design/spec.md` 수치와 비교하는 e2e를 둔다. 수동 대조는 시안 HTML과 나란히 띄워서 한다.
9. **이모지 검사**: CI에서 `src/`, `deploy/`에 Extended_Pictographic 문자가 있으면 실패한다.
10. **실서버(Ubuntu N95)**: §14 시나리오 체크리스트.

---

## 17. 확인 필요 사항 (기본값으로 진행)

> 암호화 방식과 이미지 메타데이터 처리는 §0 "확정된 결정"으로 옮겼다.

1. **TypeScript 7**: `typescript-eslint`가 TS 7을 지원하면 6.0.3에서 올린다(M0에서 확인한 제약).
2. **로그인 잠금 정책**: 기본은 시안 문구(5회마다 30s/120s/600s). CLAUDE.md 기준(3회)으로 바꿀 경우 `config/policy.ts` 값과 문구를 함께 바꾼다.
3. **위치 정보**: Cloudflare Tunnel 뒤에서는 `CF-IPCountry`/`CF-IPCity`를 쓴다. 터널 없이 LAN으로 접속하면 "Local network"으로 표시한다.
4. **테마 선택 UI**: Server 페이지에 admin 전역 설정으로 추가한다(시안에는 편집기 prop으로만 있음).
