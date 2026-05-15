# 언리얼 안드로이드 웹 빌드 트러블슈팅 가이드 (Web Builder Android Build Troubleshooting)

이 문서는 웹 빌더(Web UI)를 통해 언리얼 엔진 안드로이드(Android) 프로젝트를 빌드/쿠킹/패키징할 때 발생하는 주요 악성 에러들과 그 해결책을 명확히 기록한 가이드입니다. 향후 동일한 문제가 발생하거나, 다른 작업자가 빌드 환경을 유지보수할 때 반드시 참고해야 합니다.

---

## 🛑 에러 1: Gradle `java.io.IOException: Unable to establish loopback connection`

**에러 증상:**
- 쿠킹까지는 정상적으로 완료되었으나, 마지막 APK 패키징을 위한 Gradle 빌드 단계에서 실패함.
- 로그에 `Unable to establish loopback connection` 워딩과 함께 `To honour the JVM settings for this build a single-use Daemon process will be forked` 등의 메시지가 출력 됨.
- 터미널에서 직접 실행하면 성공하지만, UBT/UAT 파이프라인(빌드 스크립트)을 통해 엮어서 실행하면 항상 실패함.

**원인 분석:**
이 현상은 윈도우 환경 및 최신 JDK(17+)의 네트워크 소켓 바인딩 문제와 언리얼 엔진의 구시대적 코드 주입이 얽히면서 발생합니다.
언리얼 엔진 5의 원본 소스코드인 `UEDeployAndroid.cs` 에는 과거 윈도우 버전의 호환성을 위해 `set _JAVA_OPTIONS=-Djava.nio.channels.spi.SelectorProvider=sun.nio.ch.WindowsSelectorProvider` 라는 코드가 하드코딩 되어있습니다.
하지만 이 낡은 커스텀 멀티플렉서(SelectorProvider)가 강제 주입되면 최신 JDK 기반의 Gradle 데몬이 시스템의 로컬 루프백(`localhost` 또는 127.0.0.1 / `::1`)과 통신 소켓을 맺지 못하고 죽어버립니다.

**간헐적 실패 특성 (2026-03-25 추가):**
- Gradle 데몬 로그 분석 결과, **모든 빌드에서 loopback 에러가 37~41건씩 발생**하고 있으나, Gradle 내부 재시도 로직 덕분에 대부분의 빌드는 성공함.
- 다만 시스템 자원 부족, 장시간 가동, 또는 네트워크 스택 누적 이슈 등으로 인해 재시도마저 모두 실패하면 빌드가 깨짐.
- **단순 재부팅으로 해결되는 경우가 많음** — Windows의 네트워크 스택(Winsock/소켓 풀)이 초기화되면서 loopback 연결 성공률이 회복됨.
- Gradle 데몬 로그 위치: `C:\Users\<사용자명>\.gradle\daemon\8.7\daemon-*.out.log`

**해결 조치:**

