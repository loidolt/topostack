interface AtommExportIntent {
  intent: "download" | "openInStudio";
}

interface AtommExportFile {
  filename: string;
  blob: Blob;
}

interface AtommSdk {
  lifecycle: {
    on(event: "export", callback: (value: AtommExportIntent) => Promise<AtommExportFile | AtommExportFile[]>): void;
  };
  ui: {
    toast(options: { type?: "success" | "warning" | "error" | "info"; message: string; duration?: number }): Promise<string>;
    closeToast(id: string): Promise<void>;
  };
  app: {
    getLocale(): Promise<string>;
  };
}

interface Window {
  atomm?: AtommSdk;
}
