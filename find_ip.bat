@echo off
echo --- AppData BuildConfiguration.xml ---
type "%APPDATA%\Unreal Engine\UnrealBuildTool\BuildConfiguration.xml"
echo.
echo --- Searching Workspace ---
findstr /S /I /M "10.37.0.216" F:\wz\UE_CICD\*.xml F:\wz\UE_CICD\*.ini F:\wz\UE_CICD\*.bat F:\wz\UE_CICD\*.cs F:\wz\UE_CICD\*.json 2>nul
exit /b 0
