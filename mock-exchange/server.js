const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Mock user portfolio (가상 사용자 자산)
let userPortfolio = {
  KRW: 10000000, // 초기 가상 자금 1000 만원
  BTC: 0,
  ETH: 0,
  XRP: 0,
  SOL: 0
};

// 거래 내역
let tradeHistory = [];

// 코인 심볼 목록
const COINS = ['BTC', 'ETH', 'XRP', 'SOL'];
const BASE_URL = 'https://api.upbit.com/v1';

// 실시간 가격 캐시
let currentPrices = {};

// Upbit API 에서 실시간 가격 가져오기
async function fetchPrices() {
  try {
    const tickers = COINS.map(coin => `KRW-${coin}`).join(',');
    const response = await axios.get(`${BASE_URL}/ticker`, {
      params: { markets: tickers }
    });
    
    response.data.forEach(item => {
      const symbol = item.market.split('-')[1];
      currentPrices[symbol] = {
        price: item.trade_price,
        change: item.change,
        changePrice: item.change_price,
        changeRate: item.change_rate,
        high: item.high_price,
        low: item.low_price,
        volume: item.acc_trade_price_24h
      };
    });
    
    return currentPrices;
  } catch (error) {
    console.error('가격 데이터 조회 오류:', error.message);
    return currentPrices;
  }
}

// REST API: 현재 가격 조회
app.get('/api/prices', async (req, res) => {
  const prices = await fetchPrices();
  res.json(prices);
});

// REST API: 사용자 포트폴리오 조회
app.get('/api/portfolio', (req, res) => {
  res.json(userPortfolio);
});

// REST API: 주문 체결
app.post('/api/order', async (req, res) => {
  const { type, coin, amount } = req.body; // type: 'buy' or 'sell'
  
  if (!currentPrices[coin]) {
    return res.status(400).json({ error: 'Invalid coin' });
  }
  
  const price = currentPrices[coin].price;
  
  if (type === 'buy') {
    const cost = price * amount;
    if (userPortfolio.KRW < cost) {
      return res.status(400).json({ error: 'Insufficient KRW balance' });
    }
    
    userPortfolio.KRW -= cost;
    userPortfolio[coin] += amount;
    
    tradeHistory.unshift({
      type: 'BUY',
      coin,
      amount,
      price,
      total: cost,
      timestamp: new Date().toISOString()
    });
    
  } else if (type === 'sell') {
    if (userPortfolio[coin] < amount) {
      return res.status(400).json({ error: 'Insufficient coin balance' });
    }
    
    const revenue = price * amount;
    userPortfolio[coin] -= amount;
    userPortfolio.KRW += revenue;
    
    tradeHistory.unshift({
      type: 'SELL',
      coin,
      amount,
      price,
      total: revenue,
      timestamp: new Date().toISOString()
    });
  }
  
  res.json({ success: true, portfolio: userPortfolio });
});

// REST API: 거래 내역 조회
app.get('/api/history', (req, res) => {
  res.json(tradeHistory.slice(0, 50)); // 최근 50 건만
});

// REST API: 캔들스틱 데이터 (차트용)
app.get('/api/candles/:coin', async (req, res) => {
  const { coin } = req.params;
  try {
    const response = await axios.get(`${BASE_URL}/candles/minutes/1`, {
      params: { 
        market: `KRW-${coin}`,
        count: 100
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch candle data' });
  }
});

// WebSocket: 실시간 가격 브로드캐스트
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('subscribe', async (coins) => {
    console.log(`Client ${socket.id} subscribed to:`, coins);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// 3 초마다 실시간 가격 업데이트 및 브로드캐스트
setInterval(async () => {
  const prices = await fetchPrices();
  io.emit('priceUpdate', prices);
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mock Exchange Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
