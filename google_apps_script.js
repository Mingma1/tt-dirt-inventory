/**
 * 1. Go to your Google Sheet > Extensions > Apps Script
 * 2. Paste this code, replacing whatever is there.
 * 3. Click "Deploy" > "Manage Deployments"
 * 4. Important: Edit your deployment, select "New version" for Version.
 * 5. Set "Execute as" to "Me" and "Who has access" to "Anyone"
 * 6. Click "Deploy"
 */

function doGet(e) {
  var action = e.parameter.action;
  var callback = e.parameter.callback;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var responseData;
  // Default GET returns inventory
  var sheet = ss.getSheets()[0];
  responseData = sheet.getDataRange().getDisplayValues();

  // Handle JSONP fallback for CORS-blocked browsers
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(responseData) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    return ContentService.createTextOutput(JSON.stringify(responseData))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  if (!e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("Error: No data received")
      .setMimeType(ContentService.MimeType.TEXT_PLAIN);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0]; // Main inventory sheet
    
    var payload = JSON.parse(e.postData.contents);
    
    // ACTION: ADD
    if (payload.action === 'add') {
      sheet.appendRow(payload.row);
    } 
    // ACTION: UPDATE
    else if (payload.action === 'update') {
      var range = sheet.getRange(payload.rowIndex, 1, 1, payload.row.length);
      range.setValues([payload.row]);
    }
    // ACTION: DELETE
    else if (payload.action === 'delete') {
      sheet.deleteRow(payload.rowIndex);
    }
    
    return ContentService.createTextOutput("Success")
      .setMimeType(ContentService.MimeType.TEXT_PLAIN);
      
  } catch (err) {
    return ContentService.createTextOutput("Error: " + err.message)
      .setMimeType(ContentService.MimeType.TEXT_PLAIN);
  }
}
