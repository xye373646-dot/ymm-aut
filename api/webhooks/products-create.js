// api/webhooks/products-create.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    console.log("Product webhook received");
    const product = req.body;

    // 如果你想直接调 internal update handler：
    const url = `${process.env.DOMAIN.replace(/\/$/, "")}/api/update-ymm`;

    console.log("Forwarding to internal YMM:", url);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product),
    });

    console.log("Update YMM status:", resp.status);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Forward failed:", err);
    return res.status(500).send("error");
  }
}

