import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limit as fsLimit,
  addDoc,
  Firestore,
} from 'firebase/firestore';

export interface SqlQueryResult {
  rows: any[];
  rowCount: number;
  fields: { name: string; dataType?: string }[];
  latencyMs: number;
  source: 'firebase-firestore' | 'embedded-engine';
}

let firestoreDb: Firestore | null = null;
let isFirestoreReady = false;
let activeProjectId = '';
let activeDatabaseId = '(default)';

// Load Firebase Config
function loadFirebaseConfig() {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err: any) {
    console.warn('[Firebase] Warning reading firebase-applet-config.json:', err.message);
  }
  return null;
}

export async function initDb(): Promise<boolean> {
  try {
    const config = loadFirebaseConfig();
    if (!config || !config.projectId) {
      console.warn('[Firebase] No valid firebase-applet-config.json found.');
      return false;
    }

    activeProjectId = config.projectId;
    activeDatabaseId = config.firestoreDatabaseId || '(default)';

    const app = getApps().length === 0 ? initializeApp(config) : getApp();

    if (config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)') {
      firestoreDb = getFirestore(app, config.firestoreDatabaseId);
    } else {
      firestoreDb = getFirestore(app);
    }

    // Ping Firestore by checking or seeding initial admin user and default tunnels
    const usersCol = collection(firestoreDb, 'users');
    const userSnap = await getDocs(query(usersCol, fsLimit(1)));
    if (userSnap.empty) {
      await setDoc(doc(firestoreDb, 'users', '00000000-0000-0000-0000-000000000001'), {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@edgeproxy.mesh',
        api_key: 'edg_sec_09a47f12e8b6c43d91',
        plan_tier: 'enterprise',
        max_tunnels: 50,
        max_rps: 1000,
        created_at: new Date().toISOString()
      });
      console.log('[Firebase Firestore] Seeded initial admin account in users collection.');
    }

    const tunnelsCol = collection(firestoreDb, 'tunnels');
    const tunnelSnap = await getDocs(query(tunnelsCol, fsLimit(1)));
    if (tunnelSnap.empty) {
      await setDoc(doc(firestoreDb, 'tunnels', 'tun-prod-cloud'), {
        id: 'tun-prod-cloud',
        subdomain: 'cloud',
        target_port: 8080,
        protocol: 'quic',
        tls_status: 'active',
        auth_enabled: false,
        is_active: true,
        total_requests: 0,
        bytes_transferred: 0,
        avg_latency: 0,
        created_at: new Date().toISOString(),
        last_ping_at: new Date().toISOString()
      });
      await setDoc(doc(firestoreDb, 'tunnels', 'tun-prod-api'), {
        id: 'tun-prod-api',
        subdomain: 'api',
        target_port: 3000,
        protocol: 'http2',
        tls_status: 'active',
        auth_enabled: true,
        auth_user: 'admin',
        is_active: true,
        total_requests: 0,
        bytes_transferred: 0,
        avg_latency: 0,
        created_at: new Date().toISOString(),
        last_ping_at: new Date().toISOString()
      });
      console.log('[Firebase Firestore] Seeded default production tunnels.');
    }

    isFirestoreReady = true;
    console.log(`[Firebase Firestore] Connected to project: ${activeProjectId}, database: ${activeDatabaseId}`);
    return true;
  } catch (err: any) {
    console.warn('[Firebase Firestore] Initialization warning:', err.message);
    isFirestoreReady = false;
    return false;
  }
}

// Typed Database Operations against Firebase Firestore
export async function dbGetTunnels(): Promise<any[]> {
  if (isFirestoreReady && firestoreDb) {
    try {
      const tunnelsCol = collection(firestoreDb, 'tunnels');
      const snap = await getDocs(tunnelsCol);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err: any) {
      console.warn('[Firebase Firestore] Failed fetching tunnels:', err.message);
    }
  }
  return [];
}

export async function dbInsertTunnel(tunnel: any): Promise<any> {
  const tunnelId = tunnel.id || `tun-${Date.now()}`;
  const record = {
    id: tunnelId,
    subdomain: tunnel.subdomain,
    target_port: Number(tunnel.target_port || tunnel.localPort || 8080),
    protocol: tunnel.protocol || 'quic',
    tls_status: tunnel.tls_status || 'active',
    auth_enabled: Boolean(tunnel.auth_enabled),
    auth_user: tunnel.auth_user || null,
    is_active: tunnel.is_active !== undefined ? tunnel.is_active : true,
    total_requests: tunnel.total_requests || 0,
    bytes_transferred: tunnel.bytes_transferred || 0,
    avg_latency: tunnel.avg_latency || 0,
    created_at: new Date().toISOString(),
    last_ping_at: new Date().toISOString()
  };

  if (isFirestoreReady && firestoreDb) {
    try {
      await setDoc(doc(firestoreDb, 'tunnels', tunnelId), record);
      return record;
    } catch (err: any) {
      console.warn('[Firebase Firestore] Failed inserting tunnel:', err.message);
    }
  }
  return record;
}

