<#
  Firefox theme installer (Windows 10/11, Windows PowerShell 5.1 or PowerShell 7).

  What it does:
    1. Finds your default Firefox profile (or use -ProfilePath).
    2. Backs up your existing chrome folder (except chrome\utils) to chrome.backup-<date>.
    3. Downloads this repository and copies its chrome\ folder into your profile.
       Your own css\user-overrides.css is kept, never overwritten.
       Also writes chrome\1px-transparent.png (embedded in this script), the default background image
       that SidebarToggles.uc.js uses when no Background image is chosen.
    4. Downloads the fonts the theme uses into chrome\fonts (core + other alphabets + Poppins),
       plus the large CJK font for your language. Poppins is also registered for the current
       Windows user only (no admin needed) because the new tab page loads it by name.
    5. Adds the theme's user.js settings to your user.js inside a marked block (re-run safe).
    6. Deletes files listed in removed-files.txt (old scripts or css you removed from the theme).
    7. Optional (-Blur): downloads DWMBlurGlass 2.3.2 Beta3 (64-bit only) from its official GitHub
       release, checks its SHA256 and unzips it to C:\Program Files\DWMBlurGlass. It is not run and no
       setting is changed; the README explains what to do next.

  Also installs fx-autoconfig's two loader files into Firefox's install folder (config.js and
  defaults\pref\config-prefs.js, from this repo's program\ folder). The theme's .uc.js scripts need
  them. This is the only step that needs administrator permission (Windows asks once). An existing,
  different config.js is saved as config.js.bak-<date> first. Skip with -NoAutoconfig.

  Right AFTER that, config.js is patched (not replaced): any existing
  defaultPref("browser.uiCustomization.state", ...) and defaultPref("uc.background.image", ...) lines are
  replaced with the theme's lines, or inserted right after the first line if there are none. Everything else
  in config.js is left untouched. uc.background.image is set to a file:/// URI built from the profile that
  was chosen (-ProfilePath or the detected default), so no profile name is ever typed by hand.
  Same permission prompt rules as above. Re-run safe.

  Usage:
    irm https://raw.githubusercontent.com/OWNER/REPO/main/install.ps1 | iex

    With options:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/OWNER/REPO/main/install.ps1))) -Blur -Cjk ja

  -Cjk         auto (default: picked from your Windows display language), none, or any of: ja, ko, zh-cn, zh-tw
  -NoFonts     skip all font downloads
  -NoAutoconfig  do not touch Firefox's install folder (the .uc.js scripts will not run)
  -FirefoxDir  Firefox's install folder, if it is not found automatically (default: C:\Program Files\Mozilla Firefox)
  -Blur        also download DWMBlurGlass (64-bit only).   -NoBlur  never ask about it
  -ProfilePath use a specific profile folder instead of the default one
