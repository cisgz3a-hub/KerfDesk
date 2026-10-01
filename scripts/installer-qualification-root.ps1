# A release job runs fresh Launch and HistoricalUpgrade sequentially. Keep
# their filesystem ownership separate; neither may reuse another lane's root.
function Get-InstallerQualificationRoot {
  param(
    [Parameter(Mandatory = $true)][string]$RunnerTemp,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+$')][string]$RunId,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+$')][string]$RunAttempt,
    [Parameter(Mandatory = $true)][ValidateSet('Full', 'Launch', 'HistoricalUpgrade')][string]$Scenario
  )
  return Join-Path ([IO.Path]::GetFullPath($RunnerTemp)) "kerfdesk-installer-$RunId-$RunAttempt-$($Scenario.ToLowerInvariant())"
}
