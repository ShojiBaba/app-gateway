import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
import { Gpio } from 'pigpio';
// --- ADDED: ファイルパスとファイルシステムを扱うためのモジュールを追加 ---
import path from 'path';
import fs from 'fs';
// FormDataを扱うためのライブラリをインポート
import FormData from 'form-data';

// --- 設定 ---
const PORT = process.env.PORT || 8000;
const RUST_DEMON_URL = 'http://localhost:9090/sensors'; 
const POLLING_INTERVAL_MS = 100;

// --- ログ記録の設定 ---
// const LOG_POST_URL = 'https://home.feriarize.com/rasp-log/'; // 送信先URL
const LOG_POST_URL = 'http://192.168.25.150:40972/server/'; // 送信先URL
const LOGGING_INTERVAL_MS = 5000; // 5秒ごとに定期記録
const LOGGING_CHANGE_THRESHOLD_DEG = 1.0; // 1度以上の角度変化で記録
const LOG_TOKEN = "NpaI1JSn.ai2&Ah0A1$RAT__Awqd)19d0--wdq-"; // 仮の認証トークン

// --- データ型の定義 ---
interface RawData { accel_x: number; accel_y: number; accel_z: number; gyro_x: number; gyro_y: number; gyro_z: number; }
interface FusedData { angle_x_deg: number; angle_y_deg: number; }
interface SensorApiResponse { last_update_timestamp: number; distance_cm: number; raw_data: RawData; fused_data: FusedData; }
let lastSensorData: SensorApiResponse | null = null;

// --- ログ記録用の状態変数 ---
let lastLogTime = 0;
let lastLoggedAngleX = 0;
let lastLoggedAngleY = 0;
let lastLoggedTimestamp = 0;

// --- GPIOピンの管理 ---
const activeGpios = new Map<number, Gpio>();

// --- Express と Socket.IO のセットアップ ---
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    allowEIO3: true
});

// --- ADDED: 拡張機能ファイルを配信するためのルートを再追加 ---
app.get('/sensor_extension.js', (req, res) => {
    // `assets`フォルダの中の`sensor_extension.js`を指定します。
    const filePath = path.join(__dirname, '..', 'assets', 'sensor_extension.js');

    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(`[HTTP] Could not read sensor_extension.js:`, err);
            res.status(404).send(`File not found at ${filePath}`);
            return;
        }
        res.setHeader('Content-Type', 'application/javascript');
        res.send(data);
    });
});

// --- ログをHTTP POSTで送信する関数 ---
async function sendLogData(data: SensorApiResponse) {
    const dataToSend = { ...data, timestamp: new Date().getTime() };
    const formData = new FormData();
    formData.append('token', LOG_TOKEN);
    formData.append('payload', JSON.stringify(dataToSend));
    try {
        await axios.post(LOG_POST_URL, formData, {
            headers: formData.getHeaders(),
        });
        console.log(`[Log] Successfully sent log data generated at ${data.last_update_timestamp}`);
    } catch (error) {
        console.error('[Log] Failed to send log data:', error);
    }
}

// --- Socket.IOの接続ロジック ---
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);
    socket.on('gpio_write', (data: { pin: number, value: 0 | 1 }) => {
        try {
            let pin: Gpio;
            if (activeGpios.has(data.pin)) {
                pin = activeGpios.get(data.pin)!;
            } else {
                pin = new Gpio(data.pin, { mode: Gpio.OUTPUT });
                activeGpios.set(data.pin, pin);
            }
            pin.digitalWrite(data.value);
            console.log(`[GPIO] Pin ${data.pin} set to ${data.value}`);
        } catch (e) {
            console.error(`[GPIO] Failed to write to pin ${data.pin}:`, e);
        }
    });
    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
});

// --- センサーデータのポーリングと配信 ---
setInterval(async () => {
    try {
        const response = await axios.get<SensorApiResponse>(RUST_DEMON_URL);
        if (response.status === 200) {
            lastSensorData = response.data;
            io.emit('sensor_data', lastSensorData);

            // --- ログ記録条件の判定 ---
            const now = Date.now();
            const angleX = lastSensorData.fused_data.angle_x_deg;
            const angleY = lastSensorData.fused_data.angle_y_deg;
            const currentTimestamp = lastSensorData.last_update_timestamp;

            const dataHasUpdated = currentTimestamp !== lastLoggedTimestamp;
            const timeElapsed = now - lastLogTime > LOGGING_INTERVAL_MS;
            const significantChange = 
                Math.abs(angleX - lastLoggedAngleX) > LOGGING_CHANGE_THRESHOLD_DEG ||
                Math.abs(angleY - lastLoggedAngleY) > LOGGING_CHANGE_THRESHOLD_DEG;

            if (dataHasUpdated && (timeElapsed || significantChange)) {
                sendLogData(lastSensorData);
                lastLogTime = now;
                lastLoggedAngleX = angleX;
                lastLoggedAngleY = angleY;
                lastLoggedTimestamp = currentTimestamp;
            }
        }
    } catch (error) {
        // console.error('[Polling] Error fetching data:', error.message);
    }
}, POLLING_INTERVAL_MS);

// --- サーバー起動 ---
httpServer.listen(PORT, () => {
    console.log(`Application Gateway is running on http://localhost:${PORT}`);
    console.log(`Scratch Extension URL: http://localhost:${PORT}/sensor_extension.js`);
});

// --- プロセス終了時のクリーンアップ ---
process.on('SIGINT', () => {
    console.log('\n[Gateway] Cleaning up all active GPIOs...');
    process.exit(0);
});