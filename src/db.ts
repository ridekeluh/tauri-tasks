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
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS lists (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id  INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
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

      // ---- Migrations: add "position" to folders/lists if missing ----
      const folderCols = await db.select<{ name: string }[]>(`PRAGMA table_info(folders);`);
      if (!folderCols.some(c => c.name === "position")) {
        await db.execute(`ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`);
        // Initialize positions per space
        await db.execute(`
          WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY space_id ORDER BY id) - 1 AS rn
            FROM folders
          )
          UPDATE folders SET position = (SELECT rn FROM ranked WHERE ranked.id = folders.id);
        `);
      }

      const listCols2 = await db.select<{ name: string }[]>(`PRAGMA table_info(lists);`);
      if (!listCols2.some(c => c.name === "position")) {
        await db.execute(`ALTER TABLE lists ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`);
        // Initialize positions per container (space-level or folder-level)
        await db.execute(`
          WITH ranked AS (
            SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY space_id, COALESCE(folder_id, -1)
                    ORDER BY id
                  ) - 1 AS rn
            FROM lists
          )
          UPDATE lists SET position = (SELECT rn FROM ranked WHERE ranked.id = lists.id);
        `);
      }

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

// Delete a folder (cascades to its lists -> tasks)
export async function deleteFolder(folderId: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM folders WHERE id = ?;`, [folderId]);
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

//-------- Edit ----------
export async function renameSpace(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE spaces SET name = ? WHERE id = ?;`, [name, id]);
}

export async function renameFolder(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE folders SET name = ? WHERE id = ?;`, [name, id]);
}

export async function renameList(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE lists SET name = ? WHERE id = ?;`, [name, id]);
}

export async function renameTask(id: number, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE tasks SET title = ? WHERE id = ?;`, [title, id]);
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

// Utility: next position for folders within a space
async function nextFolderPosition(db: Database, spaceId: number): Promise<number> {
  const rows = await db.select<{ maxpos: number | null }[]>(
    `SELECT MAX(position) as maxpos FROM folders WHERE space_id = ?;`, [spaceId]
  );
  return (rows[0]?.maxpos ?? -1) + 1;
}

// Utility: next position for lists within a container (space-level OR folder-level)
async function nextListPositionForSpace(db: Database, spaceId: number): Promise<number> {
  const rows = await db.select<{ maxpos: number | null }[]>(
    `SELECT MAX(position) as maxpos FROM lists WHERE space_id = ? AND folder_id IS NULL;`, [spaceId]
  );
  return (rows[0]?.maxpos ?? -1) + 1;
}
async function nextListPositionForFolder(db: Database, folderId: number): Promise<number> {
  const rows = await db.select<{ maxpos: number | null }[]>(
    `SELECT MAX(position) as maxpos FROM lists WHERE folder_id = ?;`, [folderId]
  );
  return (rows[0]?.maxpos ?? -1) + 1;
}

/** (optional) reorder within same container: move up/down by swapping positions */
export async function reorderFolder(folderId: number, delta: -1 | 1): Promise<void> {
  const db = await getDb();
  const f = await db.select<{ id:number; space_id:number; position:number }[]>(
    `SELECT id, space_id, position FROM folders WHERE id = ?;`, [folderId]
  );
  if (!f.length) return;
  const { space_id, position } = f[0];

  const neighbor = await db.select<{ id:number; position:number }[]>(
    `SELECT id, position FROM folders
     WHERE space_id = ? AND position ${delta < 0 ? '<' : '>'} ?
     ORDER BY position ${delta < 0 ? 'DESC' : 'ASC'} LIMIT 1;`,
    [space_id, position]
  );
  if (!neighbor.length) return;

  await db.execute(`UPDATE folders SET position = ? WHERE id = ?;`, [neighbor[0].position, folderId]);
  await db.execute(`UPDATE folders SET position = ? WHERE id = ?;`, [position, neighbor[0].id]);
}

export async function reorderList(listId: number, delta: -1 | 1): Promise<void> {
  const db = await getDb();
  const L = await db.select<{ id:number; space_id:number; folder_id:number|null; position:number }[]>(
    `SELECT id, space_id, folder_id, position FROM lists WHERE id = ?;`, [listId]
  );
  if (!L.length) return;
  const { space_id, folder_id, position } = L[0];

  const neighbor = await db.select<{ id:number; position:number }[]>(
    `SELECT id, position FROM lists
     WHERE space_id = ? AND (folder_id IS ? OR folder_id = ?)
       AND position ${delta < 0 ? '<' : '>'} ?
     ORDER BY position ${delta < 0 ? 'DESC' : 'ASC'} LIMIT 1;`,
    [space_id, folder_id, folder_id, position]
  );
  if (!neighbor.length) return;

  await db.execute(`UPDATE lists SET position = ? WHERE id = ?;`, [neighbor[0].position, listId]);
  await db.execute(`UPDATE lists SET position = ? WHERE id = ?;`, [position, neighbor[0].id]);
}

/** Move a folder to another space (appends at end) */
export async function moveFolder(folderId: number, newSpaceId: number): Promise<void> {
  const db = await getDb();
  const pos = await nextFolderPosition(db, newSpaceId);
  await db.execute(
    `UPDATE folders SET space_id = ?, position = ? WHERE id = ?;`,
    [newSpaceId, pos, folderId]
  );
  // keep lists under this folder aligned with the new space
  await db.execute(`UPDATE lists SET space_id = ? WHERE folder_id = ?;`, [newSpaceId, folderId]);
}

/** Move a list so it belongs directly to a space (top-level) */
export async function moveListToSpace(listId: number, spaceId: number): Promise<void> {
  const db = await getDb();
  const pos = await nextListPositionForSpace(db, spaceId);
  await db.execute(
    `UPDATE lists SET space_id = ?, folder_id = NULL, position = ? WHERE id = ?;`,
    [spaceId, pos, listId]
  );
}

/** Move a list under a specific folder (space inferred from folder) */
export async function moveListToFolder(listId: number, folderId: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ space_id: number }[]>(
    `SELECT space_id FROM folders WHERE id = ?;`, [folderId]
  );
  if (!rows.length) return;
  const spaceId = rows[0].space_id;
  const pos = await nextListPositionForFolder(db, folderId);

  await db.execute(
    `UPDATE lists SET space_id = ?, folder_id = ?, position = ? WHERE id = ?;`,
    [spaceId, folderId, pos, listId]
  );
}
