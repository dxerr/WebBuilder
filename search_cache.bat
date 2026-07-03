@echo off
echo -- Checking XmlConfigCache --
findstr /M "10.37.0.216" "F:\wz\UE_CICD\SampleProject\Intermediate\Build\XmlConfigCache.bin"
findstr /M "10.37.0.216" "F:\wz\UE_CICD\Lyra\Intermediate\Build\XmlConfigCache.bin"

echo -- Checking LocalAppData --
findstr /S /I /M "10.37.0.216" "%LOCALAPPDATA%\UnrealBuildAccelerator\*.*" 2>nul
findstr /S /I /M "10.37.0.216" "%LOCALAPPDATA%\Unreal Engine\*.*" 2>nul

echo -- Checking ProgramData --
findstr /S /I /M "10.37.0.216" "%PROGRAMDATA%\Epic\*.*" 2>nul
findstr /S /I /M "10.37.0.216" "%PROGRAMDATA%\Unreal Engine\*.*" 2>nul
