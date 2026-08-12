require('dotenv').config();

const mode = (process.env.DEPLOYMENT_MODE || 'edge').toLowerCase();

if (!['cloud', 'edge'].includes(mode)) {
  throw new Error(`Invalid DEPLOYMENT_MODE "${mode}" — must be "cloud" or "edge"`);
}

module.exports = {
  mode,
  isCloud: mode === 'cloud',
  isEdge: mode === 'edge',

  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',

  // Supabase JS client (preferred DB adapter — no direct PostgreSQL needed)
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },

  databaseUrl: process.env.DATABASE_URL,

  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8001',

  cameraDiscoveryMode: process.env.CAMERA_DISCOVERY_MODE || 'manual',

  alerts: {
    emailTo: process.env.ALERT_EMAIL_TO || '',
    smsTo: process.env.ALERT_SMS_TO || '',
    cooldownSeconds: parseInt(process.env.ALERT_COOLDOWN_SECONDS || '120', 10),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'alerts@agrieyes.local',
    enabled: !!process.env.SMTP_HOST,
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    enabled: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  },

  sprinkler: {
    deviceUrl: process.env.SPRINKLER_DEVICE_URL || '',
    enabled: !!process.env.SPRINKLER_DEVICE_URL,
    cooldownSeconds: parseInt(process.env.SPRINKLER_COOLDOWN_SECONDS || '300', 10),
  },

  irrigationDevice: {
    url: process.env.IRRIGATION_DEVICE_URL || '',
    enabled: !!process.env.IRRIGATION_DEVICE_URL,
  },

  // Phase 2: Crop Growth AI + Plant Disease AI don't need per-frame analysis
  // like fire/smoke does — plants don't change second to second — so these
  // run on a schedule against each camera's latest frame instead.
  cropGrowth: {
    intervalMinutes: parseInt(process.env.CROP_GROWTH_INTERVAL_MINUTES || '360', 10), // default: 4x/day
    cropType: process.env.CROP_TYPE || 'tomato',
  },
  diseaseCheck: {
    intervalMinutes: parseInt(process.env.DISEASE_CHECK_INTERVAL_MINUTES || '120', 10), // default: every 2h
    cropType: process.env.CROP_TYPE || 'tomato',
    alertConfidenceThreshold: parseFloat(process.env.DISEASE_ALERT_CONFIDENCE || '0.6'),
  },

  // Phase 3: Farm Security AI
  security: {
    alertCooldownSeconds: parseInt(process.env.SECURITY_ALERT_COOLDOWN_SECONDS || '120', 10),
  },

  // Phase 3: Irrigation
  irrigation: {
    checkIntervalMinutes: parseInt(process.env.IRRIGATION_CHECK_INTERVAL_MINUTES || '30', 10),
  },

  // Edge nodes can optionally sync events up to a cloud instance
  // when connectivity is available. Ignored in cloud mode.
  cloudSync: {
    url: process.env.CLOUD_SYNC_URL || '',
    apiKey: process.env.CLOUD_SYNC_API_KEY || '',
    enabled: mode === 'edge' && !!process.env.CLOUD_SYNC_URL,
  },
};
