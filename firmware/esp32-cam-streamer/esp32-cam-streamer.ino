/*
  FireEyes AI — ESP32-CAM frame pusher (Phase 1)

  Instead of the dashboard pulling an MJPEG stream directly from the camera
  (which breaks on flaky farm Wi-Fi and doesn't play well with Cloud mode),
  the camera actively POSTs JPEG frames to the backend's ingest endpoint.
  The backend then fans each frame out over WebSocket to dashboards AND
  forwards it to the AI inference service.

  Board: AI-Thinker ESP32-CAM
  Required library: "esp32" board package (camera driver is built in)
*/

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ── Config ─────────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Point this at your backend. In Edge mode this is the local server's LAN IP.
// In Cloud mode this is your hosted backend's public URL.
const char* BACKEND_URL = "http://192.168.1.50:4000/api/stream/ingest";

const char* CAMERA_ID = "cam-north-field-01"; // must match a camera registered via /api/cameras
const char* FARM_ID = "default";

const int FRAME_INTERVAL_MS = 500; // ~2 fps; fire/smoke detection doesn't need more

// ── AI-Thinker ESP32-CAM pin map ─────────────────────────────
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

void setupCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA;   // 640x480 — good balance for detection + bandwidth
  config.jpeg_quality = 12;            // lower = better quality, larger file
  config.fb_count = 1;

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("Camera init failed");
  }
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

void pushFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Frame capture failed");
    return;
  }

  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-camera-id", CAMERA_ID);
  http.addHeader("x-farm-id", FARM_ID);

  int httpCode = http.POST(fb->buf, fb->len);
  if (httpCode != 202) {
    Serial.printf("Push failed, code=%d\n", httpCode);
  }

  http.end();
  esp_camera_fb_return(fb);
}

void setup() {
  Serial.begin(115200);
  setupCamera();
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  pushFrame();
  delay(FRAME_INTERVAL_MS);
}
