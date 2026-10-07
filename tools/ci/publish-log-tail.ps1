# Aurelia Browser - publish the tail of a log as job annotations.
#
# The runner's logs are not readable by every tool that has to audit one of
# these runs: they live in a blob store that some environments cannot reach,
# while the checks API returns job annotations everywhere. Anything a step
# wants to say about a failure therefore has to be said through them.
#
# Dot-source it from a step:
#
#   . .\tools\ci\publish-log-tail.ps1
#   Publish-LogTail -Path artifacts/logs/sync-0.log -Title 'sync failed'
#
# Two limits of the runner shape the implementation:
#
#   * A step keeps its first ten annotations and drops the rest, so the
#     newest lines are published first and the oldest are the ones lost.
#   * A very long message is truncated by the runner, so each annotation
#     carries only a few short lines rather than one long block.

function Publish-LogTail {
  param(
    [string]$Path,
    [string]$Title,
    [int]$Lines = 24,
    [int]$PerAnnotation = 3
  )

  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  if (-not (Test-Path -LiteralPath $Path)) { return }

  $all = @(Get-Content -LiteralPath $Path -Tail 400 -ErrorAction SilentlyContinue |
      Where-Object { $_.Trim().Length -gt 0 })
  if ($all.Count -eq 0) { return }

  $tail = @($all | Select-Object -Last $Lines)

  # Grouped newest first, so a run that is cut off after ten annotations has
  # still said the most recent thing it knew.
  $chunks = @()
  $end = $tail.Count - 1
  while ($end -ge 0) {
    $start = $end - $PerAnnotation + 1
    if ($start -lt 0) { $start = 0 }
    $chunks += ,@($tail[$start..$end])
    $end = $start - 1
  }

  $emitted = 0
  foreach ($chunk in $chunks) {
    if ($emitted -ge 10) { break }
    $text = (($chunk | ForEach-Object { $_.Trim() }) -join ' | ')
    # Percent signs and newlines break the ::error command, so they go first.
    $text = $text -replace '%', '%25'
    $text = $text -replace "`r", ''
    $text = $text -replace "`n", ' '
    if ($text.Length -gt 900) { $text = $text.Substring(0, 900) }
    Write-Host "::error title=$Title::$text"
    $emitted += 1
  }
}
