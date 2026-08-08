# FireEyes AI — Phase 1 Scaffold

Intelligent smart agriculture & farm security platform. This is the Phase 1
foundation: backend + ESP32-CAM streaming + fire/smoke detection pipeline +
dashboard, built so it runs in **Cloud mode** or **Edge mode** off the same
codebase.

## Project layout

```
fireeyes-ai/
├── backend/          Node.js/Express API + WebSocket hub
├── ai-service/        Python FastAPI inference microservice (Model A: fire/smoke)
├── dashboard/          Static HTML/CSS/JS dashboard
└── firmware/           ESP32-CAM Arduino sketch
```

## How data flows (Phase 1)

```
ESP32-CAM  --POST JPEG-->  backend /api/stream/ingest
                               │
                               ├──> WebSocket broadcast --> dashboard (Live Cameras)
                               │
                               └──> ai-service /infer/fire-smoke
                                        │
                                        ▼
                              detection_events + alerts (Postgres)
                                        │
                                        ▼
                         WebSocket broadcast --> dashboard (Fire Monitoring)
```

## Running it locally (Edge mode)

**1. Database**
```bash
createdb fireeyes_ai
cd backend
cp .env.example .env      # DEPLOYMENT_MODE=edge by default
npm install
npm run migrate           # applies db/schema.sql
```

**2. AI service**
```bash
cd ai-service
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py             # runs on :8001, starts in STUB MODE (no model yet)
```

**3. Backend**
```bash
cd backend
npm run dev                 # runs on :4000, serves the dashboard too
```

**4. Register a camera**
```bash
curl -X POST http://localhost:4000/api/cameras \
  -H "Content-Type: application/json" \
  -d '{"id":"cam-north-field-01","farmId":"default","name":"North Field Cam","streamUrl":"n/a — push mode","zone":"North field"}'
```
The `id` here must match `CAMERA_ID` in the ESP32 firmware sketch — that's
how the backend knows which registered camera an incoming frame belongs to.

**5. Flash the ESP32-CAM**
Open `firmware/esp32-cam-streamer/esp32-cam-streamer.ino`, set your Wi-Fi
credentials and `BACKEND_URL` (your machine's LAN IP), and flash it. Frames
will start appearing in the dashboard at `http://localhost:4000`.

No camera yet? You can simulate one:
```bash
curl -X POST http://localhost:4000/api/stream/ingest \
  -H "x-camera-id: cam-north-field-01" -H "x-farm-id: default" \
  -H "Content-Type: image/jpeg" --data-binary @test-frame.jpg
```

## Running it with Docker Compose (easiest)

```bash
docker compose up --build
docker compose exec backend npm run migrate   # first time only
```

Dashboard: http://localhost:4000 · AI service: http://localhost:8001/health

## Training the fire/smoke model (Model A)

See `ai-service/training/DATASET.md` for where to get a dataset (you're
starting from zero, so it points you at public datasets like D-Fire to get
a usable v1 fast). Once the dataset is in place:

```bash
cd ai-service/training
pip install ultralytics
python train.py --deploy      # fine-tunes YOLOv11, deploys best.pt automatically
```

Restart `ai-service` afterward and it picks up the trained model — no other
code changes needed, it's the same stub-mode class that just stops being a
stub.

## Switching to Cloud mode

Set `DEPLOYMENT_MODE=cloud` in `backend/.env` and point `DATABASE_URL` at a
hosted Postgres/Supabase instance. Everything else — routes, WebSocket hub,
dashboard — is identical; only the config module cares about the mode.

## Where the fire/smoke model stands

No dataset or trained model yet — `ai-service` runs in **stub mode**
(`FireSmokeDetector` returns zero detections so the rest of the pipeline is
fully testable end-to-end without a model). Drop trained YOLOv11 weights at
`ai-service/models/fire_smoke.pt` to activate real detection — no other code
changes needed. See the docstring in `ai-service/src/inference/fire_smoke.py`
for recommended public datasets to start from.

## Next steps

- [ ] Source a fire/smoke dataset (D-Fire, FASDD, or Roboflow Universe) and
      fine-tune YOLOv11 → drop weights into `ai-service/models/fire_smoke.pt`
- [x] Wire sprinkler auto-activation (relay control) off the `alert` event
- [x] Add email/SMS dispatch for critical alerts (`config.alerts`)
- [ ] Live event recording (save short clips around detection events)
- [ ] Phase 2: Crop Growth AI + Plant Disease AI modules

## Sprinkler + notifications (just added)

- `backend/src/services/sprinklerClient.js` — POSTs to an ESP32 relay
  controller's `/activate` endpoint when a `fire` detection crosses the
  confidence threshold. Rate-limited by `SPRINKLER_COOLDOWN_SECONDS` (default
  5 min) so one ongoing fire doesn't re-trigger it every second. Logs to
  `sprinkler_events` for audit. Firmware: `firmware/esp32-sprinkler-relay/`.
- `backend/src/services/notifier.js` — sends email (SMTP via nodemailer) and
  SMS (Twilio-compatible REST API) on any critical alert, rate-limited by
  `ALERT_COOLDOWN_SECONDS` (default 2 min). Both channels no-op with a log
  line if left unconfigured — nothing breaks with zero credentials set.
- Fill in `SMTP_*`, `TWILIO_*`, and `SPRINKLER_DEVICE_URL` in `backend/.env`
  to activate. All confirmed working in unconfigured (safe/log-only) mode.
