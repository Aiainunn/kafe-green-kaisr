/**
 * KAFE GREEN - POS & MANAGEMENT SYSTEM
 * Frontend: Vanilla JS
 * Backend: Node.js + Express
 * Database: MySQL
 */

const API_BASE = '/api';

const DEFAULT_SETTINGS = {
  cafeName: 'Kafe Green',
  address: '',
  phone: '',
  wifiInfo: '',
  taxRate: 0,
  footerMessage: 'Terima kasih telah berkunjung ke Kafe Green'
};

// --- APP STATE ---
const State = {
  currentUser: null,
  activeView: 'dashboard',
  menu: [],
  cart: [],
  transactions: [],
  settings: { ...DEFAULT_SETTINGS },
  soundEnabled: true,
  currentCategory: 'all',
  posSearchQuery: '',
  selectedPaymentMethod: 'Tunai',
  orderType: 'Dine In',
  lastCompletedOrder: null
};

// --- SOUND EFFECTS ---
class SoundFx {
  constructor() { this.ctx = null; }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }
  playBeep() {
    if (!State.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); 
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08); 
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    } catch(e) {}
  }
  playCashRegister() {
    if (!State.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50]; 
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + (idx * 0.06));
        gain.gain.setValueAtTime(0.18, this.ctx.currentTime + (idx * 0.06));
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (idx * 0.06) + 0.22);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + (idx * 0.06));
        osc.stop(this.ctx.currentTime + (idx * 0.06) + 0.25);
      });
    } catch(e) {}
  }
}
const sfx = new SoundFx();

// --- FORMATTERS ---
function formatRupiah(number) {
  const val = Math.round(Number(number) || 0);
  return 'Rp ' + val.toLocaleString('id-ID');
}

