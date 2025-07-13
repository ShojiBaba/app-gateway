// server.ts (pigpio使用版)

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
// Gpioを'onoff'から'pigpio'に変更します
import { Gpio } from 'pigpio';

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
// Gpioオブジェクトを永続的に保存するためのMap
const activeGpios = new Map<number, Gpio>();

// --- Express と Socket.IO のセットアップ ---
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    allowEIO3: true
});

io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('gpio_write', (data: { pin: number, value: 0 | 1 }) => {
        try {
            let pin: Gpio;

            // 1. Mapに既にGPIOオブジェクトが存在するか確認
            if (activeGpios.has(data.pin)) {
                // 2. 存在すれば、それを取り出す
                pin = activeGpios.get(data.pin)!;
            } else {
                // 3. 存在しなければ、新規作成してMapに保存する
                //    `new Gpio`はBCM番号を正しく解釈します。
                pin = new Gpio(data.pin, { mode: Gpio.OUTPUT });
                activeGpios.set(data.pin, pin);
                console.log(`[GPIO] Pin ${data.pin} initialized.`);
            }

            // 4. 値を書き込む
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

// --- センサーデータのポーリングと配信 (変更なし) ---
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
});

// --- プロセス終了時のクリーンアップ ---
process.on('SIGINT', () => {
    console.log('\n[Gateway] Cleaning up all active GPIOs...');
    // `pigpio`では、明示的なunexportは不要です。
    // プロセスが終了するとライブラリがクリーンアップします。
    process.exit(0);
});