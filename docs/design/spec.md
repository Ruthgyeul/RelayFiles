# 디자인 수치 스펙

시안([`Relay_App.dc.html`](Relay_App.dc.html))에서 뽑은 값과, 그 값을 구현한 위치를 정리한다. 화면을 만들 때 이 문서의 프리미티브와 토큰만 쓴다. 실제 렌더링은 개발용 카탈로그 `/dev/ui`(`ENABLE_UI_CATALOG=true`)에서 확인한다.

## 1. 토큰

| 종류 | 원천 | 사용 |
|---|---|---|
| 테마 색 22개 × 10 테마 | `src/shared/styles/themes.css` (시안 11행 그대로, `tokens.test.ts`가 시안과 비교) | `bg-card`, `text-t3`, `border-ctrl`, `bg-accent-soft` 등 |
| 고정 팔레트 | `src/shared/styles/globals.css` `@theme static` | `text-ok-text`, `bg-danger-bg`, `text-kind-folder` 등 |
| 데이터로 고르는 색 | `src/shared/styles/palette.ts` (`var(--…)` 참조만) | 인라인 `style` |
| 그림자 | `shadow-toolbar` · `shadow-logo` · `shadow-popover` · `shadow-panel` · `shadow-modal` · `shadow-search` · `shadow-viewer` | |
| z-index | `globals.css` `:root` `--z-*` (헤더 10 … 계정 토스트 72) | `z-(--z-modal)` |
| 브레이크포인트 | `sm` = 720px, `lg` = 1024px (다른 기본값은 제거) | `max-sm:hidden`, `lg:flex` |
| 행간 | `html { line-height: normal }` (시안은 브라우저 기본값) | |
| 폰트 | Figtree(`--font-figtree`) → Pretendard Variable → system-ui / JetBrains Mono(`--font-jetbrains`) | `font-sans`, `font-mono` |

### 기본 테마 Slate Sky (`data-theme="sky"`)

| 변수 | 값 | 변수 | 값 |
|---|---|---|---|
| `--bg` | `#0f1419` | `--t1` | `#eef3f7` |
| `--header` | `#12181e` | `--t2` | `#cdd8e1` |
| `--sunk` | `#141b21` | `--t3` | `#a4b2bf` |
| `--card` | `#182028` | `--t4` | `#8695a2` |
| `--elev` | `#1e2730` | `--t5` | `#677683` |
| `--btn` | `#232d37` | `--accent` | `#38bdf8` |
| `--btnH` | `#2b3641` | `--accentHi` | `#5ccbfa` |
| `--line` | `#212a33` | `--accentIcon` | `#4cc4f9` |
| `--cardLine` | `#27313b` | `--accentText` | `#bae6fd` |
| `--ctrl` | `#36424e` | `--accentSoft` | `#0f3347` |
| | | `--accentSoftLine` | `#1f5d80` |
| | | `--onAccent` | `#06141c` |

## 2. 프리미티브 (`src/shared/ui/`)

| 컴포넌트 | 시안 값 |
|---|---|
| `Button` | 높이 28·30(반경 8, 12px) / 32·34·36(반경 10, 13px) / 38·40(14px) / 44(15px), 굵기 700, gap 6. primary = accent·onAccent(hover accentHi), secondary = btn·1px ctrl·t1(hover btnH), ghost, danger-outline = 1px `#6b2d39`·`#ff8a94`, danger-solid = `#e5484d` |
| `IconButton` | 투명, 반경 8, 28–44px, t3, hover btn/btnH/`#222b45`, `aria-label` 필수 |
| `Card` / `ListCard` | card, 1px cardLine, 반경 16 / 행 사이 1px 선(cardLine 배경 + gap 1px) |
| `OptionChip` | option: h34, px14, 반경 10, 13px/700 · filter: h30, 반경 999, 12px/700, 개수 opacity .65. 선택 = accentSoft·accentHi·accentText |
| `OptionCard` | p12, 반경 12, 제목 14/700, 설명 12 t4, 비선택 btn 또는 elev |
| `CheckRow` | Square / CheckSquare(fill) 22px accentHi + 14px/600 |
| `Pill` | 2px 7px, 반경 999, 10px/800, 자간 .04em |
| `Tag` | md 3px 8px · sm 2px 7px, 반경 6, btn·1px ctrl, 11px/600 t2 |
| `Banner` | 패딩 14px 10px 14px 16px, 반경 14, 아이콘 20–22, 본문 13px/1.45 |
| `Menu` | elev, 1px ctrl, 반경 12, p6, popover 그림자, 항목 36px(720 미만 44px) 14px/600 반경 8 hover btnH, 구분선 1px ctrl `4px 6px` |
| `BottomSheet` | 720 미만 메뉴. 하단 고정, 위쪽 반경 16, safe-area 패딩 |
| `Modal` | card, 1px ctrl, 반경 16, modal 그림자, 폭 `min(N, 100vw-24px)`, 최대 높이 `100dvh-24px`, 헤더 16px 20px, 푸터 14px 20px |
| `ConfirmDialog` | 폭 400, 아이콘 박스 44, 제목 17/700, 본문 14/1.5 t3, 버튼 h38 |
| `PromptDialog` | 폭 420, 입력 h44 1px accentHi, 오류 13px `#ff8a94` |
| `TextInput` / `TextArea` | h36·40·44, 반경 10, 1px ctrl, bg 또는 sunk, 15px / 14px |
| `Avatar` | 36·38·68, identicon(`domain/avatar.ts`, 시안 함수와 출력 동일), 활성 점 12px `#3a8bff` |
| `Skeleton` | btn, `skel` 1.4s |
| `StatTile` | sunk, 반경 12, p12, 라벨 11/700/.04em t4, 값 15·18·20 |
| `Meter` | 높이 4(반경 2) · 6(반경 3), line 트랙 |
| `BarChart` | 막대 위 반경 2, 간격 2·3px, 데이터 없는 칸은 btn 색(가짜 값 없음), 전부 비면 "No data yet" |
| `Kbd` | key: 22px, btn, 1px ctrl + 아래 2px, 11px/600 mono · hint: 투명 |
| `Logo` | 22(반경 6, 아이콘 12) · 28(반경 8, 15) · 64(반경 18, 32, logo 그림자, 흰 화살표) |
| `EmptyState` | 패딩 48px 16px, 아이콘 박스 56(반경 14), 제목 16/700, 설명 13 t4 |

## 3. 아이콘

`src/shared/ui/icon/registry.ts`에 107개(시안 101개 + 에러 페이지 6개). `registry.test.ts`가 시안의 `ph-*` 이름이 모두 있는지 검사한다. 굵기: `ph` → `regular`, `ph-bold` → `bold`, `ph-fill` → `fill`. 이모지는 쓰지 않는다(`npm run check:emoji`).

## 4. 검증

- 단위: `tokens.test.ts`(테마 값 = 시안, palette 참조 유효성), `registry.test.ts`, `avatar.test.ts`, `primitives.test.tsx`(Modal 포커스·Esc, Confirm/Prompt, CheckRow, Menu 키보드)
- E2E: `e2e/ui-catalog.spec.ts`가 360/768/1280에서 계산된 스타일을 위 수치와 비교한다.
