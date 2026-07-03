# UE_Web_Builder MCP 서버 설치 가이드

> 작성일: 2026-05-29  
> 방식: Option A — stdio transport (기존 백엔드 무수정 유지)

---

## 1. 아키텍처 요약

```
Claude Desktop App
      ↓ MCP Protocol (stdio)
backend/mcp-server.js        ← 신규 추가 파일
      ↓ http://localhost:3001
backend/index.js             ← 기존 그대로 유지
      ↓ spawn
BuildProject.bat → UAT
```

Claude Desktop이 `mcp-server.js`를 자식 프로세스로 실행하고,  
`mcp-server.js`는 기존 Express 백엔드의 REST API를 내부적으로 호출한다.  
**기존 `index.js`는 한 줄도 수정하지 않는다.**

---

## 2. 설치 절차

### Step 1 — MCP SDK 의존성 설치

```cmd
cd F:\wz\UE_CICD\UE_Web_Builder\backend
npm install
```

`package.json`에 `@modelcontextprotocol/sdk ^1.29.0` 과 `zod ^3.24.0` 이 추가되어 있으므로 자동 설치된다.

### Step 2 — Claude Desktop 설정 파일 수정

Claude Desktop의 설정 파일을 열어 아래 내용을 추가한다.

**설정 파일 위치 (Windows):**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**추가할 내용 (`claude_desktop_config.json` 참고):**
```json
{
  "mcpServers": {
    "ue-web-builder": {
      "command": "node",
      "args": [
        "F:\\wz\\UE_CICD\\UE_Web_Builder\\backend\\mcp-server.js"
      ],
      "env": {
        "UE_BACKEND_HOST": "localhost",
        "UE_BACKEND_PORT": "3001"
      }
    }
  }
}
```

> 기존에 다른 MCP 서버가 등록되어 있다면 `mcpServers` 객체 안에 `"ue-web-builder": { ... }` 항목만 추가한다.

### Step 3 — Claude Desktop 재시작

설정 파일 저장 후 Claude Desktop을 완전히 종료하고 재시작한다.  
좌측 하단 또는 도구 목록에서 `ue-web-builder` 항목이 보이면 연결 성공.

---

## 3. 사용 방법

### 선행 조건

**MCP 서버와 별개로, 기존 Express 백엔드가 반드시 실행 중이어야 한다.**

```cmd
cd F:\wz\UE_CICD\UE_Web_Builder\backend
node index.js
```

백엔드가 꺼져 있어도 `get_server_status`, `get_build_status`, `get_build_history`, `get_analytics`, `read_build_log`, `read_issue_report` 도구는 SQLite DB를 직접 읽기 때문에 동작한다.  
빌드 트리거(`trigger_build`) 등 제어 도구는 백엔드가 켜져 있어야 동작한다.

### Claude 대화 예시

```
"현재 서버 상태 확인해줘"
→ get_server_status 호출

"main 브랜치 브랜치 목록 보여줘"
→ list_git_refs 호출

"Win64 Development로 빌드 시작해줘"
→ trigger_build 호출

"빌드 지금 어떻게 되고 있어?"
→ get_build_status 호출

"빌드 취소해줘"
→ cancel_build 호출

"최근 빌드 10개 이력 보여줘"
→ get_build_history 호출

"최근 실패 빌드 로그 에러만 뽑아줘"
→ read_build_log (filterErrors=true) 호출

"마지막 빌드 이슈 리포트 분석해줘"
→ read_issue_report 호출 → Claude가 내용 분석

"성공률이 얼마야?"
→ get_analytics 호출

"빌드 락 걸려서 새 빌드가 안 돼"
→ reset_build_lock 호출
```

---

## 4. 등록된 MCP 도구 목록 (11개)

| 도구명 | 내부 호출 | 설명 |
|--------|----------|------|
| `trigger_build` | `POST /api/build` | 플랫폼·설정·옵션 지정 후 빌드 시작 |
| `get_build_status` | DB 직접 조회 | 최신 또는 특정 빌드 상태 확인 |
| `cancel_build` | `POST /api/build/cancel` | 진행 중 빌드 강제 취소 |
| `confirm_revert` | `POST /api/build/confirm` | 로컬 변경사항 Revert 승인 후 빌드 재개 |
| `reset_build_lock` | `POST /api/build/reset` | 빌드 락 강제 해제 (비상 복구) |
| `list_git_refs` | `GET /api/git/refs` | 브랜치·태그·currentBranch 조회 |
| `get_build_history` | DB 직접 조회 | 이력 조회 (플랫폼·상태 필터) |
| `get_analytics` | DB 직접 조회 | 총 빌드·성공률·플랫폼 분포 통계 |
| `read_build_log` | 파일 직접 읽기 | 로그 파일 tail + Error/Warning 필터 |
| `read_issue_report` | 파일 직접 읽기 | 자동 생성된 issue_*.md 읽기 |
| `get_server_status` | DB + 백엔드 ping | 서버 생존 여부 + 진행 중 빌드 확인 |

---

## 5. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `UE_BACKEND_HOST` | `localhost` | Express 백엔드 호스트 |
| `UE_BACKEND_PORT` | `3001` | Express 백엔드 포트 |

백엔드가 다른 PC에서 실행 중이라면 `claude_desktop_config.json`의 `env`에서 수정한다.

---

## 6. 파일 구조 (추가된 파일)

```
UE_Web_Builder/
├── backend/
│   ├── index.js                ← 기존 그대로 (무수정)
│   ├── mcp-server.js           ← ★ 신규 추가 (MCP 서버)
│   ├── package.json            ← @modelcontextprotocol/sdk, zod 추가됨
│   └── build_history.db
├── claude_desktop_config.json  ← ★ Claude Desktop 설정 참고용
└── md/
    └── MCP_Setup_Guide.md      ← 이 문서
```

---

## 7. 트러블슈팅

### Claude Desktop에서 도구가 보이지 않을 때

1. `%APPDATA%\Claude\claude_desktop_config.json` JSON 문법 오류 확인 (쉼표 누락 등)
2. Claude Desktop 완전 종료 후 재시작
3. `node "F:\wz\UE_CICD\UE_Web_Builder\backend\mcp-server.js"` 를 직접 실행해서 오류 메시지 확인

### `npm install` 후 `Cannot find module` 오류

```cmd
cd F:\wz\UE_CICD\UE_Web_Builder\backend
npm install
```
`node_modules/@modelcontextprotocol` 폴더가 생성되어 있는지 확인.

### 빌드 도구는 보이는데 실행 시 "백엔드 서버에 연결할 수 없습니다"

Express 백엔드가 꺼져 있는 상태다.
```cmd
cd F:\wz\UE_CICD\UE_Web_Builder\backend
node index.js
```

### stdio 모드에서 console.log 출력이 MCP를 오염시키는 경우

`mcp-server.js`는 의도적으로 `console.log` 대신 `process.stderr.write`만 사용한다.  
디버깅 시 stderr로만 출력할 것.
