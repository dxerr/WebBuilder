# UE_Web_Builder 아키텍처 및 기능 종합 요약

> 작성일: 2026-05-29  
> 대상 경로: `F:\wz\UE_CICD\UE_Web_Builder`  
> 소스코드(`backend/index.js`, `frontend/src/App.tsx`) 및 기존 md 문서를 분석하여 아키텍처와 구현 현황을 압축 정리한 요약본입니다.

---

## 1. 프로젝트 정체성

| 항목 | 내용 |
|------|------|
| **포털명** | ExFrameWork Portal |
| **목적** | GitHub Webhook 없이 웹 UI 클릭 한 번으로 Unreal Engine 빌드를 수동 제어하는 사내 경량 CI/CD 포털 |
| **특징** | Jenkins 대비 경량화 — Node.js + React 단독 구성, 추가 서버 인프라 불필요 |
| **접속** | `http://{서버IP}:5173` (LAN 내 모든 PC에서 접근 가능) |

---

## 2. 전체 아키텍처

```
┌──────────────────────────────────────────────────────────┐
│   브라우저 Web UI (React + Vite)  :5173                   │
│   ├─ Build Launcher 탭 (빌드 제어)                        │
│   └─ Analytics & History 탭 (통계/이력)                   │
└───────────────────┬──────────────────────────────────────┘
                    │ HTTP REST API + WebSocket
┌───────────────────▼──────────────────────────────────────┐
│   Node.js Express 백엔드  :3001                           │
│   ├─ REST API (빌드 제어, Git 조회, 이력, 통계)           │
│   ├─ WebSocket 서버 (실시간 로그 스트리밍)                │
│   └─ SQLite DB (better-sqlite3) — build_history.db       │
└───────────────────┬──────────────────────────────────────┘
                    │ child_process.spawn
┌───────────────────▼──────────────────────────────────────┐
│   BuildProject.bat  (UE 프로젝트 루트)                    │
│   └─ Unreal Engine AutomationTool (UAT)                  │
│       └─ BuildCookRun → 빌드/쿠킹/패키징/아카이빙        │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 기술 스택

### 프론트엔드
| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| React | 19.2.0 | UI 프레임워크 |
| TypeScript | 5.9.3 | 타입 시스템 |
| Vite | 7.3.1 | 번들러 (host: 0.0.0.0, port: 5173) |
| framer-motion | 12.x | 마이크로 애니메이션 |
| recharts | 3.7.0 | BarChart / PieChart 통계 시각화 |
| lucide-react | 0.575.0 | 아이콘 |
| date-fns | 4.1.0 | 날짜 포맷 |

### 백엔드
| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| Express | 5.2.1 | HTTP 서버 |
| ws | 8.19.0 | WebSocket 서버 |
| better-sqlite3 | 12.6.2 | SQLite DB |
| uuid | 13.0.0 | 빌드 ID 생성 |
| iconv-lite | — | CP949(한글) 인코딩 변환 |
| dotenv | 17.3.1 | 환경변수 관리 |
| cors | 2.8.6 | CORS 미들웨어 |

---

## 4. REST API 전체 명세

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/build` | 빌드 시작 트리거 |
| `POST` | `/api/build/confirm` | 로컬 변경사항 Revert 승인 후 빌드 재개 |
| `POST` | `/api/build/cancel` | 진행 중 빌드 강제 종료 (`taskkill /f /t`) |
| `POST` | `/api/build/reset` | 빌드 락 강제 초기화 (비상 복구용) |
| `GET`  | `/api/git/refs?path=` | `git fetch --all --prune` 후 브랜치+태그+currentBranch 반환 |
| `GET`  | `/api/git/commits?path=&branch=` | 로컬 git log 또는 GitHub API로 커밋 50개 조회 |
| `GET`  | `/api/history` | 빌드 이력 최근 50건 |
| `GET`  | `/api/analytics` | 총/성공/실패 수, 플랫폼별 통계 |
| `POST` | `/api/open-folder` | explorer.exe로 아카이브 폴더 열기 |

---

## 5. 빌드 파이프라인 상세 흐름

### 동적 스텝 시스템

스텝 수는 활성화된 옵션에 따라 자동 산출됩니다.

