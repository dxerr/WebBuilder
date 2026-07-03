$paths = @(
  "F:\wz\UE_CICD\SampleProject\Config\UnrealBuildTool\BuildConfiguration.xml",
  "F:\wz\UE_CICD\SampleProject\BuildProject.bat",
  "$env:APPDATA\Unreal Engine\UnrealBuildTool\BuildConfiguration.xml",
  "$env:USERPROFILE\Documents\Unreal Engine\UnrealBuildTool\BuildConfiguration.xml",
  "F:\wz\UE_CICD\UnrealEngine\UnrealEngine\Engine\Saved\UnrealBuildTool\BuildConfiguration.xml",
  "F:\wz\UE_CICD\UnrealEngine\UnrealEngine\Engine\Programs\UnrealBuildTool\BuildConfiguration.xml"
)
foreach ($p in $paths) {
  if (Test-Path $p) {
    Write-Host "--- Found file: $p ---"
    Get-Content $p | Select-String "10.37.0.216" | ForEach-Object { Write-Host $_.Line.Trim() }
  } else {
    Write-Host "--- File not found: $p ---"
  }
}
Write-Host "--- Environment Variables ---"
Get-ChildItem Env: | Where-Object { $_.Value -match "10.37.0.216" } | ForEach-Object { Write-Host "$($_.Name) = $($_.Value)" }
