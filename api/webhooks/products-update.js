export const config = {
  runtime: "nodejs",
};

import fetch from "node-fetch";

export default async function handler(req, res) {
  console.log("DOMAIN =", process.env.DOMAIN);

  try {
    const url = `${process.env.DOMAIN}/api/update-ymm`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    console.log("Update YMM status:", resp.status);

    res.status(200).send("ok");
  } catch (err) {
    console.error("Update YMM failed:", err);
    res.status(500).send("error");
  }
}
