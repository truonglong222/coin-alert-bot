import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "YOUR_CHAT_ID";
const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
const OKX = "https://www.okx.com";
const CACHE_FILE = "sentCoins.json";
const DUPLICATE_TIME = 2 * 60 * 60 * 1000; // 2 giờ

// ================= CACHE =================
function loadCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

const sentCache = loadCache();

function wasSentRecently(symbol) {
    const t = sentCache[symbol];
    if (!t) return false;
    return Date.now() - t < DUPLICATE_TIME;
}

function markSent(symbol) {
    sentCache[symbol] = Date.now();
    saveCache(sentCache);
}

// ================= TELEGRAM =================
async function sendTelegram(text) {
    try {
        await axios.post(TELEGRAM_URL, {
            chat_id: CHAT_ID,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: false
        });
    } catch (e) {
        console.error("Telegram Error:", e.response?.data || e.message);
    }
}

// ================= API =================
async function getTop50() {
    try {
        const { data } = await axios.get(`${OKX}/api/v5/market/tickers?instType=SWAP`);
        if (!data || !data.data) return [];

        return data.data
            .filter(x => x.last && x.open24h)
            .map(x => {
                const open = Number(x.open24h);
                const last = Number(x.last);
                const change24 = open === 0 ? 0 : ((last - open) / open) * 100;
                return { symbol: x.instId, change24 };
            })
            // Sắp xếp theo tăng trưởng thực tế từ cao xuống thấp
            .sort((a, b) => b.change24 - a.change24) 
            .slice(0, 50);
    } catch (e) {
        console.error("Get Top 50 Error:", e.message);
        return [];
    }
}

async function getCandles(symbol, bar, limit) {
    try {
        const { data } = await axios.get(`${OKX}/api/v5/market/candles`, {
            params: { instId: symbol, bar, limit }
        });
        return data.data || [];
    } catch (e) {
        console.error(`Get Candles Error (${symbol} - ${bar}):`, e.message);
        return [];
    }
}

function percent(open, close) {
    return ((close - open) / open) * 100;
}

// ================= MAIN =================
async function checkCoin(symbol, change24) {
    try {
        // 1. ĐÃ SỬA: Check nến 15m (Thay vì 5m như trước)
        const candles15 = await getCandles(symbol, "15m", 2);
        if (candles15.length < 1) return;

        const c15 = candles15[0]; 
        const change15 = percent(Number(c15[1]), Number(c15[4]));

        // Nến 15m hiện tại phải tăng mạnh > 3%
        if (change15 <= 3) return;

        // 2. Check nến 2H (Giữ nguyên lấy nến [0] đang chạy)
        const candles2h = await getCandles(symbol, "2H", 1);
        if (candles2h.length < 1) return;

        const c2 = candles2h[0];
        const change2h = percent(Number(c2[1]), Number(c2[4]));

        // CHỈ CHẶN KHI TĂNG >= 10%. Nến âm (giảm sâu) vẫn được duyệt bình thường
        if (change2h >= 7) return; 

        // 3. Giới hạn biên độ 24h để tránh đu đỉnh coin đã tăng quá cao
        if (change24 >= 25) return;

        // 4. Check trùng trong vòng 2 giờ
        if (wasSentRecently(symbol)) return;

        // 5. ĐÃ SỬA: Tạo link giao dịch chuẩn hóa ngôn ngữ (vi) tránh lỗi redirect về BTC mặc định của OKX
        const tradeSlug = symbol.replace("-SWAP", "").toLowerCase();
        const tradeUrl = `https://www.okx.com/vi/trade-swap/${tradeSlug}`;

        const msg = `🟢 <b>Buy Signal (Futures)</b>\n\n` +
                    `Coin: <a href="${tradeUrl}"><b>${symbol}</b></a>\n\n` +
                    `15m (Hiện tại): <b>${change15.toFixed(2)}%</b>\n` +
                    `2H (Hiện tại): <b>${change2h.toFixed(2)}%</b>\n` +
                    `24H: <b>${change24.toFixed(2)}%</b>\n\n` +
                    `🔗 <a href="${tradeUrl}">Mở đồ thị & Giao dịch trên OKX</a>`;

        await sendTelegram(msg);
        markSent(symbol);

    } catch (e) {
        console.error(`Error processing ${symbol}:`, e.message);
    }
}

async function main() {
    try {
        const top50 = await getTop50();
        for (const coin of top50) {
            await checkCoin(coin.symbol, coin.change24);
            // Delay 180ms giữa các request để tránh dính rate limit (429) của OKX
            await new Promise(r => setTimeout(r, 180)); 
        }
    } catch (e) {
        console.error("Main Process Error:", e.message);
    }
}

// Chạy bot
main();
