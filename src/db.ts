// src/db.ts
import Database from "@tauri-apps/plugin-sql";
import type { Space, Folder, List, Task } from "./types";

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:tasks.db");
    const db = await dbPromise;

    // Always enforce FK integrity
    await db.execute(`PRAGMA foreign_keys = ON;`);

    // --- Repair step: if some OTHER object called 'lists' exists (index/view), drop it.
    // This fixes: "there is already another table or index with this name: lists"
    const obj = await db.select<{ type: string }[]>(
      `SELECT type FROM sqlite_master WHERE name = 'lists';`
    );
    if (obj.length && obj[0].type !== "table") {
      await db.execute(`DROP ${obj[0].type.toUpperCase()} IF EXISTS lists;`);
    }

    // --- Base tables (idempotent) ---
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

    // Unified lists table: supports space-level lists OR folder-level lists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS lists (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id  INTEGER NULL REFERENCES spaces(id) ON DELETE CASCADE,
        folder_id INTEGER NULL REFERENCES folders(id) ON DELETE CASCADE,
        name      TEXT NOT NULL
      );
    `);

    // If an older lists table exists, make sure it has space_id (NULLable) at least
    const listCols = await db.select<{ name: string }[]>(`PRAGMA table_info(lists);`);
    const hasSpaceId = listCols.some(c => c.name === "space_id");
    if (!hasSpaceId) {
      await db.execute(`
        ALTER TABLE lists
        ADD COLUMN space_id INTEGER NULL REFERENCES spaces(id) ON DELETE CASCADE;
      `);
    }
    // Optional: helpful indexes (no-ops if already present)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_lists_space  ON lists(space_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_lists_folder ON lists(folder_id);`);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        title    TEXT NOT NULL,
        done     INTEGER NOT NULL DEFAULT 0,
        list_id  INTEGER REFERENCES lists(id) ON DELETE CASCADE,
        accumulated_seconds INTEGER NOT NULL DEFAULT 0,
        running_since TEXT NULL
      );
    `);

    // --- Seed defaults & backfill ---
    const defaultSpaceId = await ensureDefaultSpace(db);
    const defaultFolderId = await ensureDefaultFolder(db, defaultSpaceId);
    const [spaceListId, folderListId] = await ensureDefaultLists(db, defaultSpaceId, defaultFolderId);

    // Attach orphan tasks to a known list
    await db.execute(
      `UPDATE tasks SET list_id = ? WHERE list_id IS NULL;`,
      [folderListId ?? spaceListId]
    );

    return db;
  }
  return dbPromise;
}

// ---------- Defaults ----------
async function ensureDefaultSpace(db: Database): Promise<number> {
  const row = await db.select<{ id: number }[]>(
    `SELECT id FROM spaces ORDER BY id LIMIT 1;`
  );
  if (row.length) return row[0].id;
  await db.execute(`INSERT INTO spaces (name) VALUES ('My Space');`);
  const created = await db.select<{ id: number }[]>(
    `SELECT id FROM spaces ORDER BY id DESC LIMIT 1;`
  );
  return created[0].id;
}

async function ensureDefaultFolder(db: Database, spaceId: number): Promise<number> {
  const row = await db.select<{ id: number }[]>(
    `SELECT id FROM folders WHERE space_id = ? ORDER BY id LIMIT 1;`,
    [spaceId]
  );
  if (row.length) return row[0].id;
  await db.execute(`INSERT INTO folders (space_id, name) VALUES (?, 'General');`, [spaceId]);
  const created = await db.select<{ id: number }[]>(
    `SELECT id FROM folders WHERE space_id = ? ORDER BY id DESC LIMIT 1;`,
    [spaceId]
  );
  return created[0].id;
}

/**
 * Ensure one space-level list (folder_id IS NULL) and one list under the default folder.
 * Returns [spaceListId, folderListId].
 */
async function ensureDefaultLists(
  db: Database,
  spaceId: number,
  folderId: number
): Promise<[number, number]> {
  // Space-level list
  let rows = await db.select<{ id: number }[]>(
    `SELECT id FROM lists WHERE space_id = ? AND folder_id IS NULL ORDER BY id LIMIT 1;`,
    [spaceId]
  );
  let spaceListId: number;
  if (rows.length) {
    spaceListId = rows[0].id;
  } else {
    await db.execute(
      `INSERT INTO lists (space_id, folder_id, name) VALUES (?, NULL, 'Inbox');`,
      [spaceId]
    );
    rows = await db.select<{ id: number }[]>(
      `SELECT id FROM lists WHERE space_id = ? AND folder_id IS NULL ORDER BY id DESC LIMIT 1;`,
      [spaceId]
    );
    spaceListId = rows[0].id;
  }

  // Folder-level list
  rows = await db.select<{ id: number }[]>(
    `SELECT id FROM lists WHERE folder_id = ? ORDER BY id LIMIT 1;`,
    [folderId]
  );
  let folderListId: number;
  if (rows.length) {
    folderListId = rows[0].id;
  } else {
    await db.execute(
      `INSERT INTO lists (space_id, folder_id, name)
       SELECT ?, ?, 'Inbox (General)';`,
      [spaceId, folderId]
    );
    rows = await db.select<{ id: number }[]>(
      `SELECT id FROM lists WHERE folder_id = ? ORDER BY id DESC LIMIT 1;`,
      [folderId]
    );
    folderListId = rows[0].id;
  }

  return [spaceListId, folderListId];
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
  return db.select<Folder[]>(
    `SELECT * FROM folders WHERE space_id = ? ORDER BY id DESC;`,
    [spaceId]
  );
}

export async function addFolder(spaceId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`INSERT INTO folders (space_id, name) VALUES (?, ?);`, [spaceId, name]);
}

// Lists directly under a space
export async function getSpaceLists(spaceId: number): Promise<List[]> {
  const db = await getDb();
  return db.select<List[]>(
    `SELECT * FROM lists WHERE space_id = ? AND folder_id IS NULL ORDER BY id DESC;`,
    [spaceId]
  );
}

// Lists inside a folder
export async function getFolderLists(folderId: number): Promise<List[]> {
  const db = await getDb();
  return db.select<List[]>(
    `SELECT * FROM lists WHERE folder_id = ? ORDER BY id DESC;`,
    [folderId]
  );
}

// Backwards compat for any older call sites
export async function getLists(folderId: number): Promise<List[]> {
  return getFolderLists(folderId);
}

// Add a list at the space level
export async function addListToSpace(spaceId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO lists (space_id, folder_id, name) VALUES (?, NULL, ?);`,
    [spaceId, name]
  );
}

// Add a list under a folder (space_id inferred)
export async function addListToFolder(folderId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO lists (space_id, folder_id, name)
     SELECT f.space_id, ?, ? FROM folders f WHERE f.id = ?;`,
    [folderId, name, folderId]
  );
}

// Delete a whole space (cascades to folders -> lists -> tasks)
export async function deleteSpace(spaceId: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM spaces WHERE id = ?;`, [spaceId]);
}

// Delete a single list (cascades to its tasks)
export async function deleteList(listId: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM lists WHERE id = ?;`, [listId]);
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
  if (!since) return;

  const elapsedSec = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000));
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