function formatDateIndo(dateObj) {
  const d = new Date(dateObj);
  const pad = (n) => String(n).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${pad(d.getDate())} ${monthNames[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} WIB`;
}

function formatDateKey(dateObj) {
  const d = new Date(dateObj);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function generateOrderNumber() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const todaysOrders = State.transactions.filter(t => t.timestamp && formatDateKey(t.timestamp) === todayKey);
  const seq = String(todaysOrders.length + 1).padStart(4, '0');
  return `KG-${dateStr}-${seq}`;
}

// ============================================================
// API HELPERS
// ============================================================
async function apiRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  let result = {};
  try { result = await response.json(); } catch (_) {}

  if (!response.ok || result.berhasil === false) {
    throw new Error(result.pesan || `Request gagal (${response.status})`);
  }

  return result;
}

function normalizeTransaction(tx) {
  return {
    ...tx,
    orderNumber: tx.orderNumber || tx.nomor_transaksi,
    timestamp: tx.timestamp || tx.tanggal,
    cashier: tx.cashier || tx.kasir || 'Kasir Kafe',
    orderType: tx.orderType || (tx.tipe_pesanan === 'take_away' ? 'Take Away' : 'Dine In'),
    tableNumber: tx.tableNumber || tx.nomor_meja || '-',
    paymentMethod: tx.paymentMethod || (tx.metode_pembayaran === 'qris' ? 'QRIS' : 'Tunai'),
    subtotal: Number(tx.subtotal) || 0,
    tax: Number(tx.tax) || 0,
    grandTotal: Number(tx.grandTotal) || 0,
    paidAmount: Number(tx.paidAmount) || 0,
    changeAmount: Number(tx.changeAmount) || 0,
    items: (tx.items || []).map(i => ({
      ...i,
      price: Number(i.price) || 0,
      qty: Number(i.qty) || 0,
      subtotal: Number(i.subtotal) || 0
    }))
  };
}

function categoryIdFromName(category) {
  const map = { 'Kopi': 1, 'Non-Kopi': 2, 'Makanan': 3, 'Snack': 4, 'Camilan': 4 };
  return map[category] || null;
}

// --- CLOUD SYNCHRONIZATION (MYSQL REAL-TIME LISTENERS) ---
function initServerSync() {
  Promise.all([loadMenuFromMySQL(), loadSettingsFromMySQL(), loadTransactionsFromMySQL()])
    .then(() => refreshCurrentView())
    .catch(error => {
      console.error('Gagal memuat data aplikasi:', error);
      showToast(error.message || 'Gagal memuat data dari server.', 'danger');
    });
}

async function loadMenuFromMySQL() {
  const result = await apiRequest('/menu');
  State.menu = (result.data || []).map(item => ({
    id: String(item.id),
    name: item.nama,
    category: item.kategori === 'Camilan' ? 'Snack' : item.kategori,
    price: Number(item.harga),
    desc: item.deskripsi || '',
    available: Boolean(item.tersedia)
  }));
}

async function loadSettingsFromMySQL() {
  const result = await apiRequest('/pengaturan');
  const item = result.data || {};
  State.settings = {
    cafeName: item.nama_kafe || DEFAULT_SETTINGS.cafeName,
    address: item.alamat || '',
    phone: item.telepon || '',
    wifiInfo: item.wifi_info || '',
    taxRate: Number(item.pajak) || 0,
    footerMessage: item.footer_struk || DEFAULT_SETTINGS.footerMessage
  };
  applySettingsToUI();
}

async function loadTransactionsFromMySQL() {
  const result = await apiRequest('/transaksi?limit=500');
  State.transactions = (result.data || []).map(normalizeTransaction);
}


function refreshCurrentView() {
  if (State.activeView === 'dashboard') renderDashboardView();
  if (State.activeView === 'pos') { updateCategoryChipCounts(); filterPosMenu(); }
  if (State.activeView === 'menuList') renderMenuListTable();
  if (State.activeView === 'menuManage') renderManageMenuGrid();
  if (State.activeView === 'history') renderHistoryTable();
  if (State.activeView === 'reports') renderReportsView();
}

// --- AUTHENTICATION ---
async function handleLogin() {
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value.trim();
  const errorEl = document.getElementById('loginError');

  if (!username || !password) {
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    const user = result.data;
    const roleMap = {
      manager: 'Manager Kafe',
      kasir: 'Staff Shift Kasir',
      operator: 'Operator Kafe'
    };

    State.currentUser = {
      id: user.id,
      username: user.username,
      role: roleMap[user.peran] || user.peran,
      roleCode: user.peran,
      displayName: user.nama
    };

    localStorage.setItem('kg_auth_user', JSON.stringify(State.currentUser));
    errorEl.classList.add('hidden');
    initLoggedInState();
    showToast(`Selamat datang di Kafe Green, ${State.currentUser.displayName}!`, 'success');
    sfx.playCashRegister();
  } catch (error) {
    console.error('Login gagal:', error);
    errorEl.textContent = error.message || 'Username atau password salah.';
    errorEl.classList.remove('hidden');
  }
}


function setQuickLogin(u, p, name) {
  document.getElementById('usernameInput').value = u;
  document.getElementById('passwordInput').value = p;
  document.querySelectorAll('.quick-btns .btn-chip').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
}

function togglePasswordVisibility() {
  const input = document.getElementById('passwordInput');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function handleLogout() {
  if (confirm('Apakah Anda yakin ingin keluar (logout)?')) {
    State.currentUser = null;
    localStorage.removeItem('kg_auth_user');
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('appContainer').classList.add('hidden');
    showToast('Berhasil keluar dari sistem.', 'info');
  }
}

function initLoggedInState() {
  if (!State.currentUser) return;
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  document.getElementById('userNameLabel').textContent = State.currentUser.displayName;
  document.getElementById('userRoleLabel').textContent = State.currentUser.role;
  document.getElementById('userAvatar').textContent = State.currentUser.displayName.charAt(0).toUpperCase();
  applySettingsToUI();
  switchView('dashboard');
}

// --- UTILS ---
function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', nextTheme === 'dark');
  document.body.classList.toggle('theme-light', nextTheme !== 'dark');
  localStorage.setItem('kg_theme', nextTheme);

  const sun = document.getElementById('themeSunIcon');
  const moon = document.getElementById('themeMoonIcon');
  if (sun) sun.classList.toggle('hidden', nextTheme === 'dark');
  if (moon) moon.classList.toggle('hidden', nextTheme !== 'dark');

  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.title = nextTheme === 'dark' ? 'Gunakan mode terang' : 'Gunakan mode gelap';
    btn.setAttribute('aria-label', btn.title);
  }
}

function toggleTheme() {
  applyTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
}

function toggleSound() {
  State.soundEnabled = !State.soundEnabled;
  document.getElementById('soundOnIcon').classList.toggle('hidden', !State.soundEnabled);
  document.getElementById('soundOffIcon').classList.toggle('hidden', State.soundEnabled);
  showToast(State.soundEnabled ? 'Efek suara kasir aktif' : 'Suara kasir dibisukan', 'info');
}

function toggleSidebar() {
  document.getElementById('appSidebar').classList.toggle('open');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  let icon = type === 'danger' ? '✕' : type === 'info' ? 'ℹ' : '✓';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function updateLiveClock() {
  const clockEl = document.getElementById('liveClockDisplay');
  if (!clockEl) return;
  const now = new Date();
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const pad = (n) => String(n).padStart(2, '0');
  clockEl.textContent = `${days[now.getDay()]}, ${pad(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()} - ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} WIB`;
}

function switchView(viewName) {
  State.activeView = viewName;
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });
  
  const views = {
    dashboard: { id: 'viewDashboard', title: 'Dashboard Server', subtitle: 'Penjualan tersinkronisasi real-time' },
    pos: { id: 'viewPos', title: 'Kasir & Pemesanan', subtitle: 'Pilih menu dan proses pembayaran' },
    menuList: { id: 'viewMenuList', title: 'Daftar Menu Kafe Green', subtitle: 'Lihat katalog minuman dan stok' },
    menuManage: { id: 'viewMenuManage', title: 'Kelola Menu Produk', subtitle: 'Tambah atau ubah data menu ke Server' },
    history: { id: 'viewHistory', title: 'Riwayat Transaksi', subtitle: 'Catatan seluruh struk dari semua kasir' },
    reports: { id: 'viewReports', title: 'Laporan Penjualan', subtitle: 'Analisis omset harian & produk terlaris' },
    settings: { id: 'viewSettings', title: 'Pengaturan Kafe', subtitle: 'Konfigurasi nama toko & sinkronisasi' }
  };

  Object.keys(views).forEach(vKey => {
    const el = document.getElementById(views[vKey].id);
    if (el) el.classList.remove('active');
  });

  const activeConf = views[viewName];
  if (activeConf) {
    const activeEl = document.getElementById(activeConf.id);
    if (activeEl) activeEl.classList.add('active');
    document.getElementById('pageTitle').textContent = activeConf.title;
    document.getElementById('pageSubtitle').textContent = activeConf.subtitle;
  }

  refreshCurrentView();
  document.getElementById('appSidebar').classList.remove('open');
}

// ============================================================
// DASHBOARD LOGIC
// ============================================================
function renderDashboardView() {
  const todayKey = formatDateKey(new Date());
  const todayOrders = State.transactions.filter(t => t.timestamp && formatDateKey(t.timestamp) === todayKey);

  const todayRevenue = todayOrders.reduce((acc, t) => acc + t.grandTotal, 0);
  document.getElementById('dashTodayRevenue').textContent = formatRupiah(todayRevenue);
  document.getElementById('dashTodayOrders').textContent = `${todayOrders.length} Transaksi`;

  const aov = todayOrders.length > 0 ? Math.round(todayRevenue / todayOrders.length) : 0;
  document.getElementById('dashAvgOrderValue').textContent = `Rata-rata: ${formatRupiah(aov)}`;

  const totalRevenue = State.transactions.reduce((acc, t) => acc + t.grandTotal, 0);
  document.getElementById('dashTotalRevenue').textContent = formatRupiah(totalRevenue);
  document.getElementById('dashTotalTransactionsCount').textContent = `${State.transactions.length} Total Transaksi`;

  const availableCount = State.menu.filter(m => m.available).length;
  document.getElementById('dashAvailableMenuCount').textContent = `${availableCount} / ${State.menu.length} Menu`;
  const badge = document.getElementById('dashStockBadge');
  if (availableCount === State.menu.length) {
    badge.textContent = 'Semua Menu Siap';
    badge.className = 'stat-badge green-badge';
  } else {
    badge.textContent = `${State.menu.length - availableCount} Kosong`;
    badge.className = 'stat-badge';
    badge.style.backgroundColor = '#fef3c7';
    badge.style.color = '#b45309';
  }

  renderHourlyChart(todayOrders);
  renderDashboardBestSellers();
  renderDashboardRecentOrders(todayOrders);
}

function renderHourlyChart(todayOrders) {
  const canvas = document.getElementById('hourlySalesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, rect.width, rect.height);
  const slots = [8, 10, 12, 14, 16, 18, 20, 22].map(h => ({ label: `${h}:00`, total: 0 }));

  todayOrders.forEach(tx => {
    const hour = new Date(tx.timestamp).getHours();
    let slotIdx = Math.floor((hour - 8) / 2);
    if (slotIdx < 0) slotIdx = 0;
    if (slotIdx >= slots.length) slotIdx = slots.length - 1;
    slots[slotIdx].total += tx.grandTotal;
  });

  const maxVal = Math.max(...slots.map(s => s.total), 100000);
  const paddingX = 40, paddingY = 30;
  const graphW = rect.width - paddingX * 2, graphH = rect.height - paddingY * 2;

  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  for (let i = 0; i <= 3; i++) {
    const y = paddingY + (graphH / 3) * i;
    ctx.beginPath(); ctx.moveTo(paddingX, y); ctx.lineTo(rect.width - paddingX, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  const points = slots.map((s, i) => ({
    x: paddingX + (graphW / (slots.length - 1)) * i,
    y: rect.height - paddingY - (s.total / maxVal) * graphH,
    label: s.label
  }));

  const gradient = ctx.createLinearGradient(0, paddingY, 0, rect.height - paddingY);
  gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
  gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  ctx.beginPath(); ctx.moveTo(points[0].x, rect.height - paddingY);
  ctx.lineTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2, yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.lineTo(points[points.length - 1].x, rect.height - paddingY);
  ctx.fillStyle = gradient; ctx.fill();

  ctx.beginPath(); ctx.strokeStyle = '#0f4c3a'; ctx.lineWidth = 3; ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2, yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y); ctx.stroke();

  points.forEach(pt => {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(pt.label, pt.x, rect.height - 10);
  });
}

function renderDashboardBestSellers() {
  const itemMap = {};
  State.transactions.forEach(tx => {
    (tx.items || []).forEach(item => {
      if (!itemMap[item.name]) itemMap[item.name] = { name: item.name, qty: 0, revenue: 0, price: item.price };
      itemMap[item.name].qty += item.qty;
      itemMap[item.name].revenue += item.subtotal;
    });
  });

  const sorted = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const container = document.getElementById('dashBestSellersList');

  if (sorted.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">Belum ada data penjualan.</p>';
    return;
  }
  container.innerHTML = sorted.map((item, idx) => {
    const menuItem = State.menu.find(m => m.name === item.name);
    const cat = menuItem ? menuItem.category : 'Menu Kafe';
    return `
      <div class="best-seller-item">
        <div class="rank-badge ${idx === 0 ? 'top-1' : ''}">${idx + 1}</div>
        <div class="best-seller-info">
          <div class="best-seller-title">${item.name}</div>
          <div class="best-seller-cat">${cat} • ${formatRupiah(item.price)}</div>
        </div>
        <div class="best-seller-stats">
          <div class="best-seller-sold">${item.qty} Terjual</div>
          <div class="best-seller-revenue">${formatRupiah(item.revenue)}</div>
        </div>
      </div>`;
  }).join('');
}

function renderDashboardRecentOrders(todayOrders) {
  const tbody = document.getElementById('dashRecentOrdersBody');
  const sorted = [...todayOrders].slice(0, 5); // Already sorted desc by listener

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 28px;">Belum ada transaksi hari ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(t => {
    const time = new Date(t.timestamp);
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')} WIB`;
    const itemsPreview = (t.items || []).map(i => `${i.qty}x ${i.name}`).join(', ');
    return `
      <tr>
        <td class="td-order-id">${t.orderNumber}</td>
        <td>${timeStr}</td>
        <td><span class="badge-tag ${t.orderType === 'Dine In' ? 'badge-blue' : 'badge-amber'}">${t.orderType}</span></td>
        <td style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${itemsPreview}">${itemsPreview}</td>
        <td><span class="badge-tag badge-gray">${t.paymentMethod}</span></td>
        <td class="td-price">${formatRupiah(t.grandTotal)}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="viewReceiptByNumber('${t.orderNumber}')">Lihat Struk</button></td>
      </tr>`;
  }).join('');
}

