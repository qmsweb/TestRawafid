# Generates clean /details/CODE/ID pages from course data files.
# Rerun after editing any assets/data/*.json.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $root 'assets\data'
$dest = Join-Path $root 'details'

if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$count = 0
Get-ChildItem "$dataDir\*.json" |
    Where-Object { $_.Name -notin @('materials.json', 'library.json', 'one.json', 'test.json') } |
    ForEach-Object {
        $code = $_.BaseName
        $j = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($item in @($j.items)) {
            $id = [string]$item.id
            if ([string]::IsNullOrWhiteSpace($id)) { $id = [string]$item.'time-ms' }
            if ([string]::IsNullOrWhiteSpace($id)) { continue }

            $title = $item.title
            if ([string]::IsNullOrWhiteSpace($title)) { $title = "$code - $id" }
            $title = $title -replace '"', '\"'

            $dir = Join-Path $dest $code
            New-Item -ItemType Directory -Path $dir -Force | Out-Null

            $front = "---`r`nlayout: details`r`ncode: `"$code`"`r`nitem_id: `"$id`"`r`ntitle: `"$title`"`r`npermalink: /details/$code/$id`r`n---`r`n"
            [System.IO.File]::WriteAllText((Join-Path $dir "$id.md"), $front, (New-Object System.Text.UTF8Encoding $false))
            $count++
        }
    }

Write-Output "Generated $count details pages."
