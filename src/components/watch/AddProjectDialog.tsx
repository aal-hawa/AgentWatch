"use client";

// Add-project dialog: point Agent Watch at any local folder.

import { useState } from "react";
import { useAppStore } from "./core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

export function AddProjectDialog() {
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const add = async (rootPath: string, displayName?: string) => {
    if (!rootPath.trim()) return;
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
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Project path (absolute)</div>
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