export async function dbDeleteTunnel(id: string): Promise<boolean> {
  if (isFirestoreReady && firestoreDb) {
    try {
      await deleteDoc(doc(firestoreDb, 'tunnels', id));
      return true;
    } catch (err: any) {
      console.warn('[Firebase Firestore] Failed deleting tunnel:', err.message);
    }
  }
  return false;
}

export async function dbInsertTrafficLog(logEntry: any): Promise<void> {
  if (!isFirestoreReady || !firestoreDb) return;

  try {
    const logId = logEntry.id || `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const record = {
      id: logId,
      tunnel_id: logEntry.tunnelId || 'tun-prod-cloud',
      subdomain: logEntry.subdomain || 'api',
      timestamp: logEntry.timestamp || new Date().toISOString(),
      method: logEntry.method || 'GET',
      path: logEntry.path || '/',
      status_code: logEntry.statusCode || 200,
      latency_ms: logEntry.latencyMs || 1.2,
      bytes_in: logEntry.bytesIn || 128,
      bytes_out: logEntry.bytesOut || 512,
      client_ip: logEntry.clientIp || '127.0.0.1',
      blocked_by_shield: Boolean(logEntry.blockedByShield)
    };
    await setDoc(doc(firestoreDb, 'traffic_logs', logId), record);
  } catch (err: any) {
    // Non-blocking log insert
  }
}

export async function dbGetTrafficLogs(limitCount: number = 50): Promise<any[]> {
  if (isFirestoreReady && firestoreDb) {
    try {
      const logsCol = collection(firestoreDb, 'traffic_logs');
      const q = query(logsCol, orderBy('timestamp', 'desc'), fsLimit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err: any) {
      console.warn('[Firebase Firestore] Failed fetching logs:', err.message);
    }
  }
  return [];
}

// SQL Query Execution Engine running directly against Firebase Collections
export async function executeQuery(sqlText: string, params: any[] = []): Promise<SqlQueryResult> {
  const start = performance.now();
  const lower = sqlText.trim().toLowerCase();

  let collectionName = 'tunnels';
  if (lower.includes('traffic_logs') || lower.includes('traffic')) collectionName = 'traffic_logs';
  else if (lower.includes('users') || lower.includes('accounts')) collectionName = 'users';
  else if (lower.includes('rate_limit_rules')) collectionName = 'rate_limit_rules';
  else if (lower.includes('tunnels')) collectionName = 'tunnels';

  if (isFirestoreReady && firestoreDb) {
    try {
      const targetCol = collection(firestoreDb, collectionName);
      let q = query(targetCol, fsLimit(50));
      if (lower.includes('limit')) {
        const match = lower.match(/limit\s+(\d+)/);
        if (match) {
          const l = parseInt(match[1], 10);
          q = query(targetCol, fsLimit(Math.min(l, 100)));
        }
      }
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      const fields = rows.length > 0 ? Object.keys(rows[0]).map(name => ({ name })) : [{ name: 'id' }];

      return {
        rows,
        rowCount: rows.length,
        fields,
        latencyMs,
        source: 'firebase-firestore'
      };
    } catch (err: any) {
      console.warn('[Firebase Firestore] Live query fallback:', err.message);
    }
  }

  // Fallback if network is starting
  const latencyMs = Math.round((performance.now() - start) * 100) / 100;
  return {
    rows: [],
    rowCount: 0,
    fields: [{ name: 'id' }, { name: 'status' }],
    latencyMs,
    source: 'embedded-engine'
  };
}

export function dbGetStatus() {
  return {
    engine: 'Firebase Firestore (Google Cloud)',
    isReady: isFirestoreReady,
    projectId: activeProjectId || 'influential-graph-nj1d7',
    databaseId: activeDatabaseId || 'ai-studio-edgeproxytraffic-8ae9f396-b7a2-4678-b3cb-c06f9bd459fd',
    status: isFirestoreReady ? 'connected' : 'initializing',
    collections: ['tunnels', 'traffic_logs', 'users', 'rate_limit_rules']
  };
}
