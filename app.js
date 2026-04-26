// ===== TT DIRT INVENTORY — Core Application Logic =====

// ── Configuration ──
const CONFIG = {
  // Google Apps Script Web App URL
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzO20BMgu-zwu0mCvVOhkEzHBdKlhrAnV4eSwIyf0k5f81qFLqmUZPGNQIjcXa-bnQe/exec',

  // Column indices (0-based)
  COL: {
    PART_ID: 0,
    PART_NAME: 1,
    STOCK_LEVEL: 2,
    COST_PRICE: 3,
    SALE_PRICE: 4,
    TOTAL_COST_VALUE: 5,
    UNIT_PROFIT: 6,
  },

  LOW_STOCK_THRESHOLD: 3,
};

// ── State ──
let state = {
  inventoryData: [],       // Array of row arrays
  filteredData: [],
  isLoading: false,
  isConnected: false,
  html5QrcodeScanner: null,
  editingRowIndex: null,   // null = adding new, number = editing
};

// ── Calculation Engine ──
function recalculateAll() {
  state.inventoryData.forEach(row => {
    const stock = parseFloat(row[CONFIG.COL.STOCK_LEVEL]) || 0;
    const cost = parseFloat(row[CONFIG.COL.COST_PRICE]) || 0;
    const sale = parseFloat(row[CONFIG.COL.SALE_PRICE]) || 0;
    row[CONFIG.COL.TOTAL_COST_VALUE] = (stock * cost).toFixed(2);
    row[CONFIG.COL.UNIT_PROFIT] = (sale - cost).toFixed(2);
  });
}

function getFinanceSummary() {
  let totalInvestment = 0;
  let totalPotentialProfit = 0;
  state.inventoryData.forEach(row => {
    const stock = parseFloat(row[CONFIG.COL.STOCK_LEVEL]) || 0;
    const totalCost = parseFloat(row[CONFIG.COL.TOTAL_COST_VALUE]) || 0;
    const unitProfit = parseFloat(row[CONFIG.COL.UNIT_PROFIT]) || 0;
    totalInvestment += totalCost;
    totalPotentialProfit += stock * unitProfit;
  });
  return { totalInvestment, totalPotentialProfit };
}

function getLowStockItems() {
  return state.inventoryData
    .map((row, index) => ({ row, index }))
    .filter(item => {
      const stock = parseFloat(item.row[CONFIG.COL.STOCK_LEVEL]) || 0;
      return stock < CONFIG.LOW_STOCK_THRESHOLD;
    })
    .sort((a, b) => parseFloat(a.row[CONFIG.COL.STOCK_LEVEL]) - parseFloat(b.row[CONFIG.COL.STOCK_LEVEL]));
}

// ── Data Operations (fetch-based) ──

// Helper: Fetch from Apps Script with CORS redirect handling
// Google Apps Script responds with a 302 redirect. We use 'redirect: follow'
// and avoid any headers that trigger a CORS preflight (OPTIONS).
async function appsScriptGet(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function appsScriptPost(url, payload) {
  // POST to Apps Script using mode: 'no-cors' to completely bypass CORS preflight
  // This is required because Apps Script redirects (302) on POSTs, which browsers block
  // if mode is 'cors'.
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors', // Opaque response, but request succeeds
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'text/plain',
    }
  });
  
  // Wait a tiny bit for the Apps Script to finish writing before we reload data
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Since 'no-cors' makes the response opaque, we can't read it. We assume success.
  return { success: true };
}

// Fallback: Use JSONP-style script injection if fetch fails due to CORS
function loadViaScriptTag(url) {
  return new Promise((resolve, reject) => {
    // Create a unique callback name
    const callbackName = '_appsScriptCb_' + Date.now();
    // Build URL with callback parameter
    const separator = url.includes('?') ? '&' : '?';
    const scriptUrl = `${url}${separator}callback=${callbackName}`;

    window[callbackName] = (data) => {
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(data);
    };

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.onerror = () => {
      delete window[callbackName];
      document.body.removeChild(script);
      reject(new Error('Script tag fetch also failed'));
    };
    document.body.appendChild(script);

    // Timeout after 15s
    setTimeout(() => {
      if (window[callbackName]) {
        delete window[callbackName];
        try { document.body.removeChild(script); } catch (e) {}
        reject(new Error('Request timed out'));
      }
    }, 15000);
  });
}

function parseResponseData(json) {
  let rows;
  if (json.data && Array.isArray(json.data)) {
    rows = json.data;
  } else if (Array.isArray(json)) {
    rows = json;
  } else {
    rows = json.values || json.rows || [];
  }

  // Skip header row if the first row looks like column names
  if (rows.length > 0 && Array.isArray(rows[0])) {
    const firstCell = String(rows[0][0] || '').toLowerCase();
    if (firstCell === 'part_id' || firstCell === 'part id' || firstCell === 'id') {
      rows = rows.slice(1);
    }
  }

  return rows;
}

