# Options Signal Scanner

A browser-based Angel One options scanner for index, stock, and MCX commodity options. It checks technical indicators, support/resistance, option-chain strength, liquidity, spread, and risk levels before showing BUY / WATCH / NO TRADE signals.

## What Is Included

- Index option scanner for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, and SENSEX
- Stock option scanner using a stock symbol and Angel One token
- Commodity option scanner for MCX symbols such as CRUDEOIL, NATURALGAS, GOLD, SILVER, COPPER, ZINC, and ALUMINIUM
- Strict option signal engine:
  - Underlying trend bias from RSI, MACD, EMA, ADX, Stochastic, and Bollinger Bands
  - Recent support/resistance and pivot barrier checks
  - Option price movement confirmation
  - Mandatory option-volume and open-interest checks for BUY alerts
  - Delta, theta, gamma, vega, and IV checks; Greeks are read from Angel One when available or estimated from IV/price, spot, strike, and expiry
  - Bid-ask spread filter when available
  - Near-ATM strike preference
  - Confidence score
  - Entry, stop-loss, target 1, and target 2 plan
- Demo Scanner mode for checking the interface without credentials
- Optional Telegram alerts for confirmed BUY option setups
- Paper-signal workflow only; no automatic order placement

## Files

```text
index.html
css/style.css
js/config.js
js/technical-indicators.js
js/angel-one-api.js
js/signal-generator.js
js/option-signal-engine.js
js/telegram-notifier.js
js/main.js
```

## How To Use

For real mode, run the local server first:

```powershell
npm start
```

If `npm` is not recognized on Windows, use:

```powershell
.\start-app.bat
```

or:

```powershell
node server.js
```

Then open:

```text
http://localhost:8787
```

## Run On Mobile

Keep the server running on your laptop/PC, then open the LAN URL printed by the server on your phone. It will look like:

```text
http://192.168.1.10:8787
```

Your phone and laptop must be on the same Wi-Fi network. Do not open `localhost` on the phone because phone `localhost` means the phone itself, not your laptop.

If the mobile browser cannot open the LAN URL:

- Allow Node.js through Windows Firewall for Private networks.
- Make sure both devices are on the same Wi-Fi, not mobile data.
- Keep the `start-app.bat` server window open.
- If your Wi-Fi blocks local devices, use the Cloudflare Tunnel or ngrok option below and open the HTTPS URL on mobile.

Do not use `file:///.../index.html` for real mode. File mode is fine for demo, but live Angel One calls need the local proxy server.

1. Open `http://localhost:8787` in a browser.
2. Enter Angel One API key, Angel One login password, client ID, and current TOTP if required.
   The `Primary Static IP` field should match the IP added in the SmartAPI app.
3. Click `Connect`.
4. Select index, stock, or commodity options.
5. Select expiry and candle timeframe.
6. Check the best setup panel and option-chain rows.

You can click `Demo Scanner` to preview the scanner with sample data.

## If Angel One Does Not Allow Localhost

Some Angel One app settings may reject `localhost` as a Redirect URL or Postback URL. In that case, keep the app running locally and expose it through a temporary HTTPS tunnel.

Cloudflare Tunnel option:

```powershell
cd C:\Users\hp\Downloads\stock-market-software\stock-market-software
npm start
cloudflared tunnel --url http://localhost:8787
```

Cloudflare will show a public URL like:

```text
https://your-random-name.trycloudflare.com
```

Use that HTTPS URL in Angel One app settings, then open the same URL in your browser.

ngrok option:

```powershell
cd C:\Users\hp\Downloads\stock-market-software\stock-market-software
npm start
ngrok http 8787
```

Use the HTTPS forwarding URL from ngrok in Angel One app settings.

## Real Data Notes

- The local server proxies Angel One SmartAPI login, quote, historical candles, and option-token lookup.
- Option strikes are built from Angel One's public instrument master, then live LTP/OI/volume is fetched through the Market Data quote API.
- Commodity options use MCX option instruments and the nearest MCX futures token for spot and candle indicators.
- Angel One quote API has rate limits, so the app refreshes gently instead of sending many requests per second.

## Telegram Alerts

The screenshot credentials are Telegram app `api_id` / `api_hash`. Those are not stored in this browser app because frontend JavaScript is visible to anyone using the page.

For alerts, use:

- A Telegram bot token from BotFather
- Your numeric Telegram chat ID, not your mobile number

The app is prefilled with `@stockoptionniftycalls` as the alert destination. Make the bot an admin/member of that channel or replace it with your own chat ID.

Enter the bot token in the `Telegram Alerts` section and click `Send Test`. Alerts are sent only for confirmed `BUY CALL` / `BUY PUT` setups above the configured minimum score.

The bot sends each symbol + expiry + strike + CALL/PUT alert only once. Use `Reset Sent` if you intentionally want the same call to alert again.

## Signal Meaning

- `BUY CALL` / `BUY PUT`: Stronger setup, but still needs manual broker/order confirmation.
- `WATCH CALL` / `WATCH PUT`: Setup is forming but not strong enough for blind action.
- `NO TRADE`: Filters did not confirm trend, option strength, liquidity, or spread.

## Important Risk Note

No stock-market or options software can guarantee zero loss. This app is a decision-support tool. Use small position sizing, stop-loss, and your own confirmation before live trading.

## Stock Options

For stock-option scanning, enter:

- Stock symbol, for example `RELIANCE`, or leave it blank and use Auto Market Scanner -> `All Stock Options`
- Angel One token from the instrument master, if auto-resolve does not find it
- Expiry date

The scanner will use the stock token for live data and apply the same option signal engine.

If stock option calls are not appearing, check the Signal Log. Telegram sends only confirmed `BUY` / `BTST` alerts; `WATCH` setups are shown in the app only.

For fully automatic stock calls, leave the stock symbol blank and choose `All Stock Options` in Auto Market Scanner. Bullish stock setups show as `BUY CALL`; bearish stock setups show as `BUY PUT`.

## Configuration

Edit `js/config.js` to tune:

- Indicator periods
- Minimum confidence
- Maximum option risk percentage
- Target risk-reward levels
- Maximum bid-ask spread
- Near-ATM strike width
- Auto-refresh seconds
