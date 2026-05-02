export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    try {
        // جلب الطلبات المعلقة مع تفاصيل الفاتورة المرتبطة بها
        const response = await fetch(`${SUPABASE_URL}/rest/v1/pending_requests?select=id,requested_due_amount,invoices(id,ref_number,customer_name,due_amount)&request_status=eq.pending`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        
        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: "خطأ في جلب الطلبات" });
    }
}
