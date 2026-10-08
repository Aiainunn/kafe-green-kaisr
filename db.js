require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,

    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,

    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// Mengubah placeholder MySQL ? menjadi PostgreSQL $1, $2, dst.
function convertPlaceholders(sql) {
    let index = 0;

    return sql.replace(/\?/g, () => {
        index++;
        return `$${index}`;
    });
}

// Fungsi query utama
async function execute(sql, params = []) {
    const convertedSql = convertPlaceholders(sql);

    const result = await pool.query(convertedSql, params);

    return [result.rows, result];
}

// Kompatibilitas dengan kode lama yang menggunakan:
// const connection = await db.getConnection();

async function getConnection() {
    const client = await pool.connect();

    return {
        // query PostgreSQL
        async query(sql, params = []) {
            const convertedSql = convertPlaceholders(sql);

            const result = await client.query(convertedSql, params);

            return [result.rows, result];
        },

        // execute dibuat sama dengan query
        async execute(sql, params = []) {
            const convertedSql = convertPlaceholders(sql);

            const result = await client.query(convertedSql, params);

            return [result.rows, result];
        },

        // MySQL beginTransaction → PostgreSQL BEGIN
        async beginTransaction() {
            await client.query('BEGIN');
        },

        // MySQL commit → PostgreSQL COMMIT
        async commit() {
            await client.query('COMMIT');
        },

        // MySQL rollback → PostgreSQL ROLLBACK
        async rollback() {
            await client.query('ROLLBACK');
        },

        // MySQL release connection
        release() {
            client.release();
        }
    };
}

// Tes koneksi saat server dijalankan
pool.connect()
    .then(client => {
        console.log('✅ Berhasil terhubung ke PostgreSQL / Supabase');
        client.release();
    })
    .catch(err => {
        console.error(
            '❌ Gagal terhubung ke PostgreSQL / Supabase:',
            err.message
        );
    });

module.exports = {
    query: (sql, params = []) => {
        const convertedSql = convertPlaceholders(sql);
        return pool.query(convertedSql, params);
    },

    execute,

    getConnection,

    pool
};