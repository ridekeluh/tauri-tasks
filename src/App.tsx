// src/App.tsx
import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import type { Task } from "./types";
import {
  getDb,
  getTasks,
  addTask as dbAddTask,
  toggleTaskDone,
  deleteTask as dbDeleteTask,
} from "./db";

export default function App() {
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");

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

  async function toggleTask(id: number, done: number) {
    await toggleTaskDone(id, done);
    if (selectedListId != null) await fetchTasks(selectedListId);
  }

  async function deleteTask(id: number) {
    await dbDeleteTask(id);
    if (selectedListId != null) await fetchTasks(selectedListId);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar selectedListId={selectedListId} onSelectList={setSelectedListId} />

      <div style={{ flex: 1, padding: 20 }}>
        {selectedListId == null ? (
          <div style={{ color: "#6b7280" }}>Select a list from the left to view its tasks.</div>
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
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {tasks.map((t) => (
                <li
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                >
                  <span
                    onClick={() => toggleTask(t.id, t.done)}
                    style={{
                      textDecoration: t.done ? "line-through" : "none",
                      cursor: "pointer",
                    }}
                    title="Toggle done"
                  >
                    {t.title}
                  </span>
                  <button
                    onClick={() => deleteTask(t.id)}
                    style={{
                      padding: "6px 8px",
                      border: "1px solid #fecaca",
                      background: "#fff1f2",
                      color: "#b91c1c",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
