/*
  FireEyes AI — ESP32 Sensor Node (Phase 3: Farm Intelligence)

  Reads a capacitive soil moisture sensor, a DHT22 (temp + humidity), and an
  analog water level sensor, then POSTs each reading to the backend's
  sensor ingestion endpoint on a timer. One node = one zone; deploy several
  with different SENSOR_ID/ZONE for multiple zones.

  Board: any ESP32 dev board (not -CAM)
  Required library: "DHT sensor library" by Adafruit (+ "Adafruit Unified Sensor")
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

// ── Config ─────────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* BACKEND_URL = "http://192.168.1.50:4000/api/sensors/ingest";
const char* SENSOR_ID = "sensor-north-01"; // unique per node
const char* ZONE = "north";
const char* FARM_ID = "default";

const int READ_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes — soil/weather don't change fast

// ── Pins ───────────────────────────────────────────────────────
const int SOIL_MOISTURE_PIN = 34;   // analog
const int WATER_LEVEL_PIN = 35;     // analog
const int DHT_PIN = 4;              // digital
#define DHT_TYPE DHT22

DHT dht(DHT_PIN, DHT_TYPE);

// Calibrate these against your actual sensor in open air (dry) vs a cup of
// water (wet) — capacitive soil sensors vary a fair bit between units.
const int SOIL_DRY_RAW = 3000;   // raw ADC reading in dry air
const int SOIL_WET_RAW = 1200;   // raw ADC reading fully submerged

float soilRawToPercent(int raw) {
  float pct = (float)(SOIL_DRY_RAW - raw) / (SOIL_DRY_RAW - SOIL_WET_RAW) * 100.0;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected: " + WiFi.localIP().toString());
}

void pushReading(const char* sensorType, float value, const char* unit) {
  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"sensorId\":\"") + SENSOR_ID +
                    "\",\"sensorType\":\"" + sensorType +
                    "\",\"value\":" + String(value, 2) +
                    "\",\"unit\":\"" + unit +
                    "\",\"zone\":\"" + ZONE +
                    "\",\"farmId\":\"" + FARM_ID + "\"}";

  int httpCode = http.POST(payload);
  if (httpCode != 202) {
    Serial.printf("Push failed for %s, code=%d\n", sensorType, httpCode);
  } else {
    Serial.printf("Pushed %s = %.2f%s\n", sensorType, value, unit);
  }
  http.end();
}

void readAndPushAll() {
  int soilRaw = analogRead(SOIL_MOISTURE_PIN);
  float soilPct = soilRawToPercent(soilRaw);
  pushReading("soil_moisture", soilPct, "%");

  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();
  if (!isnan(temp)) pushReading("temperature", temp, "C");
  if (!isnan(humidity)) pushReading("humidity", humidity, "%");

  // Water level: calibrate WATER_LEVEL_PIN raw range against your tank/
  // reservoir sensor the same way as soil moisture above.
  int waterRaw = analogRead(WATER_LEVEL_PIN);
  float waterPct = map(waterRaw, 0, 4095, 0, 100);
  pushReading("water_level", waterPct, "%");
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  readAndPushAll();
  delay(READ_INTERVAL_MS);
}
