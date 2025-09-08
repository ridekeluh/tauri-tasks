// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import type { Task } from "./types";
import {
  getDb,
  getTasks,
  addTask as dbAddTask,
  toggleTaskDone,
  deleteTask as dbDeleteTask,
  startTimer,
  stopTimer,
  resetTimer,
  renameTask, // ← use the exported helper from db.ts
} from "./db";

export default function App() {
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [tick, setTick] = useState(0);

  // inline edit state
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [taskDraft, setTaskDraft] = useState("");

  useEffect(() => {
    (async () => {
      await getDb();
    })();
  }, []);

  useEffect(() => {
    if (selectedListId == null) return;
    fetchTasks(selectedListId);
  }, [selectedListId]);

  const anyRunning = useMemo(() => tasks.some(t => !!t.running_since), [tasks]);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  async function fetchTasks(listId: number) {
    const rows = await getTasks(listId);
    setTasks(rows);
  }

  async function addTask() {
    if (!newTask.trim() || selectedListId == null) return;
    await dbAddTask(selectedListId, newTask.trim());
    setNewTask("");
    await fetchTasks(selectedListId);
  }

  async function toggleDone(id: number, done: number) {
    await toggleTaskDone(id, done);
    if (selectedListId != null) await fetchTasks(selectedListId);
  }

  async function delTask(id: number) {
    await dbDeleteTask(id);
    if (selectedListId != null) await fetchTasks(selectedListId);
  }

  async function toggleTimerFor(task: Task) {
    if (task.running_since) {
      await stopTimer(task.id);
    } else {
      await startTimer(task.id);
    }
    if (selectedListId != null) await fetchTasks(selectedListId);
  }

  async function onReset(task: Task) {
    await resetTimer(task.id);
    if (selectedListId != null) await fetchTasks(selectedListId);
  }

  // ----- rename helpers -----
  function beginEdit(t: Task) {
    setEditingTaskId(t.id);
    setTaskDraft(t.title);
  }
  async function saveEdit() {
    if (editingTaskId == null) return;
    const next = taskDraft.trim();
    if (next) {
      await renameTask(editingTaskId, next);
      if (selectedListId != null) await fetchTasks(selectedListId);
    }
    setEditingTaskId(null);
  }
  function cancelEdit() {
    setEditingTaskId(null);
  }

  // ----- time helpers -----
  function secondsFor(t: Task): number {
    const base = t.accumulated_seconds || 0;
    if (!t.running_since) return base;
    void tick; // force recompute while running
    const extra = Math.max(0, Math.floor((Date.now() - Date.parse(t.running_since)) / 1000));
    return base + extra;
  }

  function fmt(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar selectedListId={selectedListId} onSelectList={setSelectedListId} />

      <div style={{ flex: 1, padding: 20 }}>
        {selectedListId == null ? (
          <div style={{ color: "#6b7280" }}>
            Select a list from the left to view its tasks.
          </div>
        ) : (
          <>
            <h1 style={{ marginTop: 0 }}>Tasks</h1>

            <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="New task..."
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                }}
              />
              <button onClick={addTask}>Add</button>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {tasks.map((t) => {
                const running = !!t.running_since;
                const secs = secondsFor(t);

                return (
                  <li
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 10px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={!!t.done}
                        onChange={() => toggleDone(t.id, t.done)}
                        title="Toggle done"
                      />

                      {editingTaskId === t.id ? (
                        <input
                          autoFocus
                          value={taskDraft}
                          onChange={(e) => setTaskDraft(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") cancelEdit();
                          }}
                          style={{ width: 200 }}
                        />
                      ) : (
                        <span
                          style={{
                            textDecoration: t.done ? "line-through" : "none",
                            cursor: "pointer",
                          }}
                          onDoubleClick={() => beginEdit(t)}
                          title="Double-click to rename"
                        >
                          {t.title}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          minWidth: 70,
                          textAlign: "right",
                        }}
                      >
                        {fmt(secs)}
                      </span>

                      <button
                        onClick={() => toggleTimerFor(t)}
                        title={running ? "Stop timer" : "Start timer"}
                      >
                        ⏱ {running ? "Stop" : "Start"}
                      </button>

                      <button onClick={() => onReset(t)} title="Reset">
                        ↺
                      </button>
                      <button onClick={() => delTask(t.id)} className="btnLink" title="Delete">
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
