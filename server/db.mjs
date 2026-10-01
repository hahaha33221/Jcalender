import pg from 'pg';
import { config } from './config.mjs';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, options: '-c search_path=jcal,public' });

/** 한 트랜잭션 안에서 fn(client) 실행 */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}
