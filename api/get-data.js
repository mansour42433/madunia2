// api/get-data.js
// SECURITY FIXES:
//   [1] CORS restricted to configured origin
//   [2] Authentication via X-Dashboard-Token
//   [3] Rate limiting per IP
//   [4] Prototype pollution prevention in fetchAllPages
//   [5] Errors don't leak internals to client

// [FIX 3] In-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT  = 30;
const RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

export default async function handler(req, res) {

  // [FIX 1] CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
  const requestOrigin = req.headers['origin'] || '';
  if (allowedOrigin && requestOrigin && requestOrigin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin',  allowedOrigin || requestOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Token');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  // [FIX 3] Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests — please wait a minute' });
  }

  // [FIX 2] Authentication
  const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET;
  if (DASHBOARD_SECRET) {
    const token = req.headers['x-dashboard-token'];
    if (!token || token !== DASHBOARD_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const API_KEY = process.env.QOYOD_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "API Key missing" });
  }

  const headers = {
    "API-KEY": API_KEY,
    "Content-Type": "application/json"
  };

  // ORIGINAL LOGIC — دالة مساعدة لجلب كافة الصفحات بشكل آمن ومستقر
  async function fetchAllPages(baseUrl) {
    let allItems = [];
    let page = 1;
    let hasMore = true;

    // [FIX 4] Safe allowed keys — prevents prototype pollution
    const SAFE_KEYS = new Set(['invoices', 'customers', 'products', 'contacts', 'payments', 'credit_notes']);

    while (hasMore) {
      const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}`;
      try {
        const response = await fetch(url, { headers });
        if (!response.ok) { hasMore = false; break; }

        const data = await response.json();

        // [FIX 4] Only pick known safe keys, never the first arbitrary key
        const key   = Object.keys(data).find(k => SAFE_KEYS.has(k));
        const items = (key && Array.isArray(data[key])) ? data[key] : [];

        if (items.length === 0) {
          hasMore = false;
        } else {
          allItems = allItems.concat(items);
          page++;
          if (page > 20) hasMore = false; // ORIGINAL: حد أمان
        }
      } catch (e) {
        hasMore = false;
        break;
      }
    }
    return allItems;
  }

  try {
    // ORIGINAL LOGIC — نفس الـ endpoints والفلاتر
    const invBaseUrl  = "https://api.qoyod.com/2.0/invoices?q[status_not_eq]=Draft&q[status_not_eq]=Voided&q[status_not_eq]=Paid&per_page=100";
    const custBaseUrl = "https://api.qoyod.com/2.0/customers?per_page=100";
    const prodUrl     = "https://api.qoyod.com/2.0/products?q[sku_eq]=754500950512";

    const [invoices, customers, prodRes] = await Promise.all([
      fetchAllPages(invBaseUrl),
      fetchAllPages(custBaseUrl),
      fetch(prodUrl, { headers })
    ]);

    const prodData      = await prodRes.json();
    const targetProduct = prodData.products && prodData.products.length ? prodData.products[0] : null;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json({
      invoices:       { invoices },
      customers:      { customers },
      target_product: targetProduct
    });

  } catch (err) {
    // [FIX 5] Log internally, generic message to client
    console.error("QOYOD ERROR:", err);
    return res.status(500).json({ error: "فشل في جلب البيانات من قيود. تأكد من مفتاح الـ API." });
  }
}
