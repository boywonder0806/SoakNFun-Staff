import pg from 'pg';

// Strip sslmode from the URL — SSL is controlled by the ssl option below.
// DigitalOcean managed databases use a self-signed cert chain that requires
// rejectUnauthorized: false.
const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '');

const isLocalhost = (connectionString || '').includes('localhost') || (connectionString || '').includes('127.0.0.1');

const pool = new pg.Pool({
  connectionString,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
});

export default pool;
