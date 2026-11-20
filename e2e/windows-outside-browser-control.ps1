param([Parameter(Mandatory)][string]$Trace,[Parameter(Mandatory)][string]$Worktree,[Parameter(Mandatory)][string]$Output,[Parameter(Mandatory)][string]$BrowserExecutable)
$ErrorActionPreference='Stop'
if(Test-Path $Output){throw 'Control output must be new'}
New-Item -ItemType Directory -Path $Output|Out-Null
$req=Join-Path $Output 'request';$done=Join-Path $Output 'broker-result.json';$profile=Join-Path $Output 'temporary-profile'
$job=Start-Job -ArgumentList $req,$done,$profile,$BrowserExecutable -ScriptBlock {
 param($req,$done,$profile,$BrowserExecutable)
 $deadline=(Get-Date).AddSeconds(22)
 while(-not(Test-Path -LiteralPath $req) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 50}
 if(-not(Test-Path -LiteralPath $req)){throw 'No broker request'}
 $si=[Diagnostics.ProcessStartInfo]::new();$si.FileName=$BrowserExecutable
 $si.Arguments='--headless --disable-gpu --disable-background-networking --no-first-run --user-data-dir="'+$profile+'" --dump-dom about:blank'
 $si.UseShellExecute=$false;$si.CreateNoWindow=$true;$si.RedirectStandardOutput=$true;$si.RedirectStandardError=$true
 $p=[Diagnostics.Process]::Start($si); $out=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync()
 if(-not $p.WaitForExit(8000)){throw 'The temporary browser did not exit'}
 [pscustomobject]@{BrokerPid=$PID;BrowserPid=$p.Id;Exit=$p.ExitCode;Request=[IO.File]::ReadAllText($req);Html=$out.Result.Length} | ConvertTo-Json|Set-Content -Encoding utf8 $done
}
try {
 $code="const fs=require('node:fs');fs.writeFileSync(process.argv[2],String(process.pid));const timer=setInterval(()=>{if(fs.existsSync(process.argv[3])){clearInterval(timer);}},100);setTimeout(()=>{if(!fs.existsSync(process.argv[3]))process.exit(1)},18000).unref();"
 $script=Join-Path $Output 'request.cjs';[IO.File]::WriteAllText($script,$code)
 $args='"'+$script+'" "'+$req+'" "'+$done+'"'
 & $Trace -Executable (Get-Command node).Source -Arguments $args -OutputDirectory (Join-Path $Output 'trace') -WorkingDirectory $Worktree -TimeoutSeconds 29
 $code=$LASTEXITCODE
 Receive-Job -Job $job -Wait -ErrorAction Stop
 $r=[IO.File]::ReadAllText($done)|ConvertFrom-Json
 $rows=@(Import-Csv (Join-Path $Output 'trace/desktop.browser-starts.csv'))
 $observed=$rows|Where-Object {$_.Pid -eq $r.BrowserPid -and $_.Parent -eq $r.BrokerPid -and $_.Source -eq 'other'}
 if($code -ne 12 -or -not $observed -or $r.Exit -ne 0){throw 'Outside task tree positive control did not reject and match the broker chain'}
 $observed|ConvertTo-Json -Compress
 'PASS isolated external broker launched a temporary Chrome instance and the strict gate rejected it'
 exit 0
} finally {Remove-Job $job -Force}
