@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ==============================================================================
:: Generic Build Orchestrator (project-agnostic template)
:: Web Builder 백엔드가 프로젝트 폴더에 전용 BuildProject.bat이 없을 때 사용하는
:: 공용 템플릿. PROJECT_DIR/ENGINE_DIR는 백엔드가 환경변수로 주입하며
:: PROJECT_NAME은 PROJECT_DIR 내 *.uproject 로 자동 탐지한다.
:: ==============================================================================

:: Project directory setup
if "%PROJECT_DIR_OVERRIDE%"=="" (
    set "PROJECT_DIR=%~dp0"
) else (
    set "PROJECT_DIR=%PROJECT_DIR_OVERRIDE%"
)
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

:: Engine directory setup
if "%ENGINE_DIR_OVERRIDE%"=="" (
    echo [ERROR] ENGINE_DIR_OVERRIDE is not set. Set Engine Directory Path in the UI.
    exit /b 1
) else (
    set "ENGINE_DIR=%ENGINE_DIR_OVERRIDE%"
)
set "UAT_BAT=%ENGINE_DIR%\Engine\Build\BatchFiles\RunUAT.bat"

:: Project info — %PROJECT_DIR% 내 .uproject 자동 탐지 (프로젝트명 하드코딩 제거)
set "PROJECT_NAME="
for %%F in ("%PROJECT_DIR%\*.uproject") do set "PROJECT_NAME=%%~nF"
if "%PROJECT_NAME%"=="" (
    echo [ERROR] No .uproject found in "%PROJECT_DIR%"
    exit /b 1
)
set "PROJECT_FILE=%PROJECT_DIR%\%PROJECT_NAME%.uproject"
set "ARCHIVE_DIR=%PROJECT_DIR%\Saved\Builds"

:: Validate input parameters
if "%~1"=="" goto Usage
if "%~2"=="" goto Usage

set "TARGET_PLATFORM=%~1"
set "TARGET_CONFIG=%~2"

:: Check for optional flags (3rd arg onwards)
set "CLEAN_FLAG="
set "COOK_CLEAN_FLAG="

for %%A in (%3 %4 %5) do (
    if /i "%%A"=="-clean"      set "CLEAN_FLAG=-clean"
    if /i "%%A"=="-cookclean"  set "COOK_CLEAN_FLAG=1"
)

echo =======================================================
echo [Manual Build Started]
echo Project:  %PROJECT_NAME%
echo Platform: %TARGET_PLATFORM%
echo Config:   %TARGET_CONFIG%
echo Output:   %ARCHIVE_DIR%\%TARGET_PLATFORM%\%TARGET_CONFIG%
if not "%CLEAN_FLAG%"==""      echo Options:  CLEAN BUILD (full rebuild including C++)
if not "%COOK_CLEAN_FLAG%"=="" echo Options:  COOK CLEAN (shader + asset recook only, skip C++ build)
echo =======================================================

:: ──────────────────────────────────────────────────────────────────────────────
:: Dedicated Server Build (Win64Server)
:: UAT BuildCookRun 서버 모드 — 컴파일 + Cook(Win64) + Stage + Archive
:: 서버도 Cooked 에셋이 필요하므로 반드시 Cook 단계를 포함해야 함
:: ──────────────────────────────────────────────────────────────────────────────
if /i "%TARGET_PLATFORM%"=="Win64Server" (
    echo [DedicatedServer] BuildCookRun Server mode ^(Cook + Stage + Archive^)...

    if not "%COOK_CLEAN_FLAG%"=="" (
        call "%UAT_BAT%" BuildCookRun ^
            -project="%PROJECT_FILE%" ^
            -noP4 ^
            -serverconfig="%TARGET_CONFIG%" ^
            -utf8output ^
            -server -serverplatform=Win64 -noclient ^
            -nocompileeditor -skipbuildeditor -nocompile ^
            -cook -stage -archive -pak -iostore ^
            -clearcookeddata ^
            -UBA ^
            -archivedirectory="%ARCHIVE_DIR%\Win64Server\%TARGET_CONFIG%" %EXTRA_UAT_ARGS%
    ) else (
        call "%UAT_BAT%" BuildCookRun ^
            -project="%PROJECT_FILE%" ^
            -noP4 ^
            -serverconfig="%TARGET_CONFIG%" ^
            -utf8output ^
            -server -serverplatform=Win64 -noclient ^
            -build -cook -stage -archive -pak -iostore ^
            -UBA %CLEAN_FLAG% ^
            -archivedirectory="%ARCHIVE_DIR%\Win64Server\%TARGET_CONFIG%" %EXTRA_UAT_ARGS%
    )

    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [ERROR] Dedicated Server build failed. Check logs for details.
        exit /b !ERRORLEVEL!
    )

    echo.
    echo [SUCCESS] Dedicated Server build complete^^!
    echo Output: "%ARCHIVE_DIR%\Win64Server\%TARGET_CONFIG%"
    exit /b 0
)

:: ──────────────────────────────────────────────────────────────────────────────
:: Standard Client Build (Win64 / Android / IOS)
:: ──────────────────────────────────────────────────────────────────────────────

:: Run UAT BuildCookRun
:: -cookclean mode: skip C++ compilation entirely, force full recook of shaders and assets
if not "%COOK_CLEAN_FLAG%"=="" (
    call "%UAT_BAT%" BuildCookRun ^
        -project="%PROJECT_FILE%" ^
        -noP4 ^
        -clientconfig="%TARGET_CONFIG%" ^
        -serverconfig="%TARGET_CONFIG%" ^
        -utf8output ^
        -platform="%TARGET_PLATFORM%" ^
        -nocompileeditor -skipbuildeditor -nocompile ^
        -cook -stage -package -archive -pak -iostore ^
        -clearcookeddata ^
        -UBA ^
        -archivedirectory="%ARCHIVE_DIR%\%TARGET_PLATFORM%\%TARGET_CONFIG%" %EXTRA_UAT_ARGS%
) else (
    call "%UAT_BAT%" BuildCookRun ^
        -project="%PROJECT_FILE%" ^
        -noP4 ^
        -clientconfig="%TARGET_CONFIG%" ^
        -serverconfig="%TARGET_CONFIG%" ^
        -utf8output ^
        -platform="%TARGET_PLATFORM%" ^
        -build -cook -stage -package -archive -pak -iostore ^
        -UBA %CLEAN_FLAG% ^
        -archivedirectory="%ARCHIVE_DIR%\%TARGET_PLATFORM%\%TARGET_CONFIG%" %EXTRA_UAT_ARGS%
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed. Check logs for details.
    exit /b %ERRORLEVEL%
)

echo.
echo [SUCCESS] Build and packaging complete!
echo Output: "%ARCHIVE_DIR%\%TARGET_PLATFORM%\%TARGET_CONFIG%"
exit /b 0

:Usage
echo.
echo [Usage]
echo BuildProject.bat ^<Platform^> ^<Configuration^>
echo.
echo Platform: Win64, Android, IOS, Win64Server
echo Configuration: Development, Debug, Test, Shipping
echo.
echo Example:
echo   BuildProject.bat Win64 Development
echo   BuildProject.bat Android Shipping
echo.
exit /b 1
