# Generates clean /exam/CODE pages from the online YAML files.
# Rerun after adding/removing any assets/online/*.yaml.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$onlineDir = Join-Path $root 'assets\online'
$dest = Join-Path $root 'exam'

if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$count = 0
Get-ChildItem "$onlineDir\*.yaml" | ForEach-Object {
    $code = $_.BaseName
    $dir = Join-Path $dest $code
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    $front = "---`r`nlayout: exam`r`nexam_code: `"$code`"`r`ntitle: `"Exam $code`"`r`npermalink: /exam/$code`r`n---`r`n"
    [System.IO.File]::WriteAllText((Join-Path $dir "index.md"), $front, (New-Object System.Text.UTF8Encoding $false))
    $count++
}

Write-Output "Generated $count exam pages."
