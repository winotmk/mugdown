export interface DocumentData {
  id: string;
  path: string | null;
  name: string;
  raw: string;
  saved: string;
  revision: number;
}
export interface WindowData {
  label: string;
  ids: string[];
  active: string | null;
}
export interface Workspace {
  documents: DocumentData[];
  windows: WindowData[];
  settings: Settings;
  settingsStorage?: {
    path: string;
    location?: "portable" | "system";
    error: string | null;
  };
  presets?: {
    directory: string;
    items: { id: string; name: string; css: string }[];
    error: string | null;
  };
}
export interface Settings {
  uiTheme: string;
  markdownStyle: string;
  fontSize: number;
  contentWidth: number;
  customCss: string;
  language: string;
  toolbarPinned: boolean;
}
export type Mode = "visual" | "source";
