# Application Gateway (`app-gateway`)

## 概要

`gpio-sensors`デーモンからセンサーデータを取得し、WebSocketを介してクライアント（Scratch拡張機能など）にリアルタイムで配信するためのNode.js製アプリケーションゲートウェイです。
また、クライアントからGPIOピンの出力を制御する機能も提供します。

## 前提条件

- Node.js 及び npm がインストールされていること。
- `gpio-sensors` プロジェクトが `http://localhost:9090` で動作していること。

## セットアップ

プロジェクトのルートディレクトリで以下のコマンドを実行し、必要な依存関係をインストールします。

```bash
npm install
```

## 実行方法

- **開発モードでの実行（ファイルの変更を自動で反映）:**
  ```bash
  npm run dev
  ```

- **本番モードでの実行:**
  ```bash
  npm start
  ```

サーバーが起動すると、`http://localhost:8000` で待機します。

## 主な機能

- **Scratch拡張機能の提供**
  - `http://localhost:8000/sensor_extension.js` にアクセスすることで、Scratchからセンサーデータを利用するための拡張機能を取得できます。

- **センサーデータのリアルタイム配信 (WebSocket)**
  - WebSocketクライアントは `sensor_data` イベントを購読することで、`gpio-sensors`デーモンからの最新のセンサーデータをJSON形式で受け取ることができます。

- **GPIO出力の制御 (WebSocket)**
  - クライアントは `gpio_write` イベントを送信することで、Raspberry PiのGPIOピン出力を制御できます。
  - **データ形式:** `{ "pin": <ピン番号>, "value": <0 or 1> }`
    - `pin`: 制御したいGPIOピンのBCM番号
    - `value`: `1`でHigh、`0`でLow
