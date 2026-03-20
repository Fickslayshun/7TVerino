param(
	[string]$SourceDir = "dist",
	[string]$PackageName = "7tverino",
	[string]$StageDirName = $PackageName
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDir = Join-Path $repoRoot $SourceDir
$releaseDir = Join-Path $repoRoot "release-builds"

if (-not (Test-Path $distDir)) {
	throw "Build directory '$SourceDir' not found. Run the matching build command first."
}

$stageDir = Join-Path $releaseDir $stageDirName
$zipPath = Join-Path $releaseDir "$PackageName.zip"

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (Test-Path $stageDir) {
	Remove-Item -Recurse -Force $stageDir
}

if (Test-Path $zipPath) {
	Remove-Item -Force $zipPath
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item -Path (Join-Path $distDir "*") -Destination $stageDir -Recurse -Force

# Keep a single top-level folder in the archive so extraction produces a clear loadable directory.
Compress-Archive -Path $stageDir -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output "Created $zipPath"
