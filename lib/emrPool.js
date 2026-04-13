/**
 * EMR SQL Server 연결 풀 (API Routes에서 사용)
 */
import sql from 'mssql';

const sqlConfig = {
  user:     process.env.EMR_DB_USER,
  password: process.env.EMR_DB_PASSWORD,
  database: 'BrWonmu',
  server:   '192.168.0.253',
  port:     1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 60000,
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(sqlConfig).catch(err => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}
