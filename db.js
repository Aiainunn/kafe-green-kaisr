const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'kafe_green',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'local'
});

async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Berhasil terhubung ke database kafe_green');
        connection.release();
    } catch (err) {
        console.error('❌ Gagal terhubung ke MySQL:', err.message);
    }
}

testConnection();

module.exports = pool;
