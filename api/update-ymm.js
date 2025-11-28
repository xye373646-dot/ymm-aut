console.log("🚨 Vercel - update-ymm.js loaded successfully");

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio"; // ★ 用于解析表格

export const config = { runtime: "nodejs" };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 解析年份（支持 2006-2008）
function expandYearRange(yearStr) {
  if (!yearStr) return [];

  const range = yearStr.match(/(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}/);
  if (range) {
    let start = parseInt(range[1] + range[2], 10);
  }

  const m = yearStr.match(/(19|20)\d{2}/g);
  if (!m) return [];

  if (m.length === 1) return [m[0]];

  // 如果是 2006-2008
  if (m.length === 2 && yearStr.includes("-")) {
    const a = parseInt(m[0]), b = parseInt(m[1]);
    let years = [];
    for (let y = a; y <= b; y++) years.push(String(y));
    return years;
  }

  return m;
}

// ★★★ 解析 <table> 中的 YMM 列表 ★★★
function extractYMMfromTable(bodyHtml) {
  const $ = cheerio.load(bodyHtml);
  const rows = [];

  $("table tbody tr").each((i, row) => {
    const cols = $(row).find("td section.ybc-p");

    if (cols.length >= 3) {
      const make = $(cols[0]).text().trim();
      const model = $(cols[1]).text().trim();
      const yearText = $(cols[2]).text().trim();

      const years = expandYearRange(yearText);

      years.forEach((y) => {
        rows.push({
          brand: make,
          model: model,
          year: y,
        });
      });
    }
  });

  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const product = req.body;
    console.log("Received product data:", product); // 打印产品数据，检查是否正确接收到数据

    if (!product) {
      return res.status(400).json({ error: "Product data is missing" });
    }

    const bodyHtml = product.body_html || "";

    // ★ 从产品页面表格解析YMM
    const ymmList = extractYMMfromTable(bodyHtml);

    if (!ymmList.length) {
      console.log("❌ 没找到表格 YMM，跳过");
      return res.status(200).json({
        success: true,
        message: "No YMM found in product description",
      });
    }

    const productId = String(product.id);
    const title = product.title || "";
    const brandVendor = product.vendor || "";
    const handle = product.handle || "";
    const sku = product.variants?.[0]?.sku || "";
    const image =
      product.images?.[0]?.src ||
      (product.image ? product.image.src : "") ||
      "";

    const results = [];

    for (const item of ymmList) {
      const { brand, model, year } = item;

      // 是否已存在？
      const { data: existing } = await supabase
        .from("ymm")
        .select("id")
        .eq("product_id", productId)
        .eq("make", brand)
        .eq("model", model)
        .eq("year", year)
        .limit(1);

      if (existing && existing.length) {
        const id = existing[0].id;

        const { error: upErr } = await supabase
          .from("ymm")
          .update({
            title,
            make: brand,  // 注意这里 'make' 是表格字段
            model,
            year,
            sku,
            handle,
            image,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (upErr) {
          console.error(`Error updating ${brand} ${model} ${year}:`, upErr);
        } else {
          console.log(`Successfully updated ${brand} ${model} ${year}`);
        }

        results.push({
          make: brand,
          model,
          year,
          action: upErr ? "update_failed" : "updated",
        });
      } else {
        const { error: insErr } = await supabase
          .from("ymm")
          .insert([
            {
              product_id: productId,
              title,
              make: brand,
              model,
              year,
              sku,
              handle,
              image,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]);

        if (insErr) {
          console.error(`Error inserting ${brand} ${model} ${year}:`, insErr);
        } else {
          console.log(`Successfully inserted ${brand} ${model} ${year}`);
        }

        results.push({
          make: brand,
          model,
          year,
          action: insErr ? "insert_failed" : "inserted",
        });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error("Update YMM failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

