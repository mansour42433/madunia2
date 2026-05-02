export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { request_id, invoice_id, new_amount, action } = req.body;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

    try {
        if (action === 'approve') {
            // 1. تحديث مبلغ الفاتورة في جدول الفواتير
            await fetch(`${SUPABASE_URL}/rest/v1/invoices?id=eq.${invoice_id}`, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ due_amount: new_amount })
            });
        }

        // 2. تحديث حالة الطلب إلى معتمد أو مرفوض
        await fetch(`${SUPABASE_URL}/rest/v1/pending_requests?id=eq.${request_id}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ request_status: action === 'approve' ? 'approved' : 'rejected' })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: "خطأ في تنفيذ العملية" });
    }
}
