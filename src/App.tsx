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
} from "./db";

export default function App() {
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [tick, setTick] = useState(0); // re-render heartbeat for running timers

  // Ensure DB is ready on boot (creates default space/folder/list)
  useEffect(() => {
    (async () => {
      await getDb();
    })();
  }, []);

  // Load tasks when list changes
  useEffect(() => {
    if (selectedListId == null) return;
    fetchTasks(selectedListId);
  }, [selectedListId]);

  // 1s ticker only when any task is running
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

  // ----- time helpers -----
  function secondsFor(t: Task): number {
    const base = t.accumulated_seconds || 0;
    if (!t.running_since) return base;
    // use tick so it recomputes while running
    void tick;
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

  // ----- small button styles -----
  function btnOutline(): React.CSSProperties {
    return {
      padding: "6px 10px",
      border: "1px solid #c7d2fe",
      color: "#3730a3",
      background: "#eef2ff",
      borderRadius: 6,
      cursor: "pointer",
    };
  }
  function btnDanger(): React.CSSProperties {
    return {
      padding: "6px 10px",
      border: "1px solid #ef4444",
      background: "#ef4444",
      color: "#ffffff",
      borderRadius: 6,
      cursor: "pointer",
    };
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
              <button
                onClick={addTask}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #3b82f6",
                  borderRadius: 6,
                  background: "#3b82f6",
                  color: "#ffffff",  // high contrast
                  cursor: "pointer",
                }}
              >
                Add
              </button>
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
                      <span style={{ textDecoration: t.done ? "line-through" : "none" }}>
                        {t.title}
                      </span>
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

                      {/* ⏱ Stopwatch toggle */}
                      <button
                        onClick={() => toggleTimerFor(t)}
                        style={{
                          padding: "6px 10px",
                          border: running ? "1px solid #34d399" : "1px solid #d1d5db",
                          background: running ? "#ecfdf5" : "#fff",
                          color: running ? "#065f46" : "inherit",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                        title={running ? "Stop timer" : "Start timer"}
                      >
                        ⏱ {running ? "Stop" : "Start"}
                      </button>

                      <button onClick={() => onReset(t)} style={btnOutline()} title="Reset">
                        ↺
                      </button>
                      <button onClick={() => delTask(t.id)} style={btnDanger()} title="Delete">
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
