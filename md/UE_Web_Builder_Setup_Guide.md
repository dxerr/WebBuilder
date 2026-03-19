# UE_Web_Builder 환경 구축 가이드
> AI 에이전트 및 신규 개발자를 위한 완전한 설치 · 구성 매뉴얼  
> 최종 업데이트: 2026-03-09

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [사전 요구사항](#2-사전-요구사항)
3. [디렉터리 구조](#3-디렉터리-구조)
4. [환경 설정 단계별 가이드](#4-환경-설정-단계별-가이드)
5. [백엔드 구성](#5-백엔드-구성)
6. [프론트엔드 구성](#6-프론트엔드-구성)
7. [BuildProject.bat 구성](#7-buildprojectbat-구성)
8. [실행 방법](#8-실행-방법)
9. [API 명세](#9-api-명세)
10. [WebSocket 메시지 명세](#10-websocket-메시지-명세)
11. [주요 기능 설명](#11-주요-기능-설명)
12. [트러블슈팅](#12-트러블슈팅)

---

## 1. 시스템 개요

### 1.1 목적
Unreal Engine 프로젝트의 CI/CD 파이프라인을 **웹 UI로 제어**하는 빌드 관리 시스템.  
로컬 Git 저장소 동기화 → UE 빌드 실행 → 결과 아카이빙을 단일 웹 인터페이스에서 처리한다.

### 1.2 전체 아키텍처

```
[브라우저 Web UI]
      ↕ HTTP REST API (port 3001)
      ↕ WebSocket (port 3001)
[Node.js Express 백엔드]
      ↕ child_process (spawn/exec)
      ├─ git.exe         → SampleProject 저장소 동기화
      ├─ BuildProject.bat → UE AutomationTool 빌드 실행
      └─ explorer.exe   → 아카이브 폴더 열기
      ↕ SQLite (better-sqlite3)
[build_history.db]       → 빌드 이력 / 통계 저장
```

### 1.3 기술 스택

| 영역 | 기술 | 버전 |
|------|------|------|
| 백엔드 | Node.js + Express | v22+ / Express 5 |
| 실시간 통신 | WebSocket (ws) | ^8.19 |
| DB | SQLite (better-sqlite3) | ^12.6 |
| 프론트엔드 | React + TypeScript | React 19 / TS 5.9 |
| 번들러 | Vite | ^7.3 |
| UI 애니메이션 | framer-motion | ^12 |
| 차트 | recharts | ^3.7 |
| 아이콘 | lucide-react | ^0.575 |


---

## 2. 사전 요구사항

### 2.1 필수 소프트웨어

| 소프트웨어 | 최소 버전 | 확인 명령어 |
|-----------|---------|------------|
| Node.js | v18 이상 (v22 권장) | `node -v` |
| Git | 2.x 이상 | `git --version` |
| Unreal Engine | 5.x (프로젝트에 맞는 버전) | - |
| Windows OS | Windows 10/11 | - |

> ⚠️ **Node.js 설치 권장 방법**: WinGet 또는 공식 사이트(nodejs.org)에서 설치.  
> `npx` 가 정상 동작하는지 반드시 확인: `npx --version`

### 2.2 Git 저장소 구조 요구사항

빌드 대상 UE 프로젝트가 **Git으로 관리**되어야 한다.  
`.uproject` 파일이 Git 저장소 루트 또는 하위 디렉터리에 존재해야 한다.

### 2.3 네트워크 환경

- 백엔드 포트 **3001** 이 방화벽에서 허용되어야 함 (로컬 네트워크 접근 시)
- 프론트엔드 포트 **5173** 이 허용되어야 함
- 다른 PC에서 접근 시: `http://{서버IP}:5173` 으로 접속

---

## 3. 디렉터리 구조

### 3.1 권장 폴더 레이아웃

```
{작업루트}\                          ← 예: F:\wz\UE_CICD\
├── UE_Web_Builder\                  ← 이 프로젝트 루트
│   ├── backend\
│   │   ├── index.js                 ← 백엔드 메인 서버
│   │   ├── package.json
│   │   ├── build_history.db         ← SQLite DB (자동 생성)
│   │   └── node_modules\
│   ├── frontend\
│   │   ├── src\
│   │   │   ├── App.tsx              ← 메인 React 컴포넌트
│   │   │   ├── index.css            ← 전역 스타일
│   │   │   └── main.tsx
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── node_modules\
│   └── md\                          ← 문서 모음
├── SampleProject\                   ← UE Git 저장소 (빌드 대상)
│   ├── SampleProject.uproject
│   ├── BuildProject.bat             ← 빌드 실행 스크립트
│   └── Saved\
│       ├── Builds\                  ← 빌드 아카이브 출력 경로
│       └── StagedBuilds\           ← 스테이징 임시 경로
└── UnrealEngine\
    └── UnrealEngine\                ← UE 엔진 설치 경로
```

### 3.2 경로 변수 (index.js 상단에서 수정)

```javascript
// backend/index.js 상단
const BAT_SCRIPT_PATH = 'D:\\your\\path\\SampleProject\\BuildProject.bat';
```


---

## 4. 환경 설정 단계별 가이드

### Step 1 — 프로젝트 파일 복사

기존 PC에서 아래 폴더를 새 PC로 복사한다.  
`node_modules` 는 **복사하지 않는다** (용량이 크고, 새 PC에서 재설치해야 함).

```
UE_Web_Builder\backend\    (node_modules 제외)
UE_Web_Builder\frontend\   (node_modules 제외)
```

Git으로 관리 중이라면 clone 으로 대체 가능.

---

### Step 2 — Node.js 의존성 설치

**백엔드:**
```cmd
cd /d {작업루트}\UE_Web_Builder\backend
npm install
```

**프론트엔드:**
```cmd
cd /d {작업루트}\UE_Web_Builder\frontend
npm install
```

---

### Step 3 — 백엔드 경로 설정

`backend\index.js` 상단의 경로를 **새 PC 환경에 맞게 수정**한다.

```javascript
// ──── 여기만 수정하면 됨 ────────────────────────────────
const BAT_SCRIPT_PATH = 'D:\\your\\SampleProject\\BuildProject.bat';
// ───────────────────────────────────────────────────────
```

> 프론트엔드 UI에서도 경로를 입력할 수 있으므로,  
> BAT_SCRIPT_PATH 는 **기본값(fallback)** 용도이다.  
> 실제 빌드 시에는 UI의 "Project Directory Path" 입력값이 우선 적용된다.

---

### Step 4 — BuildProject.bat 생성 · 확인

UE 프로젝트 루트에 `BuildProject.bat` 파일이 있어야 한다.  
**섹션 7** 에서 상세 내용 확인.

---

### Step 5 — 프론트엔드 네트워크 설정 확인

`frontend\vite.config.ts` 에서 `host: '0.0.0.0'` 설정이 있는지 확인.  
다른 PC에서 접근하려면 반드시 필요하다.

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',   // ← 외부 접근 허용
    port: 5173
  }
})
```

---

### Step 6 — 방화벽 포트 허용 (선택, 다른 PC에서 접근 시)

Windows Defender 방화벽에서 인바운드 규칙 추가:

```cmd
:: 관리자 권한 cmd에서 실행
netsh advfirewall firewall add rule name="UE_Web_Builder_Backend" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="UE_Web_Builder_Frontend" dir=in action=allow protocol=TCP localport=5173
```


---

## 5. 백엔드 구성

### 5.1 index.js 핵심 구조

```
index.js
├── DB 초기화 (SQLite - build_history.db)
├── WebSocket 서버 (wss)
├── 전역 상태 변수
│   ├── activeBuildProcess  현재 실행 중인 빌드 child_process
│   ├── activeBuildId       현재 빌드 UUID
│   ├── isPreparingBuild    빌드 준비 중 플래그 (중복 실행 방지)
│   ├── isCancelling        취소 요청 플래그
│   ├── lastErrorLine       마지막 에러 로그 라인 (실패 메시지용)
│   └── pendingBuildContext Revert 대기 중 빌드 파라미터 보관
└── API 엔드포인트 목록
```

### 5.2 빌드 파이프라인 흐름 (5단계 또는 6단계)

스텝 수는 `clearCache` 옵션에 따라 **동적으로 결정**됨 (5 또는 6).

```
POST /api/build 수신 (cleanBuild, clearCache 파라미터 포함)
      │
      ▼
[STEP 1/N] Git Check   → git status --porcelain
      │ 변경사항 있으면 → CONFIRM_REVERT WebSocket 전송 → 사용자 확인 대기
      │ 없으면 계속
      ▼
[STEP 2/N] Git Fetch   → git fetch --all
      ▼
[STEP 3/N] Git Checkout
      │ gitRevision 지정됨 → git checkout {revision}
      │ gitRevision 없음   → 현재 브랜치 유지 (HEAD)
      ▼
[STEP 4/N] Git Pull
      │ 일반 브랜치   → git pull
      │ Detached HEAD → 스킵
      ▼
[STEP 5/N] Clear Cache (**clearCache=true 일 때만 실행**)
      │ XmlConfigCache.bin 삭제
      │ Intermediate/ 폴더 삭제
      │ Saved/ 폴더 삭제
      │ Binaries/ 폴더 삭제
      ▼
[STEP N/N] Build
      └── BuildProject.bat {platform} {config} [-clean] 실행 (spawn)
              ├── cleanBuild=true 시 -clean 인자 추가
              ├── stdout → LOG WebSocket
              ├── stderr → LOG_ERROR WebSocket (lastErrorLine 추적)
              └── close  → STATUS WebSocket (archivePath / lastError 포함)
```

> **N = 5** (기본) 또는 **N = 6** (clearCache 활성화 시). UI 스텝퍼와 로그 번호가 동적으로 조정됨.

### 5.3 주요 전역 변수 설명

| 변수 | 타입 | 역할 |
|------|------|------|
| `activeBuildProcess` | ChildProcess \| null | 현재 빌드 프로세스 참조. null이면 빌드 없음 |
| `isPreparingBuild` | boolean | git 단계 진행 중 중복 요청 차단 |
| `clearCache` | boolean (req) | 빌드 전 Intermediate/Saved/Binaries 폴더 삭제 여부 |
| `cleanBuild` | boolean (req) | UAT에 -clean 플래그 전달 여부 |
| `isCancelling` | boolean | 취소 요청 시 close 핸들러에서 status를 Canceled로 처리 |
| `lastErrorLine` | string | stdout/stderr에서 error/failed 패턴 라인 실시간 갱신 |
| `pendingBuildContext` | object \| null | Revert 대기 중 빌드 파라미터 임시 보관 |

### 5.4 서버 시작 시 자동 정리

서버가 비정상 종료된 후 재시작할 때, DB에 `Running` 상태로 남은 레코드를 자동으로 `Failed` 처리한다:

```javascript
db.prepare(`UPDATE builds SET status = 'Failed', end_time = CURRENT_TIMESTAMP
            WHERE status = 'Running'`).run();
```


---

## 6. 프론트엔드 구성

### 6.1 App.tsx 컴포넌트 구조

```
App.tsx
├── GitRevisionPicker          브랜치/태그/커밋 선택 드롭다운 컴포넌트
├── BuildResultCard            빌드 완료 결과 카드 컴포넌트
│   ├── 성공: 초록 카드 + 아카이브 경로 버튼 (탐색기 열기)
│   └── 실패: 빨간 카드 + lastError 메시지
└── App (메인)
    ├── Build Launcher 탭
    │   ├── Platform / Config 선택
    │   ├── Git Revision Control 패널
    │   │   ├── Git 저장소 경로 입력
    │   │   └── GitRevisionPicker
    │   ├── Engine / Project 경로 입력
    │   ├── Launch / Cancel Build 버튼
    │   └── UAT Console 터미널 출력
    ├── Analytics & History 탭
    │   ├── 통계 카드 (총 빌드 / 성공 / 실패 / 성공률)
    │   ├── 플랫폼 분포 Pie 차트
    │   ├── 최근 실행시간 Bar 차트
    │   └── 빌드 이력 테이블
    └── 사이드바 System Status 패널
        ├── 상태 표시 (Ready / Engine Occupied)
        ├── 빌드 단계 스텝퍼 (5단계 진행 바)
        ├── Revert 확인 모달
        └── BuildResultCard (빌드 완료 후 표시)
```

### 6.2 WebSocket 연결

```typescript
const WS_URL = `ws://${window.location.hostname}:3001`;
```

- 컴포넌트 마운트 시 자동 연결
- 페이지 새로고침으로 재연결 (자동 재연결 로직 없음 → 서버 재시작 후 F5 필요)

### 6.3 주요 State 목록

| State | 타입 | 역할 |
|-------|------|------|
| `isBuilding` | boolean | 빌드 진행 중 여부 |
| `buildStatus` | string | 현재 상태 텍스트 |
| `buildStep` | object \| null | 현재 단계 번호/총수/라벨 |
| `buildResult` | BuildResult \| null | 빌드 완료 결과 (성공/실패/경로/에러) |
| `logs` | string[] | 터미널 출력 로그 (최대 300줄 유지) |
| `revertConfirm` | object \| null | Revert 모달 표시용 데이터 |

### 6.4 BuildResult 타입

```typescript
interface BuildResult {
  status: 'Success' | 'Failed' | 'Canceled';
  archivePath?: string | null;    // 성공 시 아카이브 경로
  lastError?: string | null;      // 실패 시 마지막 에러 메시지
  durationSeconds?: number;       // 빌드 소요 시간(초)
}
```


---

## 7. BuildProject.bat 구성

### 7.1 파일 위치

```
{UE 프로젝트 루트}\BuildProject.bat
예: F:\wz\UE_CICD\SampleProject\BuildProject.bat
```

### 7.2 BAT 파일 인수

| 순서 | 인자 | 예시 | 설명 |
|------|------|------|------|
| %1 | Platform | Win64 | 대상 플랫폼 |
| %2 | Config | Development | 빌드 설정 |
| %3 | -clean (선택) | -clean | cleanBuild=true 시 백엔드에서 자동 전달, UAT에 -clean 플래그 추가 |

### 7.3 BAT 파일 템플릿

아래 내용을 참고하여 새 환경에 맞게 경로를 수정한다.

```bat
@echo off
setlocal

:: ── 환경 변수 (새 PC에 맞게 수정) ─────────────────────────────────────────
set ENGINE_PATH=%1
set PROJECT_PATH=%2
set PLATFORM=%3
set CONFIG=%4

:: 기본값 (UI에서 파라미터 전달 안 될 경우 fallback)
if "%ENGINE_PATH%"=="" set ENGINE_PATH=D:\UnrealEngine\UnrealEngine
if "%PROJECT_PATH%"=="" set PROJECT_PATH=D:\SampleProject
if "%PLATFORM%"==""      set PLATFORM=Win64
if "%CONFIG%"==""        set CONFIG=Development

:: .uproject 파일 자동 탐색
for %%f in ("%PROJECT_PATH%\*.uproject") do set UPROJECT=%%f

echo [Build] Engine:  %ENGINE_PATH%
echo [Build] Project: %UPROJECT%
echo [Build] Platform: %PLATFORM%  Config: %CONFIG%

:: ── UAT BuildCookRun 실행 ──────────────────────────────────────────────────
"%ENGINE_PATH%\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun ^
  -project="%UPROJECT%" ^
  -noP4 ^
  -platform=%PLATFORM% ^
  -clientconfig=%CONFIG% ^
  -cook ^
  -build ^
  -stage ^
  -pak ^
  -archive ^
  -archivedirectory="%PROJECT_PATH%\Saved\Builds"

exit /b %ERRORLEVEL%
```

### 7.3 백엔드에서 BAT 호출 방식

`index.js` 내부에서 아래와 같이 호출된다:

```javascript
activeBuildProcess = spawn(BAT_SCRIPT_PATH, [enginePath, finalProjectPath, platform, config], {
  shell: true,
  cwd: path.dirname(BAT_SCRIPT_PATH),
});
```

- **인수 순서**: `[enginePath, projectPath, platform, config]`
- `cwd` 는 BAT 파일 위치 디렉터리로 설정됨

### 7.4 아카이브 출력 경로 (빌드 성공 결과 카드에 표시됨)

```
{projectPath}\Saved\Builds\{platform}\{config}\
예: F:\wz\UE_CICD\SampleProject\Saved\Builds\Win64\Development\
```


---

## 8. 실행 방법

### 8.1 백엔드 서버 시작

```cmd
cd /d {작업루트}\UE_Web_Builder\backend
node index.js
```

정상 시작 시 출력:
```
Build Server running on http://localhost:3001
```

> ⚠️ **반드시 `backend` 폴더에서 실행해야 한다.**  
> 다른 경로에서 실행하면 SQLite DB 파일(`build_history.db`) 경로를 못 찾아 오류 발생.

### 8.2 프론트엔드 개발 서버 시작

```cmd
cd /d {작업루트}\UE_Web_Builder\frontend
npm run dev
```

정상 시작 시 출력:
```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://{서버IP}:5173/
```

### 8.3 접속 방법

| 접속 환경 | URL |
|-----------|-----|
| 서버 PC 자체 | `http://localhost:5173` |
| 같은 네트워크 내 다른 PC | `http://{서버IP}:5173` |

### 8.4 서버 종료 / 재시작 절차

**포트 점유 중일 때 강제 종료:**
```cmd
:: 3001 포트 점유 PID 확인
powershell -command "Get-NetTCPConnection -LocalPort 3001 | Select-Object OwningProcess"

:: PID 종료
taskkill /PID {PID번호} /F
```

**서버 재시작 후 브라우저도 반드시 새로고침(F5)**  
→ WebSocket 재연결을 위해 필요

### 8.5 프로세스 구동 확인

```cmd
:: 백엔드 살아있는지 확인
powershell -command "Invoke-RestMethod 'http://localhost:3001/api/history' | Select-Object -First 1 | ConvertTo-Json"

:: 빌드 관련 프로세스 확인
powershell -command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*BuildProject*' } | Select-Object ProcessId, Name"
```


---

## 9. API 명세

모든 요청/응답은 `Content-Type: application/json`.  
Base URL: `http://{서버IP}:3001/api`

### 9.1 빌드 제어

#### `POST /api/build` — 빌드 시작
```json
// Request Body
{
  "platform":    "Win64",
  "config":      "Development",
  "enginePath":  "F:\\UnrealEngine",
  "projectPath": "F:\\SampleProject",
  "gitRevision": "main",
  "cleanBuild":  false,
  "clearCache":  false
}
```
```json
// Response 200
{ "buildId": "uuid-v4", "message": "Build started" }
// Response 409 (이미 빌드 중)
{ "error": "Build already in progress" }
```

#### `POST /api/build/cancel` — 빌드 취소
```json
// Response 200
{ "message": "Cancellation requested" }
```

#### `POST /api/build/confirm` — Revert 확인 후 빌드 재개
```json
// Response 200
{ "message": "Confirmed — reverting and continuing build" }
```

#### `POST /api/build/reset` — 빌드 상태 강제 초기화 (비상용)
```json
// Response 200
{ "message": "Build state reset", "wasLocked": true }
```

### 9.2 Git 정보 조회

#### `GET /api/git/refs?path={repoPath}` — 브랜치/태그 목록
```json
// Response 200
{
  "branches": [
    { "type": "branch", "name": "main", "hash": "abc1234",
      "message": "커밋메시지", "author": "홍길동",
      "time": "2 hours ago", "isCurrent": true, "remote": false }
  ],
  "tags": [ ... ],
  "currentBranch": "main"
}
```

#### `GET /api/git/commits?path={repoPath}&branch={branchName}` — 커밋 목록
```json
// Response 200
[
  { "hash": "abc1234", "message": "커밋메시지", "author": "홍길동", "time": "2h ago" }
]
```

### 9.3 이력 / 통계

#### `GET /api/history` — 빌드 이력 (최근 50건)
```json
[
  { "id": "uuid", "platform": "Win64", "config": "Development",
    "status": "Success", "start_time": "...", "end_time": "...",
    "duration_seconds": 153 }
]
```

#### `GET /api/analytics` — 집계 통계
```json
{
  "totalBuilds": 24, "successfulBuilds": 20, "failedBuilds": 4,
  "platformStats": [{ "platform": "Win64", "count": 24 }]
}
```

### 9.4 유틸리티

#### `POST /api/open-folder` — Windows 탐색기로 폴더 열기
```json
// Request Body
{ "path": "F:\\SampleProject\\Saved\\Builds\\Win64\\Development" }
// Response 200
{ "message": "Opened", "path": "..." }
```


---

## 10. WebSocket 메시지 명세

연결 URL: `ws://{서버IP}:3001`  
모든 메시지는 JSON 문자열로 전송.

### 10.1 서버 → 클라이언트 메시지 타입

| type | 설명 | 주요 필드 |
|------|------|-----------|
| `LOG` | 빌드 stdout 로그 라인 | `data: string` |
| `LOG_ERROR` | 빌드 stderr 로그 라인 | `data: string` |
| `STEP` | 빌드 단계 진행 | `step: number, total: number, label: string` |
| `GIT_DONE` | Git 동기화 완료 | `buildId: string` |
| `CONFIRM_REVERT` | 로컬 변경사항 감지 → 사용자 확인 요청 | `buildId: string, files: string[]` |
| `STATUS` | 빌드 최종 완료 | `data, code, durationSeconds, buildId, archivePath?, lastError?` |

### 10.2 STATUS 메시지 상세

```json
// 성공 시
{
  "type": "STATUS",
  "data": "Build Success",
  "code": 0,
  "durationSeconds": 153,
  "buildId": "uuid",
  "archivePath": "F:\\SampleProject\\Saved\\Builds\\Win64\\Development",
  "lastError": null
}

// 실패 시
{
  "type": "STATUS",
  "data": "Build Failed",
  "code": 1,
  "durationSeconds": 538,
  "buildId": "uuid",
  "archivePath": null,
  "lastError": "Error: Unable to find plugin 'XXX'"
}

// 취소 시
{
  "type": "STATUS",
  "data": "Build Canceled",
  "code": null,
  "durationSeconds": 30,
  "buildId": "uuid",
  "archivePath": null,
  "lastError": null
}
```

### 10.3 STEP 메시지 단계 목록

| step | label | 비고 |
|------|-------|------|
| 1/N | Git Check | |
| 2/N | Git Fetch | |
| 3/N | Git Checkout | |
| 4/N | Git Pull | |
| 5/N | Clear Cache | clearCache=true 일 때만 (빨간색 스텝) |
| N/N | Build | N=5 또는 6 |

---

## 11. 주요 기능 설명

### 11.1 Clean Build / Clear Cache 옵션

Launch Editor Build 버튼 왼쪽에 iOS 스타일 토글 스위치 2개가 위치:

| 옵션 | UI 색상 | 동작 |
|--------|-----------|------|
| **Clean Build** | 파란색 토글 | UAT BuildCookRun에 `-clean` 플래그 전달 |
| **Clear Cache** | 빨간색 토글 | 빌드 전 `Intermediate/`, `Saved/`, `Binaries/`, `XmlConfigCache.bin` 삭제 |

**Clear Cache 활성화 시:**
- 빌드 버튼 클릭 → 경고 모달 팝업 (삭제 대상 목록 표시)
- 사용자 확인 후에만 실제 삭제 + 빌드 진행
- System Status 스텝퍼에 **Clear Cache** 단계가 빨간색으로 표시됨 (6단계 모드)
- 터미널 로그에 `[Clean] Target: {projectPath}` 및 각 폴더 삭제 결과 출력

### 11.2 Git Revision Picker

사이드바 드롭다운으로 브랜치 / 태그 / 커밋 해시 선택 가능.  
- **브랜치 탭**: 로컬 + 리모트 브랜치 표시 (리모트는 보라색 `remote` 배지)
- **태그 탭**: 태그 목록
- **커밋 탭**: 선택한 브랜치 기준 커밋 목록
- **빈값(HEAD)**: 현재 브랜치 그대로 유지하고 pull만 실행

### 11.3 로컬 변경사항 Revert 플로우

1. 빌드 시작 시 `git status --porcelain` 실행
2. tracked 파일 변경 감지 시 → `CONFIRM_REVERT` WebSocket 전송
3. 프론트엔드 모달 표시 → 사용자 선택:
   - **Revert 후 빌드 진행**: `POST /api/build/confirm` → `git checkout -- .` 후 빌드 재개
   - **빌드 취소**: `POST /api/build/cancel`

### 11.4 빌드 결과 카드 (System Status 하단)

- 빌드 완료 시 사이드바 System Status 패널 하단에 자동 표시
- **성공**: 초록 카드 + 소요시간 + 아카이브 경로 버튼
  - 버튼 클릭 → `POST /api/open-folder` → Windows 탐색기 자동 오픈
- **실패**: 빨간 카드 + 소요시간 + 마지막 에러 메시지
- **취소**: 카드 미표시
- 새 빌드 시작 시 이전 결과 카드 초기화

### 11.5 비상 복구 엔드포인트

빌드 상태가 잠겨 새 빌드를 시작할 수 없을 때:
```cmd
curl -X POST http://localhost:3001/api/build/reset
```
`isPreparingBuild`, `activeBuildProcess` 등 모든 상태를 강제 초기화한다.


---

## 12. 트러블슈팅

### 🔴 `EADDRINUSE: address already in use :::3001`
포트 3001이 이미 사용 중. 기존 node 프로세스를 종료한다.
```cmd
powershell -command "Get-NetTCPConnection -LocalPort 3001 | Select-Object OwningProcess"
taskkill /PID {PID} /F
```

---

### 🔴 `SqliteError: unable to open database file`
백엔드를 `backend` 폴더 외부에서 실행했을 때 발생.  
**반드시 `cd /d {경로}\backend` 후 `node index.js` 실행.**

---

### 🔴 `SyntaxError: Identifier 'xxx' has already been declared`
패치 스크립트가 중복 적용된 경우.  
`index.js` 를 열어 중복 선언된 변수를 수동으로 하나 제거.

---

### 🔴 빌드 버튼을 눌러도 터미널 로그가 안 나옴
서버 재시작 후 브라우저 WebSocket 연결이 끊긴 상태.  
**브라우저에서 F5 새로고침** 후 재시도.

---

### 🔴 `Build already in progress` 인데 빌드가 안 됨
`isPreparingBuild` 플래그가 잠긴 상태.
```cmd
curl -X POST http://localhost:3001/api/build/reset
```

---

### 🔴 Git checkout 시 `error: Your local changes would be overwritten`
tracked 파일에 로컬 변경사항이 있어 checkout 불가.  
→ 빌드 시작 시 자동으로 Revert 확인 모달이 표시됨. "Revert 후 빌드 진행" 선택.

---

### 🔴 아카이브 경로 버튼 클릭해도 탐색기가 안 열림
브라우저 보안으로 `file://` URL은 직접 열 수 없음.  
백엔드의 `/api/open-folder` 엔드포인트를 통해 서버 측 `explorer.exe` 를 실행하는 방식이므로,  
**백엔드 서버가 실행 중인지 확인**.

---

### 🔴 `Unable to find plugin 'XXX'` 빌드 실패
`.uproject` 파일에 등록된 플러그인이 엔진에 설치되지 않았거나 경로가 다름.  
- 해당 플러그인을 설치하거나
- `.uproject` 에서 해당 플러그인 항목을 제거 후 커밋

---

### 🔴 리모트 브랜치가 피커에 안 보임
`git fetch --all` 실행 후 UI 새로고침 버튼(↻) 클릭.  
또는 백엔드가 `origin/HEAD` 와 `->` 포함 항목을 필터링하므로,  
해당 remote 브랜치가 `origin` 이 아닌 다른 remote에 있는지 확인.

---

## 부록: 빠른 체크리스트

새 PC에서 처음 구축할 때 순서대로 체크:

- [ ] Node.js v18+ 설치 확인 (`node -v`)
- [ ] Git 설치 확인 (`git --version`)
- [ ] `backend\npm install` 완료
- [ ] `frontend\npm install` 완료
- [ ] `backend\index.js` 의 `BAT_SCRIPT_PATH` 수정
- [ ] `{프로젝트}\BuildProject.bat` 파일 존재 및 경로 정확한지 확인
- [ ] `frontend\vite.config.ts` 에 `host: '0.0.0.0'` 있는지 확인
- [ ] `backend` 폴더에서 `node index.js` 실행 → `Build Server running` 확인
- [ ] `frontend` 폴더에서 `npm run dev` 실행 → 브라우저 접속 확인
- [ ] UI에서 Engine/Project 경로 입력 후 빌드 테스트
- [ ] Clean Build 토글 작동 확인 (UAT 로그에 -clean 플래그 표시)
- [ ] Clear Cache 토글 작동 확인 (경고 모달 + 폴더 삭제 로그 + 6단계 스텝퍼)
- [ ] 빌드 완료 후 System Status 하단 결과 카드 표시 확인
- [ ] 아카이브 경로 버튼 클릭 → 탐색기 오픈 확인