async function loadSheetData() {
  setLoading(true);
  try {
    // Try standard fetch first
    const json = await appsScriptGet(CONFIG.WEB_APP_URL);
    state.inventoryData = parseResponseData(json);
    state.isConnected = true;
    recalculateAll();
    renderAll();
    updateConnectionStatus(true);
    showToast(`Loaded ${state.inventoryData.length} items`, 'success');
  } catch (fetchError) {
    console.warn('Fetch failed, trying script tag fallback...', fetchError);
    try {
      // Fallback: use JSONP-style <script> tag (bypasses CORS entirely)
      const json = await loadViaScriptTag(CONFIG.WEB_APP_URL);
      state.inventoryData = parseResponseData(json);
      state.isConnected = true;
      recalculateAll();
      renderAll();
      updateConnectionStatus(true);
      showToast(`Loaded ${state.inventoryData.length} items`, 'success');
    } catch (scriptError) {
      console.error('All fetch methods failed:', scriptError);
      showToast('Failed to load data: ' + fetchError.message, 'error');
      updateConnectionStatus(false);
    }
  }
  setLoading(false);
}

async function addItemToSheet(rowData) {
  try {
    const json = await appsScriptPost(CONFIG.WEB_APP_URL, { action: 'add', row: rowData });
    if (json.error) throw new Error(json.error);

    await loadSheetData();
    showToast('Item added successfully!', 'success');
    return true;
  } catch (e) {
    showToast('Failed to add item: ' + e.message, 'error');
    return false;
  }
}

async function updateItemInSheet(rowIndex, rowData) {
  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-index
  try {
    const json = await appsScriptPost(CONFIG.WEB_APP_URL, { action: 'update', rowIndex: sheetRow, row: rowData });
    if (json.error) throw new Error(json.error);

    await loadSheetData();
    showToast('Item updated successfully!', 'success');
    return true;
  } catch (e) {
    showToast('Failed to update item: ' + e.message, 'error');
    return false;
  }
}

async function deleteItemFromSheet(rowIndex) {
  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-index
  try {
    const json = await appsScriptPost(CONFIG.WEB_APP_URL, { action: 'delete', rowIndex: sheetRow });
    if (json.error) throw new Error(json.error);

    await loadSheetData();
    showToast('Item deleted successfully!', 'success');
  } catch (e) {
    showToast('Failed to delete item: ' + e.message, 'error');
  }
}

// ── Connection Status ──
function updateConnectionStatus(connected) {
  const btn = document.getElementById('btn-auth');
  if (connected) {
    state.isConnected = true;
    document.body.classList.add('authenticated');
    btn.innerHTML = '<span class="status-dot connected"></span> Connected';
    btn.classList.add('signed-in');
    btn.disabled = false;
  } else {
    btn.innerHTML = '<span class="btn-icon">🔄</span> Retry';
    btn.disabled = false;
  }
}

// ── Rendering ──
function renderAll() {
  renderFinanceSummary();
  renderLowStock();
  renderInventoryTable();
}

function renderFinanceSummary() {
  const { totalInvestment, totalPotentialProfit } = getFinanceSummary();
  document.getElementById('total-investment').textContent = formatCurrency(totalInvestment);
  document.getElementById('total-profit').textContent = formatCurrency(totalPotentialProfit);
  document.getElementById('total-items').textContent = `${state.inventoryData.length} items tracked`;
  
  const totalRevenue = state.inventoryData.reduce((sum, row) => {
    const stock = parseFloat(row[CONFIG.COL.STOCK_LEVEL]) || 0;
    const sale = parseFloat(row[CONFIG.COL.SALE_PRICE]) || 0;
    return sum + (stock * sale);
  }, 0);
  document.getElementById('potential-revenue').textContent = `Est. revenue: ${formatCurrency(totalRevenue)}`;
}

