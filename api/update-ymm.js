console.log("🚀 Vercel - update-ymm.js loaded successfully");

// api/update-ymm.js
import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "nodejs" };

// Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ----------------------------------------
   年份提取（识别范围 / 单年）
----------------------------------------- */
function extractYears(text) {
  if (!text) return [];

  const years = new Set();

  // 识别 2006–2009（长短横都支持）
  const rangeRegex = /((19|20)\d{2})\s*[–\-]\s*((19|20)\d{2})/g;
  let m;
  while ((m = rangeRegex.exec(text))) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[3], 10);
    for (let y = start; y <= end; y++) years.add(String(y));
  }

  // 单年份：2006
  const singleRegex = /\b(19|20)\d{2}\b/g;
  while ((m = singleRegex.exec(text))) years.add(m[0]);

  return Array.from(years).sort();
}

/* ----------------------------------------
   品牌 + 车型解析器（核心）
   支持：
   - "Subaru | Outback | 2006–2009 | 2.5L"
   - "compatible for Subaru Outback 2006-2009"
   - "fits Subaru Legacy 2010"
----------------------------------------- */
function extractMakeModel(text) {
  if (!text) return { brand: "", model: "" };

  // 表格格式识别：Brand | Model | Year...
  const tableRegex = /(\b[A-Z][a-zA-Z]+)\s*\|\s*([A-Za-z0-9\- ]{2,40})\s*\|\s*(19|20)\d{2}/;
  const t1 = tableRegex.exec(text);
  if (t1) {
    return {
      brand: t1[1].trim(),
      model: t1[2].trim()
    };
  }

  // 行内识别 Fits/For/Compatible
  const inlineRegex = /(compatible\s+for|fits|for)\s+([A-Z][a-zA-Z]+)\s+([A-Za-z0-9\- ]{2,40})\s*(19|20)\d{2}/i;
  const t2 = inlineRegex.exec(text);
  if (t2) {
    return {
      brand: t2[2].trim(),
      model: t2[3].trim()
    };
  }

  return { brand: "", model: "" };
}

/* ----------------------------------------
   主 Handler
----------------------------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const product = req.body;
    console.log("Product received:", product?.id, product?.title?.slice?.(0, 80));

    const text = `
      ${product.title || ""}
      ${product.body_html || product.body || ""}
      ${(product.tags || "").toString()}
    `;

    /* ---- 提取年份 ---- */
    const years = extractYears(text);
    const targetYears = years.length ? years : [null];

    /* ---- 提取品牌 / 车型 ---- */
    const { brand: extractedBrand, model: extractedModel } = extractMakeModel(text);

    const brand = extractedBrand || product.vendor || "";
    const model = extractedModel || "";

    /* ---- 其他字段 ---- */
    const sku = product.variants?.[0]?.sku || "";
    const image =
      product.images?.[0]?.src ||
      (product.image ? product.image.src : "") ||
      "";

    const productId = String(product.id || product.product_id || "");
    const handle = product.handle || "";

    const results = [];

    /* ---- 为每个年份写入 YMM ---- */
    for (const y of targetYears) {
      const yearValue = y === null ? null : String(y);

      // 检查是否已有记录
      const { data: existing, error: selErr } = await supabase
        .from("ymm")
        .select("id")
        .eq("product_id", productId)
        .eq("year", yearValue)
        .limit(1);

      if (selErr) {
        console.error("Supabase select error:", selErr);
        results.push({ year: yearValue, ok: false, error: selErr });
        continue;
      }

      if (existing && existing.length > 0) {
        // UPDATE
        const id = existing[0].id;
        const { data: upData, error: upErr } = await supabase
          .from("ymm")
          .update({
            title: product.title,
            brand,
            model,
            sku,
            handle,
            image,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (upErr) {
          console.error("Supabase update error:", upErr);
          results.push({ year: yearValue, ok: false, error: upErr });
        } else {
          results.push({ year: yearValue, ok: true, action: "updated" });
        }
      } else {
        // INSERT
        const { data: insData, error: insErr } = await supabase
          .from("ymm")
          .insert([
            {
              product_id: productId,
              title: product.title,
              brand,
              model,
              year: yearValue,
              sku,
              handle,
              image,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]);

        if (insErr) {
          console.error("Supabase insert error:", insErr);
          results.push({ year: yearValue, ok: false, error: insErr });
        } else {
          results.push({ year: yearValue, ok: true, action: "inserted" });
        }
      }
    }

    console.log("YMM results:", results);
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error("❌ Update YMM failed:", err);
    return res.status(500).json({ success: false, error: err?.message || err });
  }
}
