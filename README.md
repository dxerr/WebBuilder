# UE Web Builder (언리얼 엔진 웹 기반 빌드 자동화 시스템)

UE Web Builder는 Unreal Engine 프로젝트의 빌드, 쿠킹, 패키징 전 과정을 웹 브라우저 상에서 제어하고 모니터링할 수 있는 **CI/CD 파이프라인 전용 웹 UI 시스템**입니다. 
로컬 Git 저장소의 브랜치/커밋 동기화부터 시작하여, 백엔드에서 AutomationTool(UAT)을 안전하게 구동하고, 실시간 로그 스트리밍과 빌드 히스토리 통계를 제공합니다.

---

## 🚀 주요 기능

- **GUI 기반 빌드 제어**: 복잡한 빌드 스크립트 수정 없이 플랫폼(Win64, Android 등)과 빌드 환경(Development, Shipping 등)을 클릭으로 선택
- **Git 리비전 추적 및 동기화**: 프로젝트 저장소의 실시간 Branch, Tag, Commit 내역을 조회하고, 특정 리비전으로 Checkout 후 빌드 실행
- **리얼타임 로그 & 상태 모니터링**: WebSocket을 이용해 백엔드의 `BuildProject.bat` 실행 로그를 웹 터미널 환경에 실시간 스트리밍
- **빌드 강제 취소 (Cancel)**: 진행 중인 UAT 프로세스와 하위 빌드 작업들을 터미널을 열 필요 없이 웹에서 클릭 한 번으로 안전하게 프로세스 Kill 처리
- **빌드 결과 자동 아카이빙**: 성공한 빌드의 배포 패키지 폴더 포인팅 및 Windows 탐색기 다이렉트 오픈 연동
- **통계 대시보드 (Analytics)**: 내장 SQLite DB를 통해 빌드 성공률, 플랫폼별 파이 분포도, 최근 빌드 소요 시간 등을 대시보드로 시각화 제공

---

## 🛠 시스템 아키텍처 및 기술 스택

* **Frontend**: React 19, TypeScript, Vite, Framer-motion, Recharts, Tailwind CSS(또는 호환 CSS)
* **Backend**: Node.js v22+, Express 5, WebSocket (`ws`), SQLite3 (`better-sqlite3`)
* **Build Engine**: Unreal Engine 5.x (AutomationTool / BuildCookRun 패스)

```text
[브라우저 Web UI (React)]
      ↕ REST API & WebSocket (포트 3001)
[Node.js Express 백엔드]
      ↕ child_process 
      ├─ Git 동기화 (fetch/checkout/pull)
      ├─ UE AutomationTool 구동 (BuildProject.bat)
[SQLite DB (build_history.db)]
```

---

## ⚙️ 설치 및 실행 방법

> 상세한 단계별 환경 구성 및 폴더 배치 관련 가이드는 [`md/UE_Web_Builder_Setup_Guide.md`](md/UE_Web_Builder_Setup_Guide.md) 문서를 참고하십시오.
> 안드로이드 패키징 트러블슈팅(권한, 루프백)은 [`md/build/Android_Build_Troubleshooting_Guide.md`](md/build/Android_Build_Troubleshooting_Guide.md)를 확인하세요.

### 1. 전제 조건
- Node.js v18 이상 설치 (v22 권장)
- Git 설치 (환경변수 등록 완료)
- 대상 머신에 Unreal Engine 5 및 타겟 프로젝트(.uproject) 세팅 완료

### 2. 패키지 설치
백엔드와 프론트엔드 폴더 각각에서 의존성을 설치합니다.
```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

### 3. 백엔드 구성 및 실행
`backend/index.js` 상단의 `BAT_SCRIPT_PATH` 상수가 언리얼 프로젝트 저장소의 `BuildProject.bat`를 올바르게 가리키는지 확인합니다.
```bash
cd backend
node index.js
# 정상 작동 시: "Build Server running on http://localhost:3001" 출력
```

### 4. 프론트엔드 실행
다른 터미널 창을 열고 프론트엔드 개발 서버를 기동합니다.
```bash
cd frontend
npm run dev
# 외부망(로컬망 내 다른 PC) 접속을 허용하려면 vite.config.ts에 `host: '0.0.0.0'`이 설정되어 있어야 합니다.
```

브라우저에서 `http://localhost:5173` 으로 접속하여 빌드 데시보드를 확인합니다.

---

## 📜 라이선스 및 크레딧
이 리포지토리의 소스 코드는 사내 CI/CD 및 언리얼 빌드 자동화를 위해 작성되었습니다.
무단 배포 및 상업적 라이선스 규정은 소유자(dxerr)의 정책을 따릅니다.
