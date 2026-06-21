import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const STATE_FILE = "./state.json";
const COOLDOWN = 8 * 60 * 60 * 1000;

// ================= STATE =================
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ================= TELEGRAM =================
async function sendTelegram(text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "Markdown"
  });
}

// ================= COOLDOWN =================
function canSend(lastTime) {
  if (!lastTime) return true;
  return Date.now() - lastTime > COOLDOWN;
}

// ================= OKX TICKERS =================
async function getTickers() {
  const res = await axios.get(
    "https://www.okx.com/api/v5/market/tickers?instType=SPOT"
  );
  return res.data.data || [];
}

// ================= CANDLE CHANGE =================
async function getChange(instId, bar) {
  const res = await axios.get(
    `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=2`
  );

  const d = res.data.data;
  if (!d || d.length < 2) return null;

  const open = Number(d[1][1]);
  const close = Number(d[0][4]);

  if (open === 0) return null;

  return ((close - open) / open) * 100;
}

// ================= MAIN =================
async function run() {
  const state = loadState();

  const tickers = await getTickers();

  // 🔥 CHANGE HERE: TOP 10 instead of TOP 5
  const usdtCoins = tickers
    .filter(t => t.instId.endsWith("-USDT"))
    .map(t => {
      const last = Number(t.last);
      const open24h = Number(t.open24h);

      const change24h =
        open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;

      return {
        instId: t.instId,
        change24h
      };
    })
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 10); // 🔥 TOP 10

  let alerts = [];

  for (const coin of usdtCoins) {
    const symbol = coin.instId;

    try {
      // 15m > 3%
      const chg15m = await getChange(symbol, "15m");
      if (chg15m === null || chg15m <= 3) continue;

      // 4h -5% to +5%
      const chg4h = await getChange(symbol, "4H");
      if (chg4h === null) continue;

      if (chg4h <= -5 || chg4h >= 5) continue;

      // cooldown 8h
      if (!canSend(state[symbol])) continue;

      alerts.push({
        symbol,
        chg15m,
        chg4h,
        change24h: coin.change24h
      });

      state[symbol] = Date.now();
    } catch (e) {
      continue;
    }
  }

  saveState(state);

  if (alerts.length === 0) return;

  let msg = `🚨 *OKX ALERT (TOP 10 24H)*\n\n`;

  for (const a of alerts) {
    msg += `🪙 ${a.symbol}\n`;
    msg += `24h: +${a.change24h.toFixed(2)}%\n`;
    msg += `15m: +${a.chg15m.toFixed(2)}%\n`;
    msg += `4h: ${a.chg4h.toFixed(2)}%\n\n`;
  }

  await sendTelegram(msg);
}

run();