// ============================================================
// POS & PEMESANAN LOGIC
// ============================================================
function updateCategoryChipCounts() {
  const counts = { all: State.menu.length, Kopi: 0, 'Non-Kopi': 0, Makanan: 0, Snack: 0 };
  State.menu.forEach(m => {
    const cat = m.category === 'Camilan' ? 'Snack' : m.category;
    if (counts[cat] !== undefined) counts[cat]++;
  });

  const setCount = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setCount('catCountAll', counts.all);
  setCount('catCountKopi', counts.Kopi);
  setCount('catCountNonKopi', counts['Non-Kopi']);
  setCount('catCountMakanan', counts.Makanan);
  setCount('catCountSnack', counts.Snack);
}

function selectPosCategory(cat) {
  State.currentCategory = cat;
  document.querySelectorAll('#posCategoryChips .cat-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.cat === cat);
  });
  filterPosMenu();
}

function getCategoryVisual(category) {
  const key = category === 'Camilan' ? 'Snack' : category;
  const icons = {
    'Kopi': '<path d=\"M18 8h1a4 4 0 1 1 0 8h-1\"></path><path d=\"M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z\"></path><path d=\"M6 2v2M10 2v2M14 2v2\"></path>',
    'Non-Kopi': '<path d=\"M7 3h10l2 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7l2-4z\"></path><path d=\"M5 8h14\"></path><path d=\"M9 12h6M9 16h4\"></path>',
    'Makanan': '<path d=\"M4 4v16M8 4v7M12 4v16M16 4v16M20 4v7\"></path><path d=\"M4 11h4M16 11h4\"></path>',
    'Snack': '<path d=\"M5 7h14l-1 13H6L5 7z\"></path><path d=\"M8 7V5a4 4 0 0 1 8 0v2\"></path>'
  };
  const icon = icons[key] || '<circle cx=\"12\" cy=\"12\" r=8></circle><path d=\"M12 8v8M8 12h8\"></path>';
  return `<svg class=\"category-visual-icon\" width=34 height=34 viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\">${icon}</svg>`;
}

function filterPosMenu() {
  const query = document.getElementById('posSearchInput').value.toLowerCase().trim();
  document.getElementById('posClearSearch').style.display = query ? 'flex' : 'none';

  let filtered = State.menu;
  if (State.currentCategory !== 'all') filtered = filtered.filter(m => m.category === State.currentCategory);
  if (query) filtered = filtered.filter(m => m.name.toLowerCase().includes(query));

  const container = document.getElementById('posProductsGrid');
  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px;">Menu tidak ditemukan</div>`;
    return;
  }
  
  // Urutkan berdasarkan nama
  filtered.sort((a,b) => a.name.localeCompare(b.name));

  container.innerHTML = filtered.map(item => `
    <div class="product-card ${!item.available ? 'unavailable' : ''}" onclick="onProductClick('${item.id}')">
      <div class="product-image-box category-visual-box">
        <div class="category-visual-content">
          ${getCategoryVisual(item.category)}
          <span>${item.category}</span>
        </div>
        <span class="product-badge-stock ${item.available ? 'badge-green' : 'badge-amber'}">
          ${item.available ? 'Tersedia' : 'Habis'}
        </span>
      </div>
      <div class="product-info">
        <h4 class="product-name">${item.name}</h4>
        <span class="product-category-sub">${item.category}</span>
      </div>
      <div class="product-footer-row">
        <span class="product-price">${formatRupiah(item.price)}</span>
        <button type="button" class="btn-add-circle" ${!item.available ? 'disabled' : ''}>+</button>
      </div>
    </div>`).join('');
}

function clearPosSearch() {
  document.getElementById('posSearchInput').value = '';
  filterPosMenu();
}

