$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $nodePath = $bundledNode } else { throw '请安装 Node.js 24 或更新版本后重试。' }
} else { $nodePath = $nodeCommand.Source }
& $nodePath 'server/index.js'
