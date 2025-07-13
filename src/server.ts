import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
import { Gpio } from 'pigpio';
// ファイルパスを扱うためのモジュールを追加します。
import path from 'path';
import fs from 'fs';

// --- 設定 ---
const PORT = process.env.PORT || 8000;
const RUST_DEMON_URL = 'http://localhost:9090/sensors'; 
const POLLING_INTERVAL_MS = 100;

// --- データ型の定義 ---
interface RawData { accel_x: number; accel_y: number; accel_z: number; gyro_x: number; gyro_y: number; gyro_z: number; }
interface FusedData { angle_x_deg: number; angle_y_deg: number; }
interface SensorApiResponse { distance_cm: number; raw_data: RawData; fused_data: FusedData; }
let lastSensorData: SensorApiResponse | null = null;

// --- GPIOピンの管理 ---
const activeGpios = new Map<number, Gpio>();

// --- Express と Socket.IO のセットアップ ---
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    allowEIO3: true
});

// --- 拡張機能ファイルを配信するためのルート ---
app.get('/sensor_extension.js', (req, res) => {
    // --- ▼▼▼ ファイルパスの構築ロジックを修正 ▼▼▼ ---
    // 実行中のディレクトリ(src)から一つ上の階層に上がり、
    // `assets`フォルダの中の`sensor_extension.js`を指定します。
    const filePath = path.join(__dirname, '..', 'assets', 'sensor_extension.js');
    // --- ▲▲▲ ここまで修正 ▲▲▲ ---

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
                console.log(`[GPIO] Pin ${data.pin} initialized.`);
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