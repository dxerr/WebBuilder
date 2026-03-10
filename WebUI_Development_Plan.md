# 언리얼 빌드 제어용 웹 포털 기획 및 개발 계획서 (Web Builder Portal)

## 1. 개요
*   **목적:** GitHub 자동 빌드(Webhook)의 비효율성을 피하고, 사용자가 시각적으로 편리하게 폼을 선택한 후 클릭 한 번으로 엔진 빌드를 구동할 수 있는 단독 사내 웹 포털 사이트.
*   **경로:** `F:\wz\UE_CICD\UE_Web_Builder`

## 2. 기술 스택 (Tech Stack)
아름답고 생동감 넘치는 반응형 UI(React)와, 터미널 명령을 로컬 환경에서 실행할 수 있는 백엔드 서빙(Node.js)을 분리 혹은 결합하여 개발합니다.

1.  **프론트엔드 (Frontend):** React (Vite 프레임워크 사용)
    *   **스타일링:** Glassmorphism(투명도, 블러 효과), Smooth Gradients, Dark Theme가 적용된 모던 Vanilla CSS. 프리미엄 느낌의 고급스러운 미적 효과 우선.
    *   **애니메이션:** 유저 상호작용(호버, 클릭)에 부드럽고 매끄럽게 반응하는 마이크로 애니메이션.
2.  **백엔드 (Backend):** Node.js (Express)
    *   보안(CORS) 및 스크립트 실행의 안정성을 확보하기 위한 미들웨어.
    *   사용자의 UI 요청(Payload: Platform, Configuration)을 수신하여 `BuildProject.bat`를 스폰(Spawn)하거나 Horde REST API를 호출하는 역할을 담당합니다.

## 3. 핵심 기능 (Features)
1.  **Dashboard (대시보드)**
    *   현재 Horde 서버 및 빌드 시스템 상태 표시 (온라인/오프라인).
2.  **Make a Build (빌드 설정 폼)**
    *   **Target Platform 선택:** Win64, Android, IOS
    *   **Build Configuration 선택:** Development, Debug, Shipping
    *   **Launch Button:** 역동적 이펙트가 포함된 대형 빌드 запуска(시작) 버튼.
3.  **Live Log Terminal (실시간 모니터링 뷰어)**
    *   버튼 클릭 시 UAT 명령어의 로그 출력(stdout)을 웹 소켓 바탕으로 웹 UI 창 내의 검은 터미널 느낌 컴포넌트에 스트리밍. 에러나 성공 여부를 색상과 함께 즉각 감지.
    *   현재 쿠킹 중인지, 패키징 중인지 진행 상태(Progress)를 시각적인 애니메이션 바(Bar)나 스텝퍼(Stepper) 형식으로 매핑하여 표시.
4.  **Analytics & Build History (통계 및 실행 히스토리 탭) [추가됨]**
    *   **로컬 DB 연동**: SQLite 또는 단순 JSON 파일을 백엔드에 두어, 과거의 빌드 실행 이력(시작 시간, 소요 시간, 플랫폼/타겟, 성공/실패 여부)을 영구 저장(Persistence)합니다.
    *   **히스토리 테이블**: 과거 빌드 내역을 리스트업하고 이전 로그를 다시 열어볼 수 있는 테이블 뷰 제공.
    *   **대시보드 통계 차트**: 주간/월간 총 빌드 실행 횟수, 성공률(Success Rate), 플랫폼별 패키징 비율 등을 한눈에 볼 수 있는 Analytics 탭(웹 차트 활용)을 추가하여 성과 파악을 용이하게 합니다.
    UI -->|1. 빌드 인자(Platform, Config) 전송| Backend[Node.js (Express)]
    Backend -->|2. Child Process (bat)| Script[F:\\wz\\UE_CICD\\SampleProject\\BuildProject.bat]
    Script -->|3. 로그 실시간 스트리밍| Backend
    Backend -->|4. WebSocket Push| UI
    Script -->|5. UAT & Horde UBA| Engine[Unreal Cook & Package]
```

## 5. 단계별 구현 계획 (Milestones)
1.  **환경 세팅:** `F:\wz\UE_CICD\UE_Web_Builder` 경로에 `frontend` (Vite)와 `backend` (Express) 폴더 세팅.
2.  **프론트엔드 스캐폴딩 및 디자인:** Glassmorphism 기반의 폼 컨트롤과 프리미엄 랜딩 페이지 마크업.
3.  **백엔드 API 및 터미널 훅(Hook):** Express 서버에서 `child_process.spawn` 을 사용하여 커스텀 bat 파일을 백그라운드에서 트리거하고 stdout/stderr를 잡아내는 API 제작.
4.  **로그 스트리밍 연동:** 백엔드에서 프론트엔드로 로그를 넘겨주는 기능 구현 (가장 직관적인 피드백 제공).
5.  **Naver Works 연동 (옵션):** 빌드가 완료되면 웹 서버가 기존 알림망에 성공/실패 핑을 쏨.
