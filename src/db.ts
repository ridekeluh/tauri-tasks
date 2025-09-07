import Database from "@tauri-apps/plugin-sql";
import type { Space, Folder, List, Task } from "./types";

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:tasks.db");
    const db = await dbPromise;

    await db.execute(`PRAGMA foreign_keys = ON;`);

    // Schema (same as before) …
    await db.execute(`
      CREATE TABLE IF NOT EXISTS spaces (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS folders (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id  INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        name      TEXT NOT NULL
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS lists (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        name      TEXT NOT NULL
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        title    TEXT NOT NULL,
        done     INTEGER NOT NULL DEFAULT 0,
        list_id  INTEGER REFERENCES lists(id) ON DELETE CASCADE
      );
    `);

    // -------- Migrations for time tracking --------
    // Add accumulated_seconds
    const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(tasks);`);
    const hasAccum = cols.some(c => c.name === "accumulated_seconds");
    if (!hasAccum) {
      await db.execute(`ALTER TABLE tasks ADD COLUMN accumulated_seconds INTEGER NOT NULL DEFAULT 0;`);
    }
    const hasRunning = cols.some(c => c.name === "running_since");
    if (!hasRunning) {
      await db.execute(`ALTER TABLE tasks ADD COLUMN running_since TEXT NULL;`);
    }

    // Seed default Space/Folder/List
    const defaultSpaceId = await ensureDefaultSpace(db);
    const defaultFolderId = await ensureDefaultFolder(db, defaultSpaceId);
    const defaultListId = await ensureDefaultList(db, defaultFolderId);
    await db.execute(`UPDATE tasks SET list_id = ? WHERE list_id IS NULL;`, [defaultListId]);

    return db;
  }
  return dbPromise;
}

async function ensureDefaultSpace(db: Database): Promise<number> {
  const row = await db.select<{ id: number }[]>(`SELECT id FROM spaces ORDER BY id LIMIT 1;`);
  if (row.length) return row[0].id;
  await db.execute(`INSERT INTO spaces (name) VALUES ('My Space');`);
  const created = await db.select<{ id: number }[]>(`SELECT id FROM spaces ORDER BY id DESC LIMIT 1;`);
  return created[0].id;
}
async function ensureDefaultFolder(db: Database, spaceId: number): Promise<number> {
  const row = await db.select<{ id: number }[]>(`SELECT id FROM folders WHERE space_id = ? ORDER BY id LIMIT 1;`, [spaceId]);
  if (row.length) return row[0].id;
  await db.execute(`INSERT INTO folders (space_id, name) VALUES (?, 'General');`, [spaceId]);
  const created = await db.select<{ id: number }[]>(`SELECT id FROM folders WHERE space_id = ? ORDER BY id DESC LIMIT 1;`, [spaceId]);
  return created[0].id;
}
async function ensureDefaultList(db: Database, folderId: number): Promise<number> {
  const row = await db.select<{ id: number }[]>(`SELECT id FROM lists WHERE folder_id = ? ORDER BY id LIMIT 1;`, [folderId]);
  if (row.length) return row[0].id;
  await db.execute(`INSERT INTO lists (folder_id, name) VALUES (?, 'Inbox');`, [folderId]);
  const created = await db.select<{ id: number }[]>(`SELECT id FROM lists WHERE folder_id = ? ORDER BY id DESC LIMIT 1;`, [folderId]);
  return created[0].id;
}

// ---------- Spaces / Folders / Lists ----------
export async function getSpaces(): Promise<Space[]> {
  const db = await getDb();
  return db.select<Space[]>(`SELECT * FROM spaces ORDER BY id DESC;`);
}
export async function addSpace(name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`INSERT INTO spaces (name) VALUES (?);`, [name]);
}
export async function getFolders(spaceId: number): Promise<Folder[]> {
  const db = await getDb();
  return db.select<Folder[]>(`SELECT * FROM folders WHERE space_id = ? ORDER BY id DESC;`, [spaceId]);
}
export async function addFolder(spaceId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`INSERT INTO folders (space_id, name) VALUES (?, ?);`, [spaceId, name]);
}
export async function getLists(folderId: number): Promise<List[]> {
  const db = await getDb();
  return db.select<List[]>(`SELECT * FROM lists WHERE folder_id = ? ORDER BY id DESC;`, [folderId]);
}
export async function addList(folderId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`INSERT INTO lists (folder_id, name) VALUES (?, ?);`, [folderId, name]);
}

// ---------- Tasks ----------
export async function getTasks(listId: number): Promise<Task[]> {
  const db = await getDb();
  return db.select<Task[]>(
    `SELECT id, list_id, title, done, accumulated_seconds, running_since
     FROM tasks WHERE list_id = ? ORDER BY id DESC;`,
    [listId]
  );
}
export async function addTask(listId: number, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (list_id, title, done, accumulated_seconds, running_since)
     VALUES (?, ?, 0, 0, NULL);`,
    [listId, title]
  );
}
export async function toggleTaskDone(id: number, done: number): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE tasks SET done = ? WHERE id = ?;`, [done ? 0 : 1, id]);
}
export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM tasks WHERE id = ?;`, [id]);
}

// ---------- Time tracking ----------
export async function startTimer(id: number): Promise<void> {
  const db = await getDb();
  // Only set if not already running
  await db.execute(
    `UPDATE tasks
     SET running_since = COALESCE(running_since, ?)
     WHERE id = ?;`,
    [new Date().toISOString(), id]
  );
}

export async function stopTimer(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ running_since: string | null }[]>(
    `SELECT running_since FROM tasks WHERE id = ?;`,
    [id]
  );
  const since = rows[0]?.running_since;
  if (!since) return; // not running

  const elapsedSec = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(since)) / 1000)
  );
  await db.execute(
    `UPDATE tasks
     SET accumulated_seconds = accumulated_seconds + ?, running_since = NULL
     WHERE id = ?;`,
    [elapsedSec, id]
  );
}

export async function resetTimer(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tasks
     SET accumulated_seconds = 0, running_since = NULL
     WHERE id = ?;`,
    [id]
  );
}
