<#
.SYNOPSIS
    Installe PhotoScan3D et sa chaine de calcul (COLMAP + OpenMVS) sous Windows.

.DESCRIPTION
    Cree un environnement Python isole, telecharge les binaires Windows sans
    CUDA de COLMAP et d'OpenMVS depuis leurs pages de publication GitHub, puis
    enregistre leur emplacement dans la configuration de l'application.

    A lancer depuis le dossier du projet :
        powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
#>

[CmdletBinding()]
param(
    [string] $ToolsDir = "$env:LOCALAPPDATA\PhotoScan3D\tools"
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Write-Warn($message) { Write-Host "   $message" -ForegroundColor Yellow }

function Get-ReleaseAsset {
    param([string] $Repository, [string] $Pattern)

    $uri = "https://api.github.com/repos/$Repository/releases/latest"
    $release = Invoke-RestMethod -Uri $uri -Headers @{ 'User-Agent' = 'PhotoScan3D' }
    $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
    if (-not $asset) {
        throw "Aucun fichier correspondant a '$Pattern' dans la derniere version de $Repository. Telechargez-le manuellement depuis https://github.com/$Repository/releases"
    }
    return $asset
}

function Expand-Downloaded {
    param([string] $Archive, [string] $Destination)

    if ($Archive.ToLower().EndsWith('.zip')) {
        Expand-Archive -Path $Archive -DestinationPath $Destination -Force
        return
    }

    $sevenZip = (Get-Command 7z.exe -ErrorAction SilentlyContinue).Source
    if (-not $sevenZip) {
        $candidate = "$env:ProgramFiles\7-Zip\7z.exe"
        if (Test-Path $candidate) { $sevenZip = $candidate }
    }
    if (-not $sevenZip) {
        throw "L'archive $Archive est au format 7z et 7-Zip n'est pas installe. Installez 7-Zip (https://www.7-zip.org) puis relancez ce script."
    }
    & $sevenZip x $Archive "-o$Destination" -y | Out-Null
}

function Install-Tool {
    param([string] $Name, [string] $Repository, [string] $Pattern, [string] $Probe)

    $target = Join-Path $ToolsDir $Name
    $existing = Get-ChildItem -Path $target -Filter $Probe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($existing) {
        Write-Host "   deja installe : $($existing.FullName)"
        return $existing.Directory.FullName
    }

    $asset = Get-ReleaseAsset -Repository $Repository -Pattern $Pattern
    $archive = Join-Path $env:TEMP $asset.name
    Write-Host "   telechargement de $($asset.name) ..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive -UseBasicParsing

    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Expand-Downloaded -Archive $archive -Destination $target
    Remove-Item $archive -Force -ErrorAction SilentlyContinue

    $found = Get-ChildItem -Path $target -Filter $Probe -Recurse | Select-Object -First 1
    if (-not $found) { throw "$Probe est introuvable apres extraction dans $target." }
    return $found.Directory.FullName
}

Write-Step 'Verification de Python'
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
if (-not $python) {
    throw 'Python 3.10 ou plus recent est requis : https://www.python.org/downloads/windows/'
}

Write-Step 'Environnement Python isole'
$venv = Join-Path $projectDir '.venv'
if (-not (Test-Path $venv)) { & $python.Source -m venv $venv }
$venvPython = Join-Path $venv 'Scripts\python.exe'
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $projectDir 'requirements.txt') --quiet
Write-Host '   dependances Python installees.'

Write-Step 'COLMAP (version sans CUDA, calcul sur processeur)'
$colmapDir = Install-Tool -Name 'colmap' -Repository 'colmap/colmap' `
    -Pattern 'windows.*no.?cuda.*\.zip$' -Probe 'colmap.exe'
$colmapExe = Join-Path $colmapDir 'colmap.exe'

Write-Step 'OpenMVS (densification, maillage, texture)'
$openmvsDir = Install-Tool -Name 'openmvs' -Repository 'cdcseacave/openMVS' `
    -Pattern 'Windows.*x64.*\.(zip|7z)$' -Probe 'DensifyPointCloud.exe'

Write-Step 'Enregistrement de la configuration'
$configDir = Join-Path $env:APPDATA 'PhotoScan3D'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$configPath = Join-Path $configDir 'settings.json'
# Les reglages existants sont conserves : seuls les chemins d'outils changent.
# ConvertFrom-Json rend un objet, converti ici en table pour rester compatible
# avec le PowerShell 5.1 livre avec Windows.
$settings = @{}
if (Test-Path $configPath) {
    $existing = Get-Content $configPath -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) {
        $settings[$property.Name] = $property.Value
    }
}
$settings['colmap_path'] = $colmapExe
$settings['openmvs_dir'] = $openmvsDir
$settings | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
Write-Host "   $configPath"

Write-Step 'Installation terminee'
Write-Host "COLMAP  : $colmapExe"
Write-Host "OpenMVS : $openmvsDir"
Write-Host "`nLancez l'application avec PhotoScan3D.bat"
