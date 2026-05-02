export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { mandoub_id } = req.body; // إيميل المندوب أو معرفه
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    try {
        // نقوم بتحديث جميع الفواتير النشطة الخاصة بهذا المندوب لتصبح is_published = true
        await fetch(`${SUPABASE_URL}/rest/v1/invoices?creator_id=eq.${mandoub_id}&status=neq.Paid`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_published: true })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: "فشل تحديث التطبيق" });
    }
}
