const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function sendError(res, status, message, error = null) {
    if (error) console.error(message, error);
    return res.status(status).json({ berhasil: false, pesan: message });
}

// ============================================================
// AUTHENTICATION
// ============================================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return sendError(res, 400, 'Username dan password wajib diisi.');
    }

    try {
        const [rows] = await db.execute(
            `SELECT id, username, nama, peran
             FROM pengguna
             WHERE username = ? AND password = ?
             LIMIT 1`,
            [username, password]
        );

        if (rows.length === 0) {
            return sendError(res, 401, 'Username atau password salah.');
        }

        res.json({ berhasil: true, data: rows[0] });
    } catch (err) {
        sendError(res, 500, 'Gagal melakukan login.', err);
    }
});

// ============================================================
// MENU
// ============================================================
app.get('/api/menu', async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                menu.id,
                menu.nama,
                menu.harga,
                menu.deskripsi,
                menu.tersedia,
                menu.kategori_id,
                kategori.nama AS kategori
            FROM menu
            INNER JOIN kategori ON menu.kategori_id = kategori.id
            ORDER BY menu.id ASC
        `);

        res.json({ berhasil: true, data: rows });
    } catch (err) {
        sendError(res, 500, 'Gagal mengambil data menu.', err);
    }
});

app.post('/api/menu', async (req, res) => {
    const { nama, kategori_id, harga, deskripsi, tersedia } = req.body;

    if (!nama || !kategori_id || harga === undefined) {
        return sendError(res, 400, 'Nama, kategori, dan harga wajib diisi.');
    }

    try {
        const [result] = await db.execute(`
            INSERT INTO menu (kategori_id, nama, harga, deskripsi, tersedia)
            VALUES (?, ?, ?, ?, ?)
        `, [kategori_id, nama, Number(harga), deskripsi || '', tersedia !== undefined ? Boolean(tersedia) : true]);

        res.json({ berhasil: true, pesan: 'Menu berhasil ditambahkan.', id: result.insertId });
    } catch (err) {
        sendError(res, 500, 'Gagal menambahkan menu.', err);
    }
});

app.put('/api/menu/:id', async (req, res) => {
    const { nama, kategori_id, harga, deskripsi, tersedia } = req.body;

    if (!nama || !kategori_id || harga === undefined) {
        return sendError(res, 400, 'Nama, kategori, dan harga wajib diisi.');
    }

    try {
        const [result] = await db.execute(`
            UPDATE menu
            SET kategori_id = ?, nama = ?, harga = ?, deskripsi = ?, tersedia = ?
            WHERE id = ?
        `, [kategori_id, nama, Number(harga), deskripsi || '', Boolean(tersedia), req.params.id]);

        if (result.affectedRows === 0) {
            return sendError(res, 404, 'Menu tidak ditemukan.');
        }

        res.json({ berhasil: true, pesan: 'Menu berhasil diubah.' });
    } catch (err) {
        sendError(res, 500, 'Gagal mengubah menu.', err);
    }
});

app.patch('/api/menu/:id/status', async (req, res) => {
    const { tersedia } = req.body;

    try {
        const [result] = await db.execute(
            'UPDATE menu SET tersedia = ? WHERE id = ?',
            [Boolean(tersedia), req.params.id]
        );

        if (result.affectedRows === 0) {
            return sendError(res, 404, 'Menu tidak ditemukan.');
        }

        res.json({ berhasil: true, pesan: 'Status menu berhasil diubah.' });
    } catch (err) {
        sendError(res, 500, 'Gagal mengubah status menu.', err);
    }
});

app.delete('/api/menu/:id', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM menu WHERE id = ?', [req.params.id]);

        if (result.affectedRows === 0) {
            return sendError(res, 404, 'Menu tidak ditemukan.');
        }

        res.json({ berhasil: true, pesan: 'Menu berhasil dihapus.' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
            return sendError(res, 409, 'Menu tidak dapat dihapus karena sudah digunakan dalam transaksi.');
        }
        sendError(res, 500, 'Gagal menghapus menu.', err);
    }
});

// ============================================================
// PENGATURAN
// ============================================================
const DEFAULT_SETTINGS_DB = {
    nama_kafe: 'Kafe Green',
    alamat: '',
    telepon: '',
    wifi_info: '',
    pajak: 0,
    footer_struk: 'Terima kasih telah berkunjung ke Kafe Green'
};

app.get('/api/pengaturan', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM pengaturan ORDER BY id ASC LIMIT 1');

        if (rows.length > 0) {
            return res.json({ berhasil: true, data: rows[0] });
        }

        const [result] = await db.execute(`
            INSERT INTO pengaturan
            (nama_kafe, alamat, telepon, wifi_info, pajak, footer_struk)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            DEFAULT_SETTINGS_DB.nama_kafe,
            DEFAULT_SETTINGS_DB.alamat,
            DEFAULT_SETTINGS_DB.telepon,
            DEFAULT_SETTINGS_DB.wifi_info,
            DEFAULT_SETTINGS_DB.pajak,
            DEFAULT_SETTINGS_DB.footer_struk
        ]);

        const [created] = await db.execute('SELECT * FROM pengaturan WHERE id = ?', [result.insertId]);
        res.json({ berhasil: true, data: created[0] });
    } catch (err) {
        sendError(res, 500, 'Gagal mengambil pengaturan.', err);
    }
});

