"use client";

// Add-project dialog: point Agent Watch at any local folder.

import { useState } from "react";
import { useAppStore } from "./core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FolderOpen, Plus } from "lucide-react";

function isAbsoluteLocalPath(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("/");
}

export function AddProjectDialog() {
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const browseForProject = async () => {
    try {
      const res = await fetch("/api/folder-picker");
      const json = await res.json();

      if (!res.ok || !json?.path || typeof json.path !== "string") {
        throw new Error(json?.error || "Folder picker returned no path");
      }

      const selectedPath = json.path.trim();
      setPath(selectedPath);
      if (!name.trim()) {
        const last = selectedPath.replace(/[\\/]$/, "").split(/[\\/]/).filter(Boolean).pop() || "";
        if (last) setName(last);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please paste the absolute project path manually instead.";
      toast({
        title: "Could not select a folder",
        description: message,
        variant: "destructive",
      });
    }
  };

  const add = async (rootPath: string, displayName?: string) => {
    if (!rootPath.trim()) return;
    if (!isAbsoluteLocalPath(rootPath)) {
      toast({
        title: "Invalid project path",
        description: "Use the full absolute local path, for example C:\\Users\\you\\project. Relative folder names are not allowed.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath, name: displayName }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Could not add project", description: json.error, variant: "destructive" });
        return;
      }
      toast({ title: "Project added", description: `Watching ${json.project?.rootPath || rootPath} — first scan running.` });
      if (json.project?.id) setActiveProjectId(json.project.id);
      setOpen(false);
      setPath("");
      setName("");
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 bg-cyan-400/90 text-zinc-950 hover:bg-cyan-300">
          <Plus className="h-3.5 w-3.5" />
          Add project
        </Button>
      </DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Monitor a project</DialogTitle>
          <DialogDescription>
            Give an absolute path on this machine. Agent Watch watches it read-only — file changes, structure and output. It never edits or runs anything by itself.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
              <span>Project path (absolute)</span>
              <Button type="button" variant="outline" size="sm" className="h-7 border-zinc-700 bg-zinc-900 text-[10px] text-zinc-200 hover:bg-zinc-800" onClick={() => void browseForProject()}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
                Browse
              </Button>
            </div>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="C:\Users\you\my-ai-project"
              className="border-zinc-800 bg-zinc-900 font-mono text-xs"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Display name (optional)</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome build"
              className="border-zinc-800 bg-zinc-900 text-xs"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" className="bg-cyan-400/90 text-zinc-950 hover:bg-cyan-300" disabled={busy || !path.trim()} onClick={() => void add(path, name || undefined)}>
              {busy ? "Adding…" : "Start watching"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
