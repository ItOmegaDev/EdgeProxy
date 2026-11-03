import fs from "fs";
import crypto from "crypto";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { hashToken, isAllowedCollection, redactSecrets } from "./security";

export interface SqlQueryResult {
  rows: any[];
  rowCount: number;
  fields: { name: string; dataType?: string }[];
  latencyMs: number;
  source: "firebase-firestore" | "embedded-engine";
}

let firebaseApp: App | null = null;
let firestoreDb: Firestore | null = null;
let isFirestoreReady = false;
let activeProjectId = "";
let activeDatabaseId = "(default)";
let lastInitError = "";

/**
 * Loads a Firebase Admin credential from, in order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON or base64-encoded JSON)
 *   2. GOOGLE_APPLICATION_CREDENTIALS (path to a service-account JSON file)
 *   3. Application Default Credentials, but only when FIREBASE_PROJECT_ID is set
 *
 * The browser Firebase config is intentionally not used: the control plane needs
 * admin privileges, and Firestore rules deny all direct client access.
 */
function loadCredential(): Credential | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    const raw = inline.startsWith("{") ? inline : Buffer.from(inline, "base64").toString("utf8");
    return cert(JSON.parse(raw));
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    const stat = fs.statSync(credentialsPath);
    if (!stat.isFile()) {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS does not point to a file");
    }
    return cert(JSON.parse(fs.readFileSync(credentialsPath, "utf8")));
  }

  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return applicationDefault();
  }

  return null;
}

export async function initDb(): Promise<boolean> {
  try {
    const credential = loadCredential();
    if (!credential) {
      lastInitError = "No Firebase Admin credentials configured";
      console.warn(
        "[Firebase] Admin credentials not configured. Running with in-memory state only.",
      );
      return false;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || undefined;
    const databaseId = process.env.FIREBASE_DATABASE_ID?.trim() || "(default)";

    firebaseApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential,
            projectId,
          });

    firestoreDb =
      databaseId !== "(default)" ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);

    activeProjectId = projectId || firebaseApp.options.projectId || "(unknown)";
    activeDatabaseId = databaseId;

    // Ping the database so misconfiguration is detected at startup.
    await firestoreDb.collection("tunnels").limit(1).get();

    // Optional admin seed. Never runs without an explicit key, and only the
    // hash of that key is stored.
    const seedAdminKey = process.env.SEED_ADMIN_API_KEY?.trim();
    if (seedAdminKey) {
      const usersCol = firestoreDb.collection("users");
      const existing = await usersCol.limit(1).get();
      if (existing.empty) {
        await usersCol.doc("00000000-0000-0000-0000-000000000001").set({
          id: "00000000-0000-0000-0000-000000000001",
          email: process.env.SEED_ADMIN_EMAIL?.trim() || "admin@localhost",
          api_key_hash: hashToken(seedAdminKey),
          api_key_last4: seedAdminKey.slice(-4),
          plan_tier: "enterprise",
          max_tunnels: 50,
          max_rps: 1000,
          created_at: new Date().toISOString(),
        });
        console.log("[Firebase] Seeded the initial admin account (hash only).");
      }
    }

    isFirestoreReady = true;
    lastInitError = "";
    console.log(
      `[Firebase] Connected to project ${activeProjectId}, database ${activeDatabaseId}`,
    );
    return true;
  } catch (err: any) {
    lastInitError = String(err?.message || err);
    isFirestoreReady = false;
    console.warn("[Firebase] Initialization failed:", lastInitError);
    return false;
  }
}

function safeDocId(value: unknown, fallback: string): string {
  const candidate = String(value ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 120);
  return candidate || fallback;
}

export async function dbGetTunnels(): Promise<any[]> {
  if (!isFirestoreReady || !firestoreDb) return [];
  const snap = await firestoreDb.collection("tunnels").get();
  return snap.docs.map((d) => redactSecrets({ id: d.id, ...d.data() }));
}

export async function dbInsertTunnel(tunnel: any): Promise<any> {
  const tunnelId = safeDocId(tunnel.id, `tun-${Date.now()}`);
  const record: Record<string, unknown> = {
    id: tunnelId,
    subdomain: tunnel.subdomain,
    target_port: Number(tunnel.target_port || tunnel.localPort || 8080),
    protocol: tunnel.protocol || "quic",
    tls_status: tunnel.tls_status || "active",
    auth_enabled: Boolean(tunnel.auth_enabled),
    auth_user: tunnel.auth_user || null,
    is_active: tunnel.is_active !== undefined ? Boolean(tunnel.is_active) : true,
    total_requests: Number(tunnel.total_requests || 0),
    bytes_transferred: Number(tunnel.bytes_transferred || 0),
    avg_latency: Number(tunnel.avg_latency || 0),
    created_at: tunnel.created_at || new Date().toISOString(),
    last_ping_at: new Date().toISOString(),
  };

  if (tunnel.token_hash !== undefined) {
    record.token_hash = tunnel.token_hash;
  }
  if (tunnel.token_last4 !== undefined) {
    record.token_last4 = tunnel.token_last4;
  }

  if (isFirestoreReady && firestoreDb) {
    await firestoreDb.collection("tunnels").doc(tunnelId).set(record, { merge: true });
  }
  return record;
}

export async function dbDeleteTunnel(id: string): Promise<boolean> {
  if (!isFirestoreReady || !firestoreDb) return false;
  await firestoreDb.collection("tunnels").doc(safeDocId(id, "invalid")).delete();
  return true;
}

