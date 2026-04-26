/**
 * 1. Go to your Google Sheet > Extensions > Apps Script
 * 2. Paste this code, replacing whatever is there.
 * 3. Click "Deploy" > "Manage Deployments"
 * 4. Important: Edit your deployment, select "New version" for Version.
 * 5. Set "Execute as" to "Me" and "Who has access" to "Anyone"
 * 6. Click "Deploy"
 */

function setupHistorySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var historySheet = ss.getSheetByName("Sales History");
  
  if (!historySheet) {
    historySheet = ss.insertSheet("Sales History");
    historySheet.appendRow(["Timestamp", "Part ID", "Item Name", "Quantity Sold", "Cost Price", "Sale Price", "Total Profit"]);
    // Make headers bold
    historySheet.getRange("A1:G1").setFontWeight("bold");
    // Freeze top row
    historySheet.setFrozenRows(1);
  }
  
  return historySheet;
}

function doGet(e) {
  var action = e.parameter.action;
  var callback = e.parameter.callback;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var responseData;
  if (action === 'getHistory') {
    var historySheet = ss.getSheetByName("Sales History");
    if (!historySheet) {
      responseData = [];
    } else {
      responseData = historySheet.getDataRange().getDisplayValues();
    }
  } 
  else {
    // Default GET returns inventory
    var sheet = ss.getSheets()[0];
    responseData = sheet.getDataRange().getDisplayValues();
  }

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
    var historySheet = setupHistorySheet(); // Ensures history tab exists
    
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
    // ACTION: SELL
    else if (payload.action === 'sell') {
      // Update the main sheet stock count
      var range = sheet.getRange(payload.rowIndex, 1, 1, payload.row.length);
      range.setValues([payload.row]);
      
      // Add the record to the history sheet
      var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      var partId = payload.soldItem.partId;
      var itemName = payload.soldItem.itemName;
      var qty = 1; // Selling 1 at a time for now
      var cost = payload.soldItem.cost;
      var sale = payload.soldItem.sale;
      var profit = (sale - cost).toFixed(2);
      
      historySheet.appendRow([timestamp, partId, itemName, qty, cost, sale, profit]);
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
