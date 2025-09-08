// src/components/Sidebar.tsx
import { useEffect, useState } from "react";
import type React from "react"; // for React.CSSProperties in styles
import type { Space, Folder, List } from "../types";
import {
  getSpaces,
  getFolders,
  getSpaceLists,
  getFolderLists,
  addSpace,
  addFolder,
  addListToSpace,
  addListToFolder,
  renameSpace,
  renameFolder,
  renameList,
  moveListToSpace,
  moveListToFolder,
  moveFolder,
  deleteSpace as dbDeleteSpace,
  deleteList as dbDeleteList,
  deleteFolder as dbDeleteFolder, 
} from "../db";

type Props = {
  selectedListId: number | null;
  onSelectList: (listId: number | null) => void; // allow clearing selection
};

export default function Sidebar({ selectedListId, onSelectList }: Props) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [expandedSpaces, setExpandedSpaces] = useState<Record<number, boolean>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [foldersBySpace, setFoldersBySpace] = useState<Record<number, Folder[]>>({});
  const [listsByFolder, setListsByFolder] = useState<Record<number, List[]>>({});
  const [listsBySpace, setListsBySpace] = useState<Record<number, List[]>>({});

  const [spaceName, setSpaceName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [listName, setListName] = useState("");

  const [activeSpaceForNewFolderOrList, setActiveSpaceForNewFolderOrList] = useState<number | null>(null);
  const [activeFolderForNewList, setActiveFolderForNewList] = useState<number | null>(null);

  const [editingSpaceId, setEditingSpaceId] = useState<number | null>(null);
  const [spaceDraft, setSpaceDraft] = useState("");

  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [folderDraftEdit, setFolderDraftEdit] = useState("");

  const [editingListId, setEditingListId] = useState<number | null>(null);
  const [listDraftEdit, setListDraftEdit] = useState("");

  // track the current dropdown selection per list id
  const [movePick, setMovePick] = useState<Record<number, string>>({});

  const [moveFolderPick, setMoveFolderPick] = useState<Record<number, string>>({});

  useEffect(() => {
    refreshSpaces();
  }, []);

  async function refreshSpaces() {
    const s = await getSpaces();
    setSpaces(s);
  }

  async function toggleSpace(spaceId: number) {
    const isOpen = !!expandedSpaces[spaceId];
    setExpandedSpaces((m) => ({ ...m, [spaceId]: !isOpen }));
    if (!isOpen) {
      if (!foldersBySpace[spaceId]) {
        const fs = await getFolders(spaceId);
        setFoldersBySpace((m) => ({ ...m, [spaceId]: fs }));
      }
      if (!listsBySpace[spaceId]) {
        const ls = await getSpaceLists(spaceId);
        setListsBySpace((m) => ({ ...m, [spaceId]: ls }));
      }
    }
  }

  async function toggleFolder(folderId: number) {
    const isOpen = !!expandedFolders[folderId];
    setExpandedFolders((m) => ({ ...m, [folderId]: !isOpen }));
    if (!isOpen && !listsByFolder[folderId]) {
      const ls = await getFolderLists(folderId);
      setListsByFolder((m) => ({ ...m, [folderId]: ls }));
    }
  }

async function handleDeleteFolder(spaceId: number, folderId: number) {
  // Delete from DB
  await dbDeleteFolder(folderId);

  // If the currently selected list lived inside this folder, clear selection
  const listsInFolder = listsByFolder[folderId] || [];
  if (selectedListId != null && listsInFolder.some(l => l.id === selectedListId)) {
    onSelectList(null);
  }

  // Remove the folder from the space’s folder list (optimistic UI)
  setFoldersBySpace(prev => {
    const current = prev[spaceId] || [];
    return { ...prev, [spaceId]: current.filter(f => f.id !== folderId) };
  });

  // Drop cached lists for that folder
  setListsByFolder(prev => {
    const { [folderId]: _removed, ...rest } = prev;
    return rest;
  });

  // Collapse the folder if it was open
  setExpandedFolders(prev => {
    const { [folderId]: _exp, ...rest } = prev;
    return rest;
  });

  // (Optional) Re-sync with DB to be extra safe:
  // const fresh = await getFolders(spaceId);
  // setFoldersBySpace(prev => ({ ...prev, [spaceId]: fresh }));
}

  // ----- Adders -----
  async function handleAddSpace() {
    if (!spaceName.trim()) return;
    await addSpace(spaceName.trim());
    setSpaceName("");
    await refreshSpaces();
  }

  async function handleAddFolder(spaceId: number) {
    if (!folderName.trim()) return;
    await addFolder(spaceId, folderName.trim());
    setFolderName("");
    const fs = await getFolders(spaceId);
    setFoldersBySpace((m) => ({ ...m, [spaceId]: fs }));
  }

  async function handleAddListAtSpace(spaceId: number) {
    if (!listName.trim()) return;
    await addListToSpace(spaceId, listName.trim());
    setListName("");
    const ls = await getSpaceLists(spaceId);
    setListsBySpace((m) => ({ ...m, [spaceId]: ls }));
  }

  async function handleAddListAtFolder(folderId: number) {
    if (!listName.trim()) return;
    await addListToFolder(folderId, listName.trim());
    setListName("");
    const ls = await getFolderLists(folderId);
    setListsByFolder((m) => ({ ...m, [folderId]: ls }));
  }

  // ----- Deleters -----
  async function handleDeleteSpace(spaceId: number) {
    await dbDeleteSpace(spaceId);
    if (selectedListId != null) onSelectList(null);
    await refreshSpaces();
    setFoldersBySpace((m) => {
      const { [spaceId]: _, ...rest } = m;
      return rest;
    });
    setListsBySpace((m) => {
      const { [spaceId]: _, ...rest } = m;
      return rest;
    });
  }

  async function handleDeleteList(
    folderId: number | null,
    listId: number,
    spaceIdForTopLevel?: number
  ) {
    await dbDeleteList(listId);

    if (folderId) {
      const ls = await getFolderLists(folderId);
      setListsByFolder((m) => ({ ...m, [folderId]: ls }));
    } else if (spaceIdForTopLevel) {
      const ls = await getSpaceLists(spaceIdForTopLevel);
      setListsBySpace((m) => ({ ...m, [spaceIdForTopLevel]: ls }));
    }

    if (selectedListId === listId) onSelectList(null);
  }

  return (
    <div style={styles.sidebar}>
      <div style={styles.sectionHeader}>Spaces</div>

      <div style={{ padding: "0 8px 12px", display: "flex", gap: 8 }}>
        <input
          placeholder="New space..."
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
          style={{ ...styles.input, flex: 1 }}
        />
        <button onClick={handleAddSpace} className="btnLink">Add</button>
      </div>

      <div>
        {spaces.map((space) => (
          <div key={space.id} style={styles.spaceBlock}>
            {/* Space header row with Delete */}
            <div style={{ ...styles.spaceRow, justifyContent: "space-between" }}>
              <div
                onClick={() => toggleSpace(space.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                title="Toggle open/close"
              >
                <span style={styles.chev}>{expandedSpaces[space.id] ? "▾" : "▸"}</span>

                {editingSpaceId === space.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!spaceDraft.trim()) return;
                      await renameSpace(space.id, spaceDraft.trim());
                      setEditingSpaceId(null);
                      setSpaceDraft("");
                      await refreshSpaces();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                  >
                    <input
                      autoFocus
                      value={spaceDraft}
                      onChange={(e) => setSpaceDraft(e.target.value)}
                      style={styles.inputSm}
                    />
                    <button className="btnLink" type="submit">Save</button>
                    <button
                      type="button"
                      className="btnLink"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingSpaceId(null);
                        setSpaceDraft("");
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span>{space.name}</span>
                    <button
                      className="btnLink"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingSpaceId(space.id);
                        setSpaceDraft(space.name);
                      }}
                      title="Rename space"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>

              <button
                className="btnLink"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSpace(space.id);
                }}
                title="Delete space"
              >
                Delete
              </button>
            </div>

            {/* Expanded space content */}
            {expandedSpaces[space.id] && (
              <div style={styles.folders}>
                {/* Add FOLDER (space level) */}
                <div style={{ display: "flex", gap: 6, margin: "4px 0 8px 18px" }}>
                  <input
                    placeholder="New folder..."
                    value={activeSpaceForNewFolderOrList === space.id ? folderName : ""}
                    onChange={(e) => {
                      setActiveSpaceForNewFolderOrList(space.id);
                      setFolderName(e.target.value);
                    }}
                    style={styles.inputSm}
                  />
                  <button className="btnLink" onClick={() => handleAddFolder(space.id)}>
                    + Folder
                  </button>
                </div>

                {/* Add LIST at SPACE level */}
                <div style={{ display: "flex", gap: 6, margin: "4px 0 8px 18px" }}>
                  <input
                    placeholder="New list..."
                    value={activeSpaceForNewFolderOrList === space.id ? listName : ""}
                    onChange={(e) => {
                      setActiveSpaceForNewFolderOrList(space.id);
                      setListName(e.target.value);
                    }}
                    style={styles.inputSm}
                  />
                  <button className="btnLink" onClick={() => handleAddListAtSpace(space.id)}>
                    + List
                  </button>
                </div>

                {/* SPACE-LEVEL LISTS */}
               {(listsBySpace[space.id] || []).map((list) => (
                  <div
                    key={list.id}
                    style={{
                      ...styles.listRow,
                      ...(selectedListId === list.id ? styles.listRowActive : {}),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                      marginLeft: 18,
                    }}
                  >
                    {/* open the list */}
                    <button
                      onClick={() => onSelectList(list.id)}
                      className="btnLink"
                      title="Show tasks"
                    >
                      {list.name}
                    </button>

                    {/* actions */}
                    <div>
                     {/* Replace the Move button with a dropdown */}
                      <select
                        aria-label="Move list"
                        value={movePick[list.id] ?? ""}
                        onChange={async (e) => {
                          const value = e.target.value;
                          if (!value) return;

                          try {
                            if (value.startsWith("space:")) {
                              const sid = Number(value.slice("space:".length));
                              if (Number.isFinite(sid) && sid !== list.space_id) {
                                await moveListToSpace(list.id, sid);
                                const [srcLists, dstLists] = await Promise.all([
                                  getSpaceLists(space.id),
                                  getSpaceLists(sid),
                                ]);
                                setListsBySpace(prev => ({ ...prev, [space.id]: srcLists, [sid]: dstLists }));
                              }
                            } else if (value.startsWith("folder:")) {
                              const fid = Number(value.slice("folder:".length));
                              if (Number.isFinite(fid) && fid !== (list.folder_id ?? -1)) {
                                await moveListToFolder(list.id, fid);
                                const [srcLists, folderLists] = await Promise.all([
                                  getSpaceLists(space.id),
                                  getFolderLists(fid),
                                ]);
                                setListsBySpace(prev => ({ ...prev, [space.id]: srcLists }));
                                setListsByFolder(prev => ({ ...prev, [fid]: folderLists }));
                              }
                            }
                          } finally {
                            // reset dropdown via state (React-friendly)
                            setMovePick(prev => ({ ...prev, [list.id]: "" }));
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <option value="">Move to…</option>

                        {/* spaces */}
                        <optgroup label="Spaces">
                          {spaces.map(s => (
                            <option
                              key={`space-${s.id}`}
                              value={`space:${s.id}`}
                              disabled={s.id === list.space_id && list.folder_id == null} // avoid no-op
                            >
                              {s.name}{s.id === list.space_id && list.folder_id == null ? " (current)" : ""}
                            </option>
                          ))}
                        </optgroup>

                        {/* folders in this space */}
                        <optgroup label="Folders in this space">
                          {(foldersBySpace[space.id] || []).map(f => (
                            <option
                              key={`folder-${f.id}`}
                              value={`folder:${f.id}`}
                              disabled={f.id === (list.folder_id ?? -999)} // avoid no-op
                            >
                              {f.name}{f.id === (list.folder_id ?? -999) ? " (current)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      <button
                        onClick={() => handleDeleteList(null, list.id, space.id)}
                        className="btnLink"
                        title="Delete list"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}


                {/* FOLDERS (each with their nested lists) */}
                {(foldersBySpace[space.id] || []).map((folder) => (
                  <div key={folder.id} style={{ marginLeft: 18 }}>
                    <div style={{ ...styles.folderRow, justifyContent: "space-between" }}>
                      <div
                        onClick={() => toggleFolder(folder.id)}
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                        title="Toggle lists"
                      >
                        <span style={styles.chev}>
                          {expandedFolders[folder.id] ? "▾" : "▸"}
                        </span>

                        {editingFolderId === folder.id ? (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (!folderDraftEdit.trim()) return;
                              await renameFolder(folder.id, folderDraftEdit.trim());
                              setEditingFolderId(null);
                              setFolderDraftEdit("");
                              // refresh folders for this space
                              const fs = await getFolders(space.id);
                              setFoldersBySpace((m) => ({ ...m, [space.id]: fs }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                          >
                            <input
                              autoFocus
                              value={folderDraftEdit}
                              onChange={(e) => setFolderDraftEdit(e.target.value)}
                              style={styles.inputSm}
                            />
                            <button className="btnLink" type="submit">Save</button>
                            <button
                              type="button"
                              className="btnLink"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingFolderId(null);
                                setFolderDraftEdit("");
                              }}
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <>
                            <span>{folder.name}</span>
                            <button
                              className="btnLink"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingFolderId(folder.id);
                                setFolderDraftEdit(folder.name);
                              }}
                              title="Rename folder"
                            >
                              Rename
                            </button>
                          </>
                        )}
                      </div>
                        <select
                          aria-label="Move folder"
                          value={moveFolderPick[folder.id] ?? ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                            const value = e.target.value;
                            if (!value) return;

                            try {
                              if (value.startsWith("space:")) {
                                const sid = Number(value.slice("space:".length));
                                // no-op if same space
                                if (Number.isFinite(sid) && sid !== space.id) {
                                  await moveFolder(folder.id, sid);

                                  // refresh source + destination folder lists
                                  const [src, dst] = await Promise.all([
                                    getFolders(space.id),
                                    getFolders(sid),
                                  ]);
                                  setFoldersBySpace(prev => ({ ...prev, [space.id]: src, [sid]: dst }));

                                  // (optional) auto-expand destination space to show the moved folder
                                  setExpandedSpaces(prev => ({ ...prev, [sid]: true }));
                                }
                              }
                            } finally {
                              // reset dropdown
                              setMoveFolderPick(prev => ({ ...prev, [folder.id]: "" }));
                            }
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <option value="">Move to…</option>
                          <optgroup label="Spaces">
                            {spaces.map(s => (
                              <option
                                key={`space-move-${folder.id}-${s.id}`}
                                value={`space:${s.id}`}
                                disabled={s.id === space.id} // prevent no-op
                              >
                                {s.name}{s.id === space.id ? " (current)" : ""}
                              </option>
                            ))}
                          </optgroup>
                        </select>

                      <button
                        className="btnLink"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(space.id, folder.id);
                        }}
                        title="Delete folder"
                      >
                        Delete
                      </button>
                    </div>


                    {expandedFolders[folder.id] && (
                      <div style={styles.lists}>
                        {/* Add LIST under THIS FOLDER */}
                        <div style={{ display: "flex", gap: 6, margin: "4px 0 8px 18px" }}>
                          <input
                            placeholder="New list..."
                            value={activeFolderForNewList === folder.id ? listName : ""}
                            onChange={(e) => {
                              setActiveFolderForNewList(folder.id);
                              setListName(e.target.value);
                            }}
                            style={styles.inputSm}
                          />
                          <button
                            className="btnLink"
                            onClick={() => handleAddListAtFolder(folder.id)}
                          >
                            + List
                          </button>
                        </div>

                        {(listsByFolder[folder.id] || []).map((list) => (
                          <div
                            key={list.id}
                            style={{
                              ...styles.listRow,
                              ...(selectedListId === list.id ? styles.listRowActive : {}),
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 6,
                              // (add marginLeft when rendering space-level lists if you had that)
                            }}
                          >
                            <div>
                              {editingListId === list.id ? (
                                <form
                                  onSubmit={async (e) => {
                                    e.preventDefault();
                                    if (!listDraftEdit.trim()) return;
                                    await renameList(list.id, listDraftEdit.trim());
                                    setEditingListId(null);
                                    setListDraftEdit("");

                                    // refresh the correct list collection
                                    if (list.folder_id) {
                                      const ls = await getFolderLists(list.folder_id);
                                      setListsByFolder((m) => ({ ...m, [list.folder_id!]: ls }));
                                    } else {
                                      const ls = await getSpaceLists(list.space_id);
                                      setListsBySpace((m) => ({ ...m, [list.space_id]: ls }));
                                    }
                                  }}
                                  style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                                >
                                  <input
                                    autoFocus
                                    value={listDraftEdit}
                                    onChange={(e) => setListDraftEdit(e.target.value)}
                                    style={styles.inputSm}
                                  />
                                  <button className="btnLink" type="submit">Save</button>
                                  <button
                                    type="button"
                                    className="btnLink"
                                    onClick={() => {
                                      setEditingListId(null);
                                      setListDraftEdit("");
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </form>
                              ) : (
                                <>
                                  <button
                                    onClick={() => onSelectList(list.id)}
                                    className="btnLink"
                                    title="Show tasks"
                                  >
                                    {list.name}
                                  </button>
                                  <button
                                    className="btnLink"
                                    onClick={() => {
                                      setEditingListId(list.id);
                                      setListDraftEdit(list.name);
                                    }}
                                  >
                                    Rename
                                  </button>
                                </>
                              )}
                            </div>

                            <button
                              onClick={() =>
                                handleDeleteList(list.folder_id ?? null, list.id, list.space_id)
                              }
                              className="btnLink"
                              title="Delete list"
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 280,
    borderRight: "1px solid #e5e7eb",
    paddingTop: 12,
    paddingBottom: 12,
    overflowY: "auto",
    height: "100vh",
  },
  sectionHeader: {
    fontWeight: 600,
    fontSize: 14,
    color: "#374151",
    padding: "0 12px 8px",
  },
  spaceBlock: { marginBottom: 8 },
  spaceRow: {
    cursor: "pointer",
    padding: "6px 12px",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  folders: {},
  folderRow: {
    cursor: "pointer",
    padding: "6px 0",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  lists: { marginLeft: 18 },
  listRow: {
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    margin: "2px 0",
  },
  listRowActive: {
    background: "#eef2ff",
  },
  chev: { width: 14, display: "inline-block" },

  // Inputs
  input: {
    width: "60%",
    padding: "6px 8px",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    outline: "none",
  },
  inputSm: {
    width: 160,
    padding: "4px 6px",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    outline: "none",
  },
}