**즉시 해결 (간헐적 실패 시):**
- **PC 재부팅**으로 Windows 네트워크 스택을 초기화하면 대부분 해결됨.
- Gradle 캐시 정리: `C:\Users\<사용자명>\.gradle\daemon\` 폴더 내 오래된 로그 파일 정리.

**영구 해결 (엔진 패치):**
임시방편이 아닌 엔진 단에서의 패치를 통해 영구 해결해야 합니다.
1. **엔진 소스코드 수정**:
   - `[엔진 설치 경로]\Engine\Source\Programs\UnrealBuildTool\Platform\Android\UEDeployAndroid.cs` 파일을 오픈합니다.
   - `WindowsSelectorProvider`로 검색하여, 해당 옵션을 주입하는 두 줄(`_JAVA_OPTIONS` 및 `.jvmargs`)을 완전히 삭제하거나 빈 문자열로 교체합니다. 최신 자바가 OS 기본 네트워크 모델을 스스로 선택하게 놔둬야 합니다.
   - (참고: `-Djava.net.preferIPv4Stack=true` 같은 우회 코드도 윈도우 `hosts` 파일 설정에 따라 예외를 만드므로 아예 없애는 것이 가장 안전합니다.)
2. **UBT 재컴파일**:
   - 터미널(CMD/PowerShell)을 열고 구동합니다:
   - `F:\wz\UE_CICD\UnrealEngine\UnrealEngine\Engine\Binaries\ThirdParty\DotNet\8.0.412\win-x64\dotnet.exe build F:\wz\UE_CICD\UnrealEngine\UnrealEngine\Engine\Source\Programs\UnrealBuildTool\UnrealBuildTool.csproj -c Development` (엔진 경로에 맞게 실행)
3. **Node.js 파이프라인 (Web Builder) 환경 변수 강제 주입**:
   - `UEDeployAndroid.cs`에서 옵션을 지웠더라도 백그라운드 노드 환경의 네트워크 제한/특성 때문에 Gradle 데몬이 IPv6 루프백 소켓 바인딩을 실패할 수 있습니다.
   - `[프로젝트 경로]\UE_Web_Builder\backend\index.js` 내의 서브프로세스(`spawn`) 호출 시 강제로 `_JAVA_OPTIONS: '-Djava.net.preferIPv4Stack=true'` 환경 변수를 주입해서 데몬이 IPv4 통신을 사용하도록 유도합니다.
4. **캐시 비우기**:
   - 찌꺼기 파일이 문제를 유지시킬 수 있으므로 `[프로젝트 경로]\Intermediate\Android\arm64\gradle` 폴더를 통째로 삭제한 후 다시 빌드합니다.

---

## 🛑 에러 2: `LogUbaController: Error: UbaStorageServer - ERROR opening file \??\F: for read (Access is denied.)`

**에러 증상:**
- 안드로이드 빌드의 **쿠킹(Cook)** 단계 중간, 혹은 패키징 명령 돌입 직전에 `Access is denied` 메시지를 띄우며 UAT(AutomationTool)가 ExitCode 25 로 뻗어버림.

**원인 분석:**
이 문제는 UBA(Unreal Build Accelerator)가 로컬 환경의 로컬 디스크 파티션(F: 드라이브 등)을 직접적으로 후킹(Hooking)하여 파일 입출력을 통제하려다 윈도우의 보안 권한 문제와 엉키면서 접근 권한(Access Denied) 거부를 당하는 치명적인 버그입니다.
일반적인 네트워크 분산 빌도 환경이 아닌 단일 머신 빌드에서는 불안정성만 가중시킵니다.

**해결 조치:**
쿠킹 과정 전체에서 UBA가 개입하지 못하도록 강제 무력화해야 합니다.
1. 빌드를 실행하는 파이프라인 뼈대(`BuildProject.bat` 또는 BuildGraph XML)를 찾습니다.
2. `BuildCookRun` 명령의 파라미터 대열에 **`-NoUBA -NoXGE`** 두 개의 플래그를 추가합니다.
   - 예시: `RunUAT.bat BuildCookRun -project=... -build -cook -stage -archive -NoUBA -NoXGE`

---

## 🛑 에러 3: `ARCHIVE FAILED - ... main.1.com.YourCompany.ExFrameWork.obb was not found`

**에러 증상:**
- 빌드, 쿠킹, 패키징 (Gradle APK 생성)까지 모든 과정이 퍼펙트하게 성공함.
- 그러나 가장 마지막에 `Saved\Builds\Android\...` 경로로 배포물을 복사하는 **아카이브(Archive)** 단계에서 OBB 파일(데이터 파일)을 복사할 수 없다며 빌드가 실패 처리됨.

**원인 분석:**
언리얼 안드로이드 프로젝트는 기본적으로 Google Play Store의 용량 제한 정책 등을 고려하여 구동 파일(APK)과 애셋 데이터 파일(OBB)을 분할해서 빌드하려 합니다.
하지만 단순 테스트나 자동화 배포, Web UI 연동 단계에서는 분할이 귀찮고, 가끔 OBB 파일 이름이 꼬이거나 생성이 스킵되면서 위 스크립트 에러를 유발합니다. OBB 분할 구조는 스토어 릴리즈용으로 세팅할 때만 다룹니다.

**해결 조치:**
APK 하나에 모든 소스, 에셋 패키지를 함께 내장(Bundle)하여 단일 APK 뷰로 산출해버리면 아카이브 에러가 발생하지 않고 설치도 간편해집니다.
1. `[프로젝트 경로]\Config\DefaultEngine.ini` 파일을 오픈합니다.
2. `[/Script/AndroidRuntimeSettings.AndroidRuntimeSettings]` 섹션을 찾습니다.
3. 해당 섹션에 **`bPackageDataInsideApk=True`** 항목을 추가하고 저장합니다.
4. 이제부터 결과물은 1.5GB가 넘더라도 문제 하나 없는 튼튼한 단일 `.apk` 로 도출됩니다. OBB 아카이브를 찾지 않으므로 에러도 즉각 해결됩니다.

---

## 🛑 에러 4: OpenGL ES 3.1 셰이더 컴파일 무한 루프 (Sampler 초과)

> **추가일: 2026-03-25**

**에러 증상:**
- 안드로이드 빌드의 **쿠킹(Cook)** 단계에서 셰이더 컴파일이 끝나지 않고 무한히 지속됨.
- `UbaController` 로그에 `Task Status -- Queued: 0 -- Active: 2 local` 등의 메시지가 계속 반복 출력되며 진행이 멈춤.
- 로그에 다음과 같은 경고/에러가 나타남:
  ```
  shader uses 22 samplers exceeding the limit of 16
  shader uses 23 samplers exceeding the limit of 16
  Failed to compile Material M_MetaHumanSkin_Simplified for platform GLSL_ES3_1_ANDROID
  Missing cached shadermap for MI_HeadSynthesized_Simplified_LOD1 in OPENGL_ES3_1_ANDROID
  ```
- `Missing cached shadermap` 메시지가 여러 머티리얼(MetaHuman 스킨, Paragon 캐릭터 등)에 대해 Low/Medium/High 등 다양한 Quality Level별로 반복 출력됨.

**원인 분석:**
MetaHuman, Paragon 등 데스크톱 PC용으로 설계된 복잡한 머티리얼이 OpenGL ES 3.1 타겟으로 셰이더를 컴파일할 때 **텍스처 sampler 한도(16개)를 초과**(22~23개 사용)하여 컴파일에 실패합니다. 쿠커는 실패한 머티리얼의 다양한 permutation(LOD별, Scalability Quality별)을 계속 시도하면서 사실상 무한 루프에 빠집니다.

이 문제는 `DefaultEngine.ini`에서 `bBuildForES31=True`와 `bBuildForVulkan=True`가 동시에 활성화되어 있을 때, **Vulkan과 OpenGL ES 3.1 양쪽 모두에 대해 셰이더를 컴파일**하면서 발생합니다. Vulkan은 sampler 한도가 128개 이상이라 문제없지만, OpenGL ES 3.1은 16개 제한에 걸립니다.

**관련 설정 충돌:**
- `Config\DefaultEngine.ini` → `bBuildForES31=True` (문제의 원인)
- `Config\Android\AndroidEngine.ini` → `bBuildForES31=False` (오버라이드 의도였으나 적용되지 않음)
- Android 플랫폼 전용 ini 오버라이드(`Config\Android\AndroidEngine.ini`)에서 `bBuildForES31=False`로 설정해도, `DefaultEngine.ini`의 값이 우선 적용되는 경우가 있음.

**해결 조치:**
1. **`Config\DefaultEngine.ini`에서 직접 수정** (가장 확실):
   ```ini
   [/Script/AndroidRuntimeSettings.AndroidRuntimeSettings]
   bBuildForES31=False
   bBuildForVulkan=True
   ```
   - `bBuildForES31=True` → `False`로 변경하면, Vulkan 전용으로 셰이더를 컴파일하여 sampler 한도 문제가 해결됨.
   - 최신 안드로이드 기기의 대부분은 Vulkan을 지원하므로, ES3.1을 비활성화해도 호환성 문제가 거의 없음.

2. **쿠킹 캐시 초기화**:
   - 셰이더 컴파일 캐시가 오염될 수 있으므로, 설정 변경 후 다음 폴더들을 삭제하고 재빌드:
     - `Saved\Cooked\Android\`
     - `Intermediate\` (필요 시)
     - `Saved\Shaders\` (셰이더 디버그 정보)

3. **(선택) 불필요한 콘텐츠 제외**:
   - 모바일 빌드에서 MetaHuman(Kellan)이나 Paragon 캐릭터(TwinBlast, Shinbi)를 사용하지 않는다면, `DefaultGame.ini`의 패키징 설정에서 해당 콘텐츠 디렉토리를 제외하면 빌드 시간도 크게 단축됨.

**확인 방법:**
빌드 로그에서 다음을 확인하여 ES3.1이 비활성화되었는지 검증:
- `bBuildForES31: false` 로그 출력 확인
- 셰이더 라이브러리에 `GLSL_ES3_1_ANDROID` 관련 항목이 없어야 정상
- `SF_VULKAN_ES31_ANDROID` 셰이더 라이브러리만 생성되면 정상
