export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    // التأكد من وجود المتغيرات
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: "Environment variables missing" });
    }

    try {
        // طلب مبسط جداً لجلب الطلبات المعلقة فقط للتجربة
        const response = await fetch(`${SUPABASE_URL}/rest/v1/pending_requests?select=*&request_status=eq.pending`, {
            headers: { 
                'apikey': SUPABASE_KEY, 
                'Authorization': `Bearer ${SUPABASE_KEY}` 
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            return res.status(response.status).json({ error: errorData });
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: "Server Error: " + error.message });
    }
}
