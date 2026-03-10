# UE_Web_Builder 프로젝트 분석 문서

> 작성일: 2026-03-05
> 경로: `F:\wz\UE_CICD\UE_Web_Builder`

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **포털명** | ExFrameWork Portal |
| **목적** | GitHub Webhook 없이 웹 UI에서 클릭 한 번으로 Unreal Engine 빌드를 수동 제어하는 사내 빌드 포털 |
| **위치** | `F:\wz\UE_CICD\UE_Web_Builder` |
| **구성** | `frontend/` (React/Vite) + `backend/` (Node.js/Express) |

---

## 2. 아키텍처 구조

```
┌─────────────────────────────────────┐
│   Frontend (React + Vite)  :5173    │
│   - Build Launcher Tab              │
│   - Analytics & History Tab         │
└────────────┬────────────────────────┘
             │ HTTP REST + WebSocket
┌────────────▼────────────────────────┐
│   Backend (Node.js/Express)  :3001  │
│   - REST API                        │
│   - WebSocket Server (ws)           │
│   - SQLite DB (better-sqlite3)      │
└────────────┬────────────────────────┘
             │ child_process.spawn
┌────────────▼────────────────────────┐
│   BuildProject.bat                  │
│   F:\wz\UE_CICD\SampleProject\      │
│   → Unreal Engine UAT               │
│     BuildCookRun                    │
└─────────────────────────────────────┘
```


---

## 3. 기술 스택

### Frontend

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| React | 19.2.0 | UI 프레임워크 |
| Vite | 7.3.1 | 빌드 도구 (host: 0.0.0.0, port: 5173) |
| TypeScript | 5.9.3 | 타입 시스템 |
| framer-motion | 12.34.3 | 애니메이션 |
| recharts | 3.7.0 | 차트 (BarChart, PieChart) |
| lucide-react | 0.575.0 | 아이콘 |
| date-fns | 4.1.0 | 날짜 포맷 |

### Backend

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| Express | 5.2.1 | HTTP 서버 |
| ws | 8.19.0 | WebSocket 서버 |
| better-sqlite3 | 12.6.2 | SQLite DB |
| uuid | 13.0.0 | 빌드 ID 생성 |
| dotenv | 17.3.1 | 환경변수 |
| cors | 2.8.6 | CORS 미들웨어 |

---

## 4. Backend API 명세 (`backend/index.js`)

### 기본 설정

```js
const PORT = 3001;
const BAT_SCRIPT_PATH = 'F:\\wz\\UE_CICD\\SampleProject\\BuildProject.bat';
```

