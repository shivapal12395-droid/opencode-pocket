/**
 * Durable, local-only conversation history.
 *
 * OpenCode's own database is the authoritative upstream source. This store is
 * a recovery copy on the device: it is never expired, never deleted on app
 * updates or server restarts, and only removed when the user explicitly asks.
 * IndexedDB is used because it survives app process death and works offline.
 */
const DB_NAME = "opencode-pocket-history";
const DB_VERSION = 1;

let dbName = DB_NAME;
let dbPromise = null;

/**
 * Demo transcripts are fake, and they live on the same origin as the real app.
 * Keeping them in this database made the real client offer them as "saved
 * copies of a conversation the server no longer has". Demo mode therefore uses
 * its own database and can never write into the real recovery copy.
 */
export function useDemoNamespace() {
  if (dbName === DB_NAME + "-demo") return;
  try {
    dbPromise?.then((db) => db.close()).catch(() => {});
  } catch {}
  dbName = DB_NAME + "-demo";
  dbPromise = null;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const tx = async (store, mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
};

const key = (sessionID, id) => `${sessionID}:${id}`;

export async function putSession(session) {
  if (!session?.id) return;
  await tx("sessions", "readwrite", (s) =>
    s.put({ ...session, _savedAt: Date.now(), _workspace: session.location?.directory ?? null })
  );
}

export async function putSessions(sessions) {
  for (const s of sessions ?? []) await putSession(s);
}

export async function putMessages(sessionID, messages) {
  if (!sessionID) return;
  await tx("messages", "readwrite", (s) => {
    for (const m of messages ?? []) {
      if (m?.id) s.put({ key: key(sessionID, m.id), sessionID, ...m });
    }
  });
}

export async function getSessions() {
  return (await tx("sessions", "readonly", (s) => s.getAll())) ?? [];
}

export async function getMessages(sessionID) {
  const all = (await tx("messages", "readonly", (s) => s.getAll())) ?? [];
  return all.filter((m) => m.sessionID === sessionID).map(({ key: _k, sessionID: _s, ...m }) => m);
}

export async function deleteSession(sessionID) {
  await tx("sessions", "readwrite", (s) => s.delete(sessionID));
  const all = (await tx("messages", "readonly", (s) => s.getAll())) ?? [];
  await tx("messages", "readwrite", (s) => {
    for (const m of all.filter((x) => x.sessionID === sessionID)) s.delete(m.key);
  });
}

export async function clearAll() {
  await tx("sessions", "readwrite", (s) => s.clear());
  await tx("messages", "readwrite", (s) => s.clear());
}

export async function exportAll() {
  return {
    format: "opencode-pocket-local-history",
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: await getSessions(),
    messages: Object.fromEntries(
      (await tx("sessions", "readonly", (s) => s.getAll())).map((x) => [x.id, null])
    ),
  };
}

export async function exportWithMessages() {
  const sessions = await getSessions();
  const messages = {};
  for (const s of sessions) messages[s.id] = await getMessages(s.id);
  return { format: "opencode-pocket-local-history", version: 1, exportedAt: new Date().toISOString(), sessions, messages };
}

export async function importAll(data) {
  if (data?.format !== "opencode-pocket-local-history" || !Array.isArray(data.sessions)) {
    throw new Error("Not a Pocket local-history backup");
  }
  let n = 0;
  for (const s of data.sessions) {
    await putSession(s);
    n++;
  }
  for (const [sid, msgs] of Object.entries(data.messages ?? {})) {
    await putMessages(sid, msgs);
  }
  return n;
}
