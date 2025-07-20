import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
import { Gpio } from 'pigpio';
import path from 'path';
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
// CHANGED: Rustデーモンからのタイムスタンプ名を正しく `last_update_timestamp` にします。
interface SensorApiResponse { last_update_timestamp: number; distance_cm: number; raw_data: RawData; fused_data: FusedData; }
let lastSensorData: SensorApiResponse | null = null;

// --- ログ記録用の状態変数 ---
let lastLogTime = 0;
let lastLoggedAngleX = 0;
let lastLoggedAngleY = 0;
// ADDED: 最後にログ送信したセンサーデータのタイムスタンプを記録します。
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

// --- ログをHTTP POSTで送信する関数 ---
async function sendLogData(data: SensorApiResponse) {
    // ログ送信用のデータを作成します。元のデータに「送信時刻」を追加します。
    const dataToSend = {
        ...data,
        timestamp: new Date().getTime(), // 送信時のタイムスタンプ(ミリ秒)を追加
    };

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

            // --- CHANGED: 重複送信防止チェックを追加 ---
            // 条件0: 前回のログからセンサーデータが更新されているか？
            const dataHasUpdated = currentTimestamp !== lastLoggedTimestamp;

            // 条件1: 定期記録時間が経過したか？
            const timeElapsed = now - lastLogTime > LOGGING_INTERVAL_MS;

            // 条件2: 角度が閾値を超えて変化したか？
            const significantChange = 
                Math.abs(angleX - lastLoggedAngleX) > LOGGING_CHANGE_THRESHOLD_DEG ||
                Math.abs(angleY - lastLoggedAngleY) > LOGGING_CHANGE_THRESHOLD_DEG;

            // 「データが更新されている」かつ「定期記録時間 or 大きな変化」のどちらかを満たせばログを送信
            if (dataHasUpdated && (timeElapsed || significantChange)) {
                sendLogData(lastSensorData);
                // 記録した状態を保存
                lastLogTime = now;
                lastLoggedAngleX = angleX;
                lastLoggedAngleY = angleY;
                lastLoggedTimestamp = currentTimestamp; // 最後に記録したセンサー時刻を更新
            }
        }
    } catch (error) {
        // console.error('[Polling] Error fetching data:', error.message);
    }
}, POLLING_INTERVAL_MS);


// --- サーバー起動 ---
httpServer.listen(PORT, () => {
    console.log(`Application Gateway is running on http://localhost:${PORT}`);
    // (ファイル配信のルートは削除済み)
});

// --- プロセス終了時のクリーンアップ ---
process.on('SIGINT', () => {
    console.log('\n[Gateway] Cleaning up all active GPIOs...');
    process.exit(0);
});