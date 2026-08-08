/*
  FireEyes AI — ESP32 Irrigation Pump Relay (Phase 3)

  Same pattern as esp32-sprinkler-relay, but a distinct device: this drives
  the irrigation pump/solenoid for a crop zone, triggered by low soil
  moisture rather than fire detection. Runs for a duration set by the
  backend request (backend/src/services/irrigationClient.js) instead of a
  fixed RUN_SECONDS, since watering time varies by zone/crop.

  Board: any ESP32 dev board (not -CAM)
*/

#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const int RELAY_PIN = 27;
const int DEFAULT_RUN_SECONDS = 120;
const bool RELAY_ACTIVE_HIGH = true; // flip to false if your relay module is active-low

WebServer server(80);
unsigned long relayOffAt = 0;
bool relayOn = false;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, on == RELAY_ACTIVE_HIGH ? HIGH : LOW);
  relayOn = on;
  Serial.println(on ? "Relay ON (irrigation pump running)" : "Relay OFF");
}

// Very small hand-rolled JSON field grab — good enough for the flat,
// known-shape body irrigationClient.js sends, without pulling in a JSON lib.
long extractDurationSeconds(const String& body, long fallback) {
  int idx = body.indexOf("\"durationSeconds\"");
  if (idx == -1) return fallback;
  int colon = body.indexOf(':', idx);
  if (colon == -1) return fallback;
  return body.substring(colon + 1).toInt() > 0 ? body.substring(colon + 1).toInt() : fallback;
}

// POST /activate  { zone, reason, durationSeconds }  <- irrigationClient.js
void handleActivate() {
  String body = server.arg("plain");
  Serial.println("Activation request received: " + body);

  long durationSeconds = extractDurationSeconds(body, DEFAULT_RUN_SECONDS);
  setRelay(true);
  relayOffAt = millis() + (unsigned long)durationSeconds * 1000;

  server.send(200, "application/json", "{\"ok\":true,\"runSeconds\":" + String(durationSeconds) + "}");
}

void handleStatus() {
  String json = "{\"relayOn\":" + String(relayOn ? "true" : "false") + "}";
  server.send(200, "application/json", json);
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected: " + WiFi.localIP().toString());
  Serial.println("Set IRRIGATION_DEVICE_URL=http://" + WiFi.localIP().toString() + " in backend/.env");

  server.on("/activate", HTTP_POST, handleActivate);
  server.on("/status", HTTP_GET, handleStatus);
  server.begin();
}

void loop() {
  server.handleClient();

  if (relayOn && millis() >= relayOffAt) {
    setRelay(false);
  }

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
  }
}
