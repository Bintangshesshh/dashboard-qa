import pg from 'pg';

export class Store {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString }); }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS qa_suites (id uuid PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_cases (id uuid PRIMARY KEY, suite_id uuid NOT NULL REFERENCES qa_suites(id) ON DELETE CASCADE, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_runs (id uuid PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS qa_logs (run_id uuid NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE, seq integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(run_id,seq));`);
    await this.pool.query(`UPDATE qa_runs SET data = data || jsonb_build_object('status','interrupted','docsStatus','interrupted','finishedAt',now(),'error','Server restarted during execution') WHERE data->>'status' IN ('queued','running','cancelling')`);
    await this.pool.query(`UPDATE qa_runs SET data = data || jsonb_build_object('docsStatus','interrupted','docsError','Server restarted during report generation') WHERE data->>'docsStatus' = 'building'`);
  }
  async list(kind, suiteId) {
    const table = this.table(kind);
    const result = kind === 'cases' && suiteId
      ? await this.pool.query('SELECT data FROM '+table+" WHERE suite_id=$1 ORDER BY data->>'createdAt'", [suiteId])
      : await this.pool.query('SELECT data FROM '+table+" ORDER BY data->>'createdAt' DESC LIMIT 500");
    return result.rows.map(row => row.data);
  }
  table(kind) { const name = { suites:'qa_suites', cases:'qa_cases', runs:'qa_runs' }[kind]; if (!name) throw new Error('Invalid table'); return name; }
  async get(kind,id) { return (await this.pool.query('SELECT data FROM '+this.table(kind)+' WHERE id=$1',[id])).rows[0]?.data; }
  async patch(kind,id,transform) {
    const table=this.table(kind),client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const old=(await client.query('SELECT data FROM '+table+' WHERE id=$1 FOR UPDATE',[id])).rows[0]?.data;
      if(!old){await client.query('COMMIT');return undefined;}
      const data=transform(old);
      await client.query('UPDATE '+table+' SET data=$2 WHERE id=$1',[id,data]);
      await client.query('COMMIT');return data;
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  async put(kind,data) {
    if(kind === 'cases') await this.pool.query('INSERT INTO qa_cases(id,suite_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[data.id,data.suiteId,data]);
    else await this.pool.query('INSERT INTO '+this.table(kind)+'(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[data.id,data]);
    return data;
  }
  async delete(kind,id) { return (await this.pool.query('DELETE FROM '+this.table(kind)+' WHERE id=$1',[id])).rowCount > 0; }
  async log(runId,entry) { await this.pool.query('INSERT INTO qa_logs(run_id,seq,data) VALUES($1,$2,$3)',[runId,entry.seq,entry]); }
  async logs(runId,after=0) { return (await this.pool.query('SELECT data FROM qa_logs WHERE run_id=$1 AND seq>$2 ORDER BY seq',[runId,after])).rows.map(r=>r.data); }
  async close() { await this.pool.end(); }
}
