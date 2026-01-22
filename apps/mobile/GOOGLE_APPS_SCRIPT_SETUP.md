# Google Apps Script Email Relay Setup

This Google Apps Script serves as a backend relay to receive support messages from the mobile app and forward them via email.

## Apps Script Code

Create a new Google Apps Script project and paste this code:

```javascript
/**
 * ChessView Live - Support Email Relay
 * 
 * This script receives support messages from the mobile app via HTTP POST
 * and forwards them to the support inbox via email.
 */

// ===== CONFIGURATION =====
// TODO: Replace these values before deploying
const SUPPORT_EMAIL = 'support@chessviewlive.com'; // Your support inbox
const APP_SECRET = 'YOUR_RANDOM_SECRET_TOKEN_HERE'; // Must match mobile app config
// =========================

/**
 * Handles HTTP POST requests from the mobile app
 */
function doPost(e) {
  try {
    // Verify secret token for basic abuse protection
    const providedSecret = e.parameter['X-APP-SECRET'] || 
                          (e.postData && e.postData.headers && e.postData.headers['X-APP-SECRET']);
    
    if (providedSecret !== APP_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: 'Unauthorized'
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setStatusCode(401);
    }

    // Parse payload
    const payload = JSON.parse(e.postData.contents);
    const { userEmail, message, appVersion, platform, timestamp } = payload;

    // Validate required fields
    if (!userEmail || !message) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: 'Missing required fields'
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }

    // Compose email
    const subject = `ChessView Live Support - ${platform || 'Unknown'}`;
    const body = `
New support request received:

From: ${userEmail}
Platform: ${platform || 'Unknown'}
App Version: ${appVersion || 'Unknown'}
Timestamp: ${timestamp || 'Unknown'}

Message:
${message}

---
This email was sent automatically from the ChessView Live mobile app.
    `.trim();

    // Send email
    MailApp.sendEmail({
      to: SUPPORT_EMAIL,
      subject: subject,
      body: body,
      replyTo: userEmail
    });

    // Return success
    return ContentService.createTextOutput(JSON.stringify({
      ok: true
    }))
    .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    // Log error for debugging
    Logger.log('Error processing request: ' + error.toString());
    
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: 'Internal server error'
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Test function - run this to verify the script works
 */
function testEmail() {
  const testPayload = {
    userEmail: 'test@example.com',
    message: 'This is a test message',
    appVersion: '1.0.0',
    platform: 'ios',
    timestamp: new Date().toISOString()
  };
  
  const mockEvent = {
    parameter: { 'X-APP-SECRET': APP_SECRET },
    postData: {
      contents: JSON.stringify(testPayload)
    }
  };
  
  const result = doPost(mockEvent);
  Logger.log(result.getContent());
}
```

## Deployment Instructions

### 1. Create Google Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click "+ New project"
3. Paste the code above into `Code.gs`
4. **IMPORTANT**: Update the configuration:
   - Set `SUPPORT_EMAIL` to your actual support inbox
   - Set `APP_SECRET` to a random string (generate one below)

### 2. Generate Secret Token

Run this in your terminal to generate a random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or use any password generator. Copy the result and use it for both:
- `APP_SECRET` in the Apps Script
- `SUPPORT_SECRET` in `mobile/src/config/supportConfig.ts`

### 3. Test the Script (Optional)

1. In Apps Script editor, select `testEmail` from the function dropdown
2. Click "Run"
3. Authorize the script when prompted
4. Check your support inbox for a test email
5. Check "Execution log" for any errors

### 4. Deploy as Web App

1. Click "Deploy" → "New deployment"
2. Click the gear icon ⚙️ next to "Select type"
3. Choose "Web app"
4. Configure:
   - **Description**: ChessView Live Support Relay
   - **Execute as**: Me (your_email@gmail.com)
   - **Who has access**: Anyone
5. Click "Deploy"
6. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec`)

### 5. Update Mobile App Config

1. Open `mobile/src/config/supportConfig.ts`
2. Replace `SUPPORT_RELAY_URL` with your Web app URL
3. Replace `SUPPORT_SECRET` with the same secret from step 2

### 6. Test End-to-End

1. Run the mobile app
2. Navigate to Help screen (3-dots menu → Help)
3. Fill in the form and tap Send
4. Check your support inbox for the email
5. Verify the email contains all the metadata

## Security Notes

- The secret token provides basic protection against unauthorized requests
- The support email address is **never** exposed to the mobile app
- All requests are logged in Apps Script's execution logs
- You can add rate limiting by tracking requests in Properties Service if needed

## Troubleshooting

**If emails aren't arriving:**
1. Check Apps Script execution logs: View → Logs
2. Verify the secret token matches in both places
3. Ensure the Web app is deployed with "Anyone" access
4. Check spam folder in your support inbox

**If you see "Unauthorized" errors:**
- The secret tokens don't match
- Check both `APP_SECRET` in Apps Script and `SUPPORT_SECRET` in mobile config

**If you see "Internal server error":**
- Check Apps Script execution logs for details
- Verify the payload structure is correct
- Ensure MailApp is authorized
