@echo off
cd /d F:\wz\UE_CICD\UE_Web_Builder
echo === Git Status ===
git status --short
echo.
echo === Untracked/Modified Files ===
git status --porcelain
