$content = Get-Content "F:\wz\UE_CICD\UnrealEngine\UnrealEngine\Engine\Programs\AutomationTool\Saved\Logs\UBA-ExFrameWorkEditor-Win64-Development_2.txt"
$content | Select-String -Pattern "Result:|error C|error:|FAILED|fatal error|cannot find|undefined reference|unresolved external" | Select-Object -Last 30 | ForEach-Object { $_.ToString() }
