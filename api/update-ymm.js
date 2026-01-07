console.log("🚨 Vercel - update-ymm.js loaded successfully");

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio"; // ★ 用于解析表格

export const config = { runtime: "nodejs" };

// 初始化 Supabase (保持不变)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 解析年份范围 (逻辑优化：清理了死代码，保持核心逻辑不变)
function expandYearRange(yearStr) {
  if (!yearStr) return [];

  // 提取所有 4 位年份 (19xx 或 20xx)
  const m = yearStr.match(/(19|20)\d{2}/g);
  if (!m) return [];

  if (m.length === 1) return [m[0]];

  // 处理范围，例如 "2006-2008"
  if (m.length >= 2 && (yearStr.includes("-") || yearStr.includes("–"))) {
    const start = parseInt(m[0], 10);
    const end = parseInt(m[m.length - 1], 10); // 取最后一个年份作为结束
    let years = [];
    // 只有当开始年份小于结束年份时才循环，防止死循环
    if (start <= end) {
      for (let y = start; y <= end; y++) years.push(String(y));
    } else {
      years = m; // 如果年份顺序不对，就直接返回提取到的单个年份
    }
    return years;
  }

  // 如果只是多个年份用逗号隔开，直接返回
  return m;
}

// ★★★ NEW: 智能解析表格逻辑 (动态列名 + 无视内部标签) ★★★
function extractYMMfromTable(bodyHtml) {
  if (!bodyHtml) return [];
  const $ = cheerio.load(bodyHtml);
  const rows = [];
  
  // 找到第一个表格
  const $table = $("table").first();
  if ($table.length === 0) return [];

  // 1. 动态映射：分析表头，找出 Year/Make/Model 分别在第几列
  let yearIdx = -1, makeIdx = -1, modelIdx = -1;

  // 扫描表头 (同时支持 th 和 td 作为表头)
  const $headers = $table.find("thead tr th, thead tr td");
  
  $headers.each((index, element) => {
    const text = $(element).text().trim().toLowerCase();
    // 模糊匹配列名
    if (text.includes("year")) yearIdx = index;
    else if (text.includes("make")) makeIdx = index;
    else if (text.includes("model")) modelIdx = index;
  });

  // 如果没找到关键列，尝试检查第一行数据作为表头 (备用方案)
  if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
    const $firstRowCells = $table.find("tbody tr:first-child td");
    $firstRowCells.each((index, element) => {
        const text = $(element).text().trim().toLowerCase();
        if (text.includes("year")) yearIdx = index;
        else if (text.includes("make")) makeIdx = index;
        else if (text.includes("model")) modelIdx = index;
    });
  }

  // 如果还是找不到，说明表格格式完全不匹配，打印日志并退出
  if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
    console.log("⚠️ 表格存在，但无法识别 Year/Make/Model 表头列，跳过解析。");
    return [];
  }

  // 2. 遍历数据行
  $table.find("tbody tr").each((i, row) => {
    const $cells = $(row).find("td");

    // 确保这一行有足够的列
    const maxIndex = Math.max(yearIdx, makeIdx, modelIdx);
    if ($cells.length > maxIndex) {
      // ★ 核心修改：直接用 .text() 获取单元格纯文本
      // 这样无论里面是 <section>, <div> 还是 <span> 都能读到
      const make = $($cells[makeIdx]).text().trim();
      const model = $($cells[modelIdx]).text().trim();
      const yearText = $($cells[yearIdx]).text().trim();

      // 如果数据有效，则处理年份
      if (make && model && yearText) {
        // 排除掉可能是表头重复的行
        if (make.toLowerCase().includes("make") || yearText.toLowerCase().includes("year")) return;

        const years = expandYearRange(yearText);
        years.forEach((y) => {
          rows.push({
            brand: make,
            model: model,
            year: y,
          });
        });
      }
    }
  });

  return rows;
}

// 主处理函数 (保持原有的业务逻辑和数据库操作)
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const product = req.body;
    console.log(`Received Update for Product ID: ${product.id}`); 

    if (!product) {
      return res.status(400).json({ error: "Product data is missing" });
    }

    const bodyHtml = product.body_html || "";

    // ★ 调用新的智能解析函数
    const ymmList = extractYMMfromTable(bodyHtml);

    if (!ymmList.length) {
      console.log("❌ 没找到表格 YMM，或者表格格式无法识别");
      return res.status(200).json({
        success: true,
        message: "No recognized YMM table found",
      });
    }
    
    console.log(`✅ 解析成功，发现 ${ymmList.length} 条适配数据`);

    // --- 以下代码与原版完全一致，负责 Supabase 写入 ---
    const productId = String(product.id);
    const title = product.title || "";
    const brandVendor = product.vendor || ""; // 这里的 brandVendor 虽然定义了但下文用的是 ymmList 里的 brand，逻辑没问题
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
            make: brand,
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
          // console.log(`Updated ${brand} ${model} ${year}`); // 减少日志刷屏
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
          // console.log(`Inserted ${brand} ${model} ${year}`); // 减少日志刷屏
        }

        results.push({
          make: brand,
          model,
          year,
          action: insErr ? "insert_failed" : "inserted",
        });
      }
    }
    
    console.log(`✨ Sync Complete. Processed ${results.length} items.`);
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error("Update YMM failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