function onProductClick(id) {
  const item = State.menu.find(m => m.id === id);
  if (!item) return;
  if (!item.available) { showToast(`Maaf, ${item.name} sedang habis.`, 'danger'); return; }
  addToCart(item);
}

function addToCart(item) {
  const existing = State.cart.find(c => c.id === item.id);
  if (existing) existing.qty += 1;
  else State.cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
  sfx.playBeep();
  renderCartUI();
}

function changeCartQty(id, delta) {
  const item = State.cart.find(c => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) State.cart = State.cart.filter(c => c.id !== id);
  sfx.playBeep();
  renderCartUI();
}

function clearCartConfirm() {
  if (State.cart.length === 0) return;
  if (confirm('Kosongkan semua pesanan di keranjang?')) {
    State.cart = [];
    renderCartUI();
    showToast('Keranjang dikosongkan.', 'info');
  }
}

function setOrderType(type) {
  State.orderType = type;
  document.getElementById('btnOrderDineIn').classList.toggle('active', type === 'Dine In');
  document.getElementById('btnOrderTakeAway').classList.toggle('active', type === 'Take Away');
  const tableInput = document.getElementById('orderTableInput');
  tableInput.placeholder = type === 'Dine In' ? 'No. Meja' : 'Nama Tamu';
  if (type === 'Take Away' && tableInput.value.startsWith('Meja')) tableInput.value = 'Bungkus';
  else if (type === 'Dine In' && tableInput.value.includes('Bungkus')) tableInput.value = 'Meja 01';
}

function renderCartUI() {
  const container = document.getElementById('cartItemsList');
  const totalItemsCount = State.cart.reduce((acc, i) => acc + i.qty, 0);
  document.getElementById('cartTotalItemsCount').textContent = totalItemsCount;
  
  const pillCount = document.getElementById('cartPillCount');
  if (totalItemsCount > 0) { pillCount.style.display = 'inline-block'; pillCount.textContent = totalItemsCount; } 
  else { pillCount.style.display = 'none'; }

  if (State.cart.length === 0) {
    container.innerHTML = `<div class="cart-empty-state"><p class="empty-title">Keranjang Masih Kosong</p></div>`;
  } else {
    container.innerHTML = State.cart.map(item => `
      <div class="cart-item-row">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-unit-price">${formatRupiah(item.price)}</div>
        </div>
        <div class="cart-item-ctrls">
          <button type="button" class="btn-qty-mini" onclick="changeCartQty('${item.id}', -1)">-</button>
          <span class="cart-qty-display">${item.qty}</span>
          <button type="button" class="btn-qty-mini" onclick="changeCartQty('${item.id}', 1)">+</button>
        </div>
        <div class="cart-item-subtotal">${formatRupiah(item.price * item.qty)}</div>
      </div>`).join('');
  }

  const subtotal = State.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const tax = Math.round(subtotal * ((Number(State.settings.taxRate) || 0) / 100));
  const grandTotal = subtotal + tax;

  document.getElementById('cartSubtotalText').textContent = formatRupiah(subtotal);
  document.getElementById('taxRateLabel').textContent = `${State.settings.taxRate}%`;
  document.getElementById('cartTaxText').textContent = formatRupiah(tax);
  document.getElementById('cartGrandTotalText').textContent = formatRupiah(grandTotal);

  calculateChange();
}

