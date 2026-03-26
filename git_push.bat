@echo off
cd /d F:\wz\UE_CICD\UE_Web_Builder
echo === Adding all changes ===
git add -A
echo.
echo === Status ===
git status --short
echo.
echo === Committing ===
git commit -m "feat: Clean Build / Clear Cache options + dynamic build steps" -m "- Add cleanBuild toggle (blue) - passes -clean flag to UAT BuildCookRun" -m "- Add clearCache toggle (red) - deletes Intermediate/Saved/Binaries/XmlConfigCache.bin" -m "- Clear Cache confirmation modal with deletion target list" -m "- Dynamic build step system (5 or 6 steps based on clearCache)" -m "- Clear Cache step shown in red in System Status stepper" -m "- Backend getBuildSteps() for dynamic step calculation" -m "- BuildProject.bat accepts optional -clean 3rd argument" -m "- restart_backend.bat utility (port-based kill + restart)" -m "- Updated Analysis.md and Setup Guide with new features"
echo.
echo === Pushing to origin/main ===
git push origin main
echo.
echo === Done ===
pause
