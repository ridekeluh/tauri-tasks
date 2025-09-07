// src/types.ts
export interface Space {
  id: number;
  name: string;
}

export interface Folder {
  id: number;
  space_id: number;
  name: string;
}

export interface List {
  id: number;
  folder_id: number;
  name: string;
}

export interface Task {
  id: number;
  list_id: number;
  title: string;
  done: number; // 0 | 1
}