function selectPayMethod(method) {
  if (!['Tunai', 'QRIS'].includes(method)) method = 'Tunai';
  State.selectedPaymentMethod = method;
  document.querySelectorAll('.pay-method-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.method === method));
  if (method === 'Tunai') {
    document.getElementById('cashInputSection').classList.remove('hidden');
    document.getElementById('nonCashNotice').classList.add('hidden');
  } else {
    document.getElementById('cashInputSection').classList.add('hidden');
    document.getElementById('nonCashNotice').classList.remove('hidden');
    document.getElementById('nonCashMethodTitle').textContent = `Pembayaran via ${method}`;
  }
  calculateChange();
}

function setExactCash() {
  const subtotal = State.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const tax = Math.round(subtotal * ((Number(State.settings.taxRate) || 0) / 100));
  document.getElementById('cashGivenInput').value = subtotal + tax;
  calculateChange();
}

function addCashAmount(val) {
  const input = document.getElementById('cashGivenInput');
  input.value = (Number(input.value) || 0) + val;
  calculateChange();
}

function calculateChange() {
  const subtotal = State.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const tax = Math.round(subtotal * ((Number(State.settings.taxRate) || 0) / 100));
  const grandTotal = subtotal + tax;
  const btnPay = document.getElementById('btnProcessPayment');
  const changeDisplay = document.getElementById('cashChangeDisplay');

  if (State.cart.length === 0) {
    btnPay.disabled = true; changeDisplay.textContent = 'Rp 0'; changeDisplay.classList.remove('insufficient'); return;
  }
  if (State.selectedPaymentMethod !== 'Tunai') {
    btnPay.disabled = false; changeDisplay.textContent = 'Rp 0 (Pas)'; changeDisplay.classList.remove('insufficient'); return;
  }

  const cashGiven = Number(document.getElementById('cashGivenInput').value) || 0;
  const change = cashGiven - grandTotal;
  if (change >= 0) {
    changeDisplay.textContent = formatRupiah(change); changeDisplay.classList.remove('insufficient'); btnPay.disabled = false;
  } else {
    changeDisplay.textContent = `Kurang ${formatRupiah(Math.abs(change))}`; changeDisplay.classList.add('insufficient'); btnPay.disabled = true;
  }
}

// SIMPAN TRANSAKSI KE CLOUD MYSQL
async function processOrder() {
  if (State.cart.length === 0) return;

  const subtotal = State.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const tax = Math.round(subtotal * ((Number(State.settings.taxRate) || 0) / 100));
  const grandTotal = subtotal + tax;

  let paidAmount = grandTotal;
  if (State.selectedPaymentMethod === 'Tunai') {
    paidAmount = Number(document.getElementById('cashGivenInput').value) || 0;
  }

  if (paidAmount < grandTotal) {
    showToast('Jumlah pembayaran masih kurang.', 'danger');
    return;
  }

  const tableValue = document.getElementById('orderTableInput').value.trim();

  const payload = {
    pengguna_id: State.currentUser?.id || null,
    tipe_pesanan: State.orderType === 'Take Away' ? 'take_away' : 'dine_in',
    nomor_meja: tableValue || (State.orderType === 'Dine In' ? 'Meja 01' : 'Bungkus'),
    subtotal,
    pajak: tax,
    total: grandTotal,
    dibayar: paidAmount,
    kembalian: paidAmount - grandTotal,
    metode_pembayaran: State.selectedPaymentMethod === 'QRIS' ? 'qris' : 'cash',
    items: State.cart.map(i => ({
      menu_id: Number(i.id),
      name: i.name,
      jumlah: i.qty,
      harga: i.price,
      subtotal: i.price * i.qty
    }))
  };

  try {
    const result = await apiRequest('/transaksi', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const saved = normalizeTransaction(result.data);
    State.transactions.unshift(saved);
    State.lastCompletedOrder = saved;

    sfx.playCashRegister();
    showToast(`Transaksi ${saved.orderNumber} berhasil disimpan.`, 'success');
    openReceiptModal(saved);

    State.cart = [];
    document.getElementById('cashGivenInput').value = '';
    renderCartUI();
    document.getElementById('cartOrderNo').textContent = `Order #${generateOrderNumber()}`;
    refreshCurrentView();
  } catch (error) {
    console.error('Gagal menyimpan transaksi:', error);
    showToast(`Gagal menyimpan transaksi: ${error.message}`, 'danger');
  }
}


// ============================================================
// RECEIPT MODAL
// ============================================================
function openReceiptModal(order) {
  document.getElementById('receiptModal').classList.remove('hidden');
  document.getElementById('recStoreName').textContent = State.settings.cafeName.toUpperCase();
  document.getElementById('recStoreAddress').textContent = State.settings.address;
  document.getElementById('recStoreContact').textContent = `Telp: ${State.settings.phone}`;
  document.getElementById('recFooterMessage').textContent = State.settings.footerMessage;

  // Info Wi-Fi disimpan dalam satu kolom, misalnya:
  // "KafeGreen-Guest / kopienak88" atau "WiFi: KafeGreen-Guest | Password: kopienak88".
  // Tampilkan dengan format yang lebih jelas di struk.
  const wifiRaw = String(State.settings.wifiInfo || '').trim();
  let wifiText = wifiRaw || '-';
  if (wifiRaw.includes('/')) {
    const parts = wifiRaw.split('/').map(v => v.trim()).filter(Boolean);
    if (parts.length >= 2) {
      wifiText = `Wi-Fi: ${parts[0]} | Password: ${parts.slice(1).join(' / ')}`;
    }
  } else if (/password/i.test(wifiRaw)) {
    wifiText = wifiRaw;
  } else if (/^wifi\s*:/i.test(wifiRaw)) {
    wifiText = wifiRaw;
  } else if (wifiRaw) {
    wifiText = `Wi-Fi: ${wifiRaw}`;
  }
  document.getElementById('recWifiInfo').textContent = wifiText;

  document.getElementById('recOrderNumber').textContent = `#${order.orderNumber}`;
  document.getElementById('recBarcodeId').textContent = `*${order.orderNumber}*`;
  document.getElementById('recOrderDate').textContent = formatDateIndo(order.timestamp);
  document.getElementById('recCashierName').textContent = order.cashier;
  document.getElementById('recOrderType').textContent = `${order.orderType} (${order.tableNumber})`;

  document.getElementById('recItemsList').innerHTML = order.items.map(item => `
    <div class="receipt-item-entry">
      <div class="receipt-item-title">${item.name}</div>
      <div class="receipt-item-calc">
        <span>${item.qty} x ${formatRupiah(item.price)}</span>
        <span>${formatRupiah(item.subtotal)}</span>
      </div>
    </div>`).join('');

  document.getElementById('recSubtotal').textContent = formatRupiah(order.subtotal);
  const taxRow = document.getElementById('recTaxRow');
  if (order.tax > 0) { taxRow.style.display = 'flex'; document.getElementById('recTax').textContent = formatRupiah(order.tax); }
  else taxRow.style.display = 'none';

  document.getElementById('recGrandTotal').textContent = formatRupiah(order.grandTotal);
  document.getElementById('recPaymentMethod').textContent = order.paymentMethod;
  document.getElementById('recPaidAmount').textContent = formatRupiah(order.paidAmount);
  document.getElementById('recChangeAmount').textContent = formatRupiah(order.changeAmount);
}

function viewReceiptByNumber(orderNo) {
  const order = State.transactions.find(t => t.orderNumber === orderNo);
  if (order) openReceiptModal(order);
  else showToast('Data struk tidak ditemukan.', 'danger');
}
function closeReceiptModal() { document.getElementById('receiptModal').classList.add('hidden'); }
function printReceiptDirectly() {
  document.body.classList.remove('print-report-mode');
  document.body.classList.add('print-receipt-mode');
  window.print();
}

function printReport() {
  if (State.activeView !== 'reports') {
    switchView('reports');
  }
  // Pastikan angka, breakdown, dan tabel terbaru sudah dirender sebelum print.
  renderReportsView();
  document.body.classList.remove('print-receipt-mode');
  document.body.classList.add('print-report-mode');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-report-mode', 'print-receipt-mode');
});
function copyReceiptText() {
  const o = State.lastCompletedOrder;
  if (!o) return;
  const text = `
=== ${State.settings.cafeName.toUpperCase()} ===
${State.settings.address}
No: #${o.orderNumber}
Tgl: ${formatDateIndo(o.timestamp)}
Kasir: ${o.cashier}
Tipe: ${o.orderType} (${o.tableNumber})
--------------------------------
${o.items.map(i => `${i.name}\n${i.qty} x ${formatRupiah(i.price)} = ${formatRupiah(i.subtotal)}`).join('\n')}
--------------------------------
Subtotal: ${formatRupiah(o.subtotal)}
PPN: ${formatRupiah(o.tax)}
TOTAL: ${formatRupiah(o.grandTotal)}
================================
${State.settings.footerMessage}`.trim();
  navigator.clipboard.writeText(text).then(() => showToast('Teks struk disalin!', 'success'));
}

// ============================================================
// MENU LIST & KELOLA MENU (MYSQL CRUD)
// ============================================================
function renderMenuListTable() {
  const query = document.getElementById('menuListSearch').value.toLowerCase().trim();
  const catFilter = document.getElementById('menuListCatFilter').value;
  const stockFilter = document.getElementById('menuListStockFilter').value;

  let list = State.menu;
  if (catFilter !== 'all') list = list.filter(m => m.category === catFilter);
  if (stockFilter === 'available') list = list.filter(m => m.available);
  else if (stockFilter === 'unavailable') list = list.filter(m => !m.available);
  if (query) list = list.filter(m => m.name.toLowerCase().includes(query));

  document.getElementById('menuListTotalBadge').textContent = `Total: ${list.length} Menu`;
  const tbody = document.getElementById('menuListTableBody');
  
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px;">Tidak ada menu.</td></tr>`; return;
  }

  tbody.innerHTML = list.map(item => `
    <tr>
      <td style="text-align: center;">-</td>
      <td><strong>${item.name}</strong>${item.desc ? `<div style="font-size: 0.78rem; color: var(--text-muted);">${item.desc}</div>` : ''}</td>
      <td><span class="badge-tag badge-blue">${item.category}</span></td>
      <td class="td-price">${formatRupiah(item.price)}</td>
      <td><button class="btn btn-xs ${item.available ? 'btn-emerald' : 'btn-secondary'}" onclick="toggleMenuAvailability('${item.id}')">${item.available ? '● Tersedia' : '○ Habis'}</button></td>
      <td style="text-align: right;">
        <button class="btn btn-ghost btn-sm" onclick="switchView('menuManage'); openEditMenuModal('${item.id}')">Edit</button>
        <button class="btn btn-ghost-danger btn-sm" onclick="deleteMenuPrompt('${item.id}')">Hapus</button>
      </td>
    </tr>`).join('');
}

