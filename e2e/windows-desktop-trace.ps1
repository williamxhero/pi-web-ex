[CmdletBinding(DefaultParameterSetName='Command')]
param(
  [Parameter(Mandatory,ParameterSetName='Control')][switch]$Control,
  [Parameter(Mandatory,ParameterSetName='TaskbarControl')][switch]$TaskbarControl,
  [Parameter(Mandatory,ParameterSetName='Command')][string]$Executable,
  [Parameter(Mandatory,ParameterSetName='Command')][string]$Arguments,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [string]$WorkingDirectory=(Get-Location).Path,
  [ValidateRange(1,900)][int]$TimeoutSeconds=230
)
$ErrorActionPreference='Stop'
if (-not ('PiWebDesktopTrace' -as [type])) {
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class PiWebDesktopTrace {
 public delegate void Callback(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint tid,uint time);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr mod,Callback cb,uint proc,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg,IntPtr hwnd,uint min,uint max,uint remove);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int max);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder title,int max);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("kernel32.dll")] static extern uint GetTickCount();
 [StructLayout(LayoutKind.Sequential)] struct MSG {public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint lPrivate;}
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr proc,out long creation,out long exit,out long kernel,out long user);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr proc);
 public class Row { public long Utc; public long Creation; public uint Pid; public string Hwnd; public string Kind; public string Class; public string Hint; public bool Visible; }
 [DllImport("user32.dll")] static extern bool RegisterShellHookWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool DeregisterShellHookWindow(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int RegisterWindowMessage(string name);
 sealed class TaskbarWindow : NativeWindow, IDisposable {
   readonly int message=RegisterWindowMessage("SHELLHOOK");
   readonly Action<IntPtr,string> report;
   public TaskbarWindow(Action<IntPtr,string> report) {
     this.report=report;
     CreateHandle(new CreateParams());
     if(message==0 || !RegisterShellHookWindow(Handle)) { DestroyHandle(); throw new InvalidOperationException("Shell hook unavailable"); }
   }
   protected override void WndProc(ref Message m) {
     if(m.Msg==message){
       long code=m.WParam.ToInt64();
       if(code==1) report(m.LParam,"taskbar-add");
       if(code==0x8006) report(m.LParam,"taskbar-flash");
     }
     base.WndProc(ref m);
   }
   public void Dispose(){DeregisterShellHookWindow(Handle);DestroyHandle();}
 }
 public static List<Row> Capture(Action start,int ms,Func<bool> complete) {
   List<Row> rows=new List<Row>();
   Action<IntPtr,string,uint> observe=delegate(IntPtr hwnd,string kind,uint tick){
      if(hwnd==IntPtr.Zero || GetAncestor(hwnd,2)!=hwnd) return;
      var cls=new StringBuilder(256); var title=new StringBuilder(256); GetClassName(hwnd,cls,256); GetWindowText(hwnd,title,256);
      string c=cls.ToString(), t=title.ToString().ToLowerInvariant();
      bool console=c=="ConsoleWindowClass" || c=="CASCADIA_HOSTING_WINDOW_CLASS" || c=="PseudoConsoleWindow";
      bool control=t.Contains("pi_web_spec_1_control"); bool git=t.Contains("git.exe");
      uint pid; GetWindowThreadProcessId(hwnd,out pid);
      long birth=0, exit=0, k=0, u=0; IntPtr proc=OpenProcess(0x1000,false,pid);
      if(proc!=IntPtr.Zero){try { if(!GetProcessTimes(proc,out birth,out exit,out k,out u)) birth=0; } finally {CloseHandle(proc);} }
      rows.Add(new Row{Utc=DateTime.UtcNow.ToFileTimeUtc()-(long)(int)(GetTickCount()-tick)*10000L,Creation=birth,Pid=pid,Hwnd=hwnd.ToString("x"),Kind=kind,Class=c,Hint=control?"control":git?"git":console?"console":"other",Visible=IsWindowVisible(hwnd)});
   };
   Callback cb=delegate(IntPtr h,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint tick){
      if(obj==0 && child==0) observe(hwnd,evt==3?"foreground":"show",tick);
   };
   using(var taskbar=new TaskbarWindow((hwnd,kind)=>observe(hwnd,kind,GetTickCount()))) {
   IntPtr show=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,cb,0,0,0), fg=SetWinEventHook(3,3,IntPtr.Zero,cb,0,0,0);
   if(show==IntPtr.Zero || fg==IntPtr.Zero) { if(show!=IntPtr.Zero) UnhookWinEvent(show); if(fg!=IntPtr.Zero) UnhookWinEvent(fg); throw new InvalidOperationException("Desktop hook unavailable"); }
   try {
      start();
      var sw=System.Diagnostics.Stopwatch.StartNew();
      long finished=-1;
      while(sw.ElapsedMilliseconds<ms){
        MSG m;while(PeekMessage(out m,IntPtr.Zero,0,0,1)) DispatchMessage(ref m);
        if(finished<0 && complete!=null && complete()) finished=sw.ElapsedMilliseconds;
        if(finished>=0 && sw.ElapsedMilliseconds-finished>=500) break;
        System.Threading.Thread.Sleep(2);
      }
   }
   finally { UnhookWinEvent(show);UnhookWinEvent(fg);GC.KeepAlive(cb); }
   }
   return rows;
 }
}
'@
}
if([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){throw 'Run on an interactive Windows desktop'}
if(Test-Path -LiteralPath $OutputDirectory){throw 'Choose a new output directory for every run'}
[void](New-Item -ItemType Directory -Path $OutputDirectory)
$base=Join-Path (Resolve-Path -LiteralPath $OutputDirectory).Path 'desktop'
$psi=[Diagnostics.ProcessStartInfo]::new()
$psi.WorkingDirectory=(Resolve-Path -LiteralPath $WorkingDirectory).Path
if($Control){
  $psi.FileName=$env:ComSpec
  $psi.Arguments='/d /c "title PI_WEB_SPEC_1_CONTROL && ping.exe -n 3 127.0.0.1"'
  $psi.UseShellExecute=$true
  $psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal
}elseif($TaskbarControl){
  $psi.FileName=Join-Path $PSHOME 'powershell.exe'
  $psi.Arguments='-NoProfile -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'windows-taskbar-control.ps1')+'"'
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
}else{
  $psi.FileName=$Executable
  $psi.Arguments=$Arguments
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
}
$p=[Diagnostics.Process]::new()
$p.StartInfo=$psi
$browserPattern='^(chrome|msedge|firefox|brave|opera|chromium|webkit)\.exe$'
function Get-BrowserInstances {
  @(Get-CimInstance Win32_Process | Where-Object Name -match $browserPattern | ForEach-Object {
    [pscustomobject]@{Pid=[int]$_.ProcessId; Name=$_.Name; Creation=$_.CreationDate.ToUniversalTime().ToString('o')}
  })
}
$browserBefore=Get-BrowserInstances
$session='PiWeb1Desktop-'+$PID
$etl=$base+'.etl'
& logman.exe start $session -p '{22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716}' 0x10 5 -bs 64 -nb 64 192 -o $etl -ets | Out-Null
if($LASTEXITCODE){throw 'kernel process ETW start failed'}
try {
  $startBefore=[datetime]::UtcNow.ToFileTimeUtc()
  $win=[PiWebDesktopTrace]::Capture({
    [void]$p.Start()
    if(-not ($Control -or $TaskbarControl)){
      $script:stdout=$p.StandardOutput.ReadToEndAsync()
      $script:stderr=$p.StandardError.ReadToEndAsync()
    }
  },$TimeoutSeconds*1000,[Func[bool]]{ $p.HasExited })
  if(-not $p.WaitForExit(1000)){throw "Probe command is still running (PID $($p.Id)); inspect only this owned run"}
  if([datetime]::UtcNow.ToFileTimeUtc()-$startBefore -ge $TimeoutSeconds*10000000L){
    throw 'Window capture reached its deadline; rerun with a longer capture budget'
  }
  if(-not ($Control -or $TaskbarControl)){
    if(-not [Threading.Tasks.Task]::WaitAll(@($stdout,$stderr),3000)){throw 'An owned descendant still holds a command output pipe'}
    [IO.File]::WriteAllText($base+'.stdout.txt',$stdout.Result)
    [IO.File]::WriteAllText($base+'.stderr.txt',$stderr.Result)
  }
}finally{
  for($i=0;$i -lt 4;$i++){
    & logman.exe stop $session -ets | Out-Null
    if($LASTEXITCODE -eq 0){break}
    Start-Sleep -Milliseconds 350
  }
  if($LASTEXITCODE){throw 'Kernel process ETW stop failed; do not use this trace'}
}
& tracerpt.exe $etl -summary ($base+'.etw-integrity.txt') -o NUL -of CSV -y | Out-Null
$loss=Select-String -LiteralPath ($base+'.etw-integrity.txt') -Pattern 'Total Events\s+Lost\s+(\d+)' | Select-Object -First 1
if($LASTEXITCODE -or -not $loss){throw 'Kernel process ETW integrity unavailable'}
$lost=[int]$loss.Matches[0].Groups[1].Value
$fromSeq=@{}; $byPid=@{}; $ended=@{}
foreach($rec in (Get-WinEvent -Path $etl -Oldest)){
  if($rec.Id -notin 1,2 -or $rec.ProviderName -ne 'Microsoft-Windows-Kernel-Process'){continue}
  $d=@{}; foreach($x in ([xml]$rec.ToXml()).Event.EventData.Data){$d[$x.Name]=$x.'#text'}
  if(-not $d.ProcessSequenceNumber){continue}
  $seq=[long]$d.ProcessSequenceNumber
  if($rec.Id -eq 2){$ended[$seq]=[datetime]::Parse($d.ExitTime).ToFileTimeUtc();continue}
  $wpid=[int]$d.ProcessID
  $v=[pscustomobject]@{Sequence=$seq;Pid=$wpid;Parent=[int]$d.ParentProcessID;ParentSequence=[long]$d.ParentProcessSequenceNumber;Name=[IO.Path]::GetFileName($d.ImageName);Start=[datetime]::Parse($d.CreateTime).ToFileTimeUtc();End=[long]::MaxValue}
  $fromSeq[$seq]=$v
  if(-not $byPid.ContainsKey($wpid)){$byPid[$wpid]=[System.Collections.Generic.List[object]]::new()}
  $byPid[$wpid].Add($v)
}
foreach($kv in $ended.GetEnumerator()){if($fromSeq.ContainsKey($kv.Key)){$fromSeq[$kv.Key].End=$kv.Value}}
$root=@($byPid[[int]$p.Id] | Where-Object {$_.Start -ge $startBefore} | Sort-Object Start | Select-Object -First 1)[0]
if(-not $root -or $root.End -eq [long]::MaxValue){throw 'Trace missing owned root process start/exit'}
function Resolve-Chain($item){
  $list=[System.Collections.Generic.List[object]]::new(); $at=$item; $result='other';$i=0
  while($at -and $i -lt 80){
    $list.Add($at); if($at.Sequence -eq $root.Sequence){$result='owned';break}
    if(-not $fromSeq.ContainsKey($at.ParentSequence)){
      break
    }
    $at=$fromSeq[$at.ParentSequence];$i++
  }
  [pscustomobject]@{Source=$result;Chain=($list|ForEach-Object {$_.Name+'['+$_.Pid+':'+$_.Sequence+']'}) -join ' <- '}
}
$owned=@(foreach($item in $fromSeq.Values){if((Resolve-Chain $item).Source -eq 'owned'){$item}})
$rows=@(foreach($w in $win){
  $edge=switch($w.Kind){'foreground'{'focus'} 'show'{if($w.Visible){'visible'}else{'hidden'}} default{$w.Kind}}
  $nodes=@($byPid[[int]$w.Pid] | Where-Object {$_ -and ($_.Name -ne '')})
  $m=@();$method='none'
  if($w.Creation -gt 0){
    $m=@($nodes | Where-Object {[Math]::Abs($_.Start-$w.Creation) -le 1000})
    if($m.Count -eq 1){$method='creation'}
  }else{
    $fuzz=200000L
    $m=@($nodes | Where-Object {$_.Start -le $w.Utc+$fuzz -and $_.End -ge $w.Utc-$fuzz})
    if($m.Count -eq 1){$method='lifetime'}
  }
  $src='unmatched';$chain='';$seq=0
  if($method -ne 'none'){$srcInfo=Resolve-Chain $m[0]; $src=$srcInfo.Source; $chain=$srcInfo.Chain;$seq=$m[0].Sequence}
  elseif($m.Count -gt 1){$src='ambiguous'}
  [pscustomobject]@{At=[datetime]::FromFileTimeUtc($w.Utc).ToString('o');Pid=$w.Pid;Sequence=$seq;Hwnd=$w.Hwnd;Edge=$edge;Class=$w.Class;Hint=$w.Hint;Attribution=$method;Source=$src;Chain=$chain}
})
$rows | Export-Csv -NoTypeInformation -Encoding utf8 ($base+'.windows.csv')
$owned | Sort-Object Start | Export-Csv -NoTypeInformation -Encoding utf8 ($base+'.owned.csv')
$browserStarts=@(foreach($item in $fromSeq.Values){
  if($item.Start -lt $startBefore -or $item.Name -notmatch $browserPattern){continue}
  $source=Resolve-Chain $item
  [pscustomobject]@{At=[datetime]::FromFileTimeUtc($item.Start).ToString('o');Name=$item.Name;Pid=$item.Pid;Sequence=$item.Sequence;Parent=$item.Parent;ParentSequence=$item.ParentSequence;Source=$source.Source;Chain=$source.Chain}
})
$browserStarts | Sort-Object At | Export-Csv -NoTypeInformation -Encoding utf8 ($base+'.browser-starts.csv')
$browserAfter=Get-BrowserInstances
[pscustomobject]@{Before=@($browserBefore);After=@($browserAfter)} | ConvertTo-Json -Depth 4 | Out-File ($base+'.browsers.json') -Encoding utf8
$summary=[ordered]@{
  Control=[bool]$Control; TaskbarControl=[bool]$TaskbarControl; Exit=$p.ExitCode; RootPid=$root.Pid; RootSequence=$root.Sequence
  OwnedStarts=$owned.Count; OwnedGit=@($owned|Where-Object Name -eq 'git.exe').Count
  OwnedVisible=@($rows|Where-Object {$_.Source -eq 'owned' -and $_.Edge -eq 'visible'}).Count
  OwnedFocus=@($rows|Where-Object {$_.Source -eq 'owned' -and $_.Edge -eq 'focus'}).Count
  UncertainConsole=@($rows|Where-Object {$_.Source -in 'ambiguous','unmatched' -and $_.Hint -in 'git','console','control' -and $_.Edge -ne 'hidden'}).Count
  OwnedTaskbarAdd=@($rows|Where-Object {$_.Source -eq 'owned' -and $_.Edge -eq 'taskbar-add'}).Count
  OwnedTaskbarFlash=@($rows|Where-Object {$_.Source -eq 'owned' -and $_.Edge -eq 'taskbar-flash'}).Count
  OwnedNoExit=@($owned|Where-Object End -eq ([long]::MaxValue)).Count
  BrowserProcesses=@($owned|Where-Object Name -match '^(chrome|msedge|firefox|brave|opera|chromium|webkit|headless_shell|chrome-headless-shell)\.exe$'|Group-Object Name|ForEach-Object {"$($_.Name):$($_.Count)"})
  EtwLost=$lost
  UnexpectedBrowserStarts=$browserStarts.Count
  OutsideTaskBrowserStarts=@($browserStarts | Where-Object Source -ne 'owned').Count
  BrowserWindowEvents=@($rows|Where-Object {$_.Class -match '^(Chrome_WidgetWin_|MozillaWindowClass|WebKit)' -and $_.Edge -in 'visible','focus'}).Count
}
$summary | ConvertTo-Json | Out-File ($base+'.summary.json') -Encoding utf8
$summary | ConvertTo-Json -Compress
if($lost){exit 13}
if($p.ExitCode -ne 0){exit $p.ExitCode}
if($Control){if(-not $summary.OwnedVisible -or -not $summary.OwnedFocus){exit 11}}
elseif($TaskbarControl){if(-not $summary.OwnedTaskbarAdd -or -not $summary.OwnedTaskbarFlash){exit 11}}
elseif($summary.OwnedVisible -or $summary.OwnedFocus -or $summary.UncertainConsole -or $summary.OwnedNoExit -or $summary.OwnedTaskbarAdd -or $summary.OwnedTaskbarFlash -or $summary.UnexpectedBrowserStarts -or $summary.BrowserWindowEvents){exit 12}
