console.log("🚨 Vercel - update-ymm.js loaded successfully");

// api/update-ymm.js
import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "nodejs" };

// supabase 客户端（使用 Vercel 环境变量）
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 辅助：把 year range / lists 转成数组
function extractYears(text) {
  if (!text) return [];

  const years = new Set();

  // 查找范围 2003-2007 或 2003 – 2007（短横/长横）
  const rangeRegex = /(?:\b|[^0-9])((19|20)\d{2})\s*[–\-]\s*((19|20)\d{2})/g;
  let m;
  while ((m = rangeRegex.exec(text))) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[3], 10);
    const start = Math.min(a, b), end = Math.max(a, b);
    for (let y = start; y <= end; y++) years.add(String(y));
  }

  // 单个年份或列表 2003,2004 或 2003 2004
  const singleRegex = /\b(19|20)\d{2}\b/g;
  while ((m = singleRegex.exec(text))) years.add(m[0]);

  return Array.from(years).sort();
}

// 辅助：尝试从文案里抽取 make + model（启发式）
function extractMakeModel(text) {
  if (!text) return { brand: "", model: "" };

  // 常用触发关键词：for fits fit compatible "for 2003-2007 Honda Accord"
  const patterns = [
    /for\s+((?:[A-Z][a-zA-Z0-9&\-]+))\s+([A-Za-z0-9\-\s]{2,40}?)(?:\b(?:19|20)\d{2}\b|,|\)|$)/i,
    /fits\s+((?:[A-Z][a-zA-Z0-9&\-]+))\s+([A-Za-z0-9\-\s]{2,40}?)(?:\b(?:19|20)\d{2}\b|,|\)|$)/i,
    /compatible\s+(?:with)?\s*((?:[A-Z][a-zA-Z0-9&\-]+))\s+([A-Za-z0-9\-\s]{2,40}?)(?:\b(?:19|20)\d{2}\b|,|\)|$)/i,
  ];

  for (const reg of patterns) {
    const m = reg.exec(text);
    if (m) {
      const brand = m[1].trim();
      let model = (m[2] || "").trim();
      model = model.replace(/(series|sedan|wagon|4-door|2-door)$/i, "").trim();
      return { brand, model };
    }
  }

  // 兜底：尝试标题第一个两个单词作为 brand+model
  const parts = text.replace(/\s+/g, " ").trim().split(" ");
  if (parts.length >= 2) {
    return { brand: parts[0], model: parts.slice(1, 3).join(" ") };
  }

  return { brand: "", model: "" };
}

// 主 handler
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const product = req.body;
    console.log("Product received:", product?.id, product?.title?.slice?.(0, 80));

    const text = `${product.title || ""} ${product.body_html || product.body || ""} ${(product.tags || "").toString()}`;
    const years = extractYears(text);

    // 如果没找到年，默认存一条 year = ""（或你可以改成 skip）
    const targetYears = years.length ? years : [null];

    // 尝试从文案中抽取 brand/model
    const { brand: extractedBrand, model: extractedModel } = extractMakeModel(text);

    const brand = product.vendor || extractedBrand || "";
    const model = extractedModel || "";

    const sku = product.variants?.[0]?.sku || "";
    const image = product.images?.[0]?.src || (product.image ? product.image.src : "") || "";

    const productId = String(product.id || product.product_id || "");

    // 为每个 year 插入或更新
    const results = [];
    for (const y of targetYears) {
      const yearVal = y === null ? null : String(y);

      // 先查是否已有相同 product_id + year
      const { data: existing, error: selErr } = await supabase
        .from("ymm")
        .select("id")
        .eq("product_id", productId)
        .eq("year", yearVal)
        .limit(1);

      if (selErr) {
        console.error("Supabase select error:", selErr);
        results.push({ year: yearVal, ok: false, error: selErr });
        continue;
      }

      if (existing && existing.length > 0) {
        // update
        const id = existing[0].id;
        const { data: upData, error: upErr } = await supabase
          .from("ymm")
          .update({
            title: product.title || "",
            brand,
            model,
            sku,
            handle: product.handle || "",
            image,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (upErr) {
          console.error("Supabase update error:", upErr);
          results.push({ year: yearVal, ok: false, error: upErr });
        } else {
          results.push({ year: yearVal, ok: true, action: "updated", data: upData });
        }
      } else {
        // insert
        const { data: insData, error: insErr } = await supabase.from("ymm").insert([{
          product_id: productId,
          title: product.title || "",
          brand,
          model,
          year: yearVal,
          sku,
          handle: product.handle || "",
          image,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]);

        if (insErr) {
          console.error("Supabase insert error:", insErr);
          results.push({ year: yearVal, ok: false, error: insErr });
        } else {
          results.push({ year: yearVal, ok: true, action: "inserted", data: insData });
        }
      }
    }

    console.log("YMM results:", results);
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error("Update YMM failed:", err);
    return res.status(500).json({ success: false, error: err?.message || err });
  }
}