function renderManageMenuGrid() {
  document.getElementById('manageMenuGrid').innerHTML = State.menu.map(item => `
    <div class="manage-menu-card">
      <div>
        <div class="manage-card-top">
            <div class="manage-emoji-box menu-category-visual">
              ${getCategoryVisual(item.category)}
            </div>
          <div>
            <h4 class="manage-card-title">${item.name}</h4>
            <span class="manage-card-category">${item.category}</span>
            <div class="manage-card-price">${formatRupiah(item.price)}</div>
          </div>
        </div>
        <p class="manage-card-desc">${item.desc || '-'}</p>
      </div>
      <div>
        <div class="manage-card-status-row">
          <span style="font-size: 0.8rem; font-weight: 600;">Status Stok:</span>
          <button class="btn btn-xs ${item.available ? 'btn-emerald' : 'btn-secondary'}" onclick="toggleMenuAvailability('${item.id}')">${item.available ? 'Tersedia' : 'Habis'}</button>
        </div>
        <div class="manage-card-actions">
          <button class="btn btn-outline btn-sm" onclick="openEditMenuModal('${item.id}')">Edit Menu</button>
          <button class="btn btn-ghost-danger btn-sm" onclick="deleteMenuPrompt('${item.id}')">Hapus</button>
        </div>
      </div>
    </div>`).join('');
}

