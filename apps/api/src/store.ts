import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export class BusyError extends Error {}
export class Store {
  constructor(readonly db: DatabaseSync) {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,label TEXT NOT NULL,administrator TEXT NOT NULL,successor TEXT NOT NULL,control TEXT NOT NULL,proposal TEXT,revision TEXT NOT NULL,status TEXT NOT NULL,public INTEGER NOT NULL DEFAULT 0,ref TEXT,sequence INTEGER NOT NULL DEFAULT -1,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY,operation_id TEXT,owner TEXT NOT NULL,kind TEXT NOT NULL,ref TEXT NOT NULL,sequence INTEGER NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preparations (id TEXT PRIMARY KEY,operation_id TEXT,actor TEXT NOT NULL,session_hash TEXT NOT NULL,action TEXT NOT NULL,bytes TEXT NOT NULL,digest TEXT NOT NULL UNIQUE,conditions TEXT NOT NULL,ref TEXT,state TEXT NOT NULL,expires INTEGER NOT NULL,created TEXT NOT NULL,error TEXT);
      CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT,actor TEXT,kind TEXT NOT NULL,message TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (owner TEXT PRIMARY KEY,id TEXT NOT NULL,revision INTEGER NOT NULL,revoked INTEGER NOT NULL,ref TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_jobs (id TEXT PRIMARY KEY,namespace TEXT NOT NULL,hash TEXT NOT NULL,scope TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS controls (id TEXT PRIMARY KEY,creator TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS copilot_jobs (id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,actor TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,evidence_json TEXT NOT NULL,status TEXT NOT NULL,prompt_version TEXT NOT NULL,
        dolphin_model TEXT NOT NULL,serv_model TEXT NOT NULL,assessment_id TEXT,error TEXT,reasons TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL,started TEXT,finished TEXT,usage_json TEXT);
      CREATE INDEX IF NOT EXISTS copilot_jobs_lookup ON copilot_jobs(operation_id,actor,evidence_hash,status);
      CREATE INDEX IF NOT EXISTS copilot_jobs_created ON copilot_jobs(actor,created);
      CREATE TABLE IF NOT EXISTS copilot_assessments (id TEXT PRIMARY KEY,job_id TEXT NOT NULL,operation_id TEXT NOT NULL,
        actor TEXT NOT NULL,evidence_hash TEXT NOT NULL,evidence_json TEXT NOT NULL,assessment_json TEXT NOT NULL,
        validation_json TEXT NOT NULL,provider_json TEXT NOT NULL,checkpoint_sequence INTEGER NOT NULL,
        operation_updated TEXT NOT NULL,verdict_code TEXT NOT NULL,checkpoint_revision TEXT NOT NULL,
        live_revision TEXT,live_proposal_stage INTEGER,created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS copilot_assessments_lookup ON copilot_assessments(operation_id,actor,created);`);
  }
  log(operation: string | null, actor: string | null, kind: string, message: string) { this.db.prepare('INSERT INTO journal(operation_id,actor,kind,message,created) VALUES (?,?,?,?,?)').run(operation,actor,kind,message,new Date().toISOString()); }
  async lease<T>(id: string, work: () => Promise<T>): Promise<T> {
    const owner = randomUUID(); const now = Date.now();
    const acquired = this.db.prepare('INSERT INTO leases VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE leases.expires < ? RETURNING owner').get(id,owner,now+180000,now);
    if (!acquired) throw new BusyError('Another worker is verifying this operation. Retry shortly.');
    const heartbeat = setInterval(() => this.db.prepare('UPDATE leases SET expires=? WHERE id=? AND owner=?').run(Date.now()+180000,id,owner), 30000);
    try { return await work(); } finally { clearInterval(heartbeat); this.db.prepare('DELETE FROM leases WHERE id=? AND owner=?').run(id,owner); }
  }
}