#>
param(
  [string[]]$Cjk = @('auto'),
  [string]$ProfilePath = "",
  [switch]$NoFonts,
  [switch]$NoAutoconfig,
  [string]$FirefoxDir = "",
  [switch]$Blur,
  [switch]$NoBlur
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- EDIT THESE LINES before publishing -------------------------------------
$Repo        = 'veracruze/grandiose'   # your GitHub user name and repository name
$Branch      = 'main'
$FontRelease = 'fonts-v1'     # tag of the GitHub Release that holds ALL the font files listed below

# DWMBlurGlass (only used with -Blur). This one file from the official repository, nothing else.
$DwmUrl    = 'https://github.com/Maplespe/DWMBlurGlass/releases/download/2.3.2b3/DWMBlurGlass.2.3.2_Beta3_x64.zip'
$DwmSha256 = '32834fed77575353cf3699e3a5c182b8d4fcd7f00926c730e94d1a1dd591bd51'   # the download must match this
$DwmDir    = Join-Path $env:ProgramFiles 'DWMBlurGlass'                          # where the files are kept
# -----------------------------------------------------------------------------

# 1x1 fully transparent PNG (68 bytes, RGBA, alpha 0). Written to chrome\1px-transparent.png on every run.
# SidebarToggles.uc.js uses it as the default --uc-bg-image when no background image is chosen.
$TransparentPngName = '1px-transparent.png'
$TransparentPngB64  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='

# The lines this installer manages in Firefox's config.js. Any existing defaultPref for the same prefs is replaced
# with them; if there are none, they are inserted right after line 1 (Firefox's autoconfig parser skips line 1).
# __BG_IMAGE__ is replaced with a file:/// URI of <profile>\chrome\1px-transparent.png once the profile is known.
# Literal here-string: nothing inside is expanded. The closing '@ must stay at the start of its line.
$ConfigJsLine = @'
defaultPref("browser.uiCustomization.state", '{"placements":{"widget-overflow-fixed-list":[],"unified-extensions-area":[],"nav-bar":["unified-extensions-button","sidebar-button","back-button","forward-button","vertical-spacer","urlbar-container","downloads-button","reset-pbm-toolbar-button"],"toolbar-menubar":["menubar-items"],"TabsToolbar":["tabbrowser-tabs","new-tab-button","customizableui-special-spring3","alltabs-button","smartwindow-group-tabs-button","ai-window-toggle"],"vertical-tabs":[],"PersonalToolbar":["personal-bookmarks"]},"seen":["reset-pbm-toolbar-button","smartwindow-group-tabs-button","ai-window-toggle","developer-button","screenshot-button"],"dirtyAreaCache":["nav-bar","TabsToolbar","vertical-tabs","toolbar-menubar","PersonalToolbar"],"currentVersion":28,"newElementCount":4}');
defaultPref("uc.background.image", "__BG_IMAGE__");
'@
# Matches an existing defaultPref line for either managed pref (single line, either quote style, optional semicolon).
$ConfigJsPattern = '^\s*defaultPref\(\s*["'']((browser\.uiCustomization\.state)|(uc\.background\.image))["'']\s*,.*\)\s*;?\s*$'
# Single-line marker: config.js already carrying this means it is ours (no extra config.js.bak-<date> on re-runs).
$ConfigJsMarker  = 'defaultPref("uc.background.image"'

# Fonts. File names must match chrome/css/00-fonts.css and the release assets exactly.
$FontsCore    = @('Nunito-Black.ttf', 'NotoSans-Black.ttf')
$FontsScripts = @('NotoSansHebrew-Black.ttf', 'NotoSansArabic-Black.ttf', 'NotoSansThai-Black.ttf', 'NotoSansDevanagari-Black.ttf')
$FontsNewtab  = @('Poppins-Thin.ttf', 'Poppins-ExtraLight.ttf', 'Poppins-Light.ttf', 'Poppins-Regular.ttf')
$fontFiles    = @{ 'ja' = 'NotoSansJP-Black.ttf'; 'ko' = 'NotoSansKR-Black.ttf'; 'zh-cn' = 'NotoSansSC-Black.ttf'; 'zh-tw' = 'NotoSansTC-Black.ttf' }

function Get-DefaultProfile {
  $root = Join-Path $env:APPDATA 'Mozilla\Firefox'
  $ini  = Join-Path $root 'profiles.ini'
  if (-not (Test-Path $ini)) { throw "Could not find $ini. Start Firefox once so it creates a profile, then run this again." }

  $profiles = @(); $installDefaults = @(); $cur = $null
  foreach ($line in Get-Content $ini) {
    if ($line -match '^\[(.+)\]$') {
      $cur = @{ Section = $Matches[1] }
      if ($cur.Section -like 'Profile*') { $profiles += $cur }
      elseif ($cur.Section -like 'Install*') { $installDefaults += $cur }
    }
    elseif ($cur -and $line -match '^([^=]+)=(.*)$') { $cur[$Matches[1]] = $Matches[2] }
  }
  if ($profiles.Count -eq 0) { throw "No profiles listed in $ini." }

  $chosen = $null
  foreach ($i in $installDefaults) {
    if ($i.Default) { $chosen = $profiles | Where-Object { $_.Path -eq $i.Default } | Select-Object -First 1; if ($chosen) { break } }
  }
  if (-not $chosen) { $chosen = $profiles | Where-Object { $_.Default -eq '1' } | Select-Object -First 1 }
  if (-not $chosen -and $profiles.Count -eq 1) { $chosen = $profiles[0] }
  if (-not $chosen) {
    Write-Host 'Several Firefox profiles found:'
    for ($n = 0; $n -lt $profiles.Count; $n++) { Write-Host ("  [{0}] {1}  ({2})" -f $n, $profiles[$n].Name, $profiles[$n].Path) }
    $pick = [int](Read-Host 'Type the number of the profile to use')
    $chosen = $profiles[$pick]
  }

  $p = $chosen.Path -replace '/', '\'
  if ($chosen.IsRelative -eq '1') { return (Join-Path $root $p) } else { return $p }
}

function Find-FirefoxDir {
  foreach ($root in 'HKLM:\SOFTWARE\Mozilla\Mozilla Firefox', 'HKLM:\SOFTWARE\WOW6432Node\Mozilla\Mozilla Firefox') {
    if (Test-Path $root) {
      $ver = (Get-ItemProperty $root).CurrentVersion
      $dir = (Get-ItemProperty -LiteralPath "$root\$ver\Main" -ErrorAction SilentlyContinue).'Install Directory'
      if ($dir -and (Test-Path (Join-Path $dir 'firefox.exe'))) { return $dir }
    }
  }
  foreach ($d in (Join-Path $env:ProgramFiles 'Mozilla Firefox'), (Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox')) {
    if (Test-Path (Join-Path $d 'firefox.exe')) { return $d }
  }
  return $null
}

# Copies program\ (config.js + defaults\pref\config-prefs.js) into Firefox's install folder. Normal copy first;
# if Windows refuses (Program Files), the same copy is repeated once with an administrator prompt.
# A config.js that already contains the single-line $Marker is not backed up again,
# otherwise every re-run would pile up a config.js.bak-<date> of our own file.
function Install-Autoconfig([string]$SrcProgram, [string]$Dir, [string]$Marker) {
  $copy = {
    param($src, $dst, $marker)
    $cfg = Join-Path $dst 'config.js'
    if ((Test-Path $cfg) -and ((Get-FileHash $cfg).Hash -ne (Get-FileHash (Join-Path $src 'config.js')).Hash) -and
        -not (Select-String -Path $cfg -SimpleMatch $marker -Quiet)) {
      Copy-Item $cfg ($cfg + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force   # keep a config.js that is not ours
    }
    Copy-Item (Join-Path $src '*') $dst -Recurse -Force
  }
  try { & $copy $SrcProgram $Dir $Marker }
  catch {
    Write-Host 'Installing the loader into the Firefox folder (Windows will ask for permission)...'
    $mq  = $Marker.Replace("'", "''")   # in case the marker contains single quotes
    $cmd = "& { $($copy.ToString()) } '$SrcProgram' '$Dir' '$mq'"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-EncodedCommand', $enc
  }
  foreach ($f in 'config.js', 'defaults\pref\config-prefs.js') {
    if (-not (Test-Path (Join-Path $Dir $f))) { throw "$f was not copied into $Dir (permission prompt declined?)." }
  }
}

# Patches <Firefox>\config.js in place. Must run AFTER Install-Autoconfig, which copies fx-autoconfig's stock
# config.js into the same place. Every line matching $Pattern is dropped and $Line (one or more lines) takes the
# place of the first one; with no match, $Line is inserted after line 1. The rest of the file, its line endings
# included, is kept. The result is staged in %TEMP% so the elevated retry only has to do a plain copy.
# Written as UTF-8 without BOM.
function Set-FirefoxConfigJs([string]$Dir, [string]$Line, [string]$Pattern) {
  $target = Join-Path $Dir 'config.js'
  if (-not (Test-Path $target)) { throw "config.js not found in $Dir." }

  $orig  = [IO.File]::ReadAllText($target)
  $nl    = if ($orig -match "`r`n") { "`r`n" } else { "`n" }
  $lines = New-Object 'System.Collections.Generic.List[string]'
  $lines.AddRange([string[]]($orig -split "\r?\n"))
  if ($lines.Count -gt 1 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }   # final newline

  # $Line holds several lines; normalise them to the file's own line ending.
  $newLines = @($Line -split "\r?\n" | Where-Object { $_ -ne '' })
  $block    = $newLines -join $nl

  $out = New-Object 'System.Collections.Generic.List[string]'
  $placed = $false
  foreach ($l in $lines) {
    if ($l -match $Pattern) {
      if (-not $placed) { $out.Add($block); $placed = $true }   # first match is replaced in place, duplicates dropped
      continue
    }
    $out.Add($l)
  }
  if (-not $placed) { $out.Insert([Math]::Min(1, $out.Count), $block) }

  $text = ($out -join $nl) + $nl
  if ($text -ceq $orig) { Write-Host 'config.js already up to date.'; return }

  $stage = Join-Path $env:TEMP ('config-' + [guid]::NewGuid().ToString('N') + '.js')
  [IO.File]::WriteAllText($stage, $text, (New-Object Text.UTF8Encoding($false)))
  try {
    try { Copy-Item $stage $target -Force }
    catch {
      Write-Host 'Updating config.js in the Firefox folder (Windows will ask for permission)...'
      $cmd = "Copy-Item -LiteralPath '$stage' -Destination '$target' -Force"
      $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
      Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-EncodedCommand', $enc
    }
  }
  finally {
    Remove-Item $stage -Force -ErrorAction SilentlyContinue
  }

  # Select-String works line by line, so check every managed line separately.
  foreach ($nlLine in $newLines) {
    if (-not (Select-String -Path $target -SimpleMatch $nlLine -Quiet)) {
      throw "config.js in $Dir was not updated (permission prompt declined?)."
    }
  }
}

# Download to a .part file first so an interrupted download never leaves a broken font behind. One retry.
function Get-File([string]$Url, [string]$Dest) {
  $part = "$Dest.part"
  foreach ($try in 1..2) {
    try {
      Invoke-WebRequest $Url -OutFile $part -UseBasicParsing
      Move-Item $part $Dest -Force
      return $true
    }
    catch { Start-Sleep -Seconds 1 }
  }
  Remove-Item $part -Force -ErrorAction SilentlyContinue
  return $false
}

# Which CJK font to fetch when -Cjk is "auto": by Windows display language (the theme itself follows Firefox's language).
function Get-AutoCjk {
  $ui = (Get-UICulture).Name.ToLower()
  if ($ui -like 'ja*') { return 'ja' }
  if ($ui -like 'ko*') { return 'ko' }
  if ($ui -match '^zh-(tw|hk|mo|hant)') { return 'zh-tw' }
  if ($ui -like 'zh*') { return 'zh-cn' }
  return $null
}

# Per-user font install (Windows 10 1809+, no admin). userContent.css loads Poppins with local("Poppins Thin") etc.,
# so it has to be known to Windows; files in chrome\fonts alone are not enough for the new tab page.
function Install-UserFont([string]$Path) {
  $dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $dst = Join-Path $dir (Split-Path $Path -Leaf)
  Copy-Item $Path $dst -Force
  $key = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
  if (-not (Test-Path $key)) { New-Item -Path $key | Out-Null }   # no -Force: it can wipe an existing key's values
  $label = ([IO.Path]::GetFileNameWithoutExtension($dst) -replace '-', ' ') + ' (TrueType)'
  New-ItemProperty -Path $key -Name $label -Value $dst -PropertyType String -Force | Out-Null
}

# DWMBlurGlass is 64-bit (x64) only: the zip is the x64 build, so 32-bit Windows and Windows on ARM are not supported.
function Test-X64 {
  $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  return ($arch -eq 'AMD64')
}

# Downloads and unpacks DWMBlurGlass. It does not run it and does not change any setting: the README says what to do next.
function Install-DwmBlurGlass {
  if (-not (Test-X64)) { throw 'DWMBlurGlass is 64-bit (x64) only; this PC is not x64 Windows.' }

  # The GUI needs the .NET 9 Desktop Runtime (x64). Try winget; otherwise just tell the user.
  $dotnet = Join-Path $env:ProgramFiles 'dotnet\shared\Microsoft.WindowsDesktop.App\9.*'
  if (-not (Test-Path $dotnet) -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing the .NET 9 Desktop Runtime that DWMBlurGlass needs (Windows may ask for permission)...'
    winget install --id Microsoft.DotNet.DesktopRuntime.9 -e --accept-package-agreements --accept-source-agreements
  }
  $needDotnet = -not (Test-Path $dotnet)

  $tmp2 = Join-Path $env:TEMP ("dwmbg-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $tmp2 | Out-Null
  try {
    $zip = Join-Path $tmp2 'DWMBlurGlass.zip'
    Write-Host 'Downloading DWMBlurGlass 2.3.2 Beta3 (x64) from its official GitHub release...'
    Invoke-WebRequest $DwmUrl -OutFile $zip -UseBasicParsing

    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($DwmSha256 -and $hash -ne $DwmSha256.ToLower()) { throw "Checksum mismatch (got $hash). Not installing." }

    $x = Join-Path $tmp2 'x'
    Expand-Archive $zip -DestinationPath $x

    # Keep the files somewhere permanent. Program Files is what DWMBlurGlass recommends: Windows loads these files
    # into its desktop compositor, so they should not sit in a folder any program can write to.
    try {
      New-Item -ItemType Directory -Path $DwmDir -Force | Out-Null
      Copy-Item (Join-Path $x '*') $DwmDir -Recurse -Force
    }
    catch {
      Write-Host 'Copying to Program Files (Windows will ask for permission)...'
      $cmd = "New-Item -ItemType Directory -Force -Path '$DwmDir' | Out-Null; Copy-Item -Path '$x\*' -Destination '$DwmDir' -Recurse -Force"
      $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
      Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-EncodedCommand', $enc
    }
    $exe = Get-ChildItem $DwmDir -Recurse -Filter 'DWMBlurGlassGUI.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { throw 'The files were not copied (permission prompt declined?).' }
  }
  finally {
    Remove-Item $tmp2 -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  Write-Host "DWMBlurGlass files are in: $($exe.DirectoryName)"
  Write-Host "Run DWMBlurGlassGUI.exe from there, and follow the Transparency section of this theme's README.md for the settings."
  if ($needDotnet) {
    Write-Warning 'The .NET 9 Desktop Runtime (x64) is not installed yet, and DWMBlurGlassGUI.exe will not start without it: https://dotnet.microsoft.com/en-us/download/dotnet/9.0'
  }
}

# ---- checks -------------------------------------------------------------------
if ($PSVersionTable.PSObject.Properties['Platform'] -and $PSVersionTable.Platform -ne 'Win32NT') { throw 'This installer supports Windows 10/11 only.' }

$cjkList = @()
foreach ($c in $Cjk) {
  switch ($c.ToLower()) {
    'none'  { }
    'auto'  { $cjkList += (Get-AutoCjk) }
    default {
      if (-not $fontFiles.ContainsKey($c.ToLower())) { throw "Unknown -Cjk value '$c'. Use: auto, none, ja, ko, zh-cn, zh-tw." }
      $cjkList += $c.ToLower()
    }
  }
}
$cjkList = @($cjkList | Where-Object { $_ } | Select-Object -Unique)

if (Get-Process firefox -ErrorAction SilentlyContinue) {
  Write-Warning 'Firefox is running. Files will be copied anyway; restart Firefox afterwards to apply them.'
}

$profileDir = if ($ProfilePath) { $ProfilePath } else { Get-DefaultProfile }
if (-not (Test-Path $profileDir)) { throw "Profile folder not found: $profileDir" }
Write-Host "Profile: $profileDir"

$chromeDir = Join-Path $profileDir 'chrome'

# Build the file:/// URI of <profile>\chrome\1px-transparent.png from whichever profile was resolved above
# (-ProfilePath or the detected default) and put it into the config.js lines. [Uri] gives forward slashes
# and %-encodes spaces, e.g. file:///C:/Users/me/AppData/Roaming/Mozilla/Firefox/Profiles/abc.test/chrome/1px-transparent.png
$bgPath = [IO.Path]::GetFullPath((Join-Path $chromeDir $TransparentPngName))
$bgUri  = ([Uri]$bgPath).AbsoluteUri
$ConfigJsLine = $ConfigJsLine.Replace('__BG_IMAGE__', $bgUri)
Write-Host "Default background image: $bgUri"

# ---- backup -------------------------------------------------------------------
if (Test-Path $chromeDir) {
  $backup = Join-Path $profileDir ("chrome.backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory $backup | Out-Null
  Get-ChildItem $chromeDir | Where-Object { $_.Name -ne 'utils' } | Copy-Item -Destination $backup -Recurse -Force
  Write-Host "Backed up your existing chrome folder to $backup"
}
else {
  New-Item -ItemType Directory $chromeDir | Out-Null
}

# ---- theme files, user.js -----------------------------------------------------
$tmp = Join-Path $env:TEMP ("fxtheme-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
try {
  Write-Host 'Downloading the theme...'
  $zip = Join-Path $tmp 'theme.zip'
  Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $tmp
  $srcRoot = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
  $srcChrome = Join-Path $srcRoot 'chrome'
  if (-not (Test-Path $srcChrome)) { throw 'The download does not contain a chrome folder. Check $Repo and $Branch at the top of this script.' }

  # Keep the user's own overrides: the repo ships an empty css\user-overrides.css that would otherwise replace theirs.
  $uoPath = Join-Path $chromeDir 'css\user-overrides.css'
  $uoKeep = if (Test-Path $uoPath) { [IO.File]::ReadAllBytes($uoPath) } else { $null }
  Copy-Item (Join-Path $srcChrome '*') $chromeDir -Recurse -Force
  if ($uoKeep) { [IO.File]::WriteAllBytes($uoPath, $uoKeep); Write-Host 'Kept your css\user-overrides.css.' }
  Write-Host 'Theme files copied.'

  # chrome\1px-transparent.png: default background image for SidebarToggles.uc.js. Written after the copy above, so the
  # embedded bytes always win even if the repo also ships a file with this name.
  [IO.File]::WriteAllBytes((Join-Path $chromeDir $TransparentPngName), [Convert]::FromBase64String($TransparentPngB64))
  Write-Host "Installed chrome\$TransparentPngName."

  # Files you delete or rename in the repo stay in users' profiles unless they are deleted here. A leftover .uc.js
  # keeps running. List such files (paths inside chrome/, one per line, # for comments) in removed-files.txt at the repo root.
  $removedList = Join-Path $srcRoot 'removed-files.txt'
  if (Test-Path $removedList) {
    foreach ($line in Get-Content $removedList) {
      $rel = $line.Trim()
      if (-not $rel -or $rel.StartsWith('#')) { continue }
      if ([IO.Path]::IsPathRooted($rel) -or $rel -match '(^|[\\/])\.\.([\\/]|$)') { continue }       # stay inside chrome\
      if ($rel -match '^(utils|resources)([\\/]|$)' -or $rel -match 'user-overrides\.css$') { continue } # never touch these
      if ($rel -ieq $TransparentPngName) { continue }                                                # installed by this script
      if (Test-Path (Join-Path $srcChrome ($rel -replace '/', '\'))) { continue }                    # still part of the theme (also case-only renames)
      $target = Join-Path $chromeDir ($rel -replace '/', '\')
      if (Test-Path $target) { Remove-Item $target -Recurse -Force; Write-Host "Removed old file: $rel" }
    }
  }

  # The theme's about:config settings go into user.js between two marker lines, so re-running replaces them
  # and anything else you keep in user.js is left alone.
  $srcUserJs = Join-Path $srcRoot 'user.js'
  if (Test-Path $srcUserJs) {
    $userJs = Join-Path $profileDir 'user.js'
    $begin = '// >>> userchrome-theme (managed block, rewritten by install.ps1) >>>'
    $end   = '// <<< userchrome-theme <<<'
    $old = if (Test-Path $userJs) { [IO.File]::ReadAllText($userJs) } else { '' }
    $old = [regex]::Replace($old, '(?s)' + [regex]::Escape($begin) + '.*?' + [regex]::Escape($end) + '\r?\n?', '')
    $block = ([IO.File]::ReadAllText($srcUserJs)).Trim()
    $new = $old.TrimEnd() + "`r`n`r`n" + $begin + "`r`n" + $block + "`r`n" + $end + "`r`n"
    [IO.File]::WriteAllText($userJs, $new.TrimStart(), (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Theme settings added to user.js.'
  }
  else {
    Write-Warning 'user.js not found in the download; the theme preferences were not applied.'
  }

  # fx-autoconfig loader (needed for the .uc.js scripts), then the theme's own config.js lines on top of it
  if (-not $NoAutoconfig) {
    try {
      $srcProgram = Join-Path $srcRoot 'program'
      if (-not (Test-Path (Join-Path $srcProgram 'config.js'))) { throw 'the download has no program\config.js' }
      $ffDir = if ($FirefoxDir) { $FirefoxDir } else { Find-FirefoxDir }
      if (-not $ffDir -or -not (Test-Path (Join-Path $ffDir 'firefox.exe'))) { throw 'Firefox install folder not found; run again with -FirefoxDir "<folder that contains firefox.exe>"' }
      Install-Autoconfig $srcProgram $ffDir $ConfigJsMarker
      Write-Host "fx-autoconfig loader installed in $ffDir"

      # Must come after Install-Autoconfig: that step copies fx-autoconfig's stock config.js into the same place.
      try {
        Set-FirefoxConfigJs $ffDir $ConfigJsLine $ConfigJsPattern
        Write-Host "config.js updated in $ffDir"
      }
      catch {
        Write-Warning "config.js was not updated: $($_.Exception.Message)`n  The .uc.js loader is installed, but the default toolbar layout and background image lines were not added to config.js."
      }

      # Firefox keeps a startup cache that can hide a newly installed loader.
      $cacheDir = Join-Path $env:LOCALAPPDATA ('Mozilla\Firefox\Profiles\' + (Split-Path $profileDir -Leaf) + '\startupCache')
      Remove-Item $cacheDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    catch {
      Write-Warning "fx-autoconfig loader not installed: $($_.Exception.Message)`n  The CSS works without it, but the .uc.js scripts will not run."
    }
  }
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- fonts --------------------------------------------------------------------
$fontWarnings = @()
if (-not $NoFonts) {
  $fontDir = Join-Path $chromeDir 'fonts'
  New-Item -ItemType Directory $fontDir -Force | Out-Null

  $wanted = @($FontsCore) + @($FontsScripts) + @($FontsNewtab) + @('LICENSES.md')
  foreach ($c in $cjkList) { $wanted += $fontFiles[$c] }

  foreach ($name in $wanted) {
    $dest = Join-Path $fontDir $name
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { continue }   # already there
    Write-Host "Downloading $name..."
    if (-not (Get-File "https://github.com/$Repo/releases/download/$FontRelease/$name" $dest)) { $fontWarnings += $name }
  }

  if ([Environment]::OSVersion.Version.Build -ge 17763) {
    foreach ($name in $FontsNewtab) {
      $src = Join-Path $fontDir $name
      if (Test-Path $src) {
        try { Install-UserFont $src }
        catch { $fontWarnings += "$name (downloaded, but could not be registered for the new tab page)" }
      }
    }
  }
  else {
    Write-Warning 'This Windows version cannot install fonts per user; install the Poppins files from chrome\fonts by hand for the new tab page.'
  }

  if ($cjkList.Count -gt 0) { Write-Host ("CJK font(s): " + ($cjkList -join ', ')) }
  if ($fontWarnings.Count -gt 0) {
    Write-Warning ("These fonts could not be downloaded or registered (the theme falls back to Firefox's own font):`n  " + ($fontWarnings -join "`n  "))
  }
}

# ---- DWMBlurGlass (optional) --------------------------------------------------
$doBlur = $false
if (Test-X64) {
  $doBlur = $Blur.IsPresent
  if (-not $Blur -and -not $NoBlur -and [Environment]::UserInteractive) {
    Write-Host ''
    Write-Host 'DWMBlurGlass (optional) gives the theme its transparent, blurred window. It works on 64-bit (x64) Windows only.'
    $answer = Read-Host 'Download it now? [y/N]'
    $doBlur = $answer -match '^(y|yes)$'
  }
}
elseif ($Blur) {
  Write-Warning 'DWMBlurGlass is 64-bit (x64) Windows only; skipping it on this PC.'
}
if ($doBlur) {
  try { Install-DwmBlurGlass }
  catch {
    Write-Warning "DWMBlurGlass step skipped: $($_.Exception.Message)"
    Write-Host 'You can do it by hand: see the Transparency section of README.md.'
  }
}

Write-Host ''
Write-Host 'Done. Restart Firefox, then open the Customize panel (gear icon at the bottom of the rail).'
