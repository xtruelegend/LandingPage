import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { createClient } from "redis";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Redis/KV Store connection
const KV_REST_API_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const REDIS_URL = process.env.REDIS_URL || "";
const HAS_REST = Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
const HAS_REDIS = Boolean(REDIS_URL);

let redisClient = null;
let redisConnecting = null;

async function getRedisClient() {
  if (!HAS_REDIS) return null;
  if (redisClient && redisClient.isOpen) return redisClient;
  if (redisConnecting) return redisConnecting;

  redisClient = createClient({ url: REDIS_URL });
  redisClient.on("error", (err) => {
    console.error("Redis client error:", err.message);
  });

  redisConnecting = redisClient.connect()
    .then(() => {
      redisConnecting = null;
      return redisClient;
    })
    .catch((err) => {
      console.error("Redis connect error:", err.message);
      redisConnecting = null;
      return null;
    });

  return redisConnecting;
}

const kvStore = {
  async set(key, value) {
    if (HAS_REST) {
      try {
        const response = await fetch(`${KV_REST_API_URL}/set/${key}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${KV_REST_API_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ value })
        });
        return response.ok;
      } catch (err) {
        console.error("KV set error:", err.message);
        return false;
      }
    }

    if (HAS_REDIS) {
      try {
        const client = await getRedisClient();
        if (!client) return false;
        await client.set(key, value);
        return true;
      } catch (err) {
        console.error("Redis set error:", err.message);
        return false;
      }
    }

    return false;
  },
  async get(key) {
    if (HAS_REST) {
      try {
        const response = await fetch(`${KV_REST_API_URL}/get/${key}`, {
          headers: {
            Authorization: `Bearer ${KV_REST_API_TOKEN}`
          }
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.result;
      } catch (err) {
        console.error("KV get error:", err.message);
        return null;
      }
    }

    if (HAS_REDIS) {
      try {
        const client = await getRedisClient();
        if (!client) return null;
        return await client.get(key);
      } catch (err) {
        console.error("Redis get error:", err.message);
        return null;
      }
    }

    return null;
  }
};

const DATA_DIR = path.join(__dirname, "data");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";
const PRODUCT_PRICE = process.env.PRODUCT_PRICE || "9.99";
const CURRENCY = process.env.CURRENCY || "USD";
const KEYS_REMOTE_URL = process.env.KEYS_REMOTE_URL || "";
const DEFAULT_KEYS_VALIDATE_URL = "https://budget-xt.vercel.app/api/validate-key";
const KEYS_VALIDATE_URL = process.env.KEYS_VALIDATE_URL || DEFAULT_KEYS_VALIDATE_URL;
const DEFAULT_KEYS_PATH = path.join(DATA_DIR, "allowed-keys.json");
const KEYS_LOCAL_PATH = process.env.KEYS_LOCAL_PATH || DEFAULT_KEYS_PATH;

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function getPayPalBaseUrl() {
  return PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PayPal credentials");
  }

  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal auth failed: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify([], null, 2));
  }
}
function getCurrentTierPrice() {
  try {
    const couponsPath = path.join(__dirname, "coupons.json");
    if (!fs.existsSync(couponsPath)) {
      return PRODUCT_PRICE;
    }
    const couponsData = JSON.parse(fs.readFileSync(couponsPath, "utf8"));
    const salesCount = couponsData.salesCount || 0;
    const tiers = couponsData.pricingTiers || [];
    
    let copiesSoFar = 0;
    for (const tier of tiers) {
      if (salesCount < copiesSoFar + tier.maxCopies) {
        return tier.price.toFixed(2);
      }
      copiesSoFar += tier.maxCopies;
    }
    return tiers[tiers.length - 1]?.price?.toFixed(2) || PRODUCT_PRICE;
  } catch (err) {
    console.error("Error getting tier price:", err);
    return PRODUCT_PRICE;
  }
}

function incrementSalesCount() {
  try {
    const couponsPath = path.join(__dirname, "coupons.json");
    if (fs.existsSync(couponsPath)) {
      const couponsData = JSON.parse(fs.readFileSync(couponsPath, "utf8"));
      couponsData.salesCount = (couponsData.salesCount || 0) + 1;
      fs.writeFileSync(couponsPath, JSON.stringify(couponsData, null, 2));
    }
  } catch (err) {
    console.error("Error incrementing sales count:", err);
  }
}
function createLicenseKey() {
  const raw = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

async function getPooledLicenseKey() {
  const loadKeysPayload = async () => {
    if (KEYS_LOCAL_PATH && fs.existsSync(KEYS_LOCAL_PATH)) {
      try {
        const raw = await fs.promises.readFile(KEYS_LOCAL_PATH, "utf8");
        return JSON.parse(raw);
      } catch (e) {
        console.error("Error reading KEYS_LOCAL_PATH:", e.message);
      }
    }

    if (KEYS_REMOTE_URL) {
      try {
        const response = await fetch(KEYS_REMOTE_URL);
        if (!response.ok) return null;
        return response.json();
      } catch (e) {
        console.error("Error fetching KEYS_REMOTE_URL:", e.message);
      }
    }

    return null;
  };

  const payload = await loadKeysPayload();
  if (!payload) return null;

  let keysList = [];
  if (Array.isArray(payload)) {
    keysList = payload;
  } else if (Array.isArray(payload.keys)) {
    keysList = payload.keys;
  }

  if (!keysList.length) return null;

  // Get all issued keys from Redis (production) and local file (development)
  const issued = new Set();
  
  // Check Redis for issued keys
  try {
    const redisIssuedKeys = await kvStore.get("issued_keys");
    if (redisIssuedKeys) {
      const parsedKeys = typeof redisIssuedKeys === "string" ? JSON.parse(redisIssuedKeys) : redisIssuedKeys;
      if (Array.isArray(parsedKeys)) {
        parsedKeys.forEach(key => issued.add(String(key).toUpperCase()));
      }
    }
  } catch (e) {
    console.error("Error reading issued keys from Redis:", e.message);
  }
  
  // Also check local file (development fallback)
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      const records = Array.isArray(raw) ? raw : [];
      records.forEach(record => issued.add(String(record.licenseKey || "").toUpperCase()));
    }
  } catch (e) {
    console.error("Error reading issued keys from file:", e.message);
  }

  const nextKey = keysList
    .map((key) => String(key).toUpperCase())
    .find((key) => key && !issued.has(key));

  if (!nextKey) return null;

  // Immediately mark key as issued to avoid duplicates
  try {
    if (KV_REST_API_URL && KV_REST_API_TOKEN) {
      issued.add(nextKey);
      await kvStore.set("issued_keys", JSON.stringify(Array.from(issued)));
    }
  } catch (e) {
    console.error("Error marking key as issued:", e.message);
  }

  return nextKey;
}

async function saveLicenseKey(record) {
  // Store purchase in Redis for customer lookup
  if (!record.email) {
    console.warn("No email in record, skipping Redis storage");
    return;
  }

  console.log(`[saveLicenseKey] Saving purchase for ${record.email}:`, {
    licenseKey: record.licenseKey,
    product: record.product,
    orderId: record.orderId
  });

  try {
    const normalizedEmail = record.email.toLowerCase().trim();
    console.log(`[saveLicenseKey] Normalized email: ${normalizedEmail}`);
    
    const purchases = await kvStore.get(`purchases:${normalizedEmail}`);
    console.log(`[saveLicenseKey] Existing purchases from Redis:`, purchases);
    
    let purchasesList = [];

    if (purchases) {
      try {
        purchasesList = typeof purchases === "string" ? JSON.parse(purchases) : Array.isArray(purchases) ? purchases : [];
        console.log(`[saveLicenseKey] Parsed existing purchases, count: ${purchasesList.length}`);
      } catch (e) {
        console.error("Error parsing existing purchases:", e.message);
        purchasesList = [];
      }
    }

    const newPurchase = {
      email: record.email,
      licenseKey: record.licenseKey,
      product: record.product || "Unknown",
      orderId: record.orderId,
      date: record.createdAt || new Date().toISOString()
    };

    purchasesList.push(newPurchase);
    await kvStore.set(`purchases:${normalizedEmail}`, JSON.stringify(purchasesList));
    console.log(`Purchase saved for ${normalizedEmail} in Redis`);
    
    // Track this key as issued globally to prevent duplicates
    try {
      const issuedKeys = await kvStore.get("issued_keys");
      let keysList = [];
      if (issuedKeys) {
        keysList = typeof issuedKeys === "string" ? JSON.parse(issuedKeys) : Array.isArray(issuedKeys) ? issuedKeys : [];
      }
      if (!keysList.includes(record.licenseKey.toUpperCase())) {
        keysList.push(record.licenseKey.toUpperCase());
        await kvStore.set("issued_keys", JSON.stringify(keysList));
        console.log(`License key ${record.licenseKey} marked as issued in Redis`);
      }
    } catch (err) {
      console.error("Error tracking issued key in Redis:", err.message);
    }
  } catch (err) {
    console.error("Error saving to Redis:", err.message);
  }

  // Also save locally for development (if not on Vercel)
  if (!process.env.VERCEL) {
    try {
      ensureDataFile();
      const existing = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      existing.push(record);
      fs.writeFileSync(KEYS_FILE, JSON.stringify(existing, null, 2));
    } catch (err) {
      console.error("Warning: Could not save license key record:", err.message);
    }
  }
}

// Map app names to their download files
const APP_DOWNLOADS = {
  "BudgetXT": "BudgetXT-Setup-1.5.3.exe",
  "budgetxt": "BudgetXT-Setup-1.5.3.exe"
  // Add more apps here as you build them
  // "AppName": "AppName-Setup-1.0.0.exe"
};

async function sendKeyEmail(to, licenseKey, appName, orderDetails = {}) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !to) {
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  // Get the download file for this app
  const downloadFile = APP_DOWNLOADS[appName] || "BudgetXT-Setup-1.5.3.exe";
  const downloadUrl = `https://techapps.vercel.app/downloads/${downloadFile}`;
  const purchaseDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `Your ${appName} License Key & Receipt`,
    text: `Thanks for your purchase!\n\nOrder Confirmation\n=================\nApp: ${appName}\nLicense Key: ${licenseKey}\nDate: ${purchaseDate}\n\nDownload: ${downloadUrl}\n\nQuick Install Steps:\n1) Download the installer\n2) Open it to start setup\n3) If Windows warns you, click "More info" then "Run anyway"\n4) Enter your license key when the app opens\n\nQuestions? Reply to this email.`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #00d1ff 0%, #0099cc 100%); color: white; padding: 32px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 28px;">✓ Purchase Confirmed</h1>
          <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Thank you for your purchase!</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 32px; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333; margin-top: 0;">Order Details</h2>
          
          <div style="background: white; padding: 20px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #00d1ff;">
            <p style="margin: 8px 0;"><strong>Product:</strong> ${appName}</p>
            <p style="margin: 8px 0;"><strong>Purchase Date:</strong> ${purchaseDate}</p>
            <p style="margin: 8px 0;"><strong>Email:</strong> ${to}</p>
          </div>

          <h2 style="color: #333; margin-top: 24px;">Your License Key</h2>
          <p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">Keep this safe for future reference:</p>
          <p style="font-size: 20px; font-weight: bold; padding: 16px; background: #f0f0f0; border-radius: 6px; margin: 12px 0; word-break: break-all; text-align: center; font-family: 'Courier New', monospace;">${licenseKey}</p>

          <h2 style="color: #333; margin-top: 24px;">Get Started</h2>
          <p style="color: #666; margin: 8px 0;">Download and install your app using the button below:</p>
          <p style="margin: 16px 0; text-align: center;">
            <a href="${downloadUrl}" style="background: #00d1ff; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">Download ${appName}</a>
          </p>

          <div style="background: #fff9e6; padding: 16px; border-radius: 6px; margin-top: 16px; border-left: 4px solid #ffc107;">
            <p style="margin: 0; color: #856404; font-size: 14px;"><strong>Quick Install Tips</strong></p>
            <ol style="margin: 8px 0 0 18px; color: #856404; font-size: 14px;">
              <li>Run the installer after download</li>
              <li>If Windows shows a warning, click <strong>More info</strong> → <strong>Run anyway</strong></li>
              <li>Enter your license key when the app opens</li>
            </ol>
          </div>

          <div style="background: #f0f8ff; padding: 16px; border-radius: 6px; margin-top: 24px; border-left: 4px solid #00d1ff;">
            <p style="margin: 0; color: #0066cc; font-size: 14px;"><strong>Need Help?</strong></p>
            <p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">If you have any questions or issues, just reply to this email. We're here to help!</p>
          </div>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 32px 0;">
          <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">© 2026 Truelegendcustoms. All rights reserved.</p>
        </div>
      </div>
    `
  });

  return { messageId: info.messageId };
}

app.get("/api/config", (req, res) => {
  res.json({
    clientId: PAYPAL_CLIENT_ID,
    currency: CURRENCY,
    productPrice: PRODUCT_PRICE
  });
});

app.post("/api/lookup-purchases", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    console.log(`[lookup-purchases] Looking up purchases for: ${normalizedEmail}`);

    // First try Redis (production)
    let purchasesData = await kvStore.get(`purchases:${normalizedEmail}`);
    console.log(`[lookup-purchases] Redis data:`, purchasesData);
    let purchases = [];

    if (purchasesData) {
      try {
        const parsed = typeof purchasesData === "string" ? JSON.parse(purchasesData) : purchasesData;
        purchases = Array.isArray(parsed) ? parsed.map((p) => ({
          email: p.email || normalizedEmail,
          product: p.product || "Unknown",
          licenseKey: p.licenseKey,
          createdAt: p.date || p.createdAt,
          orderId: p.orderId
        })) : [];
      } catch (e) {
        console.error("Error parsing Redis purchases:", e.message);
      }
    }

    // Fallback: try local file (development only)
    if (purchases.length === 0 && fs.existsSync(KEYS_FILE)) {
      try {
        const raw = fs.readFileSync(KEYS_FILE, "utf8");
        const records = JSON.parse(raw);
        const matching = Array.isArray(records)
          ? records.filter(r => r.email && String(r.email).toLowerCase().trim() === normalizedEmail)
          : [];

        purchases = matching.map(r => ({
          email: r.email,
          product: r.product || "Unknown",
          licenseKey: r.licenseKey,
          createdAt: r.createdAt || r.timestamp,
          orderId: r.orderId
        }));
      } catch (err) {
        console.error("Error reading local records:", err.message);
      }
    }

    if (purchases.length === 0) {
      return res.status(404).json({
        found: false,
        message: "No purchases found for this email. Please check if you used a different email address or contact support."
      });
    }

    res.json({
      found: true,
      email: normalizedEmail,
      purchases,
      message: `Found ${purchases.length} purchase(s) under this email.`
    });
  } catch (error) {
    console.error("Lookup error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/resend-key", async (req, res) => {
  try {
    const { email, licenseKey, appName } = req.body;

    if (!email || !licenseKey) {
      return res.status(400).json({ error: "Email and license key are required" });
    }

    if (!appName) {
      return res.status(400).json({ error: "App name is required" });
    }

    // Validate the license key exists in pool
    const payload = await (async () => {
      if (KEYS_LOCAL_PATH && fs.existsSync(KEYS_LOCAL_PATH)) {
        try {
          const raw = await fs.promises.readFile(KEYS_LOCAL_PATH, "utf8");
          return JSON.parse(raw);
        } catch (e) {
          console.error("Error reading KEYS_LOCAL_PATH:", e.message);
        }
      }
      if (KEYS_REMOTE_URL) {
        try {
          const response = await fetch(KEYS_REMOTE_URL);
          if (!response.ok) return null;
          return response.json();
        } catch (e) {
          console.error("Error fetching KEYS_REMOTE_URL:", e.message);
        }
      }
      return null;
    })();

    let keysList = [];
    if (Array.isArray(payload)) {
      keysList = payload;
    } else if (Array.isArray(payload?.keys)) {
      keysList = payload.keys;
    }

    const keyExists = keysList.some(
      (key) => String(key).toUpperCase() === String(licenseKey).toUpperCase()
    );

    if (!keyExists) {
      return res.status(400).json({ error: "License key not found in valid keys pool" });
    }

    // Send the email
    const emailResult = await sendKeyEmail(email, licenseKey, appName);

    if (emailResult?.skipped) {
      return res.status(500).json({ 
        error: "Email service not configured. SMTP credentials missing.",
        success: false
      });
    }

    res.json({
      success: true,
      message: "License key email resent successfully",
      email,
      appName,
      messageId: emailResult?.messageId
    });
  } catch (error) {
    console.error("Resend key error:", error);
    res.status(500).json({ 
      error: error.message,
      success: false
    });
  }
});

app.post("/api/verify-key", async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: "Key is required" });
    }

    const normalizedKey = key.toUpperCase();

    try {
      const deactivatedRaw = await kvStore.get("deactivated_keys");
      const deactivated = deactivatedRaw ? JSON.parse(deactivatedRaw) : [];
      if (deactivated.includes(normalizedKey)) {
        return res.status(401).json({ valid: false, error: "License key deactivated" });
      }
    } catch (err) {
      console.error("Deactivated key check error:", err.message);
    }

    const localMatchesKey = () => {
      try {
        if (!fs.existsSync(KEYS_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
        const localRecords = Array.isArray(raw) ? raw : [];
        const found = localRecords.find((record) => record.licenseKey === normalizedKey);
        if (!found) return null;
        return {
          valid: true,
          email: found.email,
          product: found.product,
          timestamp: found.timestamp
        };
      } catch (error) {
        console.error("Local key lookup failed:", error.message);
        return null;
      }
    };

    const remoteMatchesKey = async () => {
      if (KEYS_VALIDATE_URL) {
        try {
          const response = await fetch(KEYS_VALIDATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: normalizedKey })
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.valid) return null;

          return {
            valid: true,
            email: null,
            product: "BudgetXT",
            timestamp: null
          };
        } catch (e) {
          console.error("KEYS_VALIDATE_URL error:", e.message);
        }
      }

      const loadKeysPayload = async () => {
        // Try local file first (development)
        if (KEYS_LOCAL_PATH && fs.existsSync(KEYS_LOCAL_PATH)) {
          try {
            const raw = await fs.promises.readFile(KEYS_LOCAL_PATH, "utf8");
            return JSON.parse(raw);
          } catch (e) {
            console.error("Error reading KEYS_LOCAL_PATH:", e.message);
          }
        }

        // Try remote URL (production)
        if (KEYS_REMOTE_URL) {
          try {
            const response = await fetch(KEYS_REMOTE_URL);
            if (!response.ok) return null;
            return response.json();
          } catch (e) {
            console.error("Error fetching KEYS_REMOTE_URL:", e.message);
          }
        }

        return null;
      };

      const payload = await loadKeysPayload();
      if (!payload) return null;

      let keysList = [];
      if (Array.isArray(payload)) {
        keysList = payload;
      } else if (Array.isArray(payload.keys)) {
        keysList = payload.keys;
      }

      const exists = keysList.some((item) => String(item).toUpperCase() === normalizedKey);
      if (!exists) return null;

      return {
        valid: true,
        email: null,
        product: "BudgetXT",
        timestamp: null
      };
    };

    const localResult = localMatchesKey();
    if (localResult) {
      return res.json(localResult);
    }

    const remoteResult = await remoteMatchesKey();
    if (remoteResult) {
      return res.json(remoteResult);
    }

    return res.status(401).json({
      valid: false,
      error: "License key not found"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const accessToken = await getPayPalAccessToken();
    const { desiredEmail, productName } = req.body || {};
    const protoHeader = req.headers["x-forwarded-proto"];
    const protocol = Array.isArray(protoHeader)
      ? protoHeader[0]
      : String(protoHeader || req.protocol).split(",")[0];
    const baseUrl = `${protocol}://${req.get("host")}`;
    
    // Use tier pricing instead of client-sent price
    const orderPrice = getCurrentTierPrice();

    const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: productName || "App License",
            custom_id: JSON.stringify({ email: desiredEmail, product: productName }),
            amount: {
              currency_code: CURRENCY,
              value: orderPrice
            }
          }
        ],
        application_context: {
          return_url: `${baseUrl}/return`,
          cancel_url: `${baseUrl}/`
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("PayPal API Error:", response.status, errorText);
      return res.status(500).json({ error: errorText });
    }

    const order = await response.json();
    
    // Find the approval link
    const approvalLink = order.links.find(link => link.rel === "approve");
    
    res.json({
      id: order.id,
      approvalUrl: approvalLink?.href || null
    });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
    const { orderID } = req.params;
    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${getPayPalBaseUrl()}/v2/checkout/orders/${orderID}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const captureData = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: captureData });
    }

    const payerEmail = captureData?.payer?.email_address || "";
    const purchaseUnit = captureData?.purchase_units?.[0];
    let customData = {};
    try {
      customData = JSON.parse(purchaseUnit?.custom_id || "{}");
    } catch {}
    
    const desiredEmail = customData.email || payerEmail;
    const productName = customData.product || "App License";

    const licenseKey = await getPooledLicenseKey();
    if (!licenseKey) {
      return res.status(500).json({ error: "No license keys available" });
    }

    await saveLicenseKey({
      orderId: orderID,
      email: desiredEmail,
      licenseKey,
      product: productName,
      createdAt: new Date().toISOString()
    });

    const emailResult = await sendKeyEmail(desiredEmail, licenseKey, productName);
    
    // Increment sales count for tier pricing
    incrementSalesCount();

    res.json({
      capture: captureData,
      licenseKey,
      emailSent: !emailResult?.skipped
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/return", async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.redirect("/");
  }

  try {
    const accessToken = await getPayPalAccessToken();
    
    // Capture the order
    const captureResponse = await fetch(
      `${getPayPalBaseUrl()}/v2/checkout/orders/${token}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const captureData = await captureResponse.json();

    if (!captureResponse.ok) {
      return res.redirect("/?error=payment_failed");
    }

    const payerEmail = captureData?.payer?.email_address || "";
    const purchaseUnit = captureData?.purchase_units?.[0];
    const customId = purchaseUnit?.custom_id
      ? JSON.parse(purchaseUnit.custom_id)
      : {};

    const licenseKey = await getPooledLicenseKey();
    if (!licenseKey) {
      return res.redirect("/?error=no_keys_available");
    }
    await saveLicenseKey({
      timestamp: new Date().toISOString(),
      email: customId.email || payerEmail,
      product: customId.product || "Unknown",
      licenseKey,
      orderId: token
    });

    await sendKeyEmail(
      customId.email || payerEmail,
      licenseKey,
      customId.product || "Unknown"
    );

    // Redirect to success page with key
    res.redirect(`/?success=true&key=${encodeURIComponent(licenseKey)}`);
  } catch (error) {
    console.error("Capture error:", error);
    res.redirect("/?error=capture_failed");
  }
});

app.get("/api/pricing", (req, res) => {
  try {
    const couponsPath = path.join(__dirname, "coupons.json");
    if (!fs.existsSync(couponsPath)) {
      return res.json({
        currentPrice: PRODUCT_PRICE,
        currentTier: "Full Price",
        salesCount: 0,
        tiers: []
      });
    }
    const couponsData = JSON.parse(fs.readFileSync(couponsPath, "utf8"));
    const currentPrice = getCurrentTierPrice();
    const salesCount = couponsData.salesCount || 0;
    let currentTier = "Full Price";
    let copiesSoFar = 0;
    for (const tier of couponsData.pricingTiers || []) {
      if (salesCount < copiesSoFar + tier.maxCopies) {
        currentTier = tier.name;
        break;
      }
      copiesSoFar += tier.maxCopies;
    }
    res.json({
      currentPrice,
      currentTier,
      salesCount,
      tiers: couponsData.pricingTiers || []
    });
  } catch (err) {
    console.error("Error getting pricing:", err);
    res.json({
      currentPrice: PRODUCT_PRICE,
      currentTier: "Full Price",
      salesCount: 0,
      tiers: []
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Simple admin authentication (stateless signed token)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";
const ADMIN_REPORT_EMAIL = process.env.ADMIN_REPORT_EMAIL || "";

function createAdminToken() {
  const payload = `${Date.now()}`;
  const signature = crypto
    .createHmac("sha256", ADMIN_PASSWORD)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64");
}

function verifyAdminToken(token) {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const [payload, signature] = decoded.split(".");
    if (!payload || !signature) return false;
    const expected = crypto
      .createHmac("sha256", ADMIN_PASSWORD)
      .update(payload)
      .digest("hex");
    return signature === expected;
  } catch {
    return false;
  }
}

async function requireAdmin(req, res) {
  const token = req.headers["x-admin-token"] || "";
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

app.post("/api/admin/login", (req, res) => {
  try {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
      const token = createAdminToken();
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: "Invalid password" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/verify-token", (req, res) => {
  try {
    const { token } = req.body;
    if (token && verifyAdminToken(token)) {
      res.json({ valid: true });
    } else {
      res.status(401).json({ valid: false });
    }
  } catch (error) {
    res.status(401).json({ valid: false });
  }
});

app.post("/api/admin/send-key", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    const { email, appName } = req.body;
    
    if (!email || !appName) {
      return res.status(400).json({ error: "Email and app name are required" });
    }

    const licenseKey = await getPooledLicenseKey();
    if (!licenseKey) {
      return res.status(500).json({ error: "No license keys available in pool" });
    }

    await saveLicenseKey({
      orderId: `MANUAL-${Date.now()}`,
      email: email.trim(),
      licenseKey,
      product: appName,
      createdAt: new Date().toISOString()
    });

    const emailResult = await sendKeyEmail(email.trim(), licenseKey, appName);
    
    if (emailResult?.skipped) {
      return res.json({ 
        success: true, 
        key: licenseKey,
        warning: "Email sending is not configured. Key generated but not sent." 
      });
    }

    res.json({ 
      success: true, 
      key: licenseKey,
      message: `License key sent to ${email}` 
    });
  } catch (error) {
    console.error("Manual send key error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Submit review endpoint
app.post("/api/submit-review", async (req, res) => {
  try {
    const { name, email, rating, text } = req.body;

    if (!name || !email || !rating || !text) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!HAS_REST && !HAS_REDIS) {
      return res.status(500).json({ error: "Review storage not configured" });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const review = {
      id: Date.now().toString(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      rating: parseInt(rating),
      text: text.trim(),
      date: new Date().toISOString(),
      approved: false
    };

    // Get existing pending reviews
    let pendingReviews = [];
    try {
      const reviews = await kvStore.get("pending_reviews");
      if (reviews) {
        pendingReviews = typeof reviews === "string" ? JSON.parse(reviews) : Array.isArray(reviews) ? reviews : [];
      }
    } catch (e) {
      console.error("Error loading pending reviews:", e.message);
    }

    pendingReviews.push(review);
    const saved = await kvStore.set("pending_reviews", JSON.stringify(pendingReviews));
    if (!saved) {
      return res.status(500).json({ error: "Failed to save review" });
    }
    console.log(`New review submitted by ${name}`);

    res.json({ success: true, message: "Review submitted successfully" });
  } catch (error) {
    console.error("Submit review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Report issue endpoint
app.post("/api/report-issue", async (req, res) => {
  try {
    const { name, email, issue } = req.body;

    if (!name || !email || !issue) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!HAS_REST && !HAS_REDIS) {
      return res.status(500).json({ error: "Issue storage not configured" });
    }

    const report = {
      id: Date.now().toString(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      issue: issue.trim(),
      date: new Date().toISOString()
    };

    let issues = [];
    try {
      const stored = await kvStore.get("reported_issues");
      if (stored) {
        issues = typeof stored === "string" ? JSON.parse(stored) : Array.isArray(stored) ? stored : [];
      }
    } catch (e) {
      console.error("Error loading issues:", e.message);
    }

    issues.push(report);
    const saved = await kvStore.set("reported_issues", JSON.stringify(issues));
    if (!saved) {
      return res.status(500).json({ error: "Failed to save issue" });
    }

    res.json({ success: true, message: "Issue submitted successfully" });
  } catch (error) {
    console.error("Submit review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get approved reviews endpoint
app.get("/api/reviews", async (req, res) => {
  try {
    let approvedReviews = [];
    const reviews = await kvStore.get("approved_reviews");
    if (reviews) {
      approvedReviews = typeof reviews === "string" ? JSON.parse(reviews) : Array.isArray(reviews) ? reviews : [];
    }
    res.json({ reviews: approvedReviews });
  } catch (error) {
    console.error("Get reviews error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get pending reviews
app.get("/api/admin/pending-reviews", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    let pendingReviews = [];
    const reviews = await kvStore.get("pending_reviews");
    if (reviews) {
      pendingReviews = typeof reviews === "string" ? JSON.parse(reviews) : Array.isArray(reviews) ? reviews : [];
    }
    res.json({ reviews: pendingReviews });
  } catch (error) {
    console.error("Get pending reviews error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Approve review
app.post("/api/admin/approve-review", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    const { reviewId } = req.body;
    if (!reviewId) {
      return res.status(400).json({ error: "Review ID required" });
    }

    // Get pending reviews
    let pendingReviews = [];
    const pending = await kvStore.get("pending_reviews");
    if (pending) {
      pendingReviews = typeof pending === "string" ? JSON.parse(pending) : Array.isArray(pending) ? pending : [];
    }

    // Find and remove the review
    const reviewIndex = pendingReviews.findIndex(r => r.id === reviewId);
    if (reviewIndex === -1) {
      return res.status(404).json({ error: "Review not found" });
    }

    const [approvedReview] = pendingReviews.splice(reviewIndex, 1);
    approvedReview.approved = true;

    // Update pending reviews
    await kvStore.set("pending_reviews", JSON.stringify(pendingReviews));

    // Add to approved reviews
    let approvedReviews = [];
    const approved = await kvStore.get("approved_reviews");
    if (approved) {
      approvedReviews = typeof approved === "string" ? JSON.parse(approved) : Array.isArray(approved) ? approved : [];
    }
    approvedReviews.push(approvedReview);
    await kvStore.set("approved_reviews", JSON.stringify(approvedReviews));

    console.log(`Review ${reviewId} approved`);
    res.json({ success: true });
  } catch (error) {
    console.error("Approve review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Delete review
app.post("/api/admin/delete-review", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    const { reviewId } = req.body;
    if (!reviewId) {
      return res.status(400).json({ error: "Review ID required" });
    }

    // Get pending reviews
    let pendingReviews = [];
    const pending = await kvStore.get("pending_reviews");
    if (pending) {
      pendingReviews = typeof pending === "string" ? JSON.parse(pending) : Array.isArray(pending) ? pending : [];
    }

    // Remove the review
    const filteredReviews = pendingReviews.filter(r => r.id !== reviewId);
    await kvStore.set("pending_reviews", JSON.stringify(filteredReviews));

    console.log(`Review ${reviewId} deleted`);
    res.json({ success: true });
  } catch (error) {
    console.error("Delete review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get approved reviews
app.get("/api/admin/approved-reviews", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    let approvedReviews = [];
    const reviews = await kvStore.get("approved_reviews");
    if (reviews) {
      approvedReviews = typeof reviews === "string" ? JSON.parse(reviews) : Array.isArray(reviews) ? reviews : [];
    }
    res.json({ reviews: approvedReviews });
  } catch (error) {
    console.error("Get approved reviews error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Update review (pending or approved)
app.post("/api/admin/update-review", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    const { reviewId, status, name, rating, text } = req.body;

    if (!reviewId || !status) {
      return res.status(400).json({ error: "Review ID and status required" });
    }

    const key = status === "approved" ? "approved_reviews" : "pending_reviews";
    let list = [];
    const stored = await kvStore.get(key);
    if (stored) {
      list = typeof stored === "string" ? JSON.parse(stored) : Array.isArray(stored) ? stored : [];
    }

    const idx = list.findIndex(r => r.id === reviewId);
    if (idx === -1) {
      return res.status(404).json({ error: "Review not found" });
    }

    list[idx] = {
      ...list[idx],
      name: name ?? list[idx].name,
      text: text ?? list[idx].text,
      rating: rating ? parseInt(rating) : list[idx].rating
    };

    await kvStore.set(key, JSON.stringify(list));
    res.json({ success: true, review: list[idx] });
  } catch (error) {
    console.error("Update review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Unpublish review (move approved -> pending)
app.post("/api/admin/unpublish-review", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    const { reviewId } = req.body;
    if (!reviewId) {
      return res.status(400).json({ error: "Review ID required" });
    }

    let approvedReviews = [];
    const approved = await kvStore.get("approved_reviews");
    if (approved) {
      approvedReviews = typeof approved === "string" ? JSON.parse(approved) : Array.isArray(approved) ? approved : [];
    }

    const idx = approvedReviews.findIndex(r => r.id === reviewId);
    if (idx === -1) {
      return res.status(404).json({ error: "Review not found" });
    }

    const [review] = approvedReviews.splice(idx, 1);
    review.approved = false;

    let pendingReviews = [];
    const pending = await kvStore.get("pending_reviews");
    if (pending) {
      pendingReviews = typeof pending === "string" ? JSON.parse(pending) : Array.isArray(pending) ? pending : [];
    }

    pendingReviews.push(review);

    await kvStore.set("approved_reviews", JSON.stringify(approvedReviews));
    await kvStore.set("pending_reviews", JSON.stringify(pendingReviews));

    res.json({ success: true });
  } catch (error) {
    console.error("Unpublish review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Delete approved review
app.post("/api/admin/delete-approved-review", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;
    const { reviewId } = req.body;
    if (!reviewId) {
      return res.status(400).json({ error: "Review ID required" });
    }

    let approvedReviews = [];
    const approved = await kvStore.get("approved_reviews");
    if (approved) {
      approvedReviews = typeof approved === "string" ? JSON.parse(approved) : Array.isArray(approved) ? approved : [];
    }

    const filtered = approvedReviews.filter(r => r.id !== reviewId);
    await kvStore.set("approved_reviews", JSON.stringify(filtered));

    res.json({ success: true });
  } catch (error) {
    console.error("Delete approved review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get active keys list
app.get("/api/admin/active-keys", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;

    const redis = await getRedisClient();
    if (!redis) {
      return res.status(500).json({ error: "Redis connection failed" });
    }

    const purchaseKeys = await redis.keys("purchases:*");
    const items = [];
    for (const key of purchaseKeys) {
      const raw = await redis.get(key);
      const list = raw ? JSON.parse(raw) : [];
      const email = key.replace("purchases:", "");
      list.forEach((p) => {
        items.push({
          email,
          product: p.product || "Unknown",
          licenseKey: p.licenseKey,
          date: p.date || p.createdAt || null,
          orderId: p.orderId || null
        });
      });
    }

    res.json({ items });
  } catch (error) {
    console.error("Active keys error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Email active keys report
app.post("/api/admin/send-key-report", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;

    if (!ADMIN_REPORT_EMAIL) {
      return res.status(400).json({ error: "ADMIN_REPORT_EMAIL not set" });
    }

    const redis = await getRedisClient();
    if (!redis) {
      return res.status(500).json({ error: "Redis connection failed" });
    }

    const purchaseKeys = await redis.keys("purchases:*");
    const rows = [];
    for (const key of purchaseKeys) {
      const raw = await redis.get(key);
      const list = raw ? JSON.parse(raw) : [];
      const email = key.replace("purchases:", "");
      list.forEach((p) => {
        rows.push({
          email,
          product: p.product || "Unknown",
          licenseKey: p.licenseKey,
          date: p.date || p.createdAt || ""
        });
      });
    }

    const textBody = rows
      .map((r) => `${r.email} | ${r.product} | ${r.licenseKey} | ${r.date}`)
      .join("\n");

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
      return res.status(500).json({ error: "SMTP not configured" });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    await transporter.sendMail({
      from: SMTP_FROM,
      to: ADMIN_REPORT_EMAIL,
      subject: "Active License Keys Report",
      text: textBody || "No active keys found."
    });

    res.json({ success: true, count: rows.length });
  } catch (error) {
    console.error("Send key report error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Deactivate key and issue new one
app.post("/api/admin/deactivate-key", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;

    const { email, oldKey, appName } = req.body;
    if (!email || !oldKey || !appName) {
      return res.status(400).json({ error: "Email, oldKey, and appName required" });
    }

    const newKey = await getPooledLicenseKey();
    if (!newKey) {
      return res.status(500).json({ error: "No license keys available" });
    }

    // Mark old key as deactivated
    const deactivatedRaw = await kvStore.get("deactivated_keys");
    const deactivated = deactivatedRaw ? JSON.parse(deactivatedRaw) : [];
    if (!deactivated.includes(oldKey.toUpperCase())) {
      deactivated.push(oldKey.toUpperCase());
      await kvStore.set("deactivated_keys", JSON.stringify(deactivated));
    }

    // Update purchase record
    const redis = await getRedisClient();
    if (!redis) {
      return res.status(500).json({ error: "Redis connection failed" });
    }

    const purchaseKey = `purchases:${email.toLowerCase().trim()}`;
    const raw = await redis.get(purchaseKey);
    const list = raw ? JSON.parse(raw) : [];
    let updated = false;

    const updatedList = list.map((p) => {
      if (String(p.licenseKey).toUpperCase() === String(oldKey).toUpperCase()) {
        updated = true;
        return {
          ...p,
          licenseKey: newKey,
          date: new Date().toISOString()
        };
      }
      return p;
    });

    if (!updated) {
      updatedList.push({
        email,
        licenseKey: newKey,
        product: appName,
        orderId: `MANUAL-REISSUE-${Date.now()}`,
        date: new Date().toISOString()
      });
    }

    await redis.set(purchaseKey, JSON.stringify(updatedList));

    // Do NOT email automatically; admin will send manually
    res.json({ success: true, newKey });
  } catch (error) {
    console.error("Deactivate key error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Rotate all issued keys and replace in purchase records
app.post("/api/admin/rotate-keys", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;

    if (!HAS_REDIS) {
      return res.status(500).json({ error: "Redis URL not configured" });
    }

    const { sendEmails } = req.body || {};

    // Load full key pool
    const loadKeysPayload = async () => {
      if (KEYS_LOCAL_PATH && fs.existsSync(KEYS_LOCAL_PATH)) {
        try {
          const raw = await fs.promises.readFile(KEYS_LOCAL_PATH, "utf8");
          return JSON.parse(raw);
        } catch (e) {
          console.error("Error reading KEYS_LOCAL_PATH:", e.message);
        }
      }

      if (KEYS_REMOTE_URL) {
        try {
          const response = await fetch(KEYS_REMOTE_URL);
          if (!response.ok) return null;
          return response.json();
        } catch (e) {
          console.error("Error fetching KEYS_REMOTE_URL:", e.message);
        }
      }

      return null;
    };

    const payload = await loadKeysPayload();
    if (!payload) {
      return res.status(500).json({ error: "Failed to load key pool" });
    }

    let keysList = [];
    if (Array.isArray(payload)) {
      keysList = payload;
    } else if (Array.isArray(payload.keys)) {
      keysList = payload.keys;
    }

    if (!keysList.length) {
      return res.status(500).json({ error: "Key pool is empty" });
    }

    const redis = await getRedisClient();
    if (!redis) {
      return res.status(500).json({ error: "Redis connection failed" });
    }

    // Get all purchase records
    const purchaseKeys = await redis.keys("purchases:*");
    if (!purchaseKeys.length) {
      return res.json({ success: true, message: "No purchases found to rotate" });
    }

    // Old issued set to avoid reusing old keys
    const oldIssuedRaw = await redis.get("issued_keys");
    const oldIssuedList = oldIssuedRaw ? JSON.parse(oldIssuedRaw) : [];
    const oldIssuedSet = new Set(oldIssuedList.map((k) => String(k).toUpperCase()));

    const available = keysList
      .map((k) => String(k).toUpperCase())
      .filter((k) => k && !oldIssuedSet.has(k));

    // Count total purchases
    let totalPurchases = 0;
    const purchasesByKey = [];
    for (const key of purchaseKeys) {
      const raw = await redis.get(key);
      const list = raw ? JSON.parse(raw) : [];
      const email = key.replace("purchases:", "");
      list.forEach((p) => {
        purchasesByKey.push({
          email,
          product: p.product || "Unknown",
          orderId: p.orderId,
          date: p.date || p.createdAt,
          oldKey: p.licenseKey
        });
      });
      totalPurchases += list.length;
    }

    if (available.length < totalPurchases) {
      return res.status(500).json({
        error: `Not enough unused keys to rotate. Need ${totalPurchases}, have ${available.length}.`
      });
    }

    // Assign new keys
    let idx = 0;
    const newIssued = [];
    const updatedByEmail = {};

    for (const purchase of purchasesByKey) {
      const newKey = available[idx++];
      newIssued.push(newKey);

      if (!updatedByEmail[purchase.email]) {
        updatedByEmail[purchase.email] = [];
      }

      updatedByEmail[purchase.email].push({
        email: purchase.email,
        licenseKey: newKey,
        product: purchase.product,
        orderId: purchase.orderId,
        date: purchase.date
      });
    }

    // Write updated purchases
    for (const email of Object.keys(updatedByEmail)) {
      await redis.set(`purchases:${email}`, JSON.stringify(updatedByEmail[email]));
    }

    // Replace issued_keys
    await redis.set("issued_keys", JSON.stringify(newIssued));

    // Optionally email customers
    if (sendEmails) {
      for (const email of Object.keys(updatedByEmail)) {
        for (const p of updatedByEmail[email]) {
          await sendKeyEmail(email, p.licenseKey, p.product || "Unknown");
        }
      }
    }

    res.json({
      success: true,
      rotated: totalPurchases,
      emailsSent: Boolean(sendEmails)
    });
  } catch (error) {
    console.error("Rotate keys error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get reported issues
app.get("/api/admin/issues", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;

    const stored = await kvStore.get("reported_issues");
    const issues = stored ? (typeof stored === "string" ? JSON.parse(stored) : stored) : [];
    res.json({ issues });
  } catch (error) {
    console.error("Get issues error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Resolve (remove) issue
app.post("/api/admin/resolve-issue", async (req, res) => {
  try {
    const authorized = await requireAdmin(req, res);
    if (!authorized) return;

    const { issueId } = req.body;
    if (!issueId) {
      return res.status(400).json({ error: "Issue ID required" });
    }

    const stored = await kvStore.get("reported_issues");
    const issues = stored ? (typeof stored === "string" ? JSON.parse(stored) : stored) : [];
    const updated = issues.filter((i) => i.id !== issueId);
    await kvStore.set("reported_issues", JSON.stringify(updated));
    res.json({ success: true });
  } catch (error) {
    console.error("Resolve issue error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
