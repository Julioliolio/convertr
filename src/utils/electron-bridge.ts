interface ElectronAPI {
  startDrag: (filePath: string) => void;
  getOutputPath: (jobId: string) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return !!window.electronAPI;
}

export function startDrag(filePath: string): void {
  window.electronAPI?.startDrag(filePath);
}

export async function getOutputPath(jobId: string): Promise<string | null> {
  return window.electronAPI?.getOutputPath(jobId) ?? null;
}
