import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "CHAT_ID";

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
const OKX_TICKERS = "https://www.okx.com/api/v5/market/tickers?instType=SWAP";

const CACHE_FILE = "./sent_cache.json";

// =====================
// Load / Save cache
// =====================
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

// =====================
// Telegram send
// =====================
async function sendTelegram(message) {
  await axios.post(TELEGRAM_URL, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// =====================
// Get all swap coins
// =====================
async function getAllCoins() {
  const res = await axios.get(OKX_TICKERS);
  return res.data.data;
}

// =====================
// Sort by volatility (24h)
// =====================
function getTop50Volatile(coins) {
  return coins
    .filter(c => c.instId && c.last && c.open24h)
    .map(c => {
      const change24h =
        ((parseFloat(c.last) - parseFloat(c.open24h)) /
          parseFloat(c.open24h)) *
        100;

      return {
        instId: c.instId,
        change24h: Math.abs(change24h),
      };
    })
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 50);
}

// =====================
// Get candle change
// =====================
async function getChange(instId, bar = "15m", periods = 1) {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${periods}`;
  const res = await axios.get(url);

  if (!res.data.data || res.data.data.length === 0) return 0;

  const candle = res.data.data[0];
  const open = parseFloat(candle[1]);
  const close = parseFloat(candle[4]);

  return ((close - open) / open) * 100;
}

// =====================
// Main logic
// =====================
async function runBot() {
  try {
    const cache = loadCache();
    const now = Date.now();

    const coins = await getAllCoins();
    const top50 = getTop50Volatile(coins);

    let results = [];

    for (const coin of top50) {
      const instId = coin.instId;

      try {
        const change15m = await getChange(instId, "15m", 1);
        const change4h = await getChange(instId, "4H", 1);

        const condition1 = change15m > 4;
        const condition2 = change4h > -5 && change4h < 5;

        if (condition1 && condition2) {
          // chống spam 2h
          if (cache[instId] && now - cache[instId] < 2 * 60 * 60 * 1000) {
            continue;
          }

          cache[instId] = now;

          results.push(
            `🚀 BUY SIGNAL\nCoin: ${instId}\n15m: ${change15m.toFixed(
              2
            )}%\n4h: ${change4h.toFixed(2)}%`
          );
        }
      } catch (e) {
        continue;
      }
    }

    if (results.length > 0) {
      await sendTelegram(results.join("\n\n"));
      saveCache(cache);
    }
  } catch (err) {
    console.error("Bot error:", err.message);
  }
}

// Run
runBot();