| 스텝 | 단계명 | 조건 | UI 색상 |
|------|--------|------|---------|
| 1/N | Git Check | 항상 실행 | 기본 |
| 2/N | Git Fetch | 항상 실행 | 기본 |
| 3/N | Git Checkout | 항상 실행 | 기본 |
| 4/N | Git Pull | 항상 실행 (Detached HEAD면 스킵) | 기본 |
| —   | Clear Cache | `clearCache=true` 시에만 | 🔴 빨간 |
| —   | Cook Clean | `cookClean=true` 시에만 | 🟠 오렌지 |
| N/N | Build (BAT) | 항상 실행 | 기본 |
| —   | Sentry Upload | 성공 + sentry.properties 존재 시에만 | 🟣 보라 |

> 기본 5스텝 / 옵션 1개 추가 시 6스텝 / Sentry 포함 시 최대 7스텝

### Git Check — 로컬 변경사항 감지 및 Revert 플로우

```
POST /api/build 수신
      │
      ▼
git status --porcelain 실행
      │
      ├─ 변경사항 없음 → executeBuild() 직행
      │
      └─ tracked 파일 변경 감지
            │
            ▼
          CONFIRM_REVERT WebSocket 전송 (파일 목록 포함)
            │
            ├─ POST /api/build/confirm → git reset --hard HEAD → executeBuild()
            └─ POST /api/build/cancel → 빌드 취소
```

### 빌드 옵션 3종 (상호배제)

| 옵션 | 처리 위치 | 동작 |
|------|----------|------|
| **Clean Build** | BAT → UBT | `-clean` 플래그 → C++ 포함 전체 풀리빌드 |
| **Cook Clean** | Node.js 사전 삭제 + BAT | `Saved/Cooked`, `Saved/ShaderDebugInfo`, `DerivedDataCache` 삭제 후 `-clearcookeddata` → 셰이더·에셋 재쿡 (C++ 생략, 가장 빠른 전체 리쿡) |
| **Clear Cache** | Node.js 사전 삭제 | `Intermediate/`, `Saved/`, `Binaries/`, `XmlConfigCache.bin` 전체 삭제 → 풀빌드 |

### 빌드 완료 후처리

1. **로그 파일 저장**: `Saved/Builds/{platform}/{config}/Log/build_{timestamp}.log`
2. **Issue 리포트 생성**: `Saved/Builds/{platform}/{config}/Issue/issue_{timestamp}.md`
   - UE 자체 Warning/Error Summary 섹션 중복 제거
   - `: Warning:` 패턴 → Warnings 목록 (중복 제거)
   - `: Error:` 패턴 → Errors 목록 (카운트 라인 제외, 중복 제거)
   - 성공/실패/취소 무관 항상 생성
3. **Sentry Symbol Upload**: 빌드 성공 시 `sentry-cli debug-files upload` 자동 실행
4. **DB 업데이트**: `builds` 테이블에 status/end_time/duration 기록
5. **STATUS WebSocket 전송**: archivePath / lastError / sentryStatus 포함

### Win64Server 전용 후처리

`Win64Server` 플랫폼 성공 시 UAT Stage 결과 경로에 런처 배치파일 자동 생성:
- `Saved/Builds/Win64Server/{config}/Run_{ProjectName}Server.bat`
- `-log -port=7777` 옵션 포함

---

## 6. WebSocket 메시지 프로토콜

| type | 설명 | 주요 payload |
|------|------|-------------|
| `LOG` | 빌드 stdout 로그 | `data: string` |
| `LOG_ERROR` | 빌드 stderr 로그 | `data: string` |
| `STEP` | 빌드 단계 진행 알림 | `step, total, label` |
| `GIT_DONE` | Git 전 단계 완료 | `buildId` |
| `CONFIRM_REVERT` | 로컬 변경사항 감지, 사용자 확인 요청 | `buildId, files[]` |
| `BUILD_LOCK_RESET` | Watchdog에 의한 자동 락 해제 | `message` |
| `STATUS` | 빌드 최종 완료 | `data, code, durationSeconds, buildId, archivePath?, lastError?, sentryStatus?` |

---

## 7. SQLite DB 스키마

**파일**: `backend/build_history.db`

```sql
CREATE TABLE IF NOT EXISTS builds (
  id               TEXT PRIMARY KEY,    -- UUID v4
  platform         TEXT,                -- Win64 / Win64Server / Android / IOS
  config           TEXT,                -- Development / Debug / Test / Shipping
  status           TEXT,                -- Running / Success / Failed / Canceled
  start_time       DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time         DATETIME,
  duration_seconds INTEGER,
  log_file         TEXT                 -- 빌드 로그 파일 절대경로
);
```

---

## 8. 프론트엔드 주요 컴포넌트 구조

