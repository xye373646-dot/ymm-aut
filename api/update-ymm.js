export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("🚗 YMM Update triggered");

  const data = req.body;

  // ▼ 你可以在这里写入你自己的 YMM 更新逻辑
  console.log("🔧 Received product payload:", data);

  // TODO: 将数据写入数据库 / Google Sheet / JSON 文件等

  return res.status(200).json({
    success: true,
    message: "YMM updated successfully",
    received: data
  });
}
