# Email Setup Guide for License Key Delivery

## Overview
Your landing page now sends professional email receipts with license keys to customers after they purchase. The email includes:
- ✓ Purchase confirmation
- ✓ License key (highlighted for easy copying)
- ✓ Purchase date and email confirmation
- ✓ Direct download link to the app
- ✓ Professional formatting with your branding

## What the Customer Receives

The email looks like this:

```
┌──────────────────────────────────────────────────────────┐
│          [BLUE GRADIENT HEADER]                          │
│          ✓ Purchase Confirmed                            │
│          Thank you for your purchase!                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Order Details                                           │
│ ├─ Product: BudgetXT                                    │
│ ├─ Purchase Date: February 05, 2026                     │
│ └─ Email: customer@example.com                          │
│                                                          │
│ Your License Key                                        │
│ │                                                       │
│ │  BBT1.8KFELQAE.HE9NKPZ2                              │
│ │                                                       │
│                                                          │
│ Get Started                                             │
│ [Download BudgetXT Button]                              │
│                                                          │
│ [Help section with contact info]                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Step 1: Choose Your Email Provider

#### Option A: Gmail (Recommended for Testing)
1. Go to: https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer"
3. Google will generate a 16-character app-specific password
4. Copy that password

Then in Vercel, add these environment variables:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=<16-character password from step 3>
SMTP_FROM=noreply@techapps.com
```

#### Option B: Outlook/Hotmail
```
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
SMTP_FROM=noreply@techapps.com
```

#### Option C: SendGrid (Recommended for Production)
1. Sign up at: https://sendgrid.com
2. Create an API key
3. Use these settings:
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your-full-api-key
SMTP_FROM=noreply@techapps.com
```

### Step 2: Add to Vercel Environment Variables

1. Go to: https://vercel.com/dashboard
2. Select your LandingPage project
3. Click "Settings" → "Environment Variables"
4. Add these variables:
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_FROM`

5. Redeploy your project (Vercel will automatically restart with new vars)

### Step 3: Test It Out

Make a test purchase:
1. Go to your landing page
2. Click "Buy" on BudgetXT
3. Complete a test purchase using PayPal sandbox
4. Check your email inbox for the receipt with license key

## Multiple Apps Support

The system is now set up to support multiple apps! Here's how to add new apps:

### In `server.js`, the `APP_DOWNLOADS` object:

```javascript
const APP_DOWNLOADS = {
  "BudgetXT": "BudgetXT-Setup-1.5.3.exe",
  "MyNewApp": "MyNewApp-Setup-1.0.0.exe",
  "AnotherApp": "AnotherApp-Setup-2.1.0.zip"
};
```

When you create a new app:
1. Build the setup file
2. Upload it to `/public/downloads/`
3. Add an entry to `APP_DOWNLOADS` in server.js
4. Create a new product in `app.js`

The download link will **automatically adjust** based on which app the customer buys!

## How It Works Behind the Scenes

1. **Customer purchases** → PayPal payment completes
2. **License key pulled** → `getPooledLicenseKey()` gets next available key from your pool
3. **Email triggered** → `sendKeyEmail()` sends professional receipt
4. **Automatic download** → Email includes correct download link for that app
5. **Future apps** → Just add new entry to `APP_DOWNLOADS` and it works for all future sales

## Troubleshooting

### Emails Not Sending?
- Check Vercel logs: Project → Deployments → Recent deployment → Logs
- Verify all SMTP variables are set in Vercel (no typos)
- For Gmail: Make sure you used the 16-char app password, not your regular password
- For Gmail: Enable "Less secure app access" if using regular password

### Email Shows Old App Name?
- Rebuild happens on next deploy
- Force redeploy: `git push` to trigger new Vercel deployment

### Want to Change Email Template?
- Edit the HTML in `sendKeyEmail()` function in server.js
- Test with another purchase
- Push changes to redeploy

## FAQ

**Q: Can customers get a resend of their license key?**
A: Yes! Add a "Resend Key" button later that emails the last key for their email address.

**Q: What if I want a different sender email?**
A: Change `SMTP_FROM` - this is what appears in "From:" field.

**Q: Can I customize the email template?**
A: Yes! Edit the HTML in the `sendKeyEmail()` function. The `${appName}` and `${licenseKey}` variables will auto-fill.

**Q: Do I need to configure SMTP to use the platform?**
A: No, but customers won't get their license key via email. You can manually send keys for now, then set up email later.
