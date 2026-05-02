// api/get-data.js (نسخة المزامنة بين قيود و Supabase)

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

  // [1] CORS
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

  // [2] Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests — please wait a minute' });
  }

  // [3] Authentication
  const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET;
  if (DASHBOARD_SECRET) {
    const token = req.headers['x-dashboard-token'];
    if (!token || token !== DASHBOARD_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // جلب المفاتيح
  const API_KEY = process.env.QOYOD_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!API_KEY) return res.status(500).json({ error: "Qoyod API Key missing" });

  const headers = {
    "API-KEY": API_KEY,
    "Content-Type": "application/json"
  };

  async function fetchAllPages(baseUrl) {
    let allItems = [];
    let page = 1;
    let hasMore = true;
    const SAFE_KEYS = new Set(['invoices', 'customers', 'products', 'contacts', 'payments', 'credit_notes']);

    while (hasMore) {
      const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}`;
      try {
        const response = await fetch(url, { headers });
        if (!response.ok) { hasMore = false; break; }
        const data = await response.json();
        const key   = Object.keys(data).find(k => SAFE_KEYS.has(k));
        const items = (key && Array.isArray(data[key])) ? data[key] : [];

        if (items.length === 0) {
          hasMore = false;
        } else {
          allItems = allItems.concat(items);
          page++;
          if (page > 20) hasMore = false;
        }
      } catch (e) {
        hasMore = false;
        break;
      }
    }
    return allItems;
  }

  try {
    // 1. جلب البيانات من قيود
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

    // 2. تجهيز البيانات بصيغة تتوافق مع قاعدة بيانات Supabase
    const targetId = targetProduct ? targetProduct.id : null;
    const customersMap = {};
    customers.forEach(c => customersMap[c.id] = c.name);

    const formattedInvoices = invoices.map(inv => {
        let isDelayed = false;
        if(targetId && inv.line_items) isDelayed = inv.line_items.some(i => i.product_id === targetId);
        else if(inv.line_items) isDelayed = inv.line_items.some(i => i.sku === "754500950512" || i.product_name?.includes("آجلة"));

        return {
            ref_number: inv.reference,
            customer_name: customersMap[inv.contact_id] || inv.contact_name || "عميل عام",
            issue_date: inv.issue_date,
            due_date: inv.due_date || inv.issue_date,
            total_amount: parseFloat(inv.total),
            due_amount: parseFloat(inv.due_amount) || parseFloat(inv.total),
            is_delayed: isDelayed,
            status: inv.status
        };
    });

    // 3. المزامنة اللحظية مع Supabase (Upsert)
    // يقوم بتحديث الفاتورة إذا كانت موجودة، أو يضيفها إذا كانت جديدة
    if (SUPABASE_URL && SUPABASE_KEY && formattedInvoices.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/invoices`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates, return=minimal'
            },
            body: JSON.stringify(formattedInvoices)
        });
    }

    // 4. إرجاع البيانات للواجهة الأمامية بنفس التنسيق القديم كي لا يتعطل موقعك
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json({
      invoices:       { invoices },
      customers:      { customers },
      target_product: targetProduct
    });

  } catch (err) {
    console.error("SYNC ERROR:", err);
    return res.status(500).json({ error: "فشل في جلب البيانات أو مزامنتها مع قاعدة البيانات." });
  }
}