app.put('/api/pengaturan', async (req, res) => {
    const {
        nama_kafe,
        alamat = '',
        telepon = '',
        wifi_info = '',
        pajak = 0,
        footer_struk = ''
    } = req.body;

    if (!nama_kafe) {
        return sendError(res, 400, 'Nama kafe wajib diisi.');
    }

    try {
        const [rows] = await db.execute('SELECT id FROM pengaturan ORDER BY id ASC LIMIT 1');
        let id;

        if (rows.length === 0) {
            const [result] = await db.execute(`
                INSERT INTO pengaturan
                (nama_kafe, alamat, telepon, wifi_info, pajak, footer_struk)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [nama_kafe, alamat, telepon, wifi_info, Number(pajak) || 0, footer_struk]);
            id = result.insertId;
        } else {
            id = rows[0].id;
            await db.execute(`
                UPDATE pengaturan
                SET nama_kafe = ?, alamat = ?, telepon = ?, wifi_info = ?, pajak = ?, footer_struk = ?
                WHERE id = ?
            `, [nama_kafe, alamat, telepon, wifi_info, Number(pajak) || 0, footer_struk, id]);
        }

        const [updated] = await db.execute('SELECT * FROM pengaturan WHERE id = ?', [id]);
        res.json({ berhasil: true, pesan: 'Pengaturan berhasil disimpan.', data: updated[0] });
    } catch (err) {
        sendError(res, 500, 'Gagal menyimpan pengaturan.', err);
    }
});

// ============================================================
// TRANSAKSI
// ============================================================
function makeOrderNumber() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const random = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    return `KG-${date}-${time}${ms}${random}`;
}

app.get('/api/transaksi', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);

    try {
        const [transactions] = await db.execute(`
            SELECT
                t.id,
                t.nomor_transaksi,
                t.tanggal,
                t.tipe_pesanan,
                t.nomor_meja,
                t.subtotal,
                t.pajak,
                t.total,
                t.dibayar,
                t.kembalian,
                t.metode_pembayaran,
                p.nama AS kasir
            FROM transaksi t
            INNER JOIN pengguna p ON t.pengguna_id = p.id
            ORDER BY t.tanggal DESC, t.id DESC
            LIMIT ${limit}
        `);

        if (transactions.length === 0) {
            return res.json({ berhasil: true, data: [] });
        }

        const ids = transactions.map(t => t.id);
        const placeholders = ids.map(() => '?').join(',');
        const [details] = await db.execute(`
            SELECT
                d.transaksi_id,
                d.menu_id,
                d.jumlah,
                d.harga,
                d.subtotal,
                m.nama AS nama_menu
            FROM detail_transaksi d
            INNER JOIN menu m ON d.menu_id = m.id
            WHERE d.transaksi_id IN (${placeholders})
            ORDER BY d.id ASC
        `, ids);

        const detailMap = {};
        details.forEach(d => {
            if (!detailMap[d.transaksi_id]) detailMap[d.transaksi_id] = [];
            detailMap[d.transaksi_id].push({
                menu_id: d.menu_id,
                name: d.nama_menu,
                price: Number(d.harga),
                qty: Number(d.jumlah),
                subtotal: Number(d.subtotal)
            });
        });

        const data = transactions.map(t => ({
            orderNumber: t.nomor_transaksi,
            timestamp: t.tanggal,
            cashier: t.kasir,
            orderType: t.tipe_pesanan === 'take_away' ? 'Take Away' : 'Dine In',
            tableNumber: t.nomor_meja || '-',
            paymentMethod: t.metode_pembayaran === 'qris' ? 'QRIS' : 'Tunai',
            subtotal: Number(t.subtotal),
            tax: Number(t.pajak),
            grandTotal: Number(t.total),
            paidAmount: Number(t.dibayar),
            changeAmount: Number(t.kembalian),
            items: detailMap[t.id] || []
        }));

        res.json({ berhasil: true, data });
    } catch (err) {
        sendError(res, 500, 'Gagal mengambil riwayat transaksi.', err);
    }
});

app.post('/api/transaksi', async (req, res) => {
    const {
        nomor_transaksi,
        pengguna_id,
        tipe_pesanan,
        nomor_meja,
        subtotal,
        pajak,
        total,
        dibayar,
        kembalian,
        metode_pembayaran,
        items
    } = req.body;

    if (!pengguna_id || !Array.isArray(items) || items.length === 0) {
        return sendError(res, 400, 'Data pengguna dan item transaksi wajib diisi.');
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const orderNumber = nomor_transaksi || makeOrderNumber();
        const safeOrderType = tipe_pesanan === 'take_away' ? 'take_away' : 'dine_in';
        const safePayment = metode_pembayaran === 'qris' ? 'qris' : 'cash';

        const [txResult] = await connection.execute(`
            INSERT INTO transaksi
            (nomor_transaksi, pengguna_id, tipe_pesanan, nomor_meja, subtotal, pajak, total, dibayar, kembalian, metode_pembayaran)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            orderNumber,
            pengguna_id,
            safeOrderType,
            nomor_meja || null,
            Number(subtotal) || 0,
            Number(pajak) || 0,
            Number(total) || 0,
            Number(dibayar) || 0,
            Number(kembalian) || 0,
            safePayment
        ]);

        for (const item of items) {
            await connection.execute(`
                INSERT INTO detail_transaksi
                (transaksi_id, menu_id, jumlah, harga, subtotal)
                VALUES (?, ?, ?, ?, ?)
            `, [
                txResult.insertId,
                item.menu_id,
                Number(item.jumlah) || 1,
                Number(item.harga) || 0,
                Number(item.subtotal) || 0
            ]);
        }

        await connection.commit();

        const [userRows] = await db.execute('SELECT nama FROM pengguna WHERE id = ?', [pengguna_id]);
        const cashier = userRows[0]?.nama || 'Kasir Kafe';

        const saved = {
            orderNumber,
            timestamp: new Date(),
            cashier,
            orderType: safeOrderType === 'take_away' ? 'Take Away' : 'Dine In',
            tableNumber: nomor_meja || '-',
            paymentMethod: safePayment === 'qris' ? 'QRIS' : 'Tunai',
            subtotal: Number(subtotal) || 0,
            tax: Number(pajak) || 0,
            grandTotal: Number(total) || 0,
            paidAmount: Number(dibayar) || 0,
            changeAmount: Number(kembalian) || 0,
            items: items.map(item => ({
                menu_id: item.menu_id,
                name: item.name || `Menu #${item.menu_id}`,
                price: Number(item.harga) || 0,
                qty: Number(item.jumlah) || 1,
                subtotal: Number(item.subtotal) || 0
            }))
        };

        res.json({ berhasil: true, pesan: 'Transaksi berhasil disimpan.', data: saved });
    } catch (err) {
        await connection.rollback();
        if (err.code === 'ER_DUP_ENTRY') {
            return sendError(res, 409, 'Nomor transaksi sudah digunakan. Silakan coba lagi.');
        }
        sendError(res, 500, 'Gagal menyimpan transaksi.', err);
    } finally {
        connection.release();
    }
});

app.delete('/api/transaksi', async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute('DELETE FROM detail_transaksi');
        await connection.execute('DELETE FROM transaksi');
        await connection.commit();
        res.json({ berhasil: true, pesan: 'Seluruh transaksi berhasil dihapus.' });
    } catch (err) {
        await connection.rollback();
        sendError(res, 500, 'Gagal menghapus seluruh transaksi.', err);
    } finally {
        connection.release();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server Kafe Green berjalan di http://localhost:${PORT}`);
    console.log('✅ Backend siap menggunakan Node.js + Express + MySQL');
});
