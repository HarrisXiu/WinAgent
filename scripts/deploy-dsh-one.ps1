param(
  [string]$Destination = 'C:\Users\53031\Desktop\dsh-one'
)
$ErrorActionPreference = 'Stop'
$dshSourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\dsh-one'))
$dshTargetRoot = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $dshTargetRoot -PathType Container)) {
  throw "目标 dsh-one 目录不存在：$dshTargetRoot"
}
$dshManifest = Get-Content -LiteralPath (Join-Path $dshSourceRoot 'plugins.json') -Raw | ConvertFrom-Json
$dshCopied = 0
foreach ($dshPackage in $dshManifest) {
  if ($dshPackage.package -notmatch '^dsh-winagent-[a-z]+[a-z0-9]*$') { throw '非法插件目录名' }
  $dshPackageSource = [IO.Path]::GetFullPath((Join-Path $dshSourceRoot $dshPackage.package))
  $dshPackageTarget = [IO.Path]::GetFullPath((Join-Path $dshTargetRoot $dshPackage.package))
  if (-not $dshPackageSource.StartsWith($dshSourceRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
      -not $dshPackageTarget.StartsWith($dshTargetRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw '插件路径超出预期目录'
  }
  if (Test-Path -LiteralPath $dshPackageTarget) {
    $dshPreviousManifest = Join-Path $dshPackageTarget 'MIGRATION.json'
    if (-not (Test-Path -LiteralPath $dshPreviousManifest)) { throw "保留已有未知目录：$dshPackageTarget" }
    if ((Get-Content -LiteralPath $dshPreviousManifest -Raw | ConvertFrom-Json).package -ne $dshPackage.package) {
      throw "已有目录的来源不一致：$dshPackageTarget"
    }
  }
  foreach ($dshSourceFile in Get-ChildItem -LiteralPath $dshPackageSource -Recurse -Force -File) {
    $dshRelative = [IO.Path]::GetRelativePath($dshPackageSource, $dshSourceFile.FullName)
    if ($dshRelative -match '(^|[\\/])(node_modules|__pycache__)([\\/]|$)' -or $dshRelative -match '\.(pyc|tgz)$') { continue }
    $dshOutputFile = [IO.Path]::GetFullPath((Join-Path $dshPackageTarget $dshRelative))
    if (-not $dshOutputFile.StartsWith($dshPackageTarget + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '文件路径超出插件目录' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dshOutputFile)) | Out-Null
    Copy-Item -LiteralPath $dshSourceFile.FullName -Destination $dshOutputFile -Force
    if ((Get-FileHash -LiteralPath $dshSourceFile.FullName).Hash -ne (Get-FileHash -LiteralPath $dshOutputFile).Hash) {
      throw "交付文件校验失败：$dshOutputFile"
    }
    $dshCopied++
  }
  Write-Output "已交付 $($dshPackage.package)"
}
foreach ($dshDocument in @('plugins.json', 'WinAgent-插件分类说明.md', 'WinAgent-插件验证记录.md', 'WinAgent-插件配置示例.md')) {
  $dshDocumentSource = Join-Path $dshSourceRoot $dshDocument
  if (Test-Path -LiteralPath $dshDocumentSource) { Copy-Item -LiteralPath $dshDocumentSource -Destination (Join-Path $dshTargetRoot $dshDocument) -Force }
}
Write-Output "交付完成：$($dshManifest.Count) 个插件，$dshCopied 个文件。已有 dsh-plugin-finder 与其他目录未修改。"