function renderLowStock() {
  const lowStockItems = getLowStockItems();
  const container = document.getElementById('low-stock-list');
  const countBadge = document.getElementById('low-stock-count');

  countBadge.textContent = lowStockItems.length;

  if (lowStockItems.length === 0) {
    container.innerHTML = '<div class="low-stock-empty">✅ All items are well-stocked!</div>';
    return;
  }

  container.innerHTML = lowStockItems.map(({ row, index }) => {
    const stock = parseInt(row[CONFIG.COL.STOCK_LEVEL]) || 0;
    const badgeClass = stock === 0 ? 'critical' : 'warning';
    const badgeText = stock === 0 ? '⚠ OUT' : `${stock} left`;
    return `
      <div class="low-stock-item" onclick="scrollToItem(${index})">
        <div>
          <div class="low-stock-item-name">${escapeHtml(row[CONFIG.COL.PART_NAME] || 'Unnamed')}</div>
          <div class="low-stock-item-id">${escapeHtml(row[CONFIG.COL.PART_ID] || '')}</div>
        </div>
        <span class="stock-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');
}

function renderInventoryTable() {
  const query = document.getElementById('search-input')?.value?.toLowerCase() || '';
  const tbody = document.getElementById('inventory-tbody');
  const countEl = document.getElementById('inventory-count');

  let data = state.inventoryData.map((row, index) => ({ row, originalIndex: index }));

  if (query) {
    data = data.filter(({ row }) =>
      row.some(cell => (cell || '').toLowerCase().includes(query))
    );
  }

  countEl.textContent = `${data.length} of ${state.inventoryData.length} items`;

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="icon">📦</div>
          <p>${query ? 'No items match your search' : 'No inventory data yet. Add your first item!'}</p>
        </div>
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(({ row, originalIndex }) => {
    const stock = parseInt(row[CONFIG.COL.STOCK_LEVEL]) || 0;
    const unitProfit = parseFloat(row[CONFIG.COL.UNIT_PROFIT]) || 0;
    const profitClass = unitProfit >= 0 ? 'cell-profit-positive' : 'cell-profit-negative';

    let stockBadge = '';
    if (stock === 0) stockBadge = '<span class="stock-badge critical">OUT</span>';
    else if (stock < CONFIG.LOW_STOCK_THRESHOLD) stockBadge = '<span class="stock-badge warning">LOW</span>';

    return `
      <tr id="row-${originalIndex}" data-index="${originalIndex}">
        <td class="cell-id">${escapeHtml(row[CONFIG.COL.PART_ID] || '')}</td>
        <td>${escapeHtml(row[CONFIG.COL.PART_NAME] || '')}</td>
        <td>${stock} ${stockBadge}</td>
        <td>${formatCurrency(parseFloat(row[CONFIG.COL.COST_PRICE]) || 0)}</td>
        <td>${formatCurrency(parseFloat(row[CONFIG.COL.SALE_PRICE]) || 0)}</td>
        <td class="cell-readonly">${formatCurrency(parseFloat(row[CONFIG.COL.TOTAL_COST_VALUE]) || 0)}</td>
        <td class="cell-readonly ${profitClass}">${formatCurrency(unitProfit)}</td>
        <td>
          <div class="cell-actions">
            <button class="btn-icon-sm" onclick="openEditModal(${originalIndex})" title="Edit">✏️</button>
            <button class="btn-icon-sm delete" onclick="confirmDelete(${originalIndex})" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function setLoading(loading) {
  state.isLoading = loading;
  const tbody = document.getElementById('inventory-tbody');
  if (loading) {
    tbody.innerHTML = Array(5).fill('').map(() => `
      <tr class="skeleton-row">
        ${Array(8).fill('').map(() => '<td><div class="skeleton skeleton-cell">&nbsp;</div></td>').join('')}
      </tr>
    `).join('');
  }
}

// ── Scanner ──
function openScanner() {
  const overlay = document.getElementById('scanner-overlay');
  overlay.classList.add('active');

  if (state.html5QrcodeScanner) {
    state.html5QrcodeScanner.clear();
  }

  state.html5QrcodeScanner = new Html5QrcodeScanner(
    'scanner-container',
    {
      fps: 10,
      qrbox: { width: 250, height: 150 },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
    },
    false
  );

  state.html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function onScanSuccess(decodedText) {
  closeScanner();

  const resultEl = document.getElementById('scanner-result-container');
  resultEl.style.display = 'block';
  document.getElementById('scanner-result-value').textContent = decodedText;

  // Search for the scanned barcode in inventory
  const foundIndex = state.inventoryData.findIndex(
    row => row[CONFIG.COL.PART_ID] === decodedText
  );

  if (foundIndex !== -1) {
    showToast(`Found: ${state.inventoryData[foundIndex][CONFIG.COL.PART_NAME]}`, 'success');
    scrollToItem(foundIndex);
  } else {
    showToast('Part not found. Add it as new?', 'info');
    openAddModal(decodedText);
  }
}

function onScanFailure(error) {
  // Silence — this fires on every frame without a barcode
}

function closeScanner() {
  const overlay = document.getElementById('scanner-overlay');
  overlay.classList.remove('active');
  if (state.html5QrcodeScanner) {
    try {
      state.html5QrcodeScanner.clear();
    } catch (e) { /* ignore */ }
    state.html5QrcodeScanner = null;
  }
}

// ── Modal ──
function openAddModal(prefillId = '') {
  state.editingRowIndex = null;
  document.getElementById('modal-title-text').textContent = 'Add New Item';
  document.getElementById('form-part-id').value = prefillId;
  document.getElementById('form-part-id').readOnly = false;
  document.getElementById('form-part-name').value = '';
  document.getElementById('form-stock').value = '';
  document.getElementById('form-cost').value = '';
  document.getElementById('form-sale').value = '';
  updateComputedPreview();
  document.getElementById('modal-overlay').classList.add('active');
  if (!prefillId) document.getElementById('form-part-id').focus();
}

function openEditModal(index) {
  const row = state.inventoryData[index];
  if (!row) return;
  state.editingRowIndex = index;
  document.getElementById('modal-title-text').textContent = 'Edit Item';
  document.getElementById('form-part-id').value = row[CONFIG.COL.PART_ID] || '';
  document.getElementById('form-part-id').readOnly = true;
  document.getElementById('form-part-name').value = row[CONFIG.COL.PART_NAME] || '';
  document.getElementById('form-stock').value = row[CONFIG.COL.STOCK_LEVEL] || '';
  document.getElementById('form-cost').value = row[CONFIG.COL.COST_PRICE] || '';
  document.getElementById('form-sale').value = row[CONFIG.COL.SALE_PRICE] || '';
  updateComputedPreview();
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  state.editingRowIndex = null;
}

function updateComputedPreview() {
  const stock = parseFloat(document.getElementById('form-stock').value) || 0;
  const cost = parseFloat(document.getElementById('form-cost').value) || 0;
  const sale = parseFloat(document.getElementById('form-sale').value) || 0;
  const totalCost = stock * cost;
  const unitProfit = sale - cost;
  document.getElementById('preview-total-cost').textContent = formatCurrency(totalCost);
  document.getElementById('preview-unit-profit').textContent = formatCurrency(unitProfit);
  document.getElementById('preview-unit-profit').className =
    'form-computed-value ' + (unitProfit >= 0 ? 'profit' : '');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const partId = document.getElementById('form-part-id').value.trim();
  const partName = document.getElementById('form-part-name').value.trim();
  const stock = document.getElementById('form-stock').value.trim();
  const cost = document.getElementById('form-cost').value.trim();
  const sale = document.getElementById('form-sale').value.trim();

  if (!partId || !partName || !stock || !cost || !sale) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  const stockNum = parseFloat(stock);
  const costNum = parseFloat(cost);
  const saleNum = parseFloat(sale);

  const rowData = [
    partId,
    partName,
    stockNum.toString(),
    costNum.toFixed(2),
    saleNum.toFixed(2),
    (stockNum * costNum).toFixed(2),
    (saleNum - costNum).toFixed(2),
  ];

  const submitBtn = document.getElementById('btn-form-submit');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Saving...';

  let success;
  if (state.editingRowIndex !== null) {
    success = await updateItemInSheet(state.editingRowIndex, rowData);
  } else {
    // Check for duplicate Part_ID
    const duplicate = state.inventoryData.findIndex(
      row => row[CONFIG.COL.PART_ID] === partId
    );
    if (duplicate !== -1) {
      showToast('A part with this ID already exists!', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = state.editingRowIndex !== null ? 'Update Item' : 'Add Item';
      return;
    }
    success = await addItemToSheet(rowData);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = state.editingRowIndex !== null ? 'Update Item' : 'Add Item';

  if (success) {
    closeModal();
  }
}

function confirmDelete(index) {
  const row = state.inventoryData[index];
  const name = row[CONFIG.COL.PART_NAME] || row[CONFIG.COL.PART_ID];
  if (confirm(`Delete "${name}"? This cannot be undone.`)) {
    deleteItemFromSheet(index);
  }
}

// ── Search ──
function handleSearch(e) {
  renderInventoryTable();
}

// ── Scroll to item ──
function scrollToItem(index) {
  const row = document.getElementById(`row-${index}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('highlight');
    setTimeout(() => row.classList.remove('highlight'), 3000);
  }
}

// ── Utils ──
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── On DOM Ready ──
document.addEventListener('DOMContentLoaded', () => {
  // Attach event listeners
  document.getElementById('btn-auth').addEventListener('click', () => loadSheetData());
  document.getElementById('btn-scan').addEventListener('click', openScanner);
  document.getElementById('btn-add').addEventListener('click', () => openAddModal());
  document.getElementById('btn-refresh').addEventListener('click', loadSheetData);
  document.getElementById('btn-close-scanner').addEventListener('click', closeScanner);
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('item-form').addEventListener('submit', handleFormSubmit);
  document.getElementById('search-input').addEventListener('input', handleSearch);

  // Live preview for computed fields
  ['form-stock', 'form-cost', 'form-sale'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateComputedPreview);
  });

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Close scanner on overlay click outside scanner
  document.getElementById('scanner-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeScanner();
  });

  // Auto-connect on load
  showToast('Connecting to Google Sheets...', 'info');
  loadSheetData();
});