```
App.tsx
├─ GitRevisionPicker          브랜치/태그/커밋 선택 드롭다운
│   ├─ Branches 탭: 로컬+리모트 브랜치, current 뱃지
│   ├─ Tags 탭: 최신순 태그 목록
│   └─ Commits 탭: 기준 브랜치 선택 후 커밋 50개
├─ BuildResultCard            빌드 완료 결과 카드
│   ├─ 성공: 초록 카드 + 아카이브 경로 버튼 (탐색기 열기)
│   └─ 실패: 빨간 카드 + lastError 메시지
└─ App (메인)
    ├─ Build Launcher 탭
    │   ├─ Platform 선택 (Win64 / Win64Server / Android / IOS)
    │   ├─ Config 선택 (Development / Debug / Test / Shipping)
    │   ├─ Git Revision Control 패널
    │   │   ├─ Git 저장소 경로 입력
    │   │   └─ GitRevisionPicker 드롭다운
    │   ├─ Engine / Project 경로 입력
    │   ├─ 빌드 옵션 토글 (Clean Build / Cook Clean / Clear Cache)
    │   ├─ Launch / Cancel 버튼
    │   └─ UAT Console 터미널 (최대 300줄 유지)
    ├─ Analytics & History 탭
    │   ├─ KPI 카드 4개 (총빌드/성공/실패/성공률)
    │   ├─ 플랫폼 분포 PieChart
    │   ├─ 최근 빌드 소요시간 BarChart
    │   └─ 빌드 이력 테이블
    └─ 사이드바 System Status 패널
        ├─ 빌드 상태 표시 (Ready / Engine Occupied)
        ├─ 동적 스텝 진행 바
        ├─ Revert 확인 모달
        └─ BuildResultCard
```

---

## 9. 디자인 시스템 (Glassmorphism)

| CSS 변수 | 값 | 용도 |
|---------|-----|------|
| `--bg-dark` | `#0f172a` | 전체 배경 |
| `--glass-bg` | `rgba(30,41,59,0.4)` | 패널 배경 |
| `--primary-color` | `#38bdf8` | 기본 강조색 (하늘) |
| `--success-color` | `#34d399` | 성공 (초록) |
| `--error-color` | `#f87171` | 실패 (빨간) |

- **레이아웃**: `grid-template-columns: 350px 1fr` (사이드바 + 메인), 반응형 @1024px 이하 단열
- **UI 폰트**: Inter (Google Fonts) / 터미널 폰트: Fira Code

---

## 10. 안전 메커니즘

| 메커니즘 | 설명 |
|---------|------|
| **중복 빌드 차단** | `isPreparingBuild` 플래그로 Git 단계 중 중복 요청 거절 |
| **Watchdog 타이머** | 5분 이상 `isPreparingBuild` 상태 지속 시 자동 초기화 |
| **비정상 종료 복구** | 서버 재시작 시 DB의 `Running` 상태를 `Failed`로 일괄 전환 |
| **빌드 락 강제 해제** | `POST /api/build/reset` 으로 모든 플래그 초기화 |
| **취소 연계 종료** | `taskkill /f /t` 로 UAT 하위 프로세스 트리 전체 종료 |

---

## 11. Sentry 연동 구조

`sentry.properties` 파일이 프로젝트 루트에 존재할 경우 자동 활성화됩니다.

```
sentry.properties
├─ auth.token
├─ defaults.org
└─ defaults.project
```

**플랫폼별 심볼 경로 매핑**

| 플랫폼 | 심볼 경로 | 파일 형식 |
|--------|----------|---------|
| Android | `Binaries/Android/{Project}_Symbols_v1/` | .so |
| Win64 | `Binaries/Win64/` | .pdb |
| Win64Server | `Binaries/Win64/` | .pdb |
| IOS | `Binaries/IOS/` | dSYM |

---

## 12. 기본 경로 설정값

```
Backend Port:  3001
Frontend Port: 5173 (host: 0.0.0.0 — 외부 접근 허용)
Engine:        F:\wz\UE_CICD\UnrealEngine\UnrealEngine
Project:       F:\wz\UE_CICD\SampleProject
BAT Script:    F:\wz\UE_CICD\SampleProject\BuildProject.bat
WebSocket:     ws://{hostname}:3001
API:           http://{hostname}:3001/api
DB:            backend/build_history.db
```

---

## 13. 빌드 산출 폴더 구조

```
SampleProject\Saved\Builds\{Platform}\{Config}\
├── (APK, PAK, EXE 등 빌드 결과물)
├── Log\
│   └── build_{timestamp}.log    ← 전체 빌드 로그 (git + build + sentry)
└── Issue\
    └── issue_{timestamp}.md     ← Warning/Error 필터링 리포트 (Markdown)
```

