declare global {
  interface Window {
    mugdown: {
      importImage(id: string, name: string, data: Uint8Array): Promise<string>;
      imageSource(id: string, url: string): Promise<string>;
      openExternal(url: string): Promise<void>;
      writeClipboard(data: { text: string; html?: string }): Promise<void>;
      readClipboard(): Promise<{ text: string; html: string }>;
    };
  }
}
export {};
