export type Connection = {
  id: string;
  name: string;
  bucket: string;
  region: string;
  prefix: string;
  endpoint?: string;
};

export type Item = {
  name: string;
  key: string;
  kind: "file" | "folder";
  size?: number;
  modified?: string;
};
export type BrowseResponse = {
  items: Item[];
  nextToken?: string;
  hasMore: boolean;
};
export type BrowseKind = "all" | "file" | "folder";
export type Settings = { theme?: "light" | "dark" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = response.ok ? "" : await response.text();

  if (!response.ok) {
    const needsLogin =
      response.status === 401 ||
      (response.status === 423 && body.includes("sign in required"));
    if (needsLogin) {
      window.location.assign(
        `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
    }
    throw new Error(body);
  }

  return response.headers.get("content-type")?.includes("json")
    ? response.json()
    : (undefined as T);
}

export const api = {
  me: () => request<{ authenticated: boolean; name?: string }>("/api/me"),
  status: () => request<{ exists: boolean }>("/api/vault/status"),
  unlock: (password: string) =>
    request<Connection[]>("/api/vault/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  lock: () => request<void>("/api/vault/lock", { method: "POST" }),
  destroyVault: () => request<void>("/api/vault", { method: "DELETE" }),
  settings: () => request<Settings>("/api/settings"),
  updateSettings: (settings: Settings) =>
    request<Settings>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }),
  browse: (
    id: string,
    prefix: string,
    kind: BrowseKind = "all",
    nextToken = "",
  ) =>
    request<BrowseResponse>(
      `/api/browse?connection=${id}&prefix=${encodeURIComponent(prefix)}&kind=${kind}${nextToken ? `&continuationToken=${encodeURIComponent(nextToken)}` : ""}`,
    ),
  connections: () => request<Connection[]>("/api/connections"),
  addConnection: (value: object) =>
    request<{ id: string }>("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
  testConnection: (value: object) =>
    request<void>("/api/connections/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
  updateConnection: (value: object) =>
    request<void>("/api/connections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
  deleteConnection: (id: string) =>
    request<void>(`/api/connections?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  createFolder: (id: string, prefix: string, name: string) =>
    request<{ key: string }>(
      "/api/folders?connection=" + encodeURIComponent(id),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, name }),
      },
    ),
  deleteFile: (id: string, key: string) =>
    request<void>(`/api/file?connection=${id}&key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),
  download: (id: string, prefix: string, format: "zip" | "tgz") =>
    fetch(
      `/api/download?connection=${id}&prefix=${encodeURIComponent(prefix)}&format=${format}`,
    ).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return response.blob();
    }),
  upload: (
    id: string,
    prefix: string,
    file: File,
    onProgress?: (value: number) => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `/api/upload?connection=${id}&prefix=${encodeURIComponent(prefix)}`,
      );
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(xhr.responseText || "Upload failed"));
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(body);
    });
  },
};
