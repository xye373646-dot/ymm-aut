import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "nodejs",
};

// 创建 Supabase 客户端（使用环境变量）
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("🚗 YMM Update triggered");
  console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
  console.log(
    "SERVICE_ROLE_KEY =",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? "Loaded" : "Missing"
  );

  const product = req.body;

  console.log("🔧 Received product payload:", product);

  try {
    // ⚠️ 根据你的字段名写入 Supabase
    const { data, error } = await supabase.from("ymm").insert({
      product_id: product.id,
      title: product.title,
      brand: product.vendor || "",
      sku: product.variants?.[0]?.sku || "",
      handle: product.handle || "",
      created_at: new Date(),
    });

    if (error) {
      console.error("❌ Supabase insert error:", error);
      return res.status(500).json({
        success: false,
        message: "Supabase insert failed",
        error,
      });
    }

    console.log("✅ Supabase insert success:", data);

    return res.status(200).json({
      success: true,
      message: "YMM updated successfully",
      data,
    });
  } catch (err) {
    console.error("🔥 Update YMM failed:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err,
    });
  }
}
