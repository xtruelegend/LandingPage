# App Landing Page

Clean, minimal landing page for selling apps with PayPal integration and automatic email delivery.

## Features

- Clean white design with minimal aesthetic
- PayPal checkout integration
- Automatic license key generation
- Email delivery of purchase keys
- Responsive design

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create `.env` file from `.env.example`:
   ```
   cp .env.example .env
   ```

3. Configure your PayPal credentials in `.env`

4. (Optional) Configure SMTP for email delivery

5. Start the server:
   ```
   npm run dev
   ```

6. Open http://localhost:3000

## Configuration

Edit the apps in `public/app.js` to customize your product offerings.