export async function dbInsertTrafficLog(logEntry: any): Promise<void> {
  if (!isFirestoreReady || !firestoreDb) return;
  try {
    const logId = safeDocId(
      logEntry.id,
      `log-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    );
    await firestoreDb.collection("traffic_logs").doc(logId).set({
      id: logId,
      tunnel_id: logEntry.tunnelId || null,
      subdomain: logEntry.subdomain || null,
      timestamp: logEntry.timestamp || new Date().toISOString(),
      method: logEntry.method || "GET",
      path: logEntry.path || "/",
      status_code: Number(logEntry.statusCode || 200),
      latency_ms: Number(logEntry.latencyMs || 0),
      bytes_in: Number(logEntry.bytesIn || 0),
      bytes_out: Number(logEntry.bytesOut || 0),
      client_ip: logEntry.clientIp || "127.0.0.1",
      blocked_by_shield: Boolean(logEntry.blockedByShield),
    });
  } catch {
    // Traffic logging must never break request handling.
  }
}

export async function dbGetTrafficLogs(limitCount = 50): Promise<any[]> {
  if (!isFirestoreReady || !firestoreDb) return [];
  const safeLimit = Math.min(Math.max(Number(limitCount) || 50, 1), 100);
  const snap = await firestoreDb
    .collection("traffic_logs")
    .orderBy("timestamp", "desc")
    .limit(safeLimit)
    .get();
  return snap.docs.map((d) => redactSecrets({ id: d.id, ...d.data() }));
}

export async function dbGetUsers(): Promise<any[]> {
  if (!isFirestoreReady || !firestoreDb) return [];
  const snap = await firestoreDb.collection("users").get();
  return snap.docs.map((d) => redactSecrets({ id: d.id, ...d.data() }));
}

export async function dbGetCollectionDocs(collectionName: string, limitCount = 50): Promise<any[]> {
  if (!isFirestoreReady || !firestoreDb) return [];
  if (!isAllowedCollection(collectionName)) {
    throw new Error("Collection is not exposed by the control plane");
  }
  const safeLimit = Math.min(Math.max(Number(limitCount) || 50, 1), 100);
  const snap = await firestoreDb.collection(collectionName).limit(safeLimit).get();
  return snap.docs.map((d) => redactSecrets({ id: d.id, ...d.data() }));
}

export async function dbInsertSampleDoc(collectionName: string, data: any): Promise<any> {
  if (!isAllowedCollection(collectionName)) {
    throw new Error("Collection is not writable through the control plane");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Document body must be a JSON object");
  }

  const docId = safeDocId(data.id, `${collectionName.slice(0, 3)}-${Date.now()}`);
  const record = redactSecrets({
    ...data,
    id: docId,
    updated_at: new Date().toISOString(),
  });

  if (isFirestoreReady && firestoreDb) {
    await firestoreDb.collection(collectionName).doc(docId).set(record, { merge: true });
  }
  return record;
}

/**
 * A deliberately narrow, read-only query interface over allowlisted Firestore
 * collections. This is not a SQL engine and never accepts writes.
 */
export async function executeQuery(sqlText: string, _params: any[] = []): Promise<SqlQueryResult> {
  const start = performance.now();
  const queryText = sqlText.trim();

  if (!/^select\b/i.test(queryText)) {
    throw new Error("Only read-only SELECT queries are allowed");
  }
  if (/;/.test(queryText)) {
    throw new Error("Multiple statements are not allowed");
  }

  const fromMatch = /\bfrom\s+([a-zA-Z0-9_]+)/i.exec(queryText);
  const collectionName = fromMatch?.[1] || "tunnels";
  if (!isAllowedCollection(collectionName)) {
    throw new Error("Collection is not exposed by the control plane");
  }

  const limitMatch = /\blimit\s+(\d+)/i.exec(queryText);
  const requestedLimit = limitMatch ? parseInt(limitMatch[1], 10) : 50;

  if (isFirestoreReady && firestoreDb) {
    const snap = await firestoreDb
      .collection(collectionName)
      .limit(Math.min(Math.max(requestedLimit, 1), 100))
      .get();
    const rows = snap.docs.map((d) => redactSecrets({ id: d.id, ...d.data() }));
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    const fields =
      rows.length > 0 ? Object.keys(rows[0]).map((name) => ({ name })) : [{ name: "id" }];

    return {
      rows,
      rowCount: rows.length,
      fields,
      latencyMs,
      source: "firebase-firestore",
    };
  }

  return {
    rows: [],
    rowCount: 0,
    fields: [{ name: "id" }, { name: "status" }],
    latencyMs: Math.round((performance.now() - start) * 100) / 100,
    source: "embedded-engine",
  };
}

export function dbGetStatus() {
  return {
    engine: "Firebase Firestore (Admin SDK)",
    isReady: isFirestoreReady,
    projectId: activeProjectId || null,
    databaseId: activeDatabaseId,
    status: isFirestoreReady ? "connected" : "not-configured",
    error: isFirestoreReady ? null : "not-connected",
    collections: ["tunnels", "traffic_logs", "users", "rate_limit_rules", "certificates"],
  };
}

export async function dbGetCertificates(): Promise<any[]> {
  if (!isFirestoreReady || !firestoreDb) return [];
  const snap = await firestoreDb.collection("certificates").get();
  return snap.docs.map((d) => redactSecrets({ id: d.id, ...d.data() }));
}

export async function dbSaveCertificate(certificateRecord: any): Promise<void> {
  if (!isFirestoreReady || !firestoreDb || !certificateRecord?.id) return;
  const id = safeDocId(certificateRecord.id, `cert-${Date.now()}`);
  await firestoreDb
    .collection("certificates")
    .doc(id)
    .set(redactSecrets({ ...certificateRecord, id }), { merge: true });
}
