# One-shot identity rename for the ChatGPT Jev fork. Ordered literal replacements; preserves CRLF + UTF-8 (no BOM).
$ErrorActionPreference = 'Stop'
Set-Location 'd:\Projects\chatgpt-jev'
$roots = @('src','launcher\src','launcher\electron','launcher\tests','launcher\scripts','tests','scripts','.github\workflows')
$files = Get-ChildItem -Recurse -Include *.ts,*.tsx,*.cjs,*.json,*.html,*.sh,*.ps1,*.yml -Path $roots -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Name -ne 'rebrand-chatgpt-jev.ps1' }
$files += Get-Item 'launcher\index.html','launcher\package.json','package.json'
$emDash = [string][char]0x2014
$rules = @(
  @('miuuyy/codex-chatgpt-web', '__UPSTREAM_REPO_SLUG__'),
  @('CODEX_CHATGPT_WEB_HOME', 'CHATGPT_JEV_HOME'),
  @('CODEX_WEB_GPT_LAUNCHER_DATA_DIR', 'CHATGPT_JEV_LAUNCHER_DATA_DIR'),
  @('CODEX_WEB_GPT_DEV_HOME', 'CHATGPT_JEV_DEV_HOME'),
  @('Codex Web GPT', 'ChatGPT Jev'),
  @('codex-web-gpt', 'chatgpt-jev'),
  @('codex-chatgpt-web', 'chatgpt-jev'),
  @('dev.codexwebgpt.launcher', 'dev.chatgptjev.launcher'),
  @('Codex Native2', 'Codex Jev'),
  @('Codex Zero Risk', 'Codex Jev Zero Risk'),
  @("ChatGPT Web $emDash", "ChatGPT Jev $emDash"),
  @('17841', '17851'),
  @('__UPSTREAM_REPO_SLUG__', 'miuuyy/codex-chatgpt-web')
)
$enc = New-Object System.Text.UTF8Encoding($false)
$changed = 0; $hits = @{}
foreach ($f in $files) {
  $text = [IO.File]::ReadAllText($f.FullName, $enc)
  $orig = $text
  foreach ($r in $rules) {
    $n = ([regex]::Matches($text, [regex]::Escape($r[0]))).Count
    if ($n -gt 0 -and $r[0] -ne '__UPSTREAM_REPO_SLUG__' -and $r[1] -ne '__UPSTREAM_REPO_SLUG__') { $hits[$r[0]] = ($hits[$r[0]] + $n) }
    $text = $text.Replace($r[0], $r[1])
  }
  if ($text -ne $orig) { [IO.File]::WriteAllText($f.FullName, $text, $enc); $changed++ }
}
"files changed: $changed of $($files.Count)"
$hits.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0,-32} {1}" -f $_.Name, $_.Value }
