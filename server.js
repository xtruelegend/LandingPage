import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";
const PRODUCT_PRICE = process.env.PRODUCT_PRICE || "9.99";
const CURRENCY = process.env.CURRENCY || "USD";
const KEYS_REMOTE_URL = process.env.KEYS_REMOTE_URL || "";
const KEYS_VALIDATE_URL = process.env.KEYS_VALIDATE_URL || "";
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

function createLicenseKey() {
  const raw = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function saveLicenseKey(record) {
  ensureDataFile();
  const existing = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  existing.push(record);
  fs.writeFileSync(KEYS_FILE, JSON.stringify(existing, null, 2));
}

async function sendKeyEmail(to, licenseKey, appName) {
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

  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `Your ${appName} License Key`,
    text: `Thanks for your purchase!\n\nHere is your license key: ${licenseKey}\n\nDownload your app at: http://localhost:3000/downloads/BudgetXT-Setup-1.5.3.exe\n\nIf you need help, just reply to this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>Thanks for your purchase!</h2>
        <p>Here is your <strong>${appName}</strong> license key:</p>
        <p style="font-size:20px;font-weight:bold;padding:16px;background:#f5f5f5;border-radius:8px;">${licenseKey}</p>
        <p style="margin-top:24px;"><strong>Download Your App:</strong></p>
        <p><a href="http://localhost:3000/downloads/BudgetXT-Setup-1.5.3.exe" style="background:#00d1ff;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Download BudgetXT</a></p>
        <p style="margin-top:24px;color:#666;font-size:14px;">If you need help, just reply to this email.</p>
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

app.post("/api/verify-key", async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: "Key is required" });
    }

    const normalizedKey = key.toUpperCase();

    const localMatchesKey = () => {
      ensureDataFile();
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
    };

    const remoteMatchesKey = async () => {
      if (KEYS_VALIDATE_URL) {
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
      }

      const loadKeysPayload = async () => {
        if (KEYS_LOCAL_PATH && fs.existsSync(KEYS_LOCAL_PATH)) {
          const raw = await fs.promises.readFile(KEYS_LOCAL_PATH, "utf8");
          return JSON.parse(raw);
        }

        if (!KEYS_REMOTE_URL) return null;
        const response = await fetch(KEYS_REMOTE_URL);
        if (!response.ok) return null;
        return response.json();
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
              value: PRODUCT_PRICE
            }
          }
        ],
        return_url: `${req.protocol}://${req.get("host")}/return`,
        cancel_url: `${req.protocol}://${req.get("host")}/`
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

    const licenseKey = createLicenseKey();

    saveLicenseKey({
      orderId: orderID,
      email: desiredEmail,
      licenseKey,
      product: productName,
      createdAt: new Date().toISOString()
    });

    const emailResult = await sendKeyEmail(desiredEmail, licenseKey, productName);

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

    const licenseKey = createLicenseKey();
    saveLicenseKey({
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

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
