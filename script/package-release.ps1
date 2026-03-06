$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDir = Join-Path $repoRoot "dist"
$releaseDir = Join-Path $repoRoot "release-builds"

if (-not (Test-Path $distDir)) {
	throw "dist directory not found. Run 'yarn build:prod' first."
}

$stageDirName = "7tvfixed"
$packageName = "7tvfixed"
$stageDir = Join-Path $releaseDir $stageDirName
$zipPath = Join-Path $releaseDir "$packageName.zip"

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (Test-Path $stageDir) {
	Remove-Item -Recurse -Force $stageDir
}

Get-ChildItem -Path $releaseDir -Filter "*.zip" -ErrorAction SilentlyContinue | Remove-Item -Force

if (Test-Path $zipPath) {
	Remove-Item -Force $zipPath
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item -Path (Join-Path $distDir "*") -Destination $stageDir -Recurse -Force

Compress-Archive -Path $stageDir -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output "Created $zipPath"
