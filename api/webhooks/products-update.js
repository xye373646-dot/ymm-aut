import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("📬 Product Updated Webhook Received");

  const product = req.body;

  const payload = {
    id: product.id,
    handle: product.handle,
    title: product.title,
    description: product.body_html
  };

  try {
    await fetch(`${process.env.MY_YMM_API}/api/update-ymm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    console.log("✅ YMM updated for product update");
  } catch (err) {
    console.error("❌ Update YMM failed:", err);
  }

  return res.status(200).json({ success: true });
}
