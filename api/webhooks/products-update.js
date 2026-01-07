console.log("🚨 Vercel - update-ymm.js loaded successfully");

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio"; 

export const config = { runtime: "nodejs" };

// 连接数据库 (保持你的配置)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- 1. 年份解析工具 (增强版) ---
function expandYearRange(yearStr) {
  if (!yearStr) return [];
  // 提取所有4位年份 (例如 2010, 2018)
  const m = yearStr.match(/(19|20)\d{2}/g);
  if (!m) return [];

  if (m.length === 1) return [m[0]];

  // 处理范围，例如 "2010-2018" 或 "2010 to 2018"
  if (m.length >= 2 && (yearStr.includes("-") || yearStr.includes("–") || yearStr.includes("to"))) {
    const start = parseInt(m[0], 10);
    const end = parseInt(m[m.length - 1], 10);
    let years = [];
    if (start <= end) {
      for (let y = start; y <= end; y++) years.push(String(y));
    } else {
      years = m; // 如果顺序不对，就只返回识别到的年份
    }
    return years;
  }
  return m;
}

// --- 2. ★★★ 核心修改：智能表格扫描系统 (Table Hunter) ★★★ ---
function extractYMMfromTable(bodyHtml) {
  if (!bodyHtml) return [];
  const $ = cheerio.load(bodyHtml);
  let finalRows = [];

  // 1. 遍历页面中的每一个表格 (不仅仅是第一个)
  $("table").each((tableIndex, tableElement) => {
    // 如果已经抓到数据了，就不看后面的表格了
    if (finalRows.length > 0) return false;

    const $table = $(tableElement);
    // console.log(`🔎 正在扫描第 ${tableIndex + 1} 个表格...`);

    // --- 步骤 A: 动态识别表头 ---
    let yearIdx = -1, makeIdx = -1, modelIdx = -1;

    // 扫描表头：查找 th 或 td，甚至第一行数据
    // 我们查找含有 div/section 的单元格，利用 .text() 穿透获取纯文本
    const $headers = $table.find("thead tr th, thead tr td, tbody tr:first-child td");
    
    $headers.each((idx, cell) => {
      // 核心：去除所有换行符和多余空格，转小写
      const text = $(cell).text().replace(/[\n\r]+/g, " ").trim().toLowerCase();
      
      if (yearIdx === -1 && text.includes("year")) yearIdx = idx;
      if (makeIdx === -1 && text.includes("make")) makeIdx = idx;
      if (modelIdx === -1 && text.includes("model")) modelIdx = idx;
    });

    // 如果这个表格缺少关键列，说明它不是 YMM 表 (可能是参数表)，跳过
    if (yearIdx === -1 || makeIdx === -1 || modelIdx === -1) {
      return; // Continue next table
    }

    // console.log(`✅ 锁定目标表格！列索引: Year[${yearIdx}], Make[${makeIdx}], Model[${modelIdx}]`);

    // --- 步骤 B: 提取数据 ---
    $table.find("tbody tr").each((rowIndex, row) => {
      const $cells = $(row).find("td");

      // 确保格子数量足够
      if ($cells.length > Math.max(yearIdx, makeIdx, modelIdx)) {
        // 使用 .text() 无视内部是 div 还是 section
        const make = $($cells[makeIdx]).text().trim();
        const model = $($cells[modelIdx]).text().trim();
        const yearText = $($cells[yearIdx]).text().trim();

        // 过滤掉可能是表头重复的行
        if (!make || make.toLowerCase().includes("make") || yearText.toLowerCase().includes("year")) return;

        const years = expandYearRange(yearText);
        years.forEach((y) => {
          finalRows.push({
            brand: make,
            model: model,
            year: y,
          });
        });
      }
    });
  });

  return finalRows;
}

// --- 3. 主程序逻辑 ---
export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const product = req.body;
    console.log(`📦 Processing Product ID: ${product.id}`);

    const bodyHtml = product.body_html || "";
    
    // ★ 执行智能提取
    const ymmList = extractYMMfromTable(bodyHtml);

    // 如果没找到数据，记录日志并返回成功 (避免 Shopify 重试)
    if (!ymmList.length) {
      console.log("❌ 扫描所有表格后未发现 YMM 适配数据。");
      return res.status(200).json({ success: true, message: "No YMM table found" });
    }

    console.log(`🚀 解析成功！准备同步 ${ymmList.length} 条数据...`);

    // --- 数据库写入逻辑 ---
    const productId = String(product.id);
    const title = product.title || "";
    const handle = product.handle || "";
    const sku = product.variants?.[0]?.sku || "";
    const image = product.images?.[0]?.src || "";

    const results = [];
    
    // 循环写入 Supabase
    for (const item of ymmList) {
      const { brand, model, year } = item;

      // 1. 检查是否存在
      const { data: existing } = await supabase
        .from("ymm")
        .select("id")
        .eq("product_id", productId)
        .eq("make", brand)
        .eq("model", model)
        .eq("year", year)
        .limit(1);

      if (existing && existing.length) {
        // 2. 更新
        await supabase.from("ymm").update({
             title, make: brand, model, year, sku, handle, image, updated_at: new Date().toISOString() 
        }).eq("id", existing[0].id);
        results.push("updated");
      } else {
        // 3. 插入
        await supabase.from("ymm").insert([{
             product_id: productId, title, make: brand, model, year, sku, handle, image,
             created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }]);
        results.push("inserted");
      }
    }

    console.log(`✨ Sync Complete! Processed: ${results.length}`);
    return res.status(200).json({ success: true, count: results.length });

  } catch (err) {
    console.error("🔥 Fatal Error:", err);
    // 返回 500 会导致 Shopify 重试，视情况而定，这里建议返回 200 并记录错误
    return res.status(500).json({ error: err.message });
  }
}
