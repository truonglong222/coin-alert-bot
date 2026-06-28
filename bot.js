import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "CHAT_ID";
const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
const CACHE_FILE = "./sent_cache.json";

// Hàm delay giúp tránh dính Rate Limit của OKX
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ===========================
// Cache
// ===========================
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function cleanCache(cache) {
  const now = Date.now();
  for (const coin in cache) {
    if (now - cache[coin] > 2 * 60 * 60 * 1000) {
      delete cache[coin];
    }
  }
}

const cache = loadCache();
cleanCache(cache);

// ===========================
// Telegram
// ===========================
async function sendTelegram(text) {
  await axios.post(TELEGRAM_URL, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
  });
}

// ===========================
// Get Top 50 Futures (Sắp xếp theo Vol hoặc Biến động)
// ===========================
async function getTop50() {
  const url = "https://www.okx.com/api/v5/market/tickers?instType=SWAP";
  const res = await axios.get(url);

  return res.data.data
    .filter((c) => c.instId.endsWith("-USDT-SWAP"))
    .sort((a, b) => Math.abs(parseFloat(b.last)) - Math.abs(parseFloat(a.last))) // Hoặc xếp theo vol24h tùy bạn
    .slice(0, 50);
}

// ===========================
// Get Candles (Đổi sang endpoint /candles để lấy realtime tốt hơn)
// ===========================
async function getCandles(instId, bar, limit = 2) {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const res = await axios.get(url);
  return res.data.data || [];
}

// ===========================
// Calculate Change
// ===========================
function percent(open, close) {
  return ((close - open) / open) * 100;
}

// ===========================
// Main
// ===========================
async function main() {
  try {
    const coins = await getTop50();
    console.log(`Đang quét ${coins.length} coins...`);

    for (const coin of coins) {
      const symbol = coin.instId;

      // Nếu đã bắn telegram trong 2h qua thì bỏ qua luôn đỡ tốn request gọi API nến
      if (cache[symbol] && Date.now() - cache[symbol] < 2 * 60 * 60 * 1000) {
        continue;
      }

      try {
        // ---------- Kiểm tra nến 5m ----------
        const c5 = await getCandles(symbol, "5m", 2);
        await sleep(100); // Nghỉ 100ms tránh spam API

        if (!c5 || c5.length < 2) continue;
        
        // OKX trả về nến mới nhất ở index 0 (đang chạy), nến vừa đóng ở index 1
        // Lấy nến đã ĐÓNG CỬA HOÀN TOÀN (index 1) để tính toán chính xác nhất
        const open5 = parseFloat(c5[1][1]);
        const close5 = parseFloat(c5[1][4]);
        const change5 = percent(open5, close5);

        // Điều kiện: Nến 5m phải TĂNG TRƯỞNG > 3% (Bạn đang để <= 3 continue tức là chỉ lấy > 3)
        if (change5 <= 3) continue; 

        // ---------- Kiểm tra nến 4H ----------
        const c4h = await getCandles(symbol, "4H", 2);
        await sleep(100); // Nghỉ 100ms

        if (!c4h || c4h.length < 2) continue;

        const open4 = parseFloat(c4h[1][1]);
        const close4 = parseFloat(c4h[1][4]);
        const change4 = percent(open4, close4);

        // Điều kiện: Nến 4H chưa tăng quá 10% (Tránh đu đỉnh cây nến quá dài)
        if (change4 >= 10) continue;

        // ---------- Thỏa mãn điều kiện -> Bắn Telegram ----------
        const price = parseFloat(coin.last);

        const msg = `🚀 <b>Buy Signal</b>\n\n` +
                    `Coin: <b>${symbol.replace("-SWAP", "")}</b>\n` +
                    `Price: <b>${price}</b>\n\n` +
                    `🔹 5m: +${change5.toFixed(2)}%\n` +
                    `🔹 4H: +${change4.toFixed(2)}%`;

        await sendTelegram(msg);
        console.log(`✅ Đã gửi tín hiệu cho ${symbol}`);

        cache[symbol] = Date.now();
        saveCache(cache);

      } catch (e) {
        console.error(`Lỗi khi xử lý coin ${symbol}:`, e.message);
      }
    }
    console.log("Quét hoàn tất!");
  } catch (err) {
    console.error("Lỗi tổng:", err.message);
  }
}

main();
