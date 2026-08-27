import { FormEvent, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderPlus,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Sun,
} from "lucide-react";
import { api, BrowseKind, Connection, Item } from "./api";

type User = { authenticated: boolean; name?: string };
type ErrorHandler = (message: string) => void;
type ConnectionForm = {
  id?: string;
  name: string;
  bucket: string;
  region: string;
  prefix: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
};
type Activity = {
  id: string;
  label: string;
  kind: "upload" | "delete" | "download";
  progress: number;
  state: "active" | "done" | "error";
  error?: string;
};

export function App() {
  const [user, setUser] = useState<User>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnection, setActiveConnection] = useState<Connection>();
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [itemFilter, setItemFilter] = useState<BrowseKind>("all");
  const [nextToken, setNextToken] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection>();
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(() => {
    if (user && !user.authenticated) window.location.assign("/auth/login");
  }, [user]);
  useEffect(() => {
    if (user?.authenticated) setUnlockOpen(true);
  }, [user]);

  async function browse(
    connection: Connection,
    nextPrefix = "",
    kind = itemFilter,
  ) {
    setActiveConnection(connection);
    setPrefix(nextPrefix);
    setLoading(true);
    try {
      const result = await api.browse(connection.id, nextPrefix, kind);
      setItems(result.items);
      setNextToken(result.nextToken ?? "");
      setHasMore(result.hasMore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  async function loadMore() {
    if (!activeConnection || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const result = await api.browse(
        activeConnection.id,
        prefix,
        itemFilter,
        nextToken,
      );
      setItems((current) => [...current, ...result.items]);
      setNextToken(result.nextToken ?? "");
      setHasMore(result.hasMore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function addConnection(value: ConnectionForm) {
    try {
      const created = await api.addConnection(value);
      const nextConnections = await api.connections();
      setConnections(nextConnections);
      setConnectionModalOpen(false);
      const saved = nextConnections.find(
        (connection) => connection.id === created.id,
      );
      if (saved) await browse(saved);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function updateConnection(value: ConnectionForm) {
    try {
      await api.updateConnection(value);
      const nextConnections = await api.connections();
      setConnections(nextConnections);
      setEditingConnection(undefined);
      const saved = nextConnections.find(
        (connection) => connection.id === value.id,
      );
      if (saved) await browse(saved, prefix);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function deleteConnection(connection: Connection) {
    if (!window.confirm(`Delete “${connection.name}”?`)) return;
    try {
      await api.deleteConnection(connection.id);
      const nextConnections = await api.connections();
      setConnections(nextConnections);
      if (activeConnection?.id === connection.id) {
        setActiveConnection(undefined);
        setItems([]);
        setPrefix("");
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!user) return <main className="center">Loading…</main>;
  if (!user.authenticated)
    return <main className="center">Redirecting to sign in…</main>;
  return (
    <div className="layout">
      <Sidebar
        userName={user.name}
        connections={connections}
        activeConnection={activeConnection}
        onBrowse={browse}
        onAddConnection={() => setConnectionModalOpen(true)}
        onEditConnection={setEditingConnection}
        onDeleteConnection={deleteConnection}
        darkMode={darkMode}
        onToggleTheme={async () => {
          const theme = darkMode ? "light" : "dark";
          setDarkMode(theme === "dark");
          await api.updateSettings({ theme });
        }}
      />
      <Workspace
        connection={activeConnection}
        loading={loading}
        prefix={prefix}
        items={items}
        onBrowse={browse}
        onRefresh={() => activeConnection && browse(activeConnection, prefix)}
        onError={setError}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
        itemFilter={itemFilter}
        onFilterChange={(kind) => {
          setItemFilter(kind);
          if (activeConnection) browse(activeConnection, prefix, kind);
        }}
      />
      {unlockOpen && (
        <UnlockModal
          onDestroy={async () => {
            await api.destroyVault();
            setConnections([]);
            setActiveConnection(undefined);
            setPrefix("");
            setItems([]);
          }}
          onUnlock={async (password) => {
            try {
              setConnections(await api.unlock(password));
              setDarkMode((await api.settings()).theme === "dark");
              setUnlockOpen(false);
            } catch (err) {
              setError(errorMessage(err));
              throw err;
            }
          }}
        />
      )}
      {connectionModalOpen && (
        <ConnectionModal
          onCancel={() => setConnectionModalOpen(false)}
          onSubmit={addConnection}
          onTest={api.testConnection}
        />
      )}
      {editingConnection && (
        <ConnectionModal
          connection={editingConnection}
          onCancel={() => setEditingConnection(undefined)}
          onSubmit={updateConnection}
          onTest={api.testConnection}
        />
      )}
      {error && (
        <div className="toast" onClick={() => setError("")}>
          {error}
        </div>
      )}
    </div>
  );
}

function Login() {
  return (
    <main className="center">
      <section className="card login">
        <div className="logo">mariner</div>
        <h1>Private S3, clearly managed.</h1>
        <p>
          Sign in with your identity provider to access your encrypted bucket
          connections.
        </p>
        <a className="button" href="/auth/login">
          Continue with OIDC
        </a>
      </section>
    </main>
  );
}

function Sidebar({
  userName,
  connections,
  activeConnection,
  onBrowse,
  onAddConnection,
  onEditConnection,
  onDeleteConnection,
  darkMode,
  onToggleTheme,
}: {
  userName?: string;
  connections: Connection[];
  activeConnection?: Connection;
  onBrowse: (connection: Connection) => void;
  onAddConnection: () => void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (connection: Connection) => void;
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <aside>
      <div className="logo">mariner</div>
      <span className="eyebrow">SIGNED IN AS</span>
      <p>{userName?.trim() || "OIDC user"}</p>
      <span className="eyebrow">CONNECTIONS</span>
      {connections.map((connection) => (
        <button
          className={
            activeConnection?.id === connection.id
              ? "connection active"
              : "connection"
          }
          onClick={() => onBrowse(connection)}
          key={connection.id}
        >
          <span className="connection-label">
            {connection.name}
            <small>{connection.bucket}</small>
          </span>
          {!connection.id.includes(":") && (
            <span className="connection-actions">
              <span
                role="button"
                tabIndex={0}
                aria-label={`Edit ${connection.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onEditConnection(connection);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    onEditConnection(connection);
                  }
                }}
              >
                <Pencil size={14} />
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${connection.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteConnection(connection);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    onDeleteConnection(connection);
                  }
                }}
              >
                <Trash2 size={14} />
              </span>
            </span>
          )}
        </button>
      ))}
      <button className="secondary add" onClick={onAddConnection}>
        <Plus size={16} /> Add connection
      </button>
      <button className="lock theme-toggle" onClick={onToggleTheme}>
        {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        {darkMode ? "Light theme" : "Dark theme"}
      </button>
      <button
        className="lock"
        onClick={() => api.lock().then(() => window.location.reload())}
      >
        <LockKeyhole size={15} /> Lock vault
      </button>
    </aside>
  );
}

function Workspace({
  connection,
  loading,
  prefix,
  items,
  onBrowse,
  onRefresh,
  onError,
  hasMore,
  onLoadMore,
  loadingMore,
  itemFilter,
  onFilterChange,
}: {
  connection?: Connection;
  loading: boolean;
  prefix: string;
  items: Item[];
  onBrowse: (connection: Connection, prefix?: string) => void;
  onRefresh: () => void;
  onError: ErrorHandler;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  loadingMore: boolean;
  itemFilter: BrowseKind;
  onFilterChange: (kind: BrowseKind) => void;
}) {
  return (
    <main className="content">
      <header>
        <div>
          <span className="eyebrow">BUCKET EXPLORER</span>
          <h1>{connection?.name ?? "Your workspace"}</h1>
        </div>
        <a className="sign-out" href="/auth/logout">
          Sign out
        </a>
      </header>
      {connection ? (
        loading ? (
          <section className="card loading-state">
            <LoaderCircle className="spin" size={28} />
            <strong>Loading bucket contents</strong>
            <p>Connecting to {connection.bucket}…</p>
          </section>
        ) : (
          <Explorer
            connection={connection}
            prefix={prefix}
            items={items}
            onBrowse={onBrowse}
            onRefresh={onRefresh}
            onError={onError}
            hasMore={hasMore}
            onLoadMore={onLoadMore}
            loadingMore={loadingMore}
            itemFilter={itemFilter}
            onFilterChange={onFilterChange}
          />
        )
      ) : (
        <section className="card empty">
          <Folder size={38} />
          <h2>Choose a connection</h2>
          <p>Select a bucket from the sidebar or add your first one.</p>
        </section>
      )}
    </main>
  );
}

function UnlockModal({
  onUnlock,
  onDestroy,
}: {
  onUnlock: (password: string) => Promise<void>;
  onDestroy: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password) await onUnlock(password);
  }
  return (
    <div className="modal-backdrop">
      <form className="card unlock" onSubmit={submit}>
        <h2>Unlock your vault</h2>
        <p>Enter your master password to access your encrypted connections.</p>
        <div className="password-field">
          <input
            autoFocus
            type={visible ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Master password"
            minLength={10}
            required
          />
          <button
            type="button"
            className="icon password-toggle"
            aria-label={visible ? "Hide password" : "Show password"}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <button className="button" type="submit">
          Unlock vault
        </button>
        {!confirmDestroy ? (
          <button
            type="button"
            className="forgot-password"
            onClick={() => setConfirmDestroy(true)}
          >
            <AlertTriangle size={15} />
            Forgot your master password?
          </button>
        ) : (
          <div className="danger-panel">
            <div className="danger-heading">
              <AlertTriangle size={18} />
              <strong>Destroy this vault?</strong>
            </div>
            <p>
              This permanently deletes every saved connection. It cannot be
              undone, and you will need to create a new master password.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setConfirmDestroy(false)}
              >
                Keep vault
              </button>
              <button type="button" className="danger" onClick={onDestroy}>
                Destroy vault
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

function ConnectionModal({
  connection,
  onCancel,
  onSubmit,
  onTest,
}: {
  connection?: Connection;
  onCancel: () => void;
  onSubmit: (value: ConnectionForm) => Promise<void>;
  onTest: (value: ConnectionForm) => Promise<void>;
}) {
  const [form, setForm] = useState<ConnectionForm>({
    id: connection?.id,
    name: connection?.name ?? "",
    bucket: connection?.bucket ?? "",
    region: connection?.region ?? "us-east-1",
    prefix: connection?.prefix ?? "",
    endpoint: connection?.endpoint ?? "",
    accessKey: "",
    secretKey: "",
  });
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const update =
    (field: keyof ConnectionForm) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm({ ...form, [field]: event.target.value });
      setTested(false);
      setTestError("");
    };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!tested) return;
    await onSubmit(form);
  }
  async function test() {
    setTesting(true);
    setTestError("");
    try {
      await onTest(form);
      setTested(true);
    } catch (err) {
      setTestError(errorMessage(err));
      setTested(false);
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="card connection-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">
              {connection ? "EDIT CONNECTION" : "NEW CONNECTION"}
            </span>
            <h2>
              {connection ? "Edit S3 connection" : "Add an S3 connection"}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="modal-description">
          {connection
            ? "Update the connection details. Leave credentials blank to keep the current values."
            : "Connection credentials are encrypted in your personal vault."}
        </p>
        <div className="form-grid">
          <label>
            Connection name
            <input
              autoFocus
              value={form.name}
              onChange={update("name")}
              placeholder="Production bucket"
              required
            />
          </label>
          <label>
            Bucket name
            <input
              value={form.bucket}
              onChange={update("bucket")}
              placeholder="my-bucket"
              required
            />
          </label>
          <label>
            Region
            <input
              value={form.region}
              onChange={update("region")}
              placeholder="us-east-1"
              required
            />
          </label>
          <label>
            Prefix <span>(optional)</span>
            <input
              value={form.prefix}
              onChange={update("prefix")}
              placeholder="folder/"
            />
          </label>
          <label className="full-width">
            S3 endpoint <span>(optional)</span>
            <input
              value={form.endpoint}
              onChange={update("endpoint")}
              placeholder="https://s3.example.com"
            />
          </label>
          <label>
            Access key <span>(optional)</span>
            <input
              value={form.accessKey}
              onChange={update("accessKey")}
              autoComplete="off"
            />
          </label>
          <label>
            Secret key <span>(optional)</span>
            <input
              value={form.secretKey}
              onChange={update("secretKey")}
              type="password"
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="secondary"
            onClick={test}
            disabled={testing || !form.bucket || !form.name}
          >
            {testing
              ? "Testing…"
              : tested
                ? "Connection tested"
                : "Test connection"}
          </button>
          <button type="submit" className="button" disabled={!tested}>
            {connection ? "Save changes" : "Save connection"}
          </button>
        </div>
        {testError && <p className="form-error">{testError}</p>}
      </form>
    </div>
  );
}

function Explorer({
  connection,
  prefix,
  items,
  onBrowse,
  onRefresh,
  onError,
  hasMore,
  onLoadMore,
  loadingMore,
  itemFilter,
  onFilterChange,
}: {
  connection: Connection;
  prefix: string;
  items: Item[];
  onBrowse: (connection: Connection, prefix?: string) => void;
  onRefresh: () => void;
  onError: ErrorHandler;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  loadingMore: boolean;
  itemFilter: BrowseKind;
  onFilterChange: (kind: BrowseKind) => void;
}) {
  const [folderOpen, setFolderOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Item>();
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const visibleItems = items;
  async function downloadArchive(format: "zip" | "tgz") {
    const id = `${Date.now()}-${format}`;
    const label = `${connection.bucket}${prefix ? `/${prefix}` : ""}.${format}`;
    setActivities((current) => [
      ...current,
      { id, label, kind: "download", progress: 35, state: "active" },
    ]);
    try {
      const blob = await api.download(connection.id, prefix, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = label;
      link.click();
      URL.revokeObjectURL(url);
      setActivities((current) =>
        current.map((item) =>
          item.id === id ? { ...item, progress: 100, state: "done" } : item,
        ),
      );
    } catch (err) {
      setActivities((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, state: "error", error: errorMessage(err) }
            : item,
        ),
      );
    }
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string>();

  function toggleSelected(key: string) {
    setSelectionAnchor(key);
    setSelected((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function selectFromRow(key: string, event: React.MouseEvent) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return false;
    if (event.shiftKey && selectionAnchor) {
      const keys = visibleItems.map((item) => item.key);
      const start = keys.indexOf(selectionAnchor),
        end = keys.indexOf(key);
      if (start >= 0 && end >= 0)
        setSelected(
          (current) =>
            new Set([
              ...current,
              ...keys.slice(Math.min(start, end), Math.max(start, end) + 1),
            ]),
        );
    } else toggleSelected(key);
    return true;
  }
  function selectAll() {
    setSelected(
      (current) =>
        new Set([...current, ...visibleItems.map((item) => item.key)]),
    );
  }
  async function deleteSelected() {
    if (!selected.size) return;
    setDeleteSelectionOpen(true);
  }
  async function confirmDeleteSelected() {
    const pending = Array.from(selected).map((key, index) => {
      const item = items.find((candidate) => candidate.key === key);
      return {
        key,
        id: `${Date.now()}-${index}-${key}`,
        label: item?.name || key,
      };
    });
    setActivities((current) => [
      ...current,
      ...pending.map(({ id, label }) => ({
        id,
        label,
        kind: "delete" as const,
        progress: 0,
        state: "active" as const,
      })),
    ]);
    await Promise.all(
      pending.map(async ({ key, id }) => {
        try {
          await api.deleteFile(connection.id, key);
          setActivities((current) =>
            current.map((activity) =>
              activity.id === id
                ? { ...activity, progress: 100, state: "done" }
                : activity,
            ),
          );
        } catch (err) {
          setActivities((current) =>
            current.map((activity) =>
              activity.id === id
                ? { ...activity, state: "error", error: errorMessage(err) }
                : activity,
            ),
          );
        }
      }),
    );
    setSelected(new Set());
    onRefresh();
  }

  async function uploadFiles(files: FileList | File[]) {
    const pending = Array.from(files).map((file, index) => ({
      file,
      id: `${Date.now()}-${index}-${file.name}`,
    }));
    setActivities((current) => [
      ...current,
      ...pending.map(({ file, id }) => ({
        id,
        label: file.name,
        kind: "upload" as const,
        progress: 0,
        state: "active" as const,
      })),
    ]);
    await Promise.all(
      pending.map(async ({ file, id }) => {
        try {
          await api.upload(connection.id, prefix, file, (progress) =>
            setActivities((current) =>
              current.map((item) =>
                item.id === id ? { ...item, progress } : item,
              ),
            ),
          );
          setActivities((current) =>
            current.map((item) =>
              item.id === id ? { ...item, progress: 100, state: "done" } : item,
            ),
          );
        } catch (err) {
          setActivities((current) =>
            current.map((item) =>
              item.id === id
                ? { ...item, state: "error", error: errorMessage(err) }
                : item,
            ),
          );
        }
      }),
    );
    onRefresh();
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) await uploadFiles(event.target.files);
    event.target.value = "";
  }
  function drop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files);
  }
  return (
    <section
      className={`card explorer ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <div className="toolbar">
        <strong onClick={() => onBrowse(connection, "")}>
          {connection.bucket}
        </strong>
        <span>{prefix}</span>
        <label className="button upload">
          <Upload size={16} /> Upload
          <input type="file" multiple onChange={upload} />
        </label>
        <button className="secondary" onClick={() => setFolderOpen(true)}>
          <FolderPlus size={16} /> New folder
        </button>
        <DownloadMenu onDownload={downloadArchive} />
        <button
          className="secondary"
          onClick={
            visibleItems.length > 0 &&
            visibleItems.every((item) => selected.has(item.key))
              ? () =>
                  setSelected(
                    (current) =>
                      new Set(
                        [...current].filter(
                          (key) =>
                            !visibleItems.some((item) => item.key === key),
                        ),
                      ),
                  )
              : selectAll
          }
        >
          {visibleItems.length > 0 &&
          visibleItems.every((item) => selected.has(item.key))
            ? "Unselect all"
            : "Select all"}
        </button>
        <button
          className="danger compact"
          disabled={!selected.size}
          onClick={deleteSelected}
        >
          <Trash2 size={15} /> Delete
          {selected.size ? ` (${selected.size})` : ""}
        </button>
      </div>
      <div className="drop-hint">
        Drop files anywhere in this bucket to upload
      </div>
      <div className="table head">
        <span />
        <span>Name</span>
        <span>Type</span>
        <span>Size</span>
        <span />
      </div>
      <div className="item-filter" aria-label="Filter bucket contents">
        {(
          [
            ["all", "All"],
            ["file", "Files"],
            ["folder", "Folders"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={itemFilter === value ? "active" : ""}
            onClick={() => onFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {visibleItems.map((item) => (
        <ExplorerRow
          key={item.key}
          item={item}
          connection={connection}
          onBrowse={onBrowse}
          onRefresh={onRefresh}
          onError={onError}
          onDelete={() => setDeleteTarget(item)}
          selected={selected.has(item.key)}
          onToggleSelected={toggleSelected}
          onSelectFromRow={selectFromRow}
        />
      ))}
      {!visibleItems.length && items.length > 0 && (
        <p className="filtered-empty">
          No {itemFilter === "file" ? "files" : "folders"} in this location.
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          className="secondary load-more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore && <LoaderCircle className="spin" size={15} />}
          {loadingMore ? "Loading more…" : "Load more"}
        </button>
      )}
      {folderOpen && (
        <FolderModal
          onCancel={() => setFolderOpen(false)}
          onSubmit={async (name) => {
            await api.createFolder(connection.id, prefix, name);
            setFolderOpen(false);
            onRefresh();
          }}
        />
      )}
      {deleteTarget && (
        <DeleteFileModal
          item={deleteTarget}
          onCancel={() => setDeleteTarget(undefined)}
          onConfirm={async () => {
            const id = `${Date.now()}-${deleteTarget.key}`;
            setDeleteTarget(undefined);
            setActivities((current) => [
              ...current,
              {
                id,
                label: deleteTarget.name,
                kind: "delete",
                progress: 0,
                state: "active",
              },
            ]);
            try {
              await api.deleteFile(connection.id, deleteTarget.key);
              setActivities((current) =>
                current.map((item) =>
                  item.id === id
                    ? { ...item, progress: 100, state: "done" }
                    : item,
                ),
              );
              onRefresh();
            } catch (err) {
              setActivities((current) =>
                current.map((item) =>
                  item.id === id
                    ? { ...item, state: "error", error: errorMessage(err) }
                    : item,
                ),
              );
            }
          }}
        />
      )}
      {deleteSelectionOpen && (
        <DeleteFileModal
          count={selected.size}
          onCancel={() => setDeleteSelectionOpen(false)}
          onConfirm={async () => {
            setDeleteSelectionOpen(false);
            await confirmDeleteSelected();
          }}
        />
      )}
      <ActivityTray
        activities={activities}
        onDismiss={(id) =>
          setActivities((current) => current.filter((item) => item.id !== id))
        }
      />
    </section>
  );
}

function DownloadMenu({
  onDownload,
}: {
  onDownload: (format: "zip" | "tgz") => void;
}) {
  const [open, setOpen] = useState(false);
  function choose(format: "zip" | "tgz") {
    setOpen(false);
    onDownload(format);
  }
  return (
    <div className="download-menu">
      <button
        type="button"
        className="secondary download-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Download size={16} />
        <span>Download</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="download-options" role="menu">
          <button type="button" role="menuitem" onClick={() => choose("zip")}>
            Download ZIP
          </button>
          <button type="button" role="menuitem" onClick={() => choose("tgz")}>
            Download TGZ
          </button>
        </div>
      )}
    </div>
  );
}

function FolderModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) await onSubmit(name.trim());
  }
  return (
    <div className="modal-backdrop">
      <form className="card small-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">NEW FOLDER</span>
            <h2>Create a subfolder</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="modal-description">
          Create a folder inside the currently open bucket path.
        </p>
        <label className="standalone-label">
          Folder name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="documents"
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button">
            Create folder
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteFileModal({
  item,
  count,
  onCancel,
  onConfirm,
}: {
  item?: Item;
  count?: number;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const multiple = !item;
  return (
    <div className="modal-backdrop">
      <div className="card small-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">
              DELETE {multiple ? "FILES" : "FILE"}
            </span>
            <h2>
              {multiple
                ? `Delete ${count} selected files?`
                : "Delete this file?"}
            </h2>
          </div>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>
        <p className="modal-description">
          This will permanently delete{" "}
          {multiple ? (
            "the selected files"
          ) : (
            <>
              <strong>{item?.name}</strong>
            </>
          )}{" "}
          from the bucket. This cannot be undone.
        </p>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm}>
            Delete {multiple ? "files" : "file"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityTray({
  activities,
  onDismiss,
}: {
  activities: Activity[];
  onDismiss: (id: string) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  if (!activities.length) return null;
  return (
    <div className={`activity-tray ${minimized ? "minimized" : ""}`}>
      <div className="activity-header">
        <strong>Activity</strong>
        <button onClick={() => setMinimized((value) => !value)}>
          {minimized ? "Show" : "Minimize"}
        </button>
      </div>
      {!minimized && (
        <div className="activity-list">
          {activities.map((activity) => (
            <div className="activity" key={activity.id}>
              <div className="activity-top">
                <span>
                  {activity.kind === "upload"
                    ? "Uploading"
                    : activity.kind === "delete"
                      ? "Deleting"
                      : "Downloading"}{" "}
                  {activity.label}
                </span>
                {activity.state !== "active" && (
                  <button
                    className="activity-dismiss"
                    onClick={() => onDismiss(activity.id)}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="activity-progress">
                <span
                  className={`${activity.state} ${activity.kind !== "upload" && activity.state === "active" ? "indeterminate" : ""}`}
                  style={{ width: `${activity.progress}%` }}
                />
              </div>
              <small>
                {activity.state === "active" ? (
                  activity.kind === "upload" ? (
                    `${activity.progress}%`
                  ) : (
                    "Working…"
                  )
                ) : activity.state === "done" ? (
                  <>
                    <Check size={13} /> Complete
                  </>
                ) : (
                  activity.error || "Failed"
                )}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExplorerRow({
  item,
  connection,
  onBrowse,
  onRefresh,
  onError,
  onDelete,
  selected,
  onToggleSelected,
  onSelectFromRow,
}: {
  item: Item;
  connection: Connection;
  onBrowse: (connection: Connection, prefix?: string) => void;
  onRefresh: () => void;
  onError: ErrorHandler;
  onDelete: () => void;
  selected: boolean;
  onToggleSelected: (key: string) => void;
  onSelectFromRow: (key: string, event: React.MouseEvent) => boolean;
}) {
  async function remove(event: React.MouseEvent) {
    event.stopPropagation();
    onDelete();
  }
  return (
    <div
      className="table row"
      onClick={(event) => {
        if (onSelectFromRow(item.key, event)) return;
        return item.kind === "folder"
          ? onBrowse(connection, item.key)
          : window.open(
              `/api/file?connection=${connection.id}&key=${encodeURIComponent(item.key)}`,
            );
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelected(item.key)}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Select ${item.name}`}
      />
      <span>
        {item.kind === "folder" ? <Folder size={18} /> : <File size={18} />}{" "}
        {item.name}
      </span>
      <span>{item.kind}</span>
      <span>{item.size ? `${(item.size / 1024).toFixed(1)} KB` : "—"}</span>
      <span>
        {item.kind === "file" && (
          <button
            className="icon"
            onClick={remove}
            aria-label={`Delete ${item.name}`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
