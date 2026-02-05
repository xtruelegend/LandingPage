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

  const issued = (() => {
    try {
      if (!fs.existsSync(KEYS_FILE)) return new Set();
      const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      const records = Array.isArray(raw) ? raw : [];
      return new Set(records.map((record) => String(record.licenseKey || "").toUpperCase()));
    } catch (e) {
      console.error("Error reading issued keys:", e.message);
      return new Set();
    }
  })();

  const nextKey = keysList
    .map((key) => String(key).toUpperCase())
    .find((key) => key && !issued.has(key));

  return nextKey || null;
}

function saveLicenseKey(record) {
  // On Vercel (serverless), we can't write to local filesystem
  // In production, you'd send this to a database or remote endpoint
  if (process.env.VERCEL) {
    console.log("License key record (not saved locally on Vercel):", record);
    return;
  }
  
  // For local development only
  try {
    ensureDataFile();
    const existing = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    existing.push(record);
    fs.writeFileSync(KEYS_FILE, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error("Warning: Could not save license key record:", err.message);
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
    text: `Thanks for your purchase!\n\nOrder Confirmation\n=================\nApp: ${appName}\nLicense Key: ${licenseKey}\nDate: ${purchaseDate}\n\nDownload: ${downloadUrl}\n\nQuestions? Reply to this email.`,
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

          <div style="background: #f0f8ff; padding: 16px; border-radius: 6px; margin-top: 24px; border-left: 4px solid #00d1ff;">
            <p style="margin: 0; color: #0066cc; font-size: 14px;"><strong>Need Help?</strong></p>
            <p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">If you have any questions or issues, just reply to this email. We're here to help!</p>
          </div>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 32px 0;">
          <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">© 2026 TechApps. All rights reserved.</p>
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

app.post("/api/verify-key", async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: "Key is required" });
    }

    const normalizedKey = key.toUpperCase();

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

    saveLicenseKey({
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
