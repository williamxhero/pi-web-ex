# Deliberate positive control: show one window and request a taskbar flash.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PiWebFlashControl {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Size; public IntPtr Window; public uint Flags, Count, Timeout;
  }
  [DllImport("user32.dll")] static extern bool FlashWindowEx(ref Info info);
  public static void Flash(IntPtr handle) {
    var info=new Info {Size=(uint)Marshal.SizeOf(typeof(Info)),Window=handle,Flags=2,Count=3,Timeout=250};
    FlashWindowEx(ref info);
  }
}
'@
$form = New-Object Windows.Forms.Form
$form.Text = 'Pi Web acceptance: deliberate taskbar flash'
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 500
$timer.add_Tick({
  $timer.Stop()
  [PiWebFlashControl]::Flash($form.Handle)
  $closer.Start()
})
$closer = New-Object Windows.Forms.Timer
$closer.Interval = 1700
$closer.add_Tick({ $closer.Stop(); $form.Close() })
$form.add_Shown({ $timer.Start() })
try { [Windows.Forms.Application]::Run($form) }
finally { $timer.Dispose(); $closer.Dispose(); $form.Dispose() }
