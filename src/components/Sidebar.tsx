// src/components/Sidebar.tsx
import { useEffect, useState } from "react";
import type { Space, Folder, List } from "../types";
import {
  getSpaces,
  getFolders,
  getLists,
  addSpace,
  addFolder,
  addList,
} from "../db";

type Props = {
  selectedListId: number | null;
  onSelectList: (listId: number) => void;
};

export default function Sidebar({ selectedListId, onSelectList }: Props) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [expandedSpaces, setExpandedSpaces] = useState<Record<number, boolean>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [foldersBySpace, setFoldersBySpace] = useState<Record<number, Folder[]>>({});
  const [listsByFolder, setListsByFolder] = useState<Record<number, List[]>>({});

  const [spaceName, setSpaceName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [listName, setListName] = useState("");

  const [activeSpaceForNewFolder, setActiveSpaceForNewFolder] = useState<number | null>(null);
  const [activeFolderForNewList, setActiveFolderForNewList] = useState<number | null>(null);

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
    if (!isOpen && !foldersBySpace[spaceId]) {
      const fs = await getFolders(spaceId);
      setFoldersBySpace((m) => ({ ...m, [spaceId]: fs }));
    }
  }

  async function toggleFolder(folderId: number, spaceId: number) {
    const isOpen = !!expandedFolders[folderId];
    setExpandedFolders((m) => ({ ...m, [folderId]: !isOpen }));
    if (!isOpen && !listsByFolder[folderId]) {
      const ls = await getLists(folderId);
      setListsByFolder((m) => ({ ...m, [folderId]: ls }));
    }
  }

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

  async function handleAddList(folderId: number) {
    if (!listName.trim()) return;
    await addList(folderId, listName.trim());
    setListName("");
    const ls = await getLists(folderId);
    setListsByFolder((m) => ({ ...m, [folderId]: ls }));
  }

  return (
    <div style={styles.sidebar}>
      <div style={styles.sectionHeader}>Spaces</div>

      <div style={{ padding: "0 8px 12px" }}>
        <input
          placeholder="New space..."
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
          style={styles.input}
        />
        <button onClick={handleAddSpace} style={styles.btn}>Add</button>
      </div>

      <div>
        {spaces.map((space) => (
          <div key={space.id} style={styles.spaceBlock}>
            <div
              style={styles.spaceRow}
              onClick={() => toggleSpace(space.id)}
              title="Toggle folders"
            >
              <span style={styles.chev}>{expandedSpaces[space.id] ? "▾" : "▸"}</span>
              <span>{space.name}</span>
            </div>

            {expandedSpaces[space.id] && (
              <div style={styles.folders}>
                {/* Add folder row */}
                <div style={{ display: "flex", gap: 6, margin: "4px 0 8px 18px" }}>
                  <input
                    placeholder="New folder..."
                    value={activeSpaceForNewFolder === space.id ? folderName : ""}
                    onChange={(e) => {
                      setActiveSpaceForNewFolder(space.id);
                      setFolderName(e.target.value);
                    }}
                    style={styles.inputSm}
                  />
                  <button
                    style={styles.btnSm}
                    onClick={() => handleAddFolder(space.id)}
                  >
                    + Folder
                  </button>
                </div>

                {(foldersBySpace[space.id] || []).map((folder) => (
                  <div key={folder.id} style={{ marginLeft: 18 }}>
                    <div
                      style={styles.folderRow}
                      onClick={() => toggleFolder(folder.id, space.id)}
                      title="Toggle lists"
                    >
                      <span style={styles.chev}>
                        {expandedFolders[folder.id] ? "▾" : "▸"}
                      </span>
                      <span>{folder.name}</span>
                    </div>

                    {expandedFolders[folder.id] && (
                      <div style={styles.lists}>
                        {/* Add list row */}
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
                            style={styles.btnSm}
                            onClick={() => handleAddList(folder.id)}
                          >
                            + List
                          </button>
                        </div>

                        {(listsByFolder[folder.id] || []).map((list) => (
                          <div
                            key={list.id}
                            onClick={() => onSelectList(list.id)}
                            style={{
                              ...styles.listRow,
                              ...(selectedListId === list.id ? styles.listRowActive : {}),
                            }}
                            title="Show tasks"
                          >
                            {list.name}
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
  btn: {
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
  },
  btnSm: {
    padding: "4px 8px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
  },
};