Win64Server의 경우 추가로:
```
SampleProject\Saved\Builds\Win64Server\{Config}\
├── WindowsServer\               ← UAT Stage 결과 (서버 실행 파일)
└── Run_{ProjectName}Server.bat  ← 자동 생성 런처
```

---

## 14. 구현 완료 기능 목록

| # | 기능 | 상태 |
|---|------|------|
| 1 | 환경 세팅 (frontend/backend 폴더 구성) | ✅ 완료 |
| 2 | Glassmorphism Dark UI 스캐폴딩 | ✅ 완료 |
| 3 | Express + child_process BAT 트리거 API | ✅ 완료 |
| 4 | WebSocket 실시간 로그 스트리밍 | ✅ 완료 |
| 5 | SQLite Analytics & History 탭 | ✅ 완료 |
| 6 | Git Revision Control (브랜치/태그/커밋 드롭다운 Picker) | ✅ 완료 |
| 7 | Clean Build / Clear Cache / Cook Clean 옵션 (상호배제 토글 + 확인 모달) | ✅ 완료 |
| 8 | 동적 스텝 시스템 (옵션에 따라 스텝 수 자동 산출) | ✅ 완료 |
| 9 | Horde 분산빌드 연동 (BuildConfiguration.xml + -UBA 플래그) | ✅ 완료 |
| 10 | Sentry Debug Symbol Upload (빌드 성공 시 자동 실행, 플랫폼별 심볼 경로 매핑) | ✅ 완료 |
| 11 | Issue 리포트 자동 생성 (Warning/Error 필터·중복 제거 → Markdown 저장) | ✅ 완료 |
| 12 | Dedicated Server 빌드 타입 (Win64Server — 런처 BAT 자동 생성) | ✅ 완료 |
| 13 | 로컬 변경사항 Revert 확인 모달 (CONFIRM_REVERT 플로우) | ✅ 완료 |
| 14 | 비정상 종료 자동 복구 (Watchdog + DB 상태 정리) | ✅ 완료 |
| 15 | Naver Works 알림 연동 | ⬜ 미구현 (옵션) |

---

## 15. Android 빌드 주요 트러블슈팅 요약

> 상세 내용: `md/build/Android_Build_Troubleshooting_Guide.md`

| 에러 | 원인 | 해결 |
|------|------|------|
| `Unable to establish loopback connection` | JDK 17+과 UE의 레거시 `WindowsSelectorProvider` 코드 충돌 | `UEDeployAndroid.cs` 패치 + UBT 재컴파일 + spawn 환경변수 `_JAVA_OPTIONS=-Djava.net.preferIPv4Stack=true` 주입 |
| `UbaStorageServer - ERROR Access is denied (F:)` | UBA가 로컬 디스크를 직접 훅킹하다 권한 충돌 | `BuildProject.bat`에 `-NoUBA -NoXGE` 플래그 추가 |
| `main.1.com.YourCompany.ExFrameWork.obb was not found` | APK/OBB 분리 빌드 시 OBB 아카이빙 실패 | `DefaultEngine.ini`에 `bPackageDataInsideApk=True` 설정 |
| OpenGL ES 3.1 셰이더 무한 컴파일 (sampler 16개 초과) | `bBuildForES31=True` 설정으로 16개 sampler 한도 초과 셰이더 반복 컴파일 | `DefaultEngine.ini`에서 `bBuildForES31=False` 로 변경 |

---

## 16. 실행 방법 요약

```bash
# 1. 백엔드 실행
cd F:\wz\UE_CICD\UE_Web_Builder\backend
node index.js
# → Build Server running on http://localhost:3001

# 2. 프론트엔드 실행 (별도 터미널)
cd F:\wz\UE_CICD\UE_Web_Builder\frontend
npm run dev
# → http://localhost:5173 (네트워크 전체 공개)
```

**새 PC 설치 시 최소 체크리스트:**
1. `cd backend && npm install`
2. `cd frontend && npm install`
3. `backend/index.js` 상단 `BAT_SCRIPT_PATH` 경로 수정
4. `{프로젝트}\BuildProject.bat` 존재 확인
5. `backend` 폴더에서 `node index.js` 실행

---

*이 문서는 UE_Web_Builder 프로젝트의 아키텍처와 현재 구현 상태를 AI 에이전트 또는 신규 개발자가 빠르게 파악할 수 있도록 정리된 압축 참조 문서입니다.*