### REST Endpoints

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/git/refs?path=` | 브랜치 목록 + 태그 목록 + currentBranch 반환 **(신규)** |
| `GET` | `/api/git/commits?path=&branch=` | 로컬 `git log` 또는 GitHub API로 커밋 50개 조회, branch 파라미터 추가 |
| `POST` | `/api/build` | 빌드 트리거 |
| `POST` | `/api/build/cancel` | 진행 중 빌드 강제 종료 (`taskkill /f /t`) |
| `GET` | `/api/history` | 빌드 이력 최근 50건 |
| `GET` | `/api/analytics` | 총/성공/실패 수, 플랫폼별 통계 |

### GET `/api/git/refs` Response

```json
{
  "branches": [
    { "type":"branch", "name":"main", "hash":"a1b2c3d", "message":"...", "author":"...", "time":"2 hours ago", "isCurrent": true }
  ],
  "tags": [
    { "type":"tag", "name":"v1.0.0", "hash":"e4f5g6h", "message":"...", "author":"", "time":"3 days ago" }
  ],
  "currentBranch": "main"
}
```


### POST `/api/build` Request Body

```json
{
  "platform":    "Win64 | Android | IOS",
  "config":      "Development | Debug | Shipping",
  "enginePath":  "F:\\wz\\UE_CICD\\UnrealEngine\\UnrealEngine",
  "projectPath": "F:\\wz\\UE_CICD\\SampleProject",
  "gitRevision": "(optional) commit hash or branch name"
}
```

### 빌드 실행 흐름 (단계별 순차 처리)

| Step | Phase | 동작 | 비고 |
|------|-------|------|------|
| 1/5 | Git Check    | `git status --porcelain` — 로컬 변경사항 감지 | 변경사항 있으면 `CONFIRM_REVERT` 메시지 → 모달 대기 |
| —   | (사용자 확인) | Revert 후 진행 / 빌드 취소 선택 | `POST /api/build/confirm` or `/cancel` |
| 2/5 | Git Fetch    | `git fetch --all` | gitRevision 지정 시만 |
| 3/5 | Git Checkout | 로컬 브랜치: `git checkout` / 리모트 전용: `git checkout -B --track origin/` | |
| 4/5 | Git Pull     | 브랜치인 경우만 `git pull`, 커밋/태그면 스킵 | |
| 5/5 | Build        | `BuildProject.bat {platform} {config}` | |

#### 신규 API
- `POST /api/build/confirm` — Revert 동의 후 빌드 재개 (`git checkout -- .` 후 executeBuild)
- `POST /api/build/reset` — 플래그 강제 초기화 (비상용)

`gitRevision` 지정 시 Git 동기화가 **완전히 완료된 후** 빌드가 시작됩니다.

| Step | Phase | 동작 | 취소 체크 |
|------|-------|------|-----------|
| 1/4 | Git Fetch   | `git fetch --all` — 원격 모든 ref 동기화 | ✅ |
| 2/4 | Git Checkout | `git checkout {revision}` | ✅ |
| 3/4 | Git Pull    | 브랜치인 경우만 `git pull`<br>커밋/태그 지정 시 스킵(detached HEAD) | ✅ |
| 4/4 | Build       | `cmd.exe /c BuildProject.bat {platform} {config}` | — |

- 각 단계마다 `STEP` WebSocket 메시지 broadcast → 프론트 스텝퍼 UI 갱신
- Git 전 단계 완료 후 `GIT_DONE` 메시지 전송
- 브랜치 판별: `git branch --list "{revision}"` 결과로 정확히 구분
- 최종 HEAD 커밋 hash + 메시지를 터미널에 출력 후 빌드 진입

---

## 5. WebSocket 메시지 프로토콜

**서버 → 클라이언트 (broadcast)**

| type | data | 설명 |
|------|------|------|
| `LOG` | 로그 문자열 | stdout 빌드 로그 |
| `LOG_ERROR` | 에러 문자열 | stderr 에러 로그 |
| `STEP` | `{ step, total, label }` | 현재 진행 단계 (1~4) — 프론트 스텝퍼 갱신용 **(신규)** |
| `GIT_DONE` | — | Git 전 단계 완료, 빌드 진입 직전 **(신규)** |
| `STATUS` | 상태 문자열 | `Build Started`, `Build Success`, `Build Failed`, `Canceled` |

**클라이언트 수신 처리 (App.tsx)**

```ts
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'LOG' || message.type === 'LOG_ERROR') {
    setLogs(prev => [...prev.slice(-300), text]); // 최대 300줄 유지
  } else if (message.type === 'STATUS') {
    setBuildStatus(message.data);
    if (includes('Success' | 'Failed' | 'Canceled')) {
      setIsBuilding(false);
      fetchHistory(); fetchAnalytics();
    }
  }
};
```

---

## 6. SQLite DB 스키마

**파일:** `backend/build_history.db`

```sql
CREATE TABLE IF NOT EXISTS builds (
  id               TEXT PRIMARY KEY,    -- UUID v4
  platform         TEXT,                -- Win64 / Android / IOS
  config           TEXT,                -- Development / Debug / Shipping
  status           TEXT,                -- Running / Success / Failed / Canceled
  start_time       DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time         DATETIME,
  duration_seconds INTEGER,
  log_file         TEXT
);
```


---

## 7. Frontend 구성 (`frontend/src/App.tsx`)

### 상태(State) 목록

| 상태 | 타입 | 설명 |
|------|------|------|
| `activeTab` | `'build' \| 'analytics'` | 현재 활성 탭 |
| `platform` | string | 선택된 빌드 플랫폼 (기본: Win64) |
| `config` | string | 빌드 설정 (기본: Development) |
| `enginePath` | string | UE 엔진 경로 |
| `projectPath` | string | 프로젝트 경로 |
| `gitRepoPath` | string | Git Picker에서 사용하는 레포지토리 경로 |
| `gitRevision` | string | 선택된 브랜치명 / 태그명 / 커밋 해시 |
| `buildStep` | `{ step, total, label } \| null` | 현재 진행 단계 (STEP 메시지 수신 시 갱신) |
| `buildStatus` | string | 빌드 상태 텍스트 |
| `logs` | string[] | 터미널 로그 목록 (최대 300줄) |
| `history` | any[] | 빌드 이력 |
| `analytics` | any | 통계 데이터 |

#### GitRevisionPicker 컴포넌트 내부 상태

| 상태 | 타입 | 설명 |
|------|------|------|
| `open` | boolean | 드롭다운 열림 여부 |
| `tab` | `'branches' \| 'tags' \| 'commits'` | 현재 활성 탭 |
| `refs` | GitRefs \| null | 브랜치+태그+currentBranch |
| `commits` | CommitInfo[] | 선택 브랜치의 커밋 목록 |
| `loading` | boolean | API 로딩 중 여부 |
| `filterText` | string | 검색 필터 문자열 |
| `selectedBranch` | string | Commits 탭에서 기준이 되는 브랜치 |

### Build Launcher 탭

- **Target Platform:** Win64 / Android / iOS (select)
- **Build Configuration:** Development / Debug / Shipping (select)
- **Git Revision Control:**
  - 레포지토리 경로 입력
  - **GitRevisionPicker 커스텀 드롭다운** (신규):
    - **Branches 탭:** 로컬 브랜치 목록, current 뱃지 표시, 클릭 시 바로 선택
    - **Tags 탭:** 태그 목록 표시
    - **Commits 탭:** 상단 브랜치 chip으로 기준 브랜치 선택 후 커밋 50개 표시
    - 실시간 필터 검색, 새로고침 버튼, HEAD(기본값) 선택 지원
    - 선택 완료 후 하단에 `Will checkout {revision}` 확인 뱃지 표시
  - 비워두면 현재 HEAD 기준 빌드
- **Engine/Project Path:** 텍스트 입력으로 경로 직접 지정
- **Launch Button:** 빌드 시작 (파란색 그라디언트)
- **Cancel Button:** 빌드 중 표시, 클릭 시 confirm 후 `POST /api/build/cancel`
- **실시간 터미널:** WebSocket 수신, 로그 색상 구분

### Analytics & History 탭

- **KPI 카드 4개:** 총 빌드 수 / 성공 수 / 실패 수 / 성공률(%)
- **PieChart:** 플랫폼별 빌드 분포 (recharts)
- **BarChart:** 최근 5건 실행 소요 시간(초) (recharts)
- **히스토리 테이블:** Configuration / Platform / Status(뱃지) / Duration / Date

---

## 8. 디자인 시스템 (`frontend/src/index.css`)

### CSS 변수 (Design Tokens)

```css
:root {
  --bg-dark:        #0f172a;
  --bg-gradient:    radial-gradient(circle at 15% 50%, #1e1b4b, #0f172a);
  --glass-bg:       rgba(30, 41, 59, 0.4);
  --glass-border:   rgba(255, 255, 255, 0.1);
  --text-primary:   #f8fafc;
  --text-secondary: #94a3b8;
  --accent-glow:    rgba(56, 189, 248, 0.5);
  --primary-color:  #38bdf8;   /* 하늘색 */
  --success-color:  #34d399;   /* 초록 */
  --error-color:    #f87171;   /* 빨간 */
}
```

### 주요 컴포넌트 클래스

| 클래스 | 설명 |
|--------|------|
| `.glass-panel` | Glassmorphism 패널 (`backdrop-filter: blur(12px)`) |
| `.glass-button` | 기본 버튼 (하늘색 테두리, hover 글로우) |
| `.glass-button.launch` | 빌드 실행 버튼 (파란 그라디언트, 크게) |
| `.terminal-output` | Fira Code 폰트, 검은 배경, 스크롤 |
| `.stats-grid` | KPI 카드 그리드 (`repeat(auto-fit, minmax(200px, 1fr))`) |
| `.history-table` | 빌드 이력 테이블 |
| `.badge.success/failed/running` | 상태 뱃지 (반투명 컬러) |

### 레이아웃

```css
.app-container {
  display: grid;
  grid-template-columns: 350px 1fr;  /* 사이드바 + 메인 */
  gap: 2rem;
}
/* 반응형: @media (max-width: 1024px) → 1열 */
```

### 폰트

- **UI 전반:** `Inter` (Google Fonts, 300~700)
- **터미널:** `Fira Code` (Monospace, 400~500)


---

## 9. 기본 경로 설정값

```
Engine:   F:\wz\UE_CICD\UnrealEngine\UnrealEngine
Project:  F:\wz\UE_CICD\SampleProject
Bat:      F:\wz\UE_CICD\SampleProject\BuildProject.bat
WS URL:   ws://{hostname}:3001
API URL:  http://{hostname}:3001/api
```

---

## 10. 실행 방법

```bash
# Backend 실행
cd F:\wz\UE_CICD\UE_Web_Builder\backend
node index.js
# → http://localhost:3001

# Frontend 실행
cd F:\wz\UE_CICD\UE_Web_Builder\frontend
npm run dev
# → http://localhost:5173 (네트워크 전체 공개: host 0.0.0.0)
```

---

## 11. 파일 구조

```
UE_Web_Builder/
├── WebUI_Development_Plan.md          # 기획서 원본
├── md/
│   └── UE_Web_Builder_Analysis.md    # 이 문서
├── backend/
│   ├── index.js                       # Express + WebSocket + SQLite 서버
│   ├── package.json                   # 의존성 (express, ws, better-sqlite3, uuid, cors, dotenv)
│   ├── build_history.db               # SQLite DB (빌드 이력)
│   └── node_modules/
└── frontend/
    ├── index.html
    ├── vite.config.ts                 # host: 0.0.0.0, port: 5173
    ├── package.json                   # 의존성 (react, vite, recharts, framer-motion, ...)
    ├── tsconfig.json
    └── src/
        ├── main.tsx                   # React 진입점
        ├── App.tsx                    # 메인 컴포넌트 (전체 UI + 상태 관리)
        ├── App.css                    # Vite 기본 CSS (거의 미사용)
        └── index.css                  # 전체 디자인 시스템 (Glassmorphism)
```

---

## 12. 향후 개발 계획 (기획서 기반)

| 단계 | 내용 | 상태 |
|------|------|------|
| 1 | 환경 세팅 (frontend/backend 폴더) | ✅ 완료 |
| 2 | Glassmorphism UI 스캐폴딩 | ✅ 완료 |
| 3 | Express + child_process bat 트리거 API | ✅ 완료 |
| 4 | WebSocket 로그 스트리밍 | ✅ 완료 |
| 5 | SQLite Analytics & History | ✅ 완료 |
| 6 | Git Revision Control (datalist 방식) | ✅ 완료 |
| 7 | Git Revision Picker 개선 (브랜치/태그/커밋 탭 드롭다운, fetch --all 연동) | ✅ 완료 |
| 8 | Naver Works 알림 연동 | ⬜ 미구현 (옵션) |
