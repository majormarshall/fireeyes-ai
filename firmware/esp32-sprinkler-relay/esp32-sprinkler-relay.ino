/*
  FireEyes AI — ESP32 Sprinkler Relay Controller (Phase 1)

  Runs a tiny HTTP server on the ESP32 that switches a relay (driving the
  water pump / sprinkler valve) on when the backend calls POST /activate,
  and back off automatically after RUN_SECONDS. This board is separate from
  the ESP32-CAM units — a plain ESP32 (not -CAM) wired to a relay module.

  Wiring: relay module IN pin -> RELAY_PIN, relay VCC/GND -> 5V/GND,
  relay controls the pump/solenoid valve on its switched side.

  Board: any ESP32 dev board
*/

#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const int RELAY_PIN = 26;
const int RUN_SECONDS = 60;      // how long the sprinkler stays on per activation
const bool RELAY_ACTIVE_HIGH = true; // flip to false if your relay module is active-low

WebServer server(80);
unsigned long relayOffAt = 0;
bool relayOn = false;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, on == RELAY_ACTIVE_HIGH ? HIGH : LOW);
  relayOn = on;
  Serial.println(on ? "Relay ON (sprinkler activated)" : "Relay OFF");
}

// POST /activate  { reason, cameraId }  <- called by backend/src/services/sprinklerClient.js
void handleActivate() {
  Serial.println("Activation request received: " + server.arg("plain"));
  setRelay(true);
  relayOffAt = millis() + (unsigned long)RUN_SECONDS * 1000;
  server.send(200, "application/json", "{\"ok\":true,\"runSeconds\":" + String(RUN_SECONDS) + "}");
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
  Serial.println("Set SPRINKLER_DEVICE_URL=http://" + WiFi.localIP().toString() + " in backend/.env");

  server.on("/activate", HTTP_POST, handleActivate);
  server.on("/status", HTTP_GET, handleStatus);
  server.begin();
}

void loop() {
  server.handleClient();

  // Auto shut-off after RUN_SECONDS, independent of the backend —
  // the field keeps working even if the backend is unreachable afterward.
  if (relayOn && millis() >= relayOffAt) {
    setRelay(false);
  }

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
  }
}
