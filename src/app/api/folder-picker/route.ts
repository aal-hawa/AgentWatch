import { NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "Folder selection is supported on Windows in this local app." }, { status: 400 });
  }

  return new Promise<NextResponse>((resolve) => {
    const command = `
      Add-Type -AssemblyName System.Windows.Forms
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.Description = "Select the project folder to watch"
      $dialog.ShowNewFolderButton = $true
      $dialog.RootFolder = [System.Environment+SpecialFolder]::MyComputer
      if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $dialog.SelectedPath
      }
    `;

    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(NextResponse.json({ error: stderr.trim() || "The folder dialog was cancelled or failed." }, { status: 400 }));
        return;
      }

      const selected = stdout.trim();
      if (!selected) {
        resolve(NextResponse.json({ error: "No folder was selected." }, { status: 400 }));
        return;
      }

      resolve(NextResponse.json({ ok: true, path: selected }));
    });

    child.on("error", (error) => {
      resolve(NextResponse.json({ error: error.message || "Unable to open the folder picker." }, { status: 500 }));
    });
  });
}
