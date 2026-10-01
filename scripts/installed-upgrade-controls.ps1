# Production packages forbid CDP. This harness uses the ordinary Windows
# accessibility provider and always searches inside one verified app window.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Initialize-UpgradeControls($App, [string]$ExpectedExecutable) {
  $script:upgradeApp = $App
  $script:upgradeExecutable = [IO.Path]::GetFullPath($ExpectedExecutable)
  $script:upgradeStarted = $App.StartTime.ToUniversalTime()
  $script:upgradeWindow = [IntPtr]::Zero
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  do {
    Assert-UpgradeApp
    if ($App.MainWindowHandle -ne [IntPtr]::Zero) {
      $script:upgradeWindow = $App.MainWindowHandle
      return
    }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Owned app did not expose a visible native window.'
}

function Assert-UpgradeApp {
  $script:upgradeApp.Refresh()
  if ($script:upgradeApp.HasExited -or
      -not [string]::Equals($script:upgradeApp.MainModule.FileName, $script:upgradeExecutable, [StringComparison]::OrdinalIgnoreCase) -or
      $script:upgradeApp.StartTime.ToUniversalTime() -ne $script:upgradeStarted) {
    throw 'Native UI process ownership changed.'
  }
  if ($script:upgradeWindow -ne [IntPtr]::Zero -and $script:upgradeApp.MainWindowHandle -ne $script:upgradeWindow) {
    throw 'Native UI window ownership changed.'
  }
}

function Get-UpgradeControl([string]$Name, [string]$Role, $Parent = $null, [switch]$Prefix, [int]$TimeoutSeconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Assert-UpgradeApp
    if ($null -eq $Parent) {
      $root = [Windows.Automation.AutomationElement]::FromHandle($script:upgradeWindow)
      if ($root.Current.ProcessId -ne $script:upgradeApp.Id) { throw 'Native root window belongs to another PID.' }
    } else { $root = $Parent }
    $matches = @($root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) | Where-Object {
      $_.Current.ControlType.ProgrammaticName -eq "ControlType.$Role" -and
      -not $_.Current.IsOffscreen -and
      $(if ($Prefix) { $_.Current.Name -eq $Name -or $_.Current.Name.StartsWith($Name + ' ', [StringComparison]::Ordinal) } else { $_.Current.Name -eq $Name })
    })
    if ($matches.Count -gt 1) { throw "Ambiguous native control: $Role $Name" }
    if ($matches.Count -eq 1) { return $matches[0] }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Native control did not appear: $Role $Name"
}

function Invoke-UpgradeControl([string]$Name, [string]$Role = 'Button', $Parent = $null, [switch]$Prefix) {
  $control = Get-UpgradeControl $Name $Role $Parent -Prefix:$Prefix
  Assert-UpgradeApp
  if (-not $control.Current.IsEnabled) { throw "Native control is disabled: $Name" }
  if ($Role -eq 'TabItem' -or $Role -eq 'RadioButton') {
    $control.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
  } elseif ($Name -in @('Edit', 'File', 'More commands')) {
    $control.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
  } else {
    $control.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  }
}

function Get-UpgradeValue([string]$Name, [string]$Role, $Parent = $null) {
  $control = Get-UpgradeControl $Name $Role $Parent
  Assert-UpgradeApp
  return $control.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
}

function Set-UpgradeValue([string]$Name, [string]$Role, [string]$Value, $Parent = $null) {
  $control = Get-UpgradeControl $Name $Role $Parent
  Assert-UpgradeApp
  if (-not $control.Current.IsEnabled) { throw "Native value control is disabled: $Name" }
  $control.SetFocus()
  $control.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($Value)
  if ((Get-UpgradeValue $Name $Role $Parent) -ne $Value) { throw "Native value did not read back: $Name" }
}

function Open-UpgradeSettings {
  Invoke-UpgradeControl 'Edit' 'MenuItem'
  Invoke-UpgradeControl 'Settings...' 'MenuItem' -Prefix
  return Get-UpgradeControl 'Settings' 'Window'
}

function Read-UpgradePreferences($Settings) {
  Invoke-UpgradeControl 'General' 'TabItem' $Settings
  $dark = Get-UpgradeControl 'Dark' 'RadioButton' $Settings
  $spacious = Get-UpgradeControl 'Spacious' 'RadioButton' $Settings
  Assert-UpgradeApp
  return [pscustomobject]@{
    dark = $dark.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected
    spacious = $spacious.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected
    recentProjectLimit = Get-UpgradeValue 'Recent projects to keep' 'Spinner' $Settings
  }
}

function Set-UpgradePreferences($Settings) {
  Invoke-UpgradeControl 'General' 'TabItem' $Settings
  Invoke-UpgradeControl 'Dark' 'RadioButton' $Settings
  Invoke-UpgradeControl 'Spacious' 'RadioButton' $Settings
  Set-UpgradeValue 'Recent projects to keep' 'Spinner' '17' $Settings
  # Move focus so the ordinary number-field blur commits its draft.
  (Get-UpgradeControl 'Dark' 'RadioButton' $Settings).SetFocus()
}

function Open-UpgradeMachine {
  $settings = Open-UpgradeSettings
  Invoke-UpgradeControl 'Machine & materials' 'TabItem' $settings
  Invoke-UpgradeControl 'Open Machine Setup...' 'Button' $settings
  $machine = Get-UpgradeControl 'Machine Setup' 'Window'
  Invoke-UpgradeControl 'Go to step 2: Essentials' 'Button' $machine
  return $machine
}

function Read-UpgradeMachine($Machine) {
  return [pscustomobject]@{
    name = Get-UpgradeValue 'Device name' 'Edit' $Machine
    bedWidth = Get-UpgradeValue 'Bed width (mm)' 'Spinner' $Machine
    bedHeight = Get-UpgradeValue 'Bed height (mm)' 'Spinner' $Machine
  }
}

function Set-UpgradeMachine($Machine) {
  Set-UpgradeValue 'Device name' 'Edit' 'Upgrade retention fixture' $Machine
  Set-UpgradeValue 'Bed width (mm)' 'Spinner' '321' $Machine
  Set-UpgradeValue 'Bed height (mm)' 'Spinner' '234' $Machine
  (Get-UpgradeControl 'Device name' 'Edit' $Machine).SetFocus()
  Invoke-UpgradeControl 'Review setup' 'Button' $Machine
  Invoke-UpgradeControl 'Save machine setup' 'Button' $Machine
}

function Invoke-UpgradeFileCommand([string]$Name) {
  # The primary toolbar owns Open and Import; Save As lives in More commands.
  if ($Name -eq 'Save As...') {
    Invoke-UpgradeControl 'More commands'
    Invoke-UpgradeControl $Name 'MenuItem' -Prefix
  } else { Invoke-UpgradeControl $Name }
}

function Assert-UpgradePreferences($Value) {
  if ($Value.dark -ne $true -or $Value.spacious -ne $true -or $Value.recentProjectLimit -ne '17') {
    throw "Retained preferences differ: $($Value | ConvertTo-Json -Compress)"
  }
}

function Assert-UpgradeMachine($Value) {
  if ($Value.name -ne 'Upgrade retention fixture' -or $Value.bedWidth -ne '321' -or $Value.bedHeight -ne '234') {
    throw "Retained machine settings differ: $($Value | ConvertTo-Json -Compress)"
  }
}
