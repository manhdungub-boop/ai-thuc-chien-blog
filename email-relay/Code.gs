/**
 * Google Apps Script mail relay for AI Thực Chiến community email verification.
 * Deploy as a Web app: Execute as Me; access Anyone. The shared secret is stored in Script Properties.
 */
function doPost(e) {
  const output = (value) => ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const properties = PropertiesService.getScriptProperties();
    const expected = String(properties.getProperty('COMMUNITY_EMAIL_RELAY_SECRET') || '');
    if (expected.length < 32) return output({ ok: false, code: 'RELAY_NOT_CONFIGURED' });
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw || raw.length > 25000) return output({ ok: false, code: 'INVALID_REQUEST' });
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { return output({ ok: false, code: 'INVALID_REQUEST' }); }
    const supplied = String(payload.secret || '');
    if (!constantTimeEquals_(expected, supplied)) return output({ ok: false, code: 'UNAUTHORIZED' });

    const recipient = String(payload.to || '').trim();
    const subject = String(payload.subject || 'Xác nhận email — AI Thực Chiến').slice(0, 160);
    const textBody = String(payload.textBody || '');
    const htmlBody = String(payload.htmlBody || '');
    const verifyUrl = String(payload.verifyUrl || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254 ||
        !textBody || !htmlBody || !/^https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\//.test(verifyUrl) ||
        !/[?]verify=[A-Za-z0-9_-]{32,80}/.test(verifyUrl)) {
      return output({ ok: false, code: 'INVALID_MESSAGE' });
    }
    if (MailApp.getRemainingDailyQuota() < 1) return output({ ok: false, code: 'DAILY_QUOTA_EXHAUSTED' });
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: 'AI Thực Chiến'
    });
    return output({ ok: true });
  } catch (_) {
    // Do not log the incoming payload, recipient, verification token, or secret.
    return output({ ok: false, code: 'SEND_FAILED' });
  }
}

function constantTimeEquals_(expected, supplied) {
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}
