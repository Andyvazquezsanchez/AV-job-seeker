' Job Seeker: starts the automatic run (scripts\auto-run.js) without a console window.
' Started by the Windows Task Scheduler (lib\schedule.js). Argument: the node.exe to use.
Option Explicit
Dim fso, sh, root, node
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = ""
If WScript.Arguments.Count > 0 Then node = WScript.Arguments(0)
If node = "" Or Not fso.FileExists(node) Then node = root & "\runtime\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
sh.CurrentDirectory = root
WScript.Quit sh.Run("""" & node & """ """ & root & "\scripts\auto-run.js""", 0, True)
