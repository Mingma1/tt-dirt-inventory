/**
 * COPY THIS ENTIRE FILE AND PASTE IT INTO GOOGLE APPS SCRIPT
 * 
 * 1. Go to your Google Sheet > Extensions > Apps Script
 * 2. Paste this code, replacing whatever is there.
 * 3. Click "Deploy" > "Manage Deployments"
 * 4. Important: Edit your deployment, select "New version" for Version.
 * 5. Set "Execute as" to "Me" and "Who has access" to "Anyone"
 * 6. Click "Deploy"
 */

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = sheet.getDataRange().getDisplayValues();
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // If we receive a POST without content, error out
  if (!e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("Error: No data received")
      .setMimeType(ContentService.MimeType.TEXT_PLAIN);
  }

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    
    // Parse the JSON payload coming from app.js
    var payload = JSON.parse(e.postData.contents);
    
    // ACTION: ADD
    if (payload.action === 'add') {
      sheet.appendRow(payload.row);
    } 
    // ACTION: UPDATE
    else if (payload.action === 'update') {
      // rowIndex from app.js is exactly matching the physical spreadsheet row
      // payload.row contains the updated array
      var range = sheet.getRange(payload.rowIndex, 1, 1, payload.row.length);
      range.setValues([payload.row]);
    }
    // ACTION: DELETE
    else if (payload.action === 'delete') {
      sheet.deleteRow(payload.rowIndex);
    }
    else {
      return ContentService.createTextOutput("Error: Unknown action " + payload.action)
        .setMimeType(ContentService.MimeType.TEXT_PLAIN);
    }
    
    // Must return text so fetch API doesn't throw parsing errors on no-cors
    return ContentService.createTextOutput("Success")
      .setMimeType(ContentService.MimeType.TEXT_PLAIN);
      
  } catch (err) {
    return ContentService.createTextOutput("Error: " + err.message)
      .setMimeType(ContentService.MimeType.TEXT_PLAIN);
  }
}
