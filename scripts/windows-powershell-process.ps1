# Windows PowerShell helpers run separately from the pwsh qualification driver.
function New-QualificationWindowsPowerShell {
  $info = [Diagnostics.ProcessStartInfo]::new((Get-Command powershell.exe).Source)
  # Raw ProcessStartInfo inherits pwsh's incompatible module search paths.
  # Let Windows PowerShell construct its own paths; preserve every other variable.
  $info.EnvironmentVariables.Remove('PSModulePath')
  return $info
}