async function toggleMenuAvailability(id) {
  const item = State.menu.find(m => m.id === id);
  if (!item) return;

  try {
    await apiRequest(`/menu/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ tersedia: !item.available })
    });
    item.available = !item.available;
    refreshCurrentView();
    showToast('Status stok menu berhasil diubah.', 'info');
  } catch (error) {
    showToast(`Gagal mengubah status: ${error.message}`, 'danger');
  }
}


function openAddMenuModal() {
  document.getElementById('menuModalTitle').textContent = 'Tambah Menu Baru';
  document.getElementById('menuEditId').value = '';
  document.getElementById('menuFormName').value = '';
  document.getElementById('menuFormCategory').value = 'Kopi';
  document.getElementById('menuFormPrice').value = '';
  document.getElementById('menuFormDesc').value = '';
  document.getElementById('menuFormAvailable').checked = true;
  document.getElementById('menuModal').classList.remove('hidden');
}


function openEditMenuModal(id) {
  const item = State.menu.find(m => m.id === id);
  if (!item) return;
  document.getElementById('menuModalTitle').textContent = 'Edit Menu';
  document.getElementById('menuEditId').value = item.id;
  document.getElementById('menuFormName').value = item.name;
  document.getElementById('menuFormCategory').value = item.category === 'Camilan' ? 'Snack' : item.category;
  document.getElementById('menuFormPrice').value = item.price;
  document.getElementById('menuFormDesc').value = item.desc || '';
  document.getElementById('menuFormAvailable').checked = item.available;
  document.getElementById('menuModal').classList.remove('hidden');
}

function closeMenuModal() { document.getElementById('menuModal').classList.add('hidden'); }



async function saveMenuForm() {
  const editId = document.getElementById('menuEditId').value;
  const name = document.getElementById('menuFormName').value.trim();
  const category = document.getElementById('menuFormCategory').value;
  const price = Number(document.getElementById('menuFormPrice').value);
  const desc = document.getElementById('menuFormDesc').value.trim();
  const available = document.getElementById('menuFormAvailable').checked;
  const kategoriId = categoryIdFromName(category);

  if (!name || !kategoriId || !Number.isFinite(price) || price < 0) {
    showToast('Isi nama, kategori, dan harga dengan benar.', 'danger');
    return;
  }

  const payload = {
    nama: name,
    kategori_id: kategoriId,
    harga: price,
    deskripsi: desc,
    tersedia: available
  };

  try {
    if (editId) {
      await apiRequest(`/menu/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Menu berhasil diubah.', 'success');
    } else {
      await apiRequest('/menu', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Menu berhasil ditambahkan.', 'success');
    }

    await loadMenuFromMySQL();
    closeMenuModal();
    refreshCurrentView();
  } catch (error) {
    showToast(`Gagal menyimpan menu: ${error.message}`, 'danger');
  }
}


async function deleteMenuPrompt(id) {
  const item = State.menu.find(m => m.id === id);
  if (!item) return;

  if (!confirm(`Yakin ingin menghapus menu "${item.name}"?`)) return;

  try {
    await apiRequest(`/menu/${id}`, { method: 'DELETE' });
    State.menu = State.menu.filter(m => m.id !== id);
    refreshCurrentView();
    showToast('Menu berhasil dihapus.', 'info');
  } catch (error) {
    showToast(`Gagal menghapus menu: ${error.message}`, 'danger');
  }
}


// ============================================================
// RIWAYAT & LAPORAN
// ============================================================
let historyRangeFilter = 'today', historySpecificDate = null;

function setHistoryFilter(range) {
  historyRangeFilter = range; historySpecificDate = null;
  document.getElementById('historyDatePicker').value = '';
  document.querySelectorAll('.btn-group-filters .btn-filter-tab').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  renderHistoryTable();
}
function filterHistoryBySpecificDate() {
  const val = document.getElementById('historyDatePicker').value;
  if (val) { historySpecificDate = val; historyRangeFilter = 'custom'; document.querySelectorAll('.btn-group-filters .btn-filter-tab').forEach(b => b.classList.remove('active')); renderHistoryTable(); }
}
function resetHistoryDate() { document.getElementById('historyDatePicker').value = ''; setHistoryFilter('today'); }

function renderHistoryTable() {
  const query = document.getElementById('historySearchInput').value.toLowerCase().trim();
  const todayKey = formatDateKey(new Date());
  const yesterdayKey = formatDateKey(new Date(Date.now() - 86400000));
  
  let list = State.transactions;
  if (historySpecificDate) list = list.filter(t => t.timestamp && formatDateKey(t.timestamp) === historySpecificDate);
  else if (historyRangeFilter === 'today') list = list.filter(t => t.timestamp && formatDateKey(t.timestamp) === todayKey);
  else if (historyRangeFilter === 'yesterday') list = list.filter(t => t.timestamp && formatDateKey(t.timestamp) === yesterdayKey);

  if (query) list = list.filter(t => t.orderNumber.toLowerCase().includes(query) || t.cashier.toLowerCase().includes(query));

  document.getElementById('historyOrdersCount').textContent = `${list.length} Transaksi`;
  document.getElementById('historyTotalSum').textContent = `Total: ${formatRupiah(list.reduce((acc, t) => acc + t.grandTotal, 0))}`;
  
  const tbody = document.getElementById('historyTableBody');
  if (list.length === 0) { tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 32px;">Tidak ada transaksi.</td></tr>`; return; }

  tbody.innerHTML = list.map(t => {
    const itemsPreview = (t.items || []).map(i => `${i.qty}x ${i.name}`).join(', ');
    return `<tr>
      <td class="td-order-id">${t.orderNumber}</td>
      <td>${formatDateIndo(t.timestamp)}</td>
      <td>${t.cashier}</td>
      <td><span class="badge-tag ${t.orderType === 'Dine In' ? 'badge-blue' : 'badge-amber'}">${t.orderType}</span></td>
      <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${itemsPreview}</td>
      <td><span class="badge-tag badge-gray">${t.paymentMethod}</span></td>
      <td class="td-price">${formatRupiah(t.grandTotal)}</td>
      <td>${formatRupiah(t.paidAmount)}</td>
      <td>${formatRupiah(t.changeAmount)}</td>
      <td style="text-align: right;"><button class="btn btn-outline btn-xs" onclick="viewReceiptByNumber('${t.orderNumber}')">Struk</button></td>
    </tr>`;
  }).join('');
}

let reportPeriod = 'today', reportCustomRange = null;
function setReportPeriod(period) {
  reportPeriod = period; reportCustomRange = null;
  document.querySelectorAll('.report-period-chips .btn-report-tab').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  renderReportsView();
}
function applyCustomReportRange() {
  const start = document.getElementById('reportStartDate').value;
  const end = document.getElementById('reportEndDate').value;
  if (!start || !end) return showToast('Pilih rentang tanggal.', 'danger');
  reportPeriod = 'custom'; reportCustomRange = { start, end };
  document.querySelectorAll('.report-period-chips .btn-report-tab').forEach(b => b.classList.remove('active'));
  renderReportsView();
}

function getFilteredReportTransactions() {
  const todayKey = formatDateKey(new Date());
  const yesterdayKey = formatDateKey(new Date(Date.now() - 86400000));
  let txList = State.transactions;

  if (reportPeriod === 'today') return txList.filter(t => t.timestamp && formatDateKey(t.timestamp) === todayKey);
  if (reportPeriod === 'yesterday') return txList.filter(t => t.timestamp && formatDateKey(t.timestamp) === yesterdayKey);
  if (reportPeriod === 'week') {
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    return txList.filter(t => t.timestamp >= oneWeekAgo);
  }
  if (reportPeriod === 'month') {
    const monthKey = todayKey.substring(0, 7);
    return txList.filter(t => t.timestamp && t.timestamp.startsWith(monthKey));
  }
  if (reportPeriod === 'custom' && reportCustomRange) {
    return txList.filter(t => {
      const d = t.timestamp ? t.timestamp.substring(0, 10) : '';
      return d >= reportCustomRange.start && d <= reportCustomRange.end;
    });
  }
  return txList;
}

function renderReportsView() {
  const data = getFilteredReportTransactions();
  const totalIncome = data.reduce((acc, t) => acc + t.grandTotal, 0);
  const totalTxCount = data.length;
  document.getElementById('repTotalIncome').textContent = formatRupiah(totalIncome);
  document.getElementById('repTotalTxCount').textContent = `${totalTxCount} Transaksi`;
  document.getElementById('repAvgBasket').textContent = formatRupiah(totalTxCount > 0 ? totalIncome / totalTxCount : 0);
  document.getElementById('repTotalItemsQty').textContent = `${data.reduce((acc, t) => acc + (t.items || []).reduce((s, i) => s + i.qty, 0), 0)} Item`;

  const catMap = { Kopi: 0, 'Non-Kopi': 0, Makanan: 0, Snack: 0 };
  data.forEach(t => (t.items || []).forEach(i => {
    const menu = State.menu.find(m => m.name === i.name);
    const cat = menu ? menu.category : 'Lainnya';
    catMap[cat] = (catMap[cat] || 0) + i.subtotal;
  }));
  document.getElementById('repCategoryBreakdown').innerHTML = Object.entries(catMap).map(([cat, rev]) => {
    const pct = Math.round((rev / (totalIncome || 1)) * 100);
    return `<div class="breakdown-row"><div class="breakdown-info"><span>${cat}</span><span>${formatRupiah(rev)} (${pct}%)</span></div>
      <div class="progress-track"><div class="progress-fill" style="width: ${pct}%;"></div></div></div>`;
  }).join('');
  
  // Payment Breakdown
  const mMap = { Tunai: 0, QRIS: 0 };
  data.forEach(t => { mMap[t.paymentMethod] = (mMap[t.paymentMethod] || 0) + 1; });
  document.getElementById('repPaymentBreakdown').innerHTML = Object.entries(mMap).map(([m, c]) => {
    const pct = Math.round((c / (totalTxCount || 1)) * 100);
    return `<div class="breakdown-row"><div class="breakdown-info"><span>${m}</span><span>${c} Transaksi (${pct}%)</span></div>
      <div class="progress-track"><div class="progress-fill" style="width: ${pct}%; background: #3b82f6;"></div></div></div>`;
  }).join('');

  // Top Products
  const iMap = {};
  data.forEach(tx => (tx.items || []).forEach(i => {
    if (!iMap[i.name]) iMap[i.name] = { name: i.name, qty: 0, rev: 0, price: i.price };
    iMap[i.name].qty += i.qty; iMap[i.name].rev += i.subtotal;
  }));
  const top = Object.values(iMap).sort((a,b) => b.qty - a.qty);
  document.getElementById('repTopProductsBody').innerHTML = top.length === 0 ? `<tr><td colspan="6" align="center">Belum ada data.</td></tr>` : 
    top.map((p, idx) => `<tr>
      <td>#${idx + 1}</td><td><strong>${p.name}</strong></td>
      <td><span class="badge-tag badge-blue">${(State.menu.find(m => m.name === p.name) || {}).category || '-'}</span></td>
      <td class="td-price">${formatRupiah(p.price)}</td><td>${p.qty} Cup/Porsi</td><td class="td-price text-emerald">${formatRupiah(p.rev)}</td>
    </tr>`).join('');
}

function exportReportCSV() {
  const data = getFilteredReportTransactions();
  if (data.length === 0) return showToast('Tidak ada data.', 'danger');
  const rows = data.map(t => [t.orderNumber, `"${t.timestamp}"`, `"${t.cashier}"`, t.orderType, t.paymentMethod, t.grandTotal]);
  const csv = 'data:text/csv;charset=utf-8,' + ['No Transaksi,Waktu,Kasir,Tipe,Metode,Total'].concat(rows.map(e => e.join(','))).join('\n');
  const link = document.createElement('a');
  link.href = encodeURI(csv); link.download = `Laporan_Kafe_${Date.now()}.csv`;
  link.click();
}

// ============================================================
// SETTINGS
// ============================================================
function applySettingsToUI() {
  document.getElementById('cfgCafeName').value = State.settings.cafeName;
  document.getElementById('cfgCafeAddress').value = State.settings.address;
  document.getElementById('cfgCafePhone').value = State.settings.phone;
  document.getElementById('cfgCafeWifi').value = State.settings.wifiInfo;
  document.getElementById('cfgTaxRate').value = State.settings.taxRate;
  document.getElementById('cfgReceiptFooter').value = State.settings.footerMessage;
}

async function saveCafeSettings() {
  const newSet = {
    nama_kafe: document.getElementById('cfgCafeName').value.trim(),
    alamat: document.getElementById('cfgCafeAddress').value.trim(),
    telepon: document.getElementById('cfgCafePhone').value.trim(),
    wifi_info: document.getElementById('cfgCafeWifi').value.trim(),
    pajak: Number(document.getElementById('cfgTaxRate').value) || 0,
    footer_struk: document.getElementById('cfgReceiptFooter').value.trim()
  };

  try {
    const result = await apiRequest('/pengaturan', { method: 'PUT', body: JSON.stringify(newSet) });
    const item = result.data;
    State.settings = {
      cafeName: item.nama_kafe,
      address: item.alamat || '',
      phone: item.telepon || '',
      wifiInfo: item.wifi_info || '',
      taxRate: Number(item.pajak) || 0,
      footerMessage: item.footer_struk || ''
    };
    applySettingsToUI();
    renderCartUI();
    showToast('Pengaturan berhasil disimpan.', 'success');
  } catch (error) {
    showToast(`Gagal menyimpan pengaturan: ${error.message}`, 'danger');
  }
}


async function resetToSampleData() {
  if (!confirm('Muat ulang data menu dan pengaturan dari database MySQL? Data transaksi tidak akan dihapus.')) return;
  try {
    await Promise.all([loadMenuFromMySQL(), loadSettingsFromMySQL()]);
    refreshCurrentView();
    showToast('Data berhasil dimuat ulang dari MySQL.', 'info');
  } catch (error) {
    showToast(`Gagal memuat ulang data: ${error.message}`, 'danger');
  }
}


async function clearTransactionsData() {
  if (!confirm('PERINGATAN: Ingin menghapus SELURUH riwayat transaksi? Tindakan ini tidak dapat dibatalkan.')) return;
  try {
    await apiRequest('/transaksi', { method: 'DELETE' });
    State.transactions = [];
    refreshCurrentView();
    showToast('Seluruh riwayat transaksi berhasil dihapus.', 'success');
  } catch (error) {
    showToast(`Gagal menghapus transaksi: ${error.message}`, 'danger');
  }
}


// ============================================================
// RESPONSIVE UI
// ============================================================
function applyResponsiveStyles() {
  if (document.getElementById('kgResponsiveStyles')) return;

  const style = document.createElement('style');
  style.id = 'kgResponsiveStyles';
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { max-width: 100%; overflow-x: hidden; }
    img, canvas, svg { max-width: 100%; }
    button, input, select, textarea { max-width: 100%; }
    .app-main, .main-content, .content-area, .page-content { min-width: 0; }
    .table-responsive, .table-wrap, .data-table-wrapper { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .table-responsive table, .table-wrap table, .data-table-wrapper table { min-width: 760px; }
    .pos-layout, .pos-container, .dashboard-grid, .stats-grid, .report-grid { min-width: 0; }
    .product-grid, #posProductsGrid, #manageMenuGrid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
    .modal-content, .modal-box, .modal-card { width: min(96vw, 720px); max-height: 92vh; overflow-y: auto; }
    .receipt-modal-content, .receipt-paper { max-width: 100%; }
    .login-card { width: min(92vw, 440px); }
    @media (max-width: 1100px) {
      .sidebar { width: 240px; }
      .content-wrapper, .main-content { padding-left: 20px !important; padding-right: 20px !important; }
      .pos-layout { grid-template-columns: 1fr !important; }
      .pos-cart, .cart-panel { position: static !important; width: 100% !important; }
      .dashboard-grid, .report-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    }
    @media (max-width: 768px) {
      .app-sidebar, #appSidebar { transform: translateX(-110%); z-index: 1000; }
      .app-sidebar.open, #appSidebar.open { transform: translateX(0); }
      .main-content, .content-wrapper { margin-left: 0 !important; padding: 14px !important; width: 100% !important; }
      .topbar, .page-header { flex-wrap: wrap; gap: 10px; }
      .page-header > *, .topbar > * { min-width: 0; }
      .dashboard-grid, .report-grid, .stats-grid { grid-template-columns: 1fr !important; }
      .product-grid, #posProductsGrid, #manageMenuGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .product-card { min-width: 0; }
      .product-name { font-size: .92rem; }
      .product-footer-row { gap: 6px; }
      .product-price { font-size: .9rem; }
      .btn-add-circle { width: 34px; height: 34px; flex: 0 0 34px; }
      .cart-item-row { grid-template-columns: 1fr auto; gap: 8px; }
      .cart-item-subtotal { grid-column: 2; }
      .filter-bar, .toolbar, .search-filter-row { flex-wrap: wrap; }
      .filter-bar > *, .toolbar > *, .search-filter-row > * { flex: 1 1 150px; }
      .modal-content, .modal-box, .modal-card { width: calc(100vw - 24px); }
      .form-grid, .settings-grid { grid-template-columns: 1fr !important; }
      .login-card { margin: 12px; }
    }
    @media (max-width: 480px) {
      .product-grid, #posProductsGrid, #manageMenuGrid { grid-template-columns: 1fr; }
      .content-wrapper, .main-content { padding: 10px !important; }
      .card, .panel, .section-card { border-radius: 12px; }
      .btn { min-height: 38px; }
      .table-responsive table, .table-wrap table, .data-table-wrapper table { min-width: 680px; }
      .toast-container, #toastContainer { left: 10px; right: 10px; width: auto; }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// INITIALIZE APP
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('kg_theme') || 'light');
  applyResponsiveStyles();
  // Muat data dari API Node.js + MySQL
  initServerSync();

  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  const savedUser = localStorage.getItem('kg_auth_user');
  if (savedUser) {
    try {
      const parsedUser = JSON.parse(savedUser);
      if (parsedUser && parsedUser.id) {
        State.currentUser = parsedUser;
        initLoggedInState();
      } else {
        localStorage.removeItem('kg_auth_user');
        document.getElementById('loginSection').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
      }
    } catch (_) {
      localStorage.removeItem('kg_auth_user');
      document.getElementById('loginSection').classList.remove('hidden');
      document.getElementById('appContainer').classList.add('hidden');
    }
  } else {
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('appContainer').classList.add('hidden');
  }

  const cashInput = document.getElementById('cashGivenInput');
  if (cashInput) {
    cashInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') processOrder(); });
  }
});
