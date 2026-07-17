function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var botToken = String(body.botToken || '').trim();
    var chatId = String(body.chat_id || body.chatId || '').trim();
    var text = String(body.text || '').trim();

    if (!botToken || !chatId || !text) {
      return jsonResponse({
        ok: false,
        description: 'botToken, chatId, and text are required'
      });
    }

    var response = UrlFetchApp.fetch(
      'https://api.telegram.org/bot' + botToken + '/sendMessage',
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: body.parse_mode || 'HTML',
          disable_web_page_preview: body.disable_web_page_preview !== false
        })
      }
    );

    return jsonResponse(JSON.parse(response.getContentText() || '{}'));
  } catch (error) {
    return jsonResponse({
      ok: false,
      description: error.message
    });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